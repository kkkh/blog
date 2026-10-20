---
title: 'Linux 基础 01：终端、Shell，和命令是怎么被找到的'
description: '先把三个东西分清楚：终端不是 shell，shell 不是内核。再搞明白 PATH 的搜索顺序、builtin 与外部命令的差别，以及为什么 cd 会"找不到命令"。'
link: linux-01-terminal-and-shell
catalog: true
date: 2022-04-09 20:30:00
updated: 2022-04-09 22:10:00
categories: ['笔记']
tags: ['Linux', '基础']
draft: false
---

## 这一节要解决什么

第一次 ssh 登录一台机器，屏幕上出现 `root@vm:~#` 这行东西，很容易产生一个错觉：我在跟 Linux 说话。

其实中间隔着好几层。分不清这几层，后面很多现象就只能靠死记：为什么 `cd` 会“找不到命令”、为什么改了 PATH 在另一个终端里却不生效、为什么 `echo $SHELL` 和当前真正跑的 shell 不是一回事。

## 一、四个角色，一条链路

```text
键盘 → 终端(pty) → shell → fork/exec 子进程 → 内核 → 磁盘/网络/CPU
```

- **内核（kernel）**：真正干活的那个。进程调度、内存、文件系统、网络都是它管。它不认识中文，也不认识 `ls`，只认系统调用。
- **shell**：一个**普通的用户态程序**，职责只有一条——读一行，解析，执行。bash、zsh、dash 都是 shell。
- **终端模拟器**：你眼前的那个窗口（iTerm2、GNOME Terminal）。它负责显示字符、接收键盘。
- **pty（伪终端）**：程序与窗口之间的一根线。ssh 登录后，远端分配的也是 pty。

一次 `ls` 的真实过程：shell 从 pty 读到 `ls\n` → 按空格切词 → 在 PATH 里找名为 `ls` 的可执行文件 → `fork()` 出一个子进程 → 子进程 `execve("/usr/bin/ls", …)` → `ls` 自己调 `open` / `readdir` / `write` → 内核读目录、返回数据 → 输出回 pty → 你看到字。

:::info
**shell 不负责“执行”**，它只负责找程序、起进程、把管道接好。真正执行的是被它 exec 出来的那个程序 —— 所以 shell 是命令**解释器**，不是执行器。
:::

## 二、命令是怎么被找到的：PATH 的顺序

```bash
echo "$PATH" | tr ':' '\n' | nl
```

PATH 从左到右找，**第一个命中即用**，后面的同名程序永远不会被用到。这也是 `~/bin` 放在 PATH 最前面就能“覆盖”系统命令的原因——方便，同时也危险（第三节有实例）。

想知道一个名字到底是什么，别猜，问 shell：

```bash
type -a ls        # 列出所有匹配：alias / function / builtin / 磁盘文件
type -a cd
command -v ls     # 只回答“shell 会怎么执行它”
```

在 Ubuntu 上我这边实测 `type -a ls` 输出两行：

```text
ls is /usr/bin/ls
ls is /bin/ls
```

看着像两个程序，其实是同一个文件：现代发行版做了 **merged-usr**，`/bin`、`/sbin`、`/lib` 都是指向 `/usr` 下的符号链接；而 PATH 里同时有 `/usr/bin` 和 `/bin`，所以同一个文件被列了两次。

`type -a cd` 的答案不一样：

```text
cd is a shell builtin
```

**`cd` 之所以“找不到”，是因为它根本不是磁盘上的程序**，而是 shell 的内建命令（builtin）。它必须内建：`cd` 要改变的是**当前 shell 进程**的工作目录（系统调用 `chdir`），而外部程序是被 fork 出来的子进程，改了也不影响父进程。

常见 builtin：`cd`、`export`、`read`、`source`、`type`、`pwd`、`umask`、`echo`（bash 有内建版，也可以调用 `/bin/echo`）。

## 三、我在哪个 shell 里？三个答案可能不一样

```bash
echo "$SHELL"                                  # 登录 shell（来自 /etc/passwd 第 7 个字段）
echo "$0"                                      # 当前这个 shell 进程的名字
ps -o pid,ppid,cmd -p $$                       # $$ 是当前 shell 的 PID
grep "^$(whoami):" /etc/passwd
tty; who am i
```

**我的批注：`$SHELL` 只能当参考，不能当证据。** 它是登录时从 `/etc/passwd` 读出来的，之后你手动敲 `zsh` 或 `bash` 都不会改变它。要看“此刻在跑什么”，用 `$0` / `$$` / `ps`。

`$-` 还能告诉你这个 shell 处于什么状态：含 `i` 是交互式（interactive），含 `m` 说明 job control 开着（这点在讲信号那节会用到）。

```bash
echo "$-"        # 例：himBH
```

## 四、踩坑记录：把当前目录写进 PATH

```bash
# 千万别这么干
export PATH=.:$PATH
```

这样 shell 找任何一个命令时，都会先在**当前目录**里找。哪天你解压了一个包含 `ls` 或 `sudo` 同名的可执行文件的压缩包，cd 进去敲 `ls`，跑的就是别人的程序。这类攻击有名字：**PATH 劫持**。

第二个坑更隐蔽，也是我真踩过的：改 PATH 忘了导出。

```bash
# 只改了变量，没导出 → 当前 shell 有，子进程看不到
PATH="$HOME/bin:$PATH"

# 正确姿势
export PATH="$HOME/bin:$PATH"
```

验证“子进程到底看不看得到”，用最小实验看得很清楚：

```bash
FOO=bar        ; bash -c 'echo "${FOO:-<empty>}"'      # <empty>
export FOO=bar ; bash -c 'echo "${FOO:-<empty>}"'      # bar
```

## 五、动手清单（五分钟跑完）

```bash
# 1. 面对的是谁
echo "$0 | $SHELL | $$"; ps -o pid,ppid,cmd -p $$

# 2. PATH 的搜索顺序
echo "$PATH" | tr ':' '\n' | nl

# 3. 同一个名字在哪几层被解释
type -a ls; type -a cd; type -a sudo

# 4. shell 起进程的直接证据：父进程就是你的 shell
sleep 300 &
ps -o pid,ppid,cmd -p $!      # $! 是最近一个后台进程的 PID
kill %1                       # 记得收拾干净
```

第 4 步里 `ppid` 显示的就是你的 shell —— 这就是“shell 只负责 fork/exec”的可观测证据。

## 小结

- 终端 ≠ shell ≠ 内核。shell 只是“读一行、找程序、起进程”的那一层。
- 命令查找靠 PATH 从左到右，`builtin` 不参与查找；`cd`、`export` 这类必须内建。
- `$SHELL` 是登录 shell，不等于当前进程；确认状态看 `$0` / `$$` / `ps` / `$-`。
- 别把 `.` 放进 PATH。

## 下一节预告

下一节讲 `/` 底下为什么是这些目录，以及 **inode** 里到底存了什么——顺带解释“磁盘明明还有空间，却写不进文件”这种真实故障。
