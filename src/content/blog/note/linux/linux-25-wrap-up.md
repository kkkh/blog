---
title: 'Linux 基础 25：收尾——自查清单与继续深入的方向'
description: '四张上线前自查清单（权限账号、服务启动、网络防火墙、存储备份）、一张现象到首选命令的对照表、继续深入的方向，以及一条可以长期沿用的排障方法论，作为整个系列的收尾。'
link: linux-25-wrap-up
catalog: true
date: 2022-05-03 20:30:00
updated: 2022-05-03 22:10:00
categories: ['笔记']
tags: ['Linux', '基础']
draft: false
---

## 这一节要解决什么

25 章走下来，命令学了一堆，但真正的日常其实是两件事：**把一台新机器、一个新服务收拾干净**，以及**出问题时第一时间该敲什么**。这一节不给新知识，只给两张东西——上线前的自查清单，和排障时的首选命令表，外加继续深入的方向。

## 一、四张自查清单

### ① 权限与账号

- [ ] 家目录权限是 `700`（`chmod 700 /home/*`）
- [ ] 私钥、`authorized_keys` 是 `600`，`.ssh` 目录是 `700`
- [ ] `awk -F: '$2==""{print $1}' /etc/shadow` 无输出，即没有空密码账号
- [ ] sudo 走白名单（`/etc/sudoers.d/`），不滥用 `NOPASSWD: ALL`
- [ ] `find / -perm -4000 -type f` 里没有可疑的 setuid 程序
- [ ] 服务账号是 `nologin`，不能拿来登录

### ② 服务与启动

- [ ] `systemctl --failed` 为空
- [ ] 关键服务不以 root 运行，配了 `User=`
- [ ] 有 `Restart=on-failure` 之类的重启策略
- [ ] 日志进 journald 或自己的日志文件，有轮转
- [ ] 需要开机自启的服务都 `systemctl enable` 了
- [ ] 没有互相打架的旧服务，比如 `network` 与 `NetworkManager` 同时开着

### ③ 网络与防火墙

- [ ] `ss -ltnp` 里没有意外监听，该只绑 `127.0.0.1` 的别绑 `0.0.0.0`
- [ ] 主机防火墙只放行必要端口
- [ ] 云安全组与主机防火墙的放行范围一致
- [ ] 容器发布的端口考虑了绕过防火墙的问题（见第 17 节）
- [ ] DNS 顺序合理，必要时用 `resolvectl` 查

### ④ 存储与备份

- [ ] `df -h` 与 `df -i` 都不满，inode 也常爆
- [ ] fstab 用 UUID 加 `nofail`，网络盘尤其要加
- [ ] `findmnt --verify` 与 `mount -a` 都不报错
- [ ] 有**能恢复**的备份，而不是"备份过"
- [ ] 真演练过一次恢复流程
- [ ] 日志目录有 logrotate 或容量监控

## 二、现象到首选命令

| 现象 | 首选命令 |
| --- | --- |
| 服务起不来 | `systemctl status X -l`；`journalctl -u X -n 50` |
| 端口不通 | `ss -ltnp`；`curl -sv 127.0.0.1:PORT`；再看防火墙与安全组 |
| 磁盘满 | `df -h`；`df -i`；`lsof +L1` |
| 文件删不掉 | `lsattr` 看 `i` 属性；`lsof file` 看是否有人抓着 |
| ssh 拒绝 | `journalctl -u sshd -n 30`；`namei -l ~/.ssh`；看 auth 日志 |
| 命令找不到 | `echo $PATH`；`type -a cmd`；`command -v cmd` |
| 系统卡顿 | `vmstat -w 1`；`iostat -x 1`；`pidstat`；`strace -T` |
| 定时任务不跑 | `journalctl -u cron`；`env -i /bin/bash` 复现；`systemctl list-timers` |
| 容器端口绕过防火墙 | 绑 `127.0.0.1`，或在 `DOCKER-USER` 链里拦 |
| 网页 403 | `namei -l`；`ls -Z` 与 `getenforce` 查 SELinux |
| 内存告警 | `free -h` 看 available；`vmstat` 看 `si/so` |
| 证书过期 | `openssl s_client -connect host:443 -servername host` 查日期 |

## 三、继续深入的方向

- **内核与 `/proc`**：理解了进程、内存、IO 在 `/proc` 里的表示，工具的行为就不再是黑箱。
- **网络与 eBPF**：`tcpdump` 之后是 `bpftrace`，能在内核里追踪系统调用与网络，排障进入快车道。
- **容器编排（K8s）**：单机容器之上是调度与自愈，是运维与后端的主流去向。
- **可观测性（Prometheus 加日志聚合）**：从"出问题才上机器"变成"指标先告警"。
- **自动化（Ansible / Terraform）**：把手工步骤变成可重复、可审查的代码。

:::info
清单不是用来"打勾交差"的，而是**上线前和出事时各过一遍**。每次真出一次故障，回头给它补一条——这份清单应该随你的经验一起变长。
:::

## 四、最后：方法论

这个系列真正想留下的不是命令表，而是一种顺序：**先观察再动手、先看日志再猜、一次只改一个变量、保留现场、把过程写下来**。命令会忘，顺序不会——照着这个顺序走，哪怕机器你从没见过，也能一步步把答案问出来。

## 五、动手清单

```bash title="上线前对着跑一遍" command:("$":1-8)
systemctl --failed                                   # 1. 有没有失败的服务
awk -F: '$2==""{print $1}' /etc/shadow               # 2. 空密码账号，应为空
find / -perm -4000 -type f 2>/dev/null | head        # 3. setuid 文件排查
ss -ltnp | head                                      # 4. 监听与绑定地址
df -h; df -i                                         # 5. 空间与 inode
findmnt --verify --verbose | head                    # 6. fstab 校验
journalctl -p err -b --no-pager | tail -20           # 7. 本次开机的错误
ls /etc/cron.d /etc/logrotate.d 2>/dev/null          # 8. 定时与日志轮转配置
```

## 小结

- 四张清单：**权限账号、服务启动、网络防火墙、存储备份**，覆盖绝大多数"顺手能修"的问题。
- 一张对照表把现象映射到首选命令，出事先照着敲，别凭感觉。
- 深入方向：内核与 `/proc`、eBPF、K8s、可观测性、自动化，各按需要挑一个走下去。
- 方法论：**先观察再动手、先看日志再猜、一次改一个变量、保留现场、写下过程**。
- 清单会越来越长，那正是你经验在增长的样子。

## 下一节预告

本系列到这里收尾。下一站不必是"下一节"——把上面任意一个深入方向挑一个，动手做个小项目，比如给自己的机器加一整套 Prometheus 监控，或把日常操作写成 Ansible，比继续读更有用。
