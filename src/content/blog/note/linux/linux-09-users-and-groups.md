---
title: 'Linux 基础 09：用户与组——passwd、shadow、sudoers 三件套'
description: '/etc/passwd 七个字段的含义、shadow 里 ! 与 * 的区别、主组与附加组的真实影响、usermod -aG 少写一个 -a 的后果、su 与 sudo 的差别，以及 sudoers 的最小可用写法。'
link: linux-09-users-and-groups
catalog: true
date: 2022-04-17 20:30:00
updated: 2022-04-17 22:10:00
categories: ['笔记']
tags: ['Linux', '基础']
draft: false
---

## 这一节要解决什么

用户管理的命令谁都会敲，但真正出事的地方在三个文件（`passwd`、`shadow`、`group`）和一条容易被忽略的 `-a`。这一节按"读文件 → 看权限 → 改账号 → 授权"的顺序讲，并给出几个真实事故的成因。

## 一、`/etc/passwd`：七个字段，一个都不能猜

```bash title="拆开一个用户记录" command:("$":1-2)
grep "^$(whoami):" /etc/passwd
getent passwd "$(whoami)"
```

```text
alice:x:1000:1000:Alice:/home/alice:/bin/bash
  ↑   ↑  ↑    ↑     ↑        ↑          ↑
 1   2  3    4     5        6          7
```

| 字段 | 含义 | 备注 |
| --- | --- | --- |
| 1 | 用户名 | 登录名 |
| 2 | 密码占位 | 现代系统是 `x`，真哈希在 `/etc/shadow` |
| 3 | **UID** | `0` 就是 root；系统账号一般 < 1000（发行版门槛不同） |
| 4 | **主组 GID** | 注意：这个字段决定的是**主组** |
| 5 | GECOS | 备注/全名（随便写） |
| 6 | 家目录 | 注意 `root` 是 `/root`，不是 `/home/root` |
| 7 | 登录 shell | 写 `/usr/sbin/nologin` 就禁止登录（服务账号常用） |

**批注**：判断"是不是系统账号"不要只看 UID 数值，不同发行版门槛不同（RHEL 曾用 500，现在是 1000）；`getent passwd` 比直接读文件更好，因为它走的是 NSS，能顺带看到 LDAP 等来源。

## 二、`/etc/shadow`：`!` 和 `*` 不是一回事

```bash title="需要 root 才能读" command:("$":1)
sudo grep "^$(whoami):" /etc/shadow
```

```text
alice:$6$xxx...:19000:0:99999:7:::
      ↑            ↑   ↑   ↑   ↑
   密码哈希      最短   最长 警告 宽限
```

| 情况 | 字段值 | 含义 |
| --- | --- | --- |
| 正常 | `$6$...` / `$y$...` | 哈希（`$6$` = SHA-512，`$y$` = yescrypt） |
| **锁定** | 前面加 `!` | **账号被锁**（`passwd -l` 就是这么做的） |
| **无可用密码** | `*` | 不可能匹配任何输入（服务账号常用，禁止密码登录） |
| 空 | （空白） | 实际无密码——极度危险，务必确认没有这种账号 |

```bash title="谁有真实密码 / 谁被锁了" command:("$":1-2)
sudo awk -F: '$2 ~ /^\$/ {print $1" 有密码"}' /etc/shadow | head
sudo awk -F: '$2 ~ /^!/ {print $1" 已锁定"}' /etc/shadow | head
```

## 三、主组与附加组：权限按"集合"算

```bash title="看自己的组" command:("$":1-3)
id                             # uid + gid + 所有组
id -Gn                         # 只列组名
getent group sudo wheel        # 这两个组在 Debian/RHEL 上分别是管理员组
```

进程访问文件时，内核会用**有效 UID + 有效 GID + 所有附加组**去比对权限位：

- **主组**是 `passwd` 第 4 字段（新建文件默认属组）
- **附加组**决定你还"属于"哪些组（比如 `sudo`、`docker`）——**附加组是权限的来源**

**批注**：`docker` 组的成员等同于 root（能挂载宿主目录、能起特权容器），很多人以为它只是"方便"，其实它是提权路径。

## 四、改账号：四个命令 + 一个必踩的坑

