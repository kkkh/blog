---
title: 'Linux 基础 20：Shell 脚本（下）——trap、日志、幂等与并发锁'
description: '函数与 local、return 和 exit 的区别、用 trap 保证退出前清理现场、统一的日志函数与 exec 重定向、幂等写法与原子写、用 flock 防止脚本跑重，以及一个完整可运行的备份脚本逐句拆解。'
link: linux-20-shell-scripting-advanced
catalog: true
date: 2022-04-28 20:30:00
updated: 2022-04-28 22:10:00
categories: ['笔记']
tags: ['Linux', '基础']
draft: false
---

## 这一节要解决什么

一个每天凌晨跑的备份脚本，某天没到点却跑了两遍——定时任务没删干净，我手动又点了一次，两边同时写同一个目标目录，数据花了。另一天它中途被打断，留下半个临时文件和一把没释放的锁，第二天再也跑不起来。

上一节讲的是"脚本能跑对一次"，这一节讲的是"**脚本能安全地反复跑**"：函数、`trap`、统一日志、幂等、并发锁，最后给一个能直接用的备份脚本。

## 一、函数：`local`、`return` 与 `exit`

```bash title="函数与作用域" command:("$":1-6)
log() { printf '[%s] %s\n' "$(date '+%F %T')" "$*"; }

work() {
  local tmp=${1:?need an argument}   # local 只在本函数内可见
  echo "$tmp"
  return 0                            # 返回状态码给调用者
}

work "x" || exit 1                    # 用返回值决定是否继续
```

**关键区别**：`return` 只结束**当前函数**并返回一个状态码（0–255）；`exit` **直接结束整个脚本**。在函数里用 `exit`，调用者就再没机会善后了。

## 二、`trap`：退出前一定把现场清干净

```bash title="清理临时文件" command:("$":1-4)
tmp=$(mktemp -d)
cleanup() { rm -rf "$tmp"; }
trap cleanup EXIT                # 正常结束、出错、Ctrl-C 都会触发
trap 'echo interrupted; exit 130' INT
```

| 信号 | 何时触发 |
| --- | --- |
| `EXIT` | 脚本退出时，包括出错退出 |
| `ERR` | 某条命令失败时，配合 `set -e` 使用 |
| `INT` / `TERM` | 收到 Ctrl-C / `kill` 时 |

**批注**：`EXIT` 的 trap 是"兜底清理"的标准位置。我习惯把临时目录、锁文件、后台进程 PID 的清理全塞进去，**比在每条 `exit` 前手写一遍可靠得多**。

## 三、日志：一个函数加一次重定向就够

```bash title="统一日志" command:("$":1-3)
log() { printf '[%s] %s\n' "$(date '+%F %T')" "$*"; }
log "start backup"
exec > >(tee -a /var/log/backup.log) 2>&1   # 之后所有输出同时进文件和终端
```

`exec > >(tee -a …) 2>&1` 之后**整个脚本的输出都被重定向**，不用给每条命令加 `>> log`。cron 里没有终端时它照样往文件写。

## 四、幂等：重复跑也不出事

```bash title="幂等写法" command:("$":1-4)
mkdir -p /srv/backups            # 已存在也不报错
install -d -m 750 /srv/backups   # 建目录并设权限，一条搞定
# 原子写：先写临时文件，再 mv，避免读者看到半个文件
printf '...' > "$out.tmp" && mv "$out.tmp" "$out"
```

**关键结论**：脚本要能**重复执行而不产生副作用**——目录用 `mkdir -p`，文件用"临时名加 `mv`"，配置用"先渲染临时文件再原子替换"。

## 五、并发锁：防止跑重

```bash title="两种 flock" command:("$":1-4)
# 方式一：文件描述符锁
exec 9>/var/lock/backup.lock
flock -n 9 || { log "another run in progress"; exit 0; }   # -n 拿不到锁立刻失败

# 方式二：直接锁命令
flock -n /var/lock/backup.lock -c '/usr/local/bin/backup.sh'
```

**批注**：最痛的一次事故就是"凌晨的 cron 还没跑完，我手动又点了一次"，两边同时写同一个目标目录。用上 `flock -n` 之后，这类问题再没出现过。

## 六、一个完整可运行的备份脚本

```bash title="backup.sh" command:("$":1-3) mark:10-11
#!/usr/bin/env bash
set -euo pipefail

SRC=${1:?usage: backup.sh dir}
DEST=/srv/backups
KEEP=7

log() { printf '[%s] %s\n' "$(date '+%F %T')" "$*"; }

exec 9>"$DEST/.lock"
flock -n 9 || { log "another backup running, abort"; exit 0; }

tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT

mkdir -p "$DEST"
name="$(basename "$SRC")-$(date +%F-%H%M).tar.gz"
tar -czf "$tmp/$name" -C "$(dirname "$SRC")" "$(basename "$SRC")"
gzip -t "$tmp/$name"
mv "$tmp/$name" "$DEST/$name"

ls -1t "$DEST"/"$(basename "$SRC")"-*.tar.gz | tail -n +$((KEEP+1)) | xargs -r rm -f
log "ok: $DEST/$name, kept last $KEEP"
```

## 七、逐句拆解

- `exec 9>"$DEST/.lock"` 加 `flock -n 9`：把锁绑在 fd 9 上，**拿不到就立刻退出**，退出码用 0，因为"别人正在跑"不算失败。
- `tmp=$(mktemp -d)` 加 `trap 'rm -rf "$tmp"' EXIT`：所有中间产物只放在临时目录里，**任何退出路径都会清掉**，不留垃圾。
- `gzip -t` 后再 `mv`：**校验通过才算成品**，同一文件系统内的 `mv` 是原子操作，读者永远看不到半个文件。
- `ls -1t … | tail -n +$((KEEP+1)) | xargs -r rm -f`：按时间倒序保留 `KEEP` 份，`xargs -r` 保证没有多余行时不执行 `rm`。

## 八、动手清单

```bash title="逐条验证" command:("$":1-7)
bash -n backup.sh; shellcheck backup.sh             # 1. 语法与静态检查
bash -x backup.sh /tmp/test 2>&1 | tail             # 2. 跟踪执行
flock -n /tmp/demo.lock -c 'echo locked'            # 3. 验证锁能被拿到
flock -n /tmp/demo.lock -c 'echo locked'            # 4. 再跑一次应立刻失败
bash -c 'trap echo bye EXIT; true'                  # 5. 观察退出时触发 trap
mkdir -p /tmp/a && install -d -m 700 /tmp/b         # 6. 幂等建目录
printf 'x' > /tmp/f.tmp && mv /tmp/f.tmp /tmp/f     # 7. 原子写
```

## 小结

- `local` 限定函数内变量；`return` 只结束函数，**`exit` 结束整个脚本**。
- `trap … EXIT` 是兜底清理的标准位置；`INT` 用来响应 Ctrl-C。
- 日志用一个 `log()` 函数加 `exec > >(tee -a …) 2>&1` 全局重定向。
- 幂等靠 `mkdir -p`、`install -d`、以及"临时文件加 `mv` 原子替换"。
- 防重复运行用 `flock -n`，拿不到锁就干净退出。
- 好脚本的骨架固定是：**锁 → 临时区 → trap 清理 → 校验 → 原子落地 → 保留 N 份**。

## 下一节预告

下一节：定时任务——cron 五字段语义、它那套"极简环境"的经典坑、`/etc/cron.d` 与 allow/deny，以及用 systemd timer 的 `Persistent=` 补上"机器当时没开机"的缺口。
