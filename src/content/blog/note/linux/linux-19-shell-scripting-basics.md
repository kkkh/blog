---
title: 'Linux 基础 19：Shell 脚本（上）——引号、条件与退出码'
description: 'shebang 与两种执行方式的差别、"$VAR" 与 $VAR 以及 "$@" 与 $* 的引号陷阱、[ ] 与 [[ ]] 的取舍、while read -r 为什么必须带 -r、参数与 getopts 最小示例、set -euo pipefail 各自解决什么，以及退出码约定与 shellcheck。'
link: linux-19-shell-scripting-basics
catalog: true
date: 2022-04-27 20:30:00
updated: 2022-04-27 22:10:00
categories: ['笔记']
tags: ['Linux', '基础']
draft: false
---

## 这一节要解决什么

把一串能在终端里跑通的命令粘进脚本，往往立刻翻车：文件名里有空格，被拆成两个参数；路径里的变量没加引号，`rm -rf $DIR/` 在 `DIR` 为空时差点把根目录带走；脚本明明"成功"了，`&&` 后面却接着执行了。

这一节讲清 shell 最容易咬人的三样东西：**引号、条件、退出码**。这三样没搞懂，脚本就是定时炸弹。

## 一、shebang 与两种执行方式

```bash title="第一行写什么" command:("$":1-3)
#!/usr/bin/env bash      # 用 PATH 里的 bash，可移植性最好
#!/bin/bash              # 写死路径
#!/bin/sh                # POSIX sh，功能受限，见后文
```

```bash title="两种跑法，差别在权限位" command:("$":1-3)
bash script.sh           # 把文件当输入交给 bash 解释，不需要 x 位
chmod +x script.sh       # 加上可执行位
./script.sh              # 靠 shebang 决定用哪个解释器
```

**关键结论**：`bash script.sh` 忽略 shebang，你写 `#!/usr/bin/env bash` 也没用；只有 `./script.sh` 才读 shebang。调试期常用前者，交付时用后者。

## 二、引号：这是最贵的坑

```bash title="对比着看" command:("$":1-4)
f="my file.txt"
cat $f              # 被拆成两个参数 my 和 file.txt，报错
cat "$f"            # ✅ 一个整体
echo $f             # 词分割加通配符展开，空格被吃掉
echo "$f"           # ✅ 原样输出
```

接收参数的两个特殊变量必须分清：

```bash title="脚本里打印参数" command:("$":1-3)
echo "共 $# 个参数"
printf '[%s]\n' "$@"     # ✅ 每个参数独立成一项，推荐
printf '[%s]\n' $*       # ❌ 先词分割再拼接，等于什么都没保住
```

| 写法 | 含义 |
| --- | --- |
| `"$@"` | **每个参数是一个独立单词**，循环里首选 |
| `"$*"` | 所有参数被拼成**一个**字符串 |
| 未加引号的 `$*` | 先词分割再拼接，最糟的组合 |

**批注**：写脚本的默认动作是**给所有变量加双引号**，除了明确需要词分割或通配的场景。这一条能挡掉一半以上的诡异 bug。

:::warning
`$DIR` 为空时，`rm -rf $DIR/` 会展开成 `rm -rf /`。**删除类命令永远先 `echo` 一遍**确认展开结果，或者写 `rm -rf "${DIR:?DIR is unset}"`，让变量为空时直接报错退出。
:::

## 三、条件：`[ ]` 还是 `[[ ]]`

```bash title="两种测试" command:("$":1-5)
[ -f "$path" ] && echo exists       # POSIX test，变量必须加引号
[[ -f $path ]] && echo exists       # bash 关键字，不加引号也安全
[[ $name == *.log ]]                # ✅ 支持通配模式匹配
[[ $s =~ ^[0-9]+$ ]]                # ✅ 支持正则匹配
[[ $a -lt 10 && $b -gt 5 ]]         # 逻辑组合不用 -a/-o
```

| 检查 | 含义 |
| --- | --- |
| `-z "$s"` | 字符串为空 |
| `-n "$s"` | 字符串非空 |
| `-e` / `-f` / `-d` | 存在 / 是普通文件 / 是目录 |
| `-x` | 可执行 |
| `-r` / `-w` | 可读 / 可写 |

**关键结论**：脚本头用 `#!/usr/bin/env bash` 时**优先 `[[ ]]`**——它不会因变量未加引号而被词分割，还支持 `==`、`=~` 模式匹配。只有必须 POSIX 时才退回 `[ ]`，那时引号一个都不能省。

