---
title: 'Linux 基础 05：文本处理——把 grep/sort/uniq 变成你的分析工具'
description: '流式思维：一行进、一行出，不做中间文件；grep 的过滤语义、sort 与 uniq 的先后顺序、cut/tr/wc/awk 的分工，以及从 2GB 访问日志里算出 Top IP 与每分钟请求数的真实用法。'
link: linux-05-text-processing
catalog: true
date: 2022-04-13 20:30:00
updated: 2022-04-13 22:10:00
categories: ['笔记']
tags: ['Linux', '基础']
draft: false
---

## 这一节要解决什么

“统计一下别人最常访问哪个接口”“找出打了最多请求的 IP”“5xx 涨了没有”——这些问题的答案都在文本里，而且**九十% 的场景不需要写脚本**。真正需要的是记住六个工具的分工，以及一条被反复验证的管道习惯：`grep → sort → uniq -c → sort -rn`。

## 一、流式思维：一行进，一行出

这些工具都是**按行**工作的：读一行、处理、输出一行。好处是内存占用基本恒定（例外下面会说），并且**不需要中间文件**：

```bash title="常见的三段式管道" command:("$":1)
cat access.log | grep ' 500 ' | awk '{print $7}' | sort | uniq -c | sort -rn | head
```

工具分工先记牢：

| 工具 | 只做一件事 |
| --- | --- |
| `grep` | **筛选行**（留或丢） |
| `sort` | **重排行**（需要看完整份数据） |
| `uniq` | **合并相邻的重复行**（所以必须先 sort） |
| `cut` / `awk` | **切列** |
| `tr` | **按字符替换/压缩/转换** |
| `wc` | 计数（行/字/字节） |

## 二、grep：它是"过滤器"，不是"搜索框"

```bash title="grep 的六个常用面" command:("$":1-6)
grep -c 'ERROR' app.log         # 匹配的“行数”
grep -o 'ERROR' app.log | wc -l # 匹配的“出现次数” ← 两者不同！
grep -n 'ERROR' app.log         # 带行号
grep -v 'DEBUG' app.log         # 只要不含 DEBUG 的行（反向）
grep -i 'error' app.log         # 忽略大小写
grep -A3 -B1 'panic' app.log    # 前后上下文：后 3 行、前 1 行
```

**我的批注**：

- 默认是**基础正则**，`|` 这种要转义或加 `-E`；`~` 匹配整行用 `-x`。
- 日志里搜固定串（IP、UUID）用 `-F`：不做正则解析，更快也更不容易被 `.` 这类字符咬到。
- **`-c` 数的是行数**：一行里出现两次 `ERROR`，`grep -c` 也只算 1；要数出现次数用 `grep -o | wc -l`。这个差别我在做告警阈值时踩过。

## 三、sort 与 uniq：顺序决定结果

```bash title="排序与去重" command:("$":1-4)
sort file               # 字典序：注意 "10" 会排在 "9" 前面
sort -n file            # 数值序
sort -k2,2 -n file      # 只按第 2 列排（列区间要比列号 2,2）
sort -u file            # 排序 + 去重（只想去重时最省事）
sort -t: -k3,3n /etc/passwd     # 指定分隔符 + 按第 3 列数值
```

```bash title="uniq 只比较相邻行" command:("$":1-3)
sort ips.txt | uniq -c | sort -rn | head     # ⭐ 经典四联：Top N
uniq -d ips.txt      # 只输出重复项（不 sort 就是白干）
uniq -u ips.txt      # 只输出唯一项
```

**批注**：`uniq` 的算法就是"和前一行比"，所以**不排序等于没去重**——这是初学者最大的坑。`uniq -c` 的输出格式是"**空格 + 计数 + 内容**"，取字段时用 `awk '{print $2}'`。

## 四、cut / tr / wc / awk 的分工

```bash title="切列与字符处理" command:("$":1-5)
cut -d' ' -f1,7 access.log | head     # 默认是 Tab 分隔，取空格列必须 -d' '
tr -s ' '                             # 压缩连续空格
tr 'A-Z' 'a-z' < file                 # 大小写转换（tr 只按字符对应）
wc -l file; wc -c file; wc -w file    # 行 / 字节 / 词
awk '{print $7}' access.log           # 按任意空白切列，比 cut 更皮实
```

**批注**：`cut` 的 `-d' '` 是"单个空格"，遇到连续空格会产生空字段；`awk` 默认按 `FS=" "` 处理连续空白——**生产日志切列我现在直接用 awk**。

## 五、真实案例：从访问日志里算出三件事

以 Nginx 默认组合格式为例（先看一眼再动手）：

```bash title="先确认格式" command:("$":1) mark:1
head -1 /var/log/nginx/access.log
# 127.0.0.1 - - [13/Apr/2022:20:31:02 +0800] "GET /post/linux-01 HTTP/1.1" 200 5123 "-" "curl/7.81.0"
```

```bash title="Top IP / 每分钟请求量 / 5xx 接口" command:("$":1-4)
# 1) 请求最多的 10 个客户端 IP
awk '{print $1}' /var/log/nginx/access.log | sort | uniq -c | sort -rn | head -10

# 2) 每分钟的请求量（时间在 $4，形如 [13/Apr/2022:20:31:02）
awk '{print $4}' /var/log/nginx/access.log | cut -d: -f1-3 | sort | uniq -c | sort -rn | head

# 3) 只统计 5xx，并看是哪些接口
awk '$9 ~ /^5/ {print $7, $9}' /var/log/nginx/access.log | sort | uniq -c | sort -rn | head
```

**批注**：这三条命令行我在这几年的排障里用得比任何自写脚本都多。注意 `$4`、`$9` 是 **Nginx 组合格式的位置**；Apache combined 的列号不同，所以第一步永远是 `head -1`。

大文件的处理顺序建议：

```bash title="大日志的处理习惯" command:("$":1-3)
# 先按时间窗切，再统计 —— 减少后续处理的数据量
grep -F '13/Apr/2022' big.log > /tmp/today.log
wc -l /tmp/today.log
awk '{print $1}' /tmp/today.log | sort | uniq -c | sort -rn | head
```

## 六、动手清单

```bash title="五条命令验完本节" command:("$":1-6)
printf 'b\na\nb\nc\n' > l.txt
sort l.txt | uniq -c                       # 1. 计数
sort -u l.txt; sort -n <<< $'10\n9\n2'     # 2. 字典序 vs 数值序
printf 'a a  a\n' | tr -s ' '              # 3. 压缩空格
echo 'ERROR ERROR' | grep -c ERROR         # 4. 1（行数）
echo 'ERROR ERROR' | grep -o ERROR | wc -l # 5. 2（出现次数）
wc -l l.txt; wc -c l.txt                   # 6. 行数与字节数
```

## 小结

- 六个工具各有分工；**统计类任务的标准管道是 `sort | uniq -c | sort -rn | head`**。
- `grep -c` 数行、`grep -o | wc -l` 数出现次数——不一样。
- `uniq` 只处理相邻重复，所以**必须排序**；`sort` 是唯一要吞下全部数据的步骤。
- 切列优先用 `awk`（连续空白友好）；`cut` 需显式指定单字符分隔符。
- 真实排障先 `head -1` 确认字段位置，再拼统计管道。

## 下一节预告

下一节：管道与重定向——`stdin/stdout/stderr` 三条流、`2>&1` 的顺序为什么重要、管道退出码与 `pipefail`，以及"为什么 `sudo echo > /root/file` 会失败"。