```bash title="建、改、锁、删" command:("$":1-6)
sudo useradd -m -s /bin/bash -G sudo alice     # 建（-m 建家目录，-G 附件组）
sudo adduser bob                                # Debian 的友好版：交互式、拷 /etc/skel、设密码
sudo usermod -aG docker alice                   # ⭐ 追加附加组（-a 必须带上）
sudo passwd -l alice                            # 锁定（hash 前加 !）
sudo userdel -r alice                           # 删用户 + 删家目录（⚠️ 数据一起没了）
sudo chage -l alice                             # 看密码有效期策略
```

:::danger
**`usermod -G` 不带 `-a` 会把用户的附加组整个覆盖掉。**
```bash title="真实事故"
sudo usermod -G docker alice     # ❌ alice 从 sudo 组里被移除，反而失去了管理员权限
sudo usermod -aG docker alice    # ✅ 追加
```
这个坑的可怕之处是"当场看不出问题"——直到下次你要用 sudo。
:::

## 五、su 与 sudo：不是同一个东西

| | `su` | `sudo` |
| --- | --- | --- |
| 需要谁的密码 | **目标用户**的（普通用户 su 到 root 就要 root 密码） | **自己的** |
| 授权粒度 | 全有或全无 | 按 sudoers 逐条命令授权 |
| 环境 | `su` 保留部分原环境，`su -` 才像登录 | 默认重置（`env_reset`、`secure_path`） |
| 审计 | 基本没有 | `/var/log/auth.log`（Debian）/ `secure`（RHEL）有记录 |

```bash title="对照体验" command:("$":1-4)
su -                     # 变成 root，环境像登录（PATH/家目录都换）
su                       # 变成 root，但保留你的环境与当前目录
sudo -i                  # 取得一个 root 的登录 shell（推荐替代 su -）
sudo -u postgres psql    # 以指定用户执行单条命令（服务运维常用）
```

## 六、sudoers：用 visudo 改，不要手动编辑

```bash title="最小可用规则" command:("$":1-4) mark:3
sudo visudo -f /etc/sudoers.d/deploy      # 用独立文件，别动主文件
# 内容示例：
#   deploy ALL=(root) NOPASSWD: /bin/systemctl restart nginx
#   %sudo ALL=(ALL:ALL) ALL               # 组授权：% 前缀
sudo -l                                   # 看当前身份被授权了什么
```

**批注**：

- `visudo` 的价值是**保存前做语法检查 + 原子替换**——直接编辑 sudoers 写错一个字符，可能让你彻底进不去 sudo。
- `NOPASSWD` 是给"无人值守任务"用的，能不用就不用；必须用时把命令限定到完整路径，别写成 `/bin/systemctl` 系列的通配。
- Debian/Ubuntu 的管理员组是 `sudo`，RHEL 系是 `wheel`——迁移脚本时这两处经常对不上。

## 七、动手清单

```bash title="在测试机上逐条验" command:("$":1-8)
id; groups                                  # 1. 你的身份与组集合
getent passwd "$(whoami)"                    # 2. 七个字段
sudo awk -F: '$2 ~ /^!/ {print $1}' /etc/shadow | head   # 3. 哪些账号被锁
sudo useradd -m -s /bin/bash t1; id t1       # 4. 建号（默认主组=同名组）
sudo usermod -aG docker t1; id -Gn t1        # 5. 追加附加组
sudo passwd -l t1; sudo grep "^t1:" /etc/shadow | cut -d: -f2 | head -c 2   # 6. 锁定痕迹 "!"
sudo userdel -r t1                           # 7. 清理（会删家目录）
sudo -l                                     # 8. 你的 sudo 授权
```

## 小结

- `passwd` 存身份（UID/GID/家目录/shell），`shadow` 存密码；`!` 是锁定，`*` 是"无可用密码"。
- **附加组才是权限来源**（`sudo`/`docker` 组）；`docker` 组成员实质上等同 root。
- `usermod -aG` 的 `-a` 不能省；`userdel -r` 会连同家目录一起删。
- `su` 要对方密码、`sudo` 要自己密码并逐条授权；审计日志在 `/var/log/auth.log`。
- sudoers 只改 `/etc/sudoers.d/` 下的独立文件，且永远用 `visudo`。

## 下一节预告

下一节：包管理——`apt update` 与 `install` 之间到底发生了什么、`dpkg -S` 查文件归属、版本钉住（`apt-mark hold` 与 pin）、四个高频报错的成因，以及 RHEL 系 `dnf` 的对照写法。
