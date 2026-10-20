---
title: 'Linux 基础 08：环境变量与 shell 启动文件——为什么 ssh 跑命令找不到你的 PATH'
description: '变量的作用域与"快照"语义、登录/非登录/交互/非交互四种组合各加载哪些文件、为什么 ssh 远程执行命令拿不到你的 PATH、sudo 的 secure_path 是怎么改变环境的。'
link: linux-08-env-and-startup-files
catalog: true
date: 2022-04-16 20:30:00
updated: 2022-04-16 22:10:00
categories: ['笔记']
tags: ['Linux', '基础']
draft: false
---

## 这一节要解决什么

“我在终端里明明是 `node -v` 能用的，`ssh host 'node -v'` 却说找不到”——这个问题把环境变量、shell 的四种启动方式、以及 `sudo` 的环境策略串在了一起。搞清这条链，日常那些"本地能跑、远程不行""脚本里能跑、cron 里不行"的怪现象都会消失。

## 一、变量的三个层次

```bash title="三种写法的差别" command:("$":1-5)
VAR=local          # 1) shell 变量：只存在于当前 shell
export VAR=global  # 2) 环境变量：会被子进程继承
bash -c 'echo "${VAR:-<empty>}"'      # 3) 子进程读的是“fork 那一刻的快照”

MYVAR=1; export MYVAR; bash -c 'echo $MYVAR'   # 1
MYVAR=2; bash -c 'echo $MYVAR'                 # 1 ← 已启动的子进程不受影响
```

**批注**：环境变量是**拷贝**，不是共享。父进程之后怎么改，已经跑起来的子进程都看不到——这条语义解释了第 01 篇那个 `export` 实验，也是"脚本里改了 PATH 但命令还是找不到"的根源。

```bash title="查看环境的三件工具" command:("$":1-3)
env | sort | head              # 只看环境变量
printenv PATH                  # 取单个变量
set | head                     # 环境变量 + shell 变量 + 函数（最全）
env -i bash -c 'env'           # 干净环境（调试“到底缺了哪个变量”）
```

## 二、shell 的四种启动方式，加载不同的文件

| 启动方式 | 典型场景 | 加载的文件 |
| --- | --- | --- |
| **登录 + 交互** | ssh 登录、控制台登录、`bash -l` | `/etc/profile` → `~/.bash_profile` / `~/.bash_login` / `~/.profile`（**按顺序取第一个存在的**） |
| **非登录 + 交互** | 新开一个终端窗口、直接敲 `bash` | `/etc/bash.bashrc`（Debian 系）→ `~/.bashrc` |
| **非登录 + 非交互** | `ssh host 'cmd'`、脚本、`bash -c` | **都不加载**，只读 `$BASH_ENV` 指向的文件 |
| **登录 + 非交互** | `ssh host 'bash -lc cmd'` | 同"登录 + 交互"那一行 |

**批注**：这张表是本节的核心。绝大多数"远程执行找不到命令"的问题，都是因为**第 3 行**——你的 PATH 扩展写在 `~/.bashrc` 里，而它根本不会被加载。

## 三、真实故障 1：`ssh host 'node -v'` 找不到 node

原因通常不是没装，而是两件事叠加：

1. PATH 扩展写在 `~/.bashrc`（或 nvm 的初始化块）里；
2. `~/.bashrc` 顶部几乎都有这么一段（Ubuntu 默认就有）：

```bash title="~/.bashrc 顶部的提前退出" command:("$":1-4) mark:2
case $- in
  *i*) ;;      # 交互式：继续往下执行
  *) return;;  # 非交互式：直接返回 ← ssh 执行命令时走的就是这里
esac
```

于是 `ssh host 'node -v'` 既没加载 `.bashrc`、也没加载 `.profile`，PATH 里自然没有 nvm 的目录。

四种解法（按推荐度）：

```bash title="四种解法" command:("$":1-4)
ssh host 'bash -lc "node -v"'                       # 1) 显式让它当登录 shell 跑
ssh host 'source ~/.bashrc; node -v'                # 2) 手动加载（注意输出可能被污染）
# 3) 把 PATH 改成写进 ~/.profile（登录 shell 会读，非交互登录也会读）
# 4) 在 ~/.bashrc 里把“交互式判断”拿掉或改成只给 PATH/别名分块
```

我自己的做法是**把 PATH 与 nvm 初始化放到 `~/.profile`**，交互式专属的东西（别名、提示符）才留在 `~/.bashrc`。

## 四、真实故障 2：`sudo` 之后 PATH 变了

```bash title="对照一下" command:("$":1-3)
echo "$PATH"
sudo sh -c 'echo $PATH'      # Debian 默认会是 secure_path：/usr/local/sbin:...:/bin
sudo env | grep -i path      # policies 里也能看到
```

原因在 `sudoers` 的 `secure_path`：出于安全，`sudo` **默认重置 PATH**，只保留系统目录（`env_reset` + `secure_path`）。后果是 `/opt/xxx/bin` 里的程序用 sudo 就跑不了。

```bash title="两种应对" command:("$":1-2)
sudo -E whoami                     # 保留当前环境（可用，但要清楚风险：别整段环境都带过去）
sudo visudo                        # 或给具体命令写完整路径的规则
```

## 五、把 PATH 写"幂等"

重复加载启动文件时，PATH 容易被叠成一长串。稳妥写法是先判断再加：

```bash title="幂等追加 PATH" command:("$":1-4) mark:1
case ":$PATH:" in
  *":$HOME/bin:"*) ;;                       # 已经在了，什么都不做
  *) PATH="$HOME/bin:$PATH" ;;
esac
export PATH
```

**批注**：`~/.bashrc` 被 source 多次（每条新终端一次）很常见，幂等都是省下自己排查"PATH 为什么有 8 份 /usr/local/bin"的时间。

## 六、动手清单

```bash title="把本节结论跑一遍" command:("$":1-7)
MYVAR=1; bash -c 'echo "${MYVAR:-<empty>}"'      # 1. 未导出：子进程看不到
export MYVAR; bash -c 'echo $MYVAR'              # 2. 导出后可见
echo $-                                          # 3. 当前 shell 是否交互（含 i）
bash -lc 'echo login: $0'; bash -c 'echo plain: $0'   # 4. 两种启动的差别
ssh localhost 'echo "$PATH"' 2>/dev/null || true  # 5. 非交互的非登录 PATH 长什么样
sudo sh -c 'echo "$PATH"'                         # 6. secure_path
env -i bash -c 'env'                              # 7. 干净环境对照
```

## 小结

- 环境变量是**子进程启动时的快照**，改父进程不影响已运行的子进程；子进程要用就得 `export`。
- 登录 shell 读 `profile` 系，交互非登录读 `bashrc` 系，**非交互（`ssh host 'cmd'`、脚本、cron）两个都不读**。
- PATH 扩展放 `~/.profile` 更通用；`~/.bashrc` 顶部的交互判断是"远程执行找不到命令"的常见原因。
- `sudo` 默认重置环境（`secure_path`）；需要保留用 `-E`，或走 sudoers 规则。
- PATH 追加要写成幂等方式。

## 下一节预告

下一节：用户与组——`/etc/passwd` 七个字段、`/etc/shadow` 里 `!` 与 `*` 的含义、主组与附加组、`usermod -aG` 为什么必须带 `-a`，以及 `su`、`sudo`、`sudoers` 的关系。
