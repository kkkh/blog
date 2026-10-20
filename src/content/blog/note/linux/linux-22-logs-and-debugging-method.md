---
title: 'Linux 基础 22：日志与故障排查方法论——从现象到根因的六步'
description: 'journald 与 /var/log 的分工、journalctl 的常用组合、logrotate 要点，以及一套六步排障法：描述现象、画时间线、找最近变更、缩小范围、验证假设、记录复盘；附磁盘满、端口被占、权限拒绝三个真实案例。'
link: linux-22-logs-and-debugging-method
catalog: true
date: 2022-04-30 20:30:00
updated: 2022-04-30 22:10:00
categories: ['笔记']
tags: ['Linux', '基础']
draft: false
---

## 这一节要解决什么

出故障时最诱人的动作是 `systemctl restart` 一下，赌它自己好。**这一下会把现场清掉**——内存里的状态没了，连接计数重置了，崩溃前的最后几行日志可能也没了，之后再想查"为什么"就少了一半证据。

这一节讲清日志都在哪、怎么看，然后给一套能反复套用的**六步排障法**，最后用三个真实案例把它走一遍。

## 一、日志在哪：journald 与 `/var/log` 的分工

```bash title="journald 是首选入口" command:("$":1-6)
journalctl -n 50                     # 最近 50 行
journalctl -p err -b                 # 本次开机以来 err 级别以上
journalctl --since '1 hour ago'      # 时间窗
journalctl -b -1                     # 上一次开机，崩溃或重启后查这个
journalctl -u nginx -f               # 跟某个服务的实时输出
journalctl -o json-pretty -n 1       # 结构化字段：_PID、_COMM、unit 等
```

| 位置 | 谁写的 |
| --- | --- |
| journald | systemd 服务与内核消息，用 `journalctl` 统一查 |
| `/var/log/syslog`、`messages` | 传统 syslog 汇总，Debian 与 RHEL 命名不同 |
| `/var/log/auth.log`、`secure` | 登录、sudo、sshd |
| `/var/log/dpkg.log`、`yum.log` | 包管理操作记录 |
| `/var/log/nginx/*.log` | 应用自己的日志 |

**关键结论**：先 `journalctl -u <服务>` 看**服务视角**，再 `journalctl -b -1` 或 `-p err` 看**系统视角**；而应用日志（nginx、数据库）**不在 journald 里**，必须去它自己的目录看。

## 二、logrotate 要点

```ini title="/etc/logrotate.d/app"
/var/log/app/*.log {
    daily          # 或写 size 100M
    rotate 14      # 保留 14 份
    compress       # 旧的 gzip
    missingok
    notifempty
    copytruncate   # 服务不支持重开文件时用：先复制再清空原文件
    postrotate
        systemctl reload app >/dev/null 2>&1 || true
    endscript
}
```

**批注**：服务能重开文件就用 `postrotate` 加 `reload`，最干净；不能重开就用 `copytruncate`——代价是有一个小小的丢日志窗口，但不用重启服务。**日志目录也要做容量监控**，否则 rotate 策略写错时磁盘照样会满。

## 三、六步排障法

1. **描述现象**：要可观测、可复现——"什么时间、什么操作、看到什么、期望什么"。含糊的"它坏了"没法查。
2. **画时间线**：用 `journalctl --since/--until/-b -1` 确定"**从何时开始**"。
3. **找最近变更**：发布、配置、证书、依赖升级、磁盘空间。**八成故障紧跟在一次变更之后**。
4. **缩小范围**：属于哪一层——应用、网络、磁盘、权限、SELinux。用前面几节的工具逐层排除。
5. **验证假设**：**一次只改一个变量**，改完再看。同时改三样，永远说不清是哪样起了作用。
6. **记录与复盘**：写下现象、根因、动作；下次同类问题直接查。

:::info
**先别急着重启，先保留现场。** 重启会清掉内存里的状态、重置连接计数、丢掉崩溃前的上下文。先把 `journalctl`、`ss`、`df`、`ps` 各类快照截一遍，再决定动不动手。
:::

## 四、三个真实案例

**案例 A：磁盘满。** 服务突然写不进数据，`df -h` 显示根分区 100%。但 `du -sh /*` 加起来远不到满——因为**有进程抓着已删除的大文件**：`df` 算的是块占用，`du` 看不见已经 unlink 的 inode。`sudo lsof +L1` 列出这些"删了但没释放"的文件，重启那个进程就能回收空间。

**案例 B：端口被占用。** 新服务起不来，日志里是 `address already in use`。`ss -ltnp | grep :8080` 找到占用者的 PID，`sudo fuser -k 8080/tcp` 或直接 `kill`。也可能是旧进程没退干净或残留的 `TIME_WAIT`（这种等超时即可，不用杀）。**先看清楚是谁**，别上来就重启整个服务。

**案例 C：权限拒绝。** `Permission denied`，可 `ls -l` 看着完全正常。用 `namei -l /data/app/upload/file` 从根开始逐级看每层目录的权限——**最常见的坑是中间某一级目录缺了 `x` 位**。如果权限都对，再 `getenforce` 看是不是 SELinux 拦的（见第 16 节）。

## 五、动手清单

```bash title="排障工具包常备" command:("$":1-7)
journalctl -p err -b --no-pager | tail -30          # 1. 本次开机的错误
journalctl -u myapp --since '30 min ago'            # 2. 目标服务近况
df -h; df -i                                        # 3. 空间与 inode
sudo lsof +L1 | head                                # 4. 被删但未释放的文件
ss -ltnp | head                                     # 5. 监听与占用
namei -l /path/to/file                              # 6. 逐级权限
sudo logrotate -d /etc/logrotate.d/app              # 7. 干跑日志切割配置
```

## 小结

- 优先 `journalctl`（`-u`、`-p`、`-b -1`、`--since`、`-o json-pretty`）；应用日志去 `/var/log` 下自己的目录。
- logrotate 三件套：`daily/size` 加 `rotate N` 加 `compress`，再加 `postrotate` 或 `copytruncate`。
- 六步：**描述现象 → 画时间线 → 找变更 → 缩小范围 → 验证假设 → 记录复盘**。
- 变更之后出故障不是巧合；**一次只改一个变量**才能归因。
- 磁盘满先 `df -h` 再 `df -i` 再 `lsof +L1`；端口占用先 `ss -ltnp`；权限问题先 `namei -l`。
- **先保留现场再动手**，重启是最后手段，不是第一反应。

## 下一节预告

下一节：容器与内核边界——容器其实是普通进程加上 namespace 与 cgroup、`docker exec` 和 `nsenter` 的关系、cgroup v2 的 cpu/memory 限额，以及 docker 组为什么几乎等于 root。
