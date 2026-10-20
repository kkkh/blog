---
title: 'Linux 基础 10：包管理——apt 到底做了什么，以及四个高频报错'
description: 'apt update 与 install 之间发生的事、dpkg/apt 的三个数据目录、dpkg -S 查文件归属、版本钉住与 pin、四个高频报错的成因与定位顺序，以及 RHEL 系 dnf 的对照写法。'
link: linux-10-package-management
catalog: true
date: 2022-04-18 20:30:00
updated: 2022-04-18 22:10:00
categories: ['笔记']
tags: ['Linux', '基础']
draft: false
---

## 这一节要解决什么

`apt install` 谁都会敲，但报错的时候能一眼定位的人不多。这一节讲清三个数据目录、依赖解析的时机，以及四个高频报错的真正成因——`Unable to locate package`、`held broken packages`、`Could not get lock`、`unmet dependencies`。

## 一、`apt update` 和 `install` 之间发生了什么

```bash title="标准两步" command:("$":1-3)
sudo apt update           # 1) 从 /etc/apt/sources.list* 拉索引 → 写入 /var/lib/apt/lists
apt-cache policy nginx    # 2) 看这个包有哪些版本可用、来自哪个仓库
sudo apt install nginx    # 3) 解析依赖 → 下载 .deb → dpkg 解包安装 → 触发 postinst 脚本
```

三个目录分工（记住它们，报错时就知道该看哪）：

| 路径 | 内容 | 谁维护 |
| --- | --- | --- |
| `/etc/apt/sources.list`、`sources.list.d/` | **仓库地址**（你手写的） | 你 |
| `/var/lib/apt/lists/` | 仓库索引缓存 | `apt update` |
| `/var/cache/apt/archives/` | 下载好的 `.deb` | `apt`（`apt clean` 可清） |
| `/var/lib/dpkg/` | **已安装包的数据库**（`status` 文件） | `dpkg` |

**批注**：`apt` 是**上层包装**（负责依赖、仓库、下载），`dpkg` 是**底层执行者**（负责解包、安装、维护数据库）。所以看到 `dpkg: error processing ...` 就知道问题在底层；看到 `Unable to locate package` 就知道是索引/仓库层。

## 二、查询：装了什么、文件属于谁

```bash title="四个查询动作" command:("$":1-5)
apt list --installed 2>/dev/null | wc -l        # 装了多少个包
apt-cache policy nginx                          # Candidate / Installed / 各来源
apt show nginx | head -12                       # 描述、依赖、体积
dpkg -l | grep -i nginx                          # 已装版本（ii = 正常安装）
dpkg -S "$(command -v ls)"                       # ⭐ 这个文件属于哪个包
```

```bash title="版本钉住：三档手段" command:("$":1-5)
sudo apt-mark hold nginx        # 最简单：禁止升级这一个包
apt-mark showhold               # 看被 hold 的包
sudo apt-mark unhold nginx
# 更精细的场景（混源时，比如同时有官方源和第三方源）用 Pin：
cat /etc/apt/preferences.d/10-nginx-pin  # 内容形如：
# Package: nginx
# Pin: origin nginx.org
# Pin-Priority: 900
```

**批注**：`apt-mark hold` 的语义是"**升级时跳过它**"，不是"锁死在某个版本、不许重装"。想固定具体版本用 `apt install nginx=1.18.0-0ubuntu1`（可用版本看 `apt-cache policy`），并用 pin 控制优先级。

## 三、四个高频报错：成因与顺序

### 1. `Unable to locate package xxx`

```bash title="三步定位" command:("$":1-3)
sudo apt update                     # ① 最常见原因：索引过期/根本没拉过
apt-cache policy xxx                # ② 看这个包在不在任何来源里
grep -r . /etc/apt/sources.list*    # ③ 仓库有没有启用、suite 对不对（jammy vs noble）
```

补充可能：架构不符（`amd64`/`arm64`）、包名拼错、需要的仓库没加（如 `universe`）。

### 2. `The following packages have been kept back` / `held broken packages`

```bash title="看 Candidate 那一行" command:("$":1-2) mark:2
apt-cache policy 冲突包名
# Candidate 为空或低于 Installed，说明“有依赖把它按住了”
apt list --upgradable 2>/dev/null         # 哪些包被 kept back
```

常见成因：某个被 hold 的包、第三方源版本更高导致的依赖冲突、或者 `Phased-Update` 灰度。不要用 `--force` 硬闯，先看 `apt-cache policy` 的 Version table。

### 3. `Could not get lock /var/lib/dpkg/lock-frontend`

