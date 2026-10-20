---
title: 'Linux 基础 06：管道与重定向——三条流、一个顺序问题'
description: 'stdin/stdout/stderr 的本质、`2>&1` 为什么"顺序比内容重要"、`>` 会先清空文件、管道退出码与 pipefail、tee 与进程替换，以及 sudo 重定向失败的真实原因。'
link: linux-06-pipes-and-redirection
catalog: true
date: 2022-04-14 20:30:00
updated: 2022-04-14 22:10:00
categories: ['笔记']
tags: ['Linux', '基础']
draft: false
---

## 这一节要解决什么

重定向和管道是 shell 里最像"魔法"的部分：`> log 2>&1 &` 这一串符号为什么能同时决定输出去哪、错误去哪、进程在哪。它们的答案都在**文件描述符**上——而且有一个真实事故级别的顺序问题：`2>&1 > file` 和 `> file 2>&1` 完全不是一个意思。

## 一、先承认一件事：程序只有三个出口

每个进程启动时，内核都会给它三个已打开的"文件"：

| fd | 名字 | 默认指向 | 用途 |
| --- | --- | --- | --- |
| 0 | stdin | 你的键盘（pty） | 输入 |
| 1 | stdout | 终端 | 正常输出 |
| 2 | stderr | 终端 | 错误与日志 |

**重定向的本质是 `dup2()`**：shell 在 fork 出子进程、exec 之前，把 fd 1（或 2）换成你指定的文件。所以"重定向是 shell 做的"这句话决定了后面所有的坑。

```bash title="三条流的分离" command:("$":1-3)
ls /etc > out.txt              # stdout → out.txt，错误仍然打在终端
ls /nope 2> err.txt             # stderr → err.txt
ls /etc /nope > out.txt 2>&1    # 两个都进 out.txt ← 注意顺序
```

## 二、`2>&1` 的顺序：一个真实事故级别的细节

`2>&1` 的含义是"**把 stderr 复制到当前 stdout 指向的地方**"，所以它的效果**取决于它出现的位置**：

```bash title="两种写法，两种结果" command:("$":1-3) mark:2
ls /etc /nope > all.txt 2>&1    # ✅ 先改 1 → all.txt，再把 2 也指到同一处：都进 all.txt
ls /etc /nope 2>&1 > all.txt    # ❌ 先把 2 指到"当时的 1"（还是终端），再改 1 → all.txt
```

**批注**：第二种写法里，错误会打在终端、正常输出进文件——很多"日志里怎么少了报错"的疑难都是这一行。记法：**从左到右、即时生效**。`bash` 还提供了简写 `&>`（等价 `> file 2>&1`），`zsh` 里是 `>&`。

有意思的是 `>` 的行为：它是"打开 + 截断"，所以

```bash title="为什么 > 会先把文件清空" command:("$":1-3)
echo hi > f; echo there > f; cat f        # there（旧的 hi 被截掉）
set -o noclobber; echo x > f 2>&1 | head -1   # 拒绝覆盖已存在文件
echo x >| f                                   # 强制覆盖（noclobber 下的例外语法）
```

## 三、管道：shell 搭的两根管子

```bash title="管道背后发生了什么" command:("$":1-2)
ls -l /etc | grep passwd          # 两个进程 + 一个 pipe(2)
# 等价于: ls 的 stdout 接到 pipe 写端，grep 的 stdin 接到 pipe 读端
```

管道是**并发**的：`a | b` 里 a、b 同时在跑，不是"a 跑完再跑 b"。这也是为什么 `yes | head -1` 不会无限运行——`head` 读够就退出，`yes` 收到 SIGPIPE 后死掉。

**退出码的陷阱**：`$?` 取的是**管道最后一个命令**的退出码。

```bash title="pipefail 摆平这件事" command:("$":1-4)
false | true; echo $?            # 0 ← 前面的失败被吞掉了
set -o pipefail; false | true; echo $?   # 1 ✅ 管道中任一环节失败即失败
echo "${PIPESTATUS[@]}"          # 每个环节的退出码（bash 专有）
```

## 四、tee、进程替换与 here-doc

```bash title="tee：边看边存" command:("$":1-3)
make 2>&1 | tee build.log                     # 屏幕一份、文件一份
make 2>&1 | tee -a build.log | grep -i error  # 追加 + 继续往下传
```

```bash title="进程替换与 here-doc" command:("$":1-4)
diff <(sort a) <(sort b)          # 把命令的输出当文件用（bash/zsh）
cat <<'EOF' > cfg.sh
echo "$HOME"        # 单引号 EOF：变量不会被展开（写配置模板的常用手法）
EOF
wc -c <<< 'hello'                 # here-string：等价于 printf 'hello\n' | wc -c
```

## 五、真实故障：`sudo echo x > /root/f` 为什么会 Permission denied

```bash title="经典报错" command:("$":1-2)
sudo echo hello > /root/f
# bash: /root/f: Permission denied     ← 明明用了 sudo！
```

**原因**：**重定向是 shell 做的事，不是 `sudo` 做的事。** shell 用**你自己的身份**打开 `/root/f` 失败，`sudo echo` 根本没轮到执行。

三种正解：

```bash title="三种正解" command:("$":1-3)
sudo sh -c 'echo hello > /root/f'            # 让 root 的 shell 去做重定向
echo hello | sudo tee /root/f                # tee 以 root 打开文件
sudo dd of=/root/f <<< hello 2>/dev/null     # 少见但可行
```

同理，`sudo cat /etc/shadow > shadow.bak` 也拿不到内容——**重定向发生在当前身份下**。

## 六、动手清单

```bash title="把每个结论跑一遍" command:("$":1-8)
ls /etc /nope > a.txt 2>&1; wc -l a.txt        # 1. 顺序正确的合并
ls /etc /nope 2>&1 > b.txt; wc -l b.txt        # 2. 顺序错误的对照（stderr 去了终端）
set -o pipefail; false | true; echo $?         # 3. 管道失败可见
yes | head -3                                  # 4. 并发管道与 SIGPIPE
printf 'x\n' | tee c.txt | wc -l               # 5. tee 分支
diff <(seq 3) <(seq 4)                         # 6. 进程替换
sudo sh -c 'echo ok > /tmp/rootfile'; ls -l /tmp/rootfile   # 7. root 侧重定向
```

## 小结

- 重定向 = 在 exec 前用 `dup2` 改掉 fd 1/2，**由 shell 执行**——所以 `2>&1` 的位置决定结果，`sudo cmd > f` 也救不了权限。
- `>` 是打开并截断；`noclobber` 可以禁止覆盖，`>|` 强制覆盖。
- 管道是并发的两根管子；`$?` 只反映最后一个命令，`set -o pipefail` 才看整条链。
- `tee` 用于"一边看一边存"，`<(...)` 把命令输出当文件，`<<'EOF'` 写模板时长这样用。

## 下一节预告

下一节：进程与信号——`ps` 的状态码怎么读、`TERM` 与 `KILL` 的根本差别、前台/后台与 `Ctrl+Z` 的真实信号、僵尸与孤儿进程，以及"为什么关掉终端进程就死了"。
