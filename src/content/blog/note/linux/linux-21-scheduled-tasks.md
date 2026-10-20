---
title: 'Linux 基础 21：定时任务——crontab 的坑与 systemd timer'
description: 'cron 五字段的语义与 日/星期 的“或”关系、它那套极简环境的经典陷阱（PATH、工作目录、% 转义、输出邮寄、变量不继承）、crontab 与 cron.d 的管理、anacron 补跑，以及 systemd timer 的 OnCalendar、Persistent 与查看方法。'
link: linux-21-scheduled-tasks
catalog: true
date: 2022-04-29 20:30:00
updated: 2022-04-29 22:10:00
categories: ['笔记']
tags: ['Linux', '基础']
draft: false
---

## 这一节要解决什么

同一个脚本，在终端里手跑好好的，塞进 crontab 就静默失败——没有输出、没有报错、没人知道它根本没跑。偶尔还会漏掉一次，因为那一刻机器正好没开机。

这一节先把 cron 的**环境陷阱**讲透（这才是 90% 的"定时任务不工作"的根因），再看它的现代替代 systemd timer 怎么把这些坑一个个填平。

## 一、五个字段

```text
*  *  *  *  *  command
│  │  │  │  └─ 星期 (0-7，0 和 7 都是周日，也可写 MON..SUN)
│  │  │  └──── 月   (1-12)
│  │  └─────── 日   (1-31)
│  └────────── 时   (0-23)
└───────────── 分   (0-59)
```

| 写法 | 含义 |
| --- | --- |
| `*/15 * * * *` | 每 15 分钟 |
| `0 3 * * *` | 每天 03:00 |
| `0 9 * * 1-5` | 工作日 09:00 |
| `0 0 1 * *` | 每月 1 日 00:00 |
| `@reboot` | 每次开机一次 |

**关键结论**：`日` 和 `星期` 同时被指定时是**"或"关系**——`0 0 1 * 5` 不是"每月 1 号且是周五"，而是"每月 1 号**或**每周四"，两个都触发。要"且"只能写进命令里自己判断。

## 二、环境陷阱（本节重点）

cron 执行时，环境和你在终端里登录的 shell **完全是两套**：

```ini title="crontab 顶部：显式声明环境"
PATH=/usr/local/bin:/usr/bin:/bin
MAILTO=
SHELL=/bin/bash
```

```text
PATH=/usr/bin:/bin     ← 极简，/usr/local/bin 常常不在里面
HOME=/root             ← 工作目录是家目录，不是你 cd 过去的目录
其他变量几乎全空       ← alias、.bashrc、nvm 都不加载
```

| 现象 | 原因 |
| --- | --- |
| `command not found` | PATH 里没有那个目录，呼应第 08 节的环境 |
| 相对路径找不到文件 | 工作目录是 `$HOME`，不是脚本所在目录 |
| 命令被截断 | 命令里的 `%` 是特殊字符，必须写成 `\%` |
| 报错没人知道 | cron 把输出**邮寄**给 `MAILTO`；设 `MAILTO=` 关掉 |
| `$VAR` 是空的 | 变量不继承，必须在 crontab 顶部声明或在脚本里 source |

:::warning
**写 crontab 的第一原则：命令用绝对路径，需要的环境变量在顶部显式声明。**
排查"为什么不跑"的固定动作，是把命令复制到终端、用 `env -i /bin/bash` 跑一遍——模拟那个极简环境，问题往往立刻现形。
:::

## 三、管理命令与日志

```bash title="crontab 与系统级任务" command:("$":1-6)
crontab -l                     # 当前用户的定时任务
crontab -e                     # 编辑
crontab -r                     # 删除全部，无确认，慎用
ls /etc/cron.d/                # 系统级：格式多一个“用户”字段
cat /etc/cron.allow            # 白名单，存在则只有名单内用户能用
sudo journalctl -u cron -n 50  # Debian/Ubuntu 看 cron 日志
```

`/etc/cron.d/` 里的文件和 crontab 格式一样，只是**多一列用户名**，适合打包分发：

```text
30 2 * * * root /usr/local/bin/backup.sh /srv/data
```

