---
title: 'Linux 基础 11：systemd——unit、systemctl 与 journalctl 的正确用法'
description: 'unit 的三种类型与三节结构、八个必备的 systemctl 子命令、写一个能自启能重启的最小 service、journalctl 的过滤姿势，以及五个真正常踩的坑（忘了 daemon-reload、绝对路径、干净 PATH 等）。'
link: linux-11-systemd
catalog: true
date: 2022-04-19 20:30:00
updated: 2022-04-19 22:10:00
categories: ['笔记']
tags: ['Linux', '基础']
draft: false
---

## 这一节要解决什么

"服务起不来""改完配置不生效""开机没自启"——现代发行版上这些问题几乎都在 systemd 里。它的核心概念只有一个：**unit（单元）**。看懂一个 unit 文件，比背一堆命令名字有用得多。

## 一、systemd 在管什么：unit 是统一的抽象

| 类型 | 后缀 | 作用 |
| --- | --- | --- |
| service | `.service` | 一个进程/进程组（最常用） |
| socket | `.socket` | 按需激活（有人连就拉起对应服务，省内存） |
| timer | `.timer` | 定时任务（替代 cron，见第 21 节） |
| target | `.target` | 一组 unit 的集合（像"运行级别"） |
| mount / path | `.mount` / `.path` | 挂载 / 目录变动触发 |

```bash title="先摸底：这台机器在跑什么" command:("$":1-5)
systemctl list-units --type=service --state=running | head
systemctl list-unit-files --state=enabled | head        # 开机自启的
systemctl is-active nginx; systemctl is-enabled nginx    # 只问状态，输出干净（写脚本友好）
systemctl cat nginx                                      # 打印 unit 文件 + 覆盖片段（排查必看）
systemctl show -p FragmentPath nginx                     # unit 文件到底在哪
```

## 二、八个必备子命令 + 两个最容易混的区别

```bash title="生命周期操作" command:("$":1-8)
systemctl start   app     # 启动（本次运行）
systemctl stop    app     # 停止
systemctl restart app     # 停止再启动（会中断连接）
systemctl reload  app     # 只重载配置（需服务支持；不中断现有连接）
systemctl status  app     # 状态 + 最近日志（第一手信息）
systemctl enable  app     # 写入开机自启（建立符号链接）
systemctl disable app     # 取消开机自启
systemctl mask    app     # 彻底禁用（链接到 /dev/null，start 也会被拒绝）
```

**两个区别**：

- **`enable` ≠ `start`**：`enable` 只管"下次开机要不要起"，不会立刻启动。要一步到位用 `systemctl enable --now app`。
- **`mask` 比 `disable` 更彻底**：`disable` 只是去掉自启链接（你还能手动 start）；`mask` 之后连 `start` 都会被拒绝——用于"这个服务绝不能被拉起来"的场景。

```bash title="查看与复位失败的单元" command:("$":1-4)
systemctl --failed                        # 所有失败的单元（排障第一站）
journalctl -u app -n 50 --no-pager        # 最近的日志
systemctl reset-failed app                # 清掉失败计数（否则重启策略会一路叠加）
systemctl daemon-reload                   # ⭐ 改过 unit 文件后必须执行
```

## 三、写一个最小可用 service

文件放 `/etc/systemd/system/myworker.service`：

```ini title="/etc/systemd/system/myworker.service" mark:4,7-9
[Unit]
Description=My background worker
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=deploy
WorkingDirectory=/srv/worker
ExecStart=/usr/local/bin/worker.sh --loop
Restart=on-failure
RestartSec=3
EnvironmentFile=-/etc/default/myworker
TimeoutStopSec=20
KillSignal=SIGTERM

[Install]
WantedBy=multi-user.target
```

```bash title="让它生效" command:("$":1-3)
sudo systemctl daemon-reload            # 1) 让 systemd 重读文件
sudo systemctl enable --now myworker    # 2) 自启 + 立即启动
systemctl status myworker --no-pager    # 3) 看结果
```

关键字段的语义（**这几个决定了服务"稳不稳"**）：