## 四、循环

```bash title="两种循环" command:("$":1-4)
for f in *.log; do echo "$f"; done

while IFS= read -r line; do        # ✅ -r 阻止反斜杠被解释
  echo "$line"
done < input.txt
```

**为什么不用 `for line in $(cat file)`**：命令替换会做**词分割**，空格和空行全被吃掉，一行被拆成好几行；`while read -r` 按行读，原样保留。`-r` 是防止行尾的 `\` 被当转义符，**几乎永远该加**。

## 五、参数与 `getopts`

```bash title="位置参数与选项解析" command:("$":1-6)
echo "$0"             # 脚本名
echo "$1"; echo "$2"  # 第一、第二个参数
echo "${@:2}"         # 从第二个开始的所有参数

while getopts "vho:" opt; do
  case $opt in
    v) set -x ;;
    o) out=$OPTARG ;;
    h) echo "usage: $0 [-v] [-o out]"; exit 0 ;;
    *) exit 2 ;;
  esac
done
shift $((OPTIND-1))   # 移走已解析的选项，剩下的才是位置参数
```

## 六、`set -euo pipefail` 各自解决什么

```bash title="写在脚本开头" command:("$":1-2)
set -euo pipefail
set -x               # 调试时打开：打印每条实际执行的命令
```

| 选项 | 作用 |
| --- | --- |
| `-e` | 命令失败（非零退出）立刻退出脚本 |
| `-u` | 使用未定义变量时报错退出 |
| `-o pipefail` | 管道中任一环失败，整个管道就算失败 |
| `-x` | 打印每条展开后的命令，用于调试 |

**批注（`-e` 的坑）**：`-e` 在 `if`、`&&`、`||`、`while` 的条件位置**不生效**——那里失败是预期行为。所以"允许失败"要写成 `cmd || true` 或 `if ! cmd; then`，别指望 `-e` 帮你兜住这些。

## 七、退出码与 shellcheck

```bash title="退出码约定" command:("$":1-3)
true; echo $?        # 0 = 成功
false; echo $?       # 非 0 = 失败
exit 1               # 脚本显式以失败结束
```

**关键结论**：`0` 是成功，**非 0 全是失败**；`$?` 永远是上一条命令的结果。写完脚本跑一遍 `shellcheck script.sh`——它会揪出没加引号的变量、误用的 `[ ]`、无用调用等，**这是最便宜的代码审查**。

## 八、可移植性

`#!/bin/sh` 是 POSIX，`bash` 特性一律不可用：`[[ ]]`、数组、`function` 关键字、`${@:2}`、进程替换 `<(...)` 都不存在。要跨发行版（尤其 Alpine 的 `busybox sh`）就老实写 POSIX，或者显式声明依赖 bash。

## 九、动手清单

```bash title="练手" command:("$":1-7)
bash -n script.sh                                  # 1. 只做语法检查，不执行
shellcheck script.sh                               # 2. 静态审查
bash -x script.sh 2>&1 | head                      # 3. 跟踪执行
printf '[%s]\n' "$@" | head                        # 4. 验证参数展开
[[ -d /tmp && -w /tmp ]] && echo ok                # 5. 条件测试
while IFS= read -r l; do echo "$l"; done < /etc/hosts | head   # 6. 逐行读文件
bash -c 'set -euo pipefail; false; echo never'     # 7. 验证 -e 会提前退出
```

## 小结

- `bash script.sh` 忽略 shebang、不需要 x 位；只有 `./script.sh` 才读 shebang。
- **默认给变量加双引号**；`"$@"` 保留每个参数，`"$*"` 会把它们拼成一串。
- bash 脚本优先 `[[ ]]`（免引号加模式匹配），POSIX 才用 `[ ]`（引号一个不能省）。
- 按行读文件用 `while IFS= read -r line`，不要 `for x in $(cat file)`。
- `set -euo pipefail` 分别管"失败即退 / 未定义变量 / 管道失败"，但 `-e` 在条件位置不生效。
- 退出码 0 成功、非 0 失败；`shellcheck` 是所有脚本的必跑项。

## 下一节预告

下一节：Shell 脚本（下）——函数与 `local`、`trap` 清理现场、统一日志函数、幂等写法、`flock` 防重复运行，并给一个完整可运行的备份脚本逐句拆解。