## 四、anacron：机器不常开机怎么办

cron 的假设是"**机器一直开着**"——关机的时段任务就漏了。`anacron` 记录"上次哪天跑的"，开机后按天/周补齐：

```ini title="/etc/anacrontab"
1  5   cron.daily    run-parts /etc/cron.daily
7  10  cron.weekly   run-parts /etc/cron.weekly
```

| 字段 | 含义 |
| --- | --- |
| 周期（天） | 至少间隔几天跑一次 |
| 延迟（分钟） | 开机后延迟多久再跑，用来错峰 |

## 五、systemd timer：更现代、还能补跑

```ini title="backup.timer"
[Unit]
Description=Run backup daily

[Timer]
OnCalendar=*-*-* 03:00:00
Persistent=true
RandomizedDelaySec=10m

[Install]
WantedBy=timers.target
```

```ini title="backup.service"
[Unit]
Description=Nightly backup

[Service]
Type=oneshot
ExecStart=/usr/local/bin/backup.sh /srv/data
```

```bash title="启用与查看" command:("$":1-4)
sudo systemctl enable --now backup.timer
systemctl list-timers --all            # 下次触发时间一览
systemctl status backup.timer
sudo journalctl -u backup.service -n 30
```

**关键结论**：三点比 cron 强——`Persistent=true` 让**关机错过的任务在开机后补跑**（正是 anacron 的能力）、`RandomizedDelaySec` 错峰避免一堆机器同时打同一台服务器、日志自动进 journald 随时可查。

**批注**：`OnCalendar` 我一开始写成 `03:00`（没有秒），systemd 能解析但补跑行为不如写全 `*-*-* 03:00:00` 明确。`systemctl list-timers` 是最实用的一个命令——**它直接告诉你下次什么时候跑**。

## 六、logrotate

日志放任不管会撑满磁盘。`logrotate` 按大小或时间切割、压缩、保留 N 份、重开文件：

```ini title="/etc/logrotate.d/myapp"
/var/log/myapp/*.log {
    daily
    rotate 14
    compress
    missingok
    notifempty
    postrotate
        systemctl reload myapp >/dev/null 2>&1 || true
    endscript
}
```

它通常由 `/etc/cron.daily/logrotate` 或一个 systemd timer 驱动；`postrotate` 是让服务**重新打开日志文件**，否则它继续往被改名后的旧 inode 写。

## 七、动手清单

```bash title="练手（安全环境）" command:("$":1-7)
crontab -l                                               # 1. 现有任务
printf '#!/bin/sh\ndate >> ~/cron.log\n' | tee ~/bin/t.sh >/dev/null; chmod +x ~/bin/t.sh   # 2. 造一个脚本
env -i /bin/bash -c '~/bin/t.sh'                         # 3. 模拟 cron 的极简环境
systemd-analyze calendar '*-*-* 03:00:00'                # 4. 校验 OnCalendar 语法
systemctl list-timers --all | head                       # 5. 系统里所有 timer
sudo journalctl -u cron -n 20 2>/dev/null || sudo journalctl -u crond -n 20   # 6. cron 日志
sudo logrotate -d /etc/logrotate.d/myapp                 # 7. 干跑，不真改文件
```

## 小结

- cron 五字段里，`日` 和 `星期` 同时指定是**"或"**；`0` 与 `7` 都是周日。
- 环境陷阱是 cron 的头号问题：**极简 PATH、工作目录是 `$HOME`、变量不继承、`%` 要转义、输出走邮件**。
- `crontab -r` 无确认删光任务，慎用；系统级任务放 `/etc/cron.d/`，格式多一个用户字段。
- 机器不常开机就靠 **anacron** 或 systemd timer 的 `Persistent=true` 补跑。
- systemd timer 比 cron 多了补跑、随机延迟和 journald 日志；`systemctl list-timers` 看下次触发。
- 日志用 `logrotate` 切割压缩保留，别等磁盘满了才想起它。

## 下一节预告

下一节：日志与故障排查方法论——journald 与 `/var/log` 的分工、从现象到根因的六步排障法，以及磁盘满、端口被占、权限拒绝三个真实案例。