| 字段 | 含义 | 备注 |
| --- | --- | --- |
| `Type` | 进程模型 | `simple`（默认，前台进程）、`forking`（老式守护进程）、`oneshot`（跑完即退）、`notify`（需 sd_notify） |
| `Restart` | 退出后的策略 | `on-failure`（推荐）、`always`、`no` |
| `RestartSec` | 重启前等待 | 别设 0，避免疯狂重启 |
| `User` / `Group` | 以谁的身份跑 | **不要**用 root 跑业务进程 |
| `EnvironmentFile=-…` | 环境文件 | 前面加 `-` = 文件不存在也不报错 |
| `WorkingDirectory` | 工作目录 | 相对路径的坑在这里 |
| `TimeoutStopSec` | 停止超时 | 超时后升级为 `KILL` |

:::warning
**systemd 里请一律写绝对路径。** `ExecStart=worker.sh` 会失败——因为 systemd 不经过你的 shell，**PATH 干净到只剩 `/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin`**（呼应第 08 节：非交互环境的 PATH 就是系统默认值）。同理，服务需要的自定义环境变量要写 `Environment=` / `EnvironmentFile=`，别指望 `~/.bashrc`。
:::

日志：**stdout/stderr 自动进 journal**，所以进程只要往标准输出打日志就够了（不用自己写文件、不用 logrotate）。

```bash title="journalctl 的常用过滤" command:("$":1-6)
journalctl -u myworker -f                 # 跟随（≈ tail -f）
journalctl -u myworker --since '1 hour ago'
journalctl -p err -b                      # 本次开机以来的 error 及以上
journalctl -b -1 -u myworker              # 上一次开机（重启后查原因的利器）
journalctl --disk-usage                   # journal 占了多少
journalctl --vacuum-time=7d               # 只保留 7 天
```

## 四、五个真正常踩的坑

1. **改完 unit 忘了 `daemon-reload`** → 改的东西"看起来没生效"。systemd 只在你 reload 后重读磁盘上的 unit 文件。
2. **`ExecStart` 写相对路径** → 报 `No such file or directory`，即使文件真的存在（PATH 原因，见上）。
3. **`systemctl restart` 打断服务** → 能用 `reload` 就用 `reload`（前提是服务支持，比如 nginx 的 `-s reload`）。生产上我更倾向 `reload`，缩短中断窗口。
4. **`Type=forking` 用错** → 前台进程用 `simple`；把 `simple` 服务写成 `forking` 会导致 systemd 认为"主进程已退出"从而重启循环。
5. **服务里读不到你的环境变量** → 不是 bug，是设计。systemd 给的是干净环境；要变量就显式声明。

## 五、动手清单

```bash title="在测试机上练一遍" command:("$":1-8)
systemctl list-units --failed                      # 1. 有没有失败的单元
systemctl cat ssh                                # 2. 读一个真实 unit（含覆盖片段）
sudo tee /etc/systemd/system/hello.service >/dev/null <<'EOF'
[Unit]
Description=hello
[Service]
ExecStart=/bin/sleep 300
Restart=on-failure
[Install]
WantedBy=multi-user.target
EOF
sudo systemctl daemon-reload; sudo systemctl enable --now hello   # 3. reload + 自启启动
systemctl status hello --no-pager; systemctl is-enabled hello      # 4. 状态与自启
journalctl -u hello -n 10 --no-pager                     # 5. 日志进 journal
sudo systemctl disable --now hello; sudo systemctl reset-failed hello  # 6. 清理
```

## 小结

- systemd 的统一抽象是 **unit**；业务用 `service`，定时用 `timer`，按需激活用 `socket`。
- `enable` 管自启、`start` 管本次；`enable --now` 一步到位；`mask` 比 `disable` 更彻底。
- 改 unit 必须 `daemon-reload`；`ExecStart` 必须绝对路径、环境必须显式声明（systemd 的 PATH 很干净）。
- 日志天然进 `journalctl`；`-u`、`--since`、`-p err`、`-b -1` 是最常用的四个过滤。
- `systemctl --failed` + `status` + `journalctl -u` 是排查服务问题的固定三步。

## 下一节预告

下一节：磁盘与文件系统——`lsblk -f`/`blkid`/`findmnt` 各看什么、`fstab` 六个字段与"为什么必须写 UUID"、`mount -a` 为什么是改 fstab 后的必做动作，以及"删了文件空间却不释放"的正解。