```bash title="先弄清是谁持有锁" command:("$":1-4)
ps aux | grep -E 'apt|dpkg' | grep -v grep
sudo fuser -v /var/lib/dpkg/lock-frontend
systemctl status unattended-upgrades     # 自动更新常是“元凶”
sudo lsof /var/lib/dpkg/lock-frontend
```

**批注**：最常见的不是"上一个 apt 崩了留了锁"，而是**后台的 `unattended-upgrades` 正在跑**。这时正确做法是等它结束（或 `systemctl stop unattended-upgrades` 后重试），而不是 `rm` 掉锁文件——删锁在极端情况下会真的损坏 dpkg 数据库。

### 4. `Unmet dependencies` / `dpkg: error processing`

```bash title="修复动作" command:("$":1-4)
sudo apt --fix-broken install       # 先让 apt 把断掉的依赖补齐
sudo dpkg --configure -a            # 配置阶段失败的包重新配置
apt-cache policy 包名                # 版本来源对不对
sudo apt install -f                 # 等价于 --fix-broken
```

## 四、第三方源与密钥（`apt-key` 已弃用）

```bash title="加一个第三方源（现代写法）" command:("$":1-4)
sudo install -d /etc/apt/keyrings
curl -fsSL https://example.com/key.asc | sudo gpg --dearmor -o /etc/apt/keyrings/example.gpg
echo "deb [signed-by=/etc/apt/keyrings/example.gpg] https://repo.example.com stable main" \
  | sudo tee /etc/apt/sources.list.d/example.list
sudo apt update
```

**批注**：还在用 `apt-key add` 的教程都过期了——它把密钥加到**全局**信任，等同于"任何源都能用这把钥匙"；`signed-by` 才是把信任范围限定到单个仓库。

## 五、RHEL / CentOS 系对照

| 目的 | Debian/Ubuntu | RHEL/Rocky |
| --- | --- | --- |
| 刷新索引 | `apt update` | `dnf makecache`（`dnf check-update` 也会刷） |
| 安装 | `apt install nginx` | `dnf install nginx` |
| 查文件归属 | `dpkg -S /usr/bin/ls` | `rpm -qf /usr/bin/ls` |
| 查包内容 | `dpkg -L nginx` | `rpm -ql nginx` |
| 历史记录 | `/var/log/dpkg.log`、`apt history` | `dnf history`（回滚用 `dnf history undo`） |
| 包组/模块 | （元包） | `dnf group list`、`dnf module list` |

## 六、上线前的两条纪律（我的批注）

```bash title="别做这两件事" command:("$":1-3)
sudo apt upgrade -y            # ❌ 生产环境不要无脑全升：内核、glibc、数据库都可能被换成新大版本
cat /var/run/reboot-required   # ✅ 升级后确认是否需要重启（内核/libc 更新会创建这个文件）
```

- 需要自动安全更新时，用 `unattended-upgrades` 并且**只放开 security 源**，不要放开全部源：
  ```bash title="只放开安全更新" command:("$":1) mark:1
  # /etc/apt/apt.conf.d/50unattended-upgrades 里只保留 *-security
  ```
- 升级前先 `apt list --upgradable`，把 `nginx`、`mysql-server`、`kernel` 这类关键包单独看一遍，必要时 hold。

## 七、动手清单

```bash title="把本节结论跑一遍" command:("$":1-7)
apt-cache policy bash | head -8          # 1. Candidate / Installed / 来源
dpkg -S "$(command -v ls)"               # 2. 文件归属
dpkg -L coreutils | head                 # 3. 包内文件清单
apt-mark hold bash; apt-mark showhold    # 4. 钉住与查看（测完记得 unhold）
sudo apt --fix-broken install            # 5. 依赖修复（幂等）
ls /var/lib/apt/lists | wc -l            # 6. 索引缓存确实被 update 写入
ls /var/cache/apt/archives/*.deb 2>/dev/null | wc -l    # 7. .deb 缓存
```

## 小结

- `apt` 管依赖/仓库/下载，`dpkg` 管解包与数据库；报错先判断落在哪一层。
- 查文件归属用 `dpkg -S`（RHEL 用 `rpm -qf`）；候选版本用 `apt-cache policy`。
- 钉住版本用 `apt-mark hold`（简单）或 `preferences.d` 的 Pin（混源场景）。
- 锁文件报错先找**持有者**（常常是 `unattended-upgrades`），不要删锁。
- 生产上避免无脑 `apt upgrade -y`；升完记得看 `/var/run/reboot-required`。

## 下一节预告

下一节进入服务管理：systemd 的 unit 是什么、`systemctl` 的八个常用子命令、`journalctl` 的过滤姿势，以及它与传统 SysV init/cron 的分工。
