---
title: 'Linux 基础 02：/ 底下为什么是这些目录，inode 里到底存了什么'
description: 'FHS 每个目录的职责与"谁会写它"，再往下一层：文件名其实不属于文件，rm 不是删除，而"磁盘有空间却写不进"通常是 inode 用满了。'
link: linux-02-filesystem-and-inode
catalog: true
date: 2022-04-10 20:30:00
updated: 2022-04-10 22:00:00
categories: ['笔记']
tags: ['Linux', '基础']
draft: false
---

## 这一节要解决什么

多数人对 `/` 的印象是：`/etc` 放配置，`/home` 放用户。但真正决定排障方向的，是另外几个问题：**谁在往这个目录写、重启后会不会消失、它是磁盘还是内存**。再往下还有一层更根本的东西：在 Linux 里，文件名和文件本身是分开的。理解了这一点，`rm`、`mv`、硬链接、以及那句著名的 `No space left on device` 才有统一的解释。

## 一、FHS：每个目录是谁的地盘

| 目录 | 放什么 | 谁在写 | 特别提醒 |
| --- | --- | --- | --- |
| `/bin`、`/sbin` | 基础命令（`ls`、`ip`） | 包管理器 | 现代发行版是指向 `/usr/bin`、`/usr/sbin` 的符号链接 |
| `/usr` | 系统装的大部分东西：`bin/ lib/ share/ local/` | 包管理器 | 体积最大的地方；`/usr/local` 留给手工安装 |
| `/etc` | 配置 | 你和包管理器 | 只放配置，别在这里写日志 |
| `/var` | 运行时会增长的东西：`log/ cache/ spool/ lib/` | 各种服务 | **磁盘写满的头号嫌疑人就是 `/var/log`** |
| `/home`、`/root` | 用户与 root 的家目录 | 你 | 备份的重点 |
| `/tmp` | 临时文件 | 任何人 | 常被挂成 tmpfs 或定期清理，**别放重要数据** |
| `/opt` | 第三方独立软件 | 你 | 与包管理器无关的整套软件 |
| `/srv` | 对外服务的数据 | 你 | 约定俗成，很多机器空着 |
| `/run` | 本次启动产生的运行时数据（PID、socket） | 服务 | 早年的 `/var/run` 现在指向它 |
| `/proc`、`/sys` | 内核暴露的虚拟文件 | 内核 | 读它们是在读内核状态，不是读磁盘 |
| `/dev` | 设备文件 | 内核/udev | `/dev/sda`、`/dev/null` 都在这里 |

先看清自己这台机器的实际情况（比背 FHS 有用得多）：

```bash
ls -ld /bin /sbin /lib /usr/bin /tmp /var /run
findmnt /tmp /var /home /            # 各自挂在哪个设备上、是不是 tmpfs
```

我这边一台 Ubuntu 的实际输出（节选）：

```bash
$ ls -ld /bin
lrwxrwxrwx 1 root root 7  2月  2 08:55 /bin -> usr/bin

$ findmnt /tmp
TARGET SOURCE FILESYSTEM OPTIONS
/tmp   tmpfs  tmpfs      rw,nosuid,nodev,size=...
```

两个结论直接落地：`/bin` 只是入口，真身在 `/usr/bin`；`/tmp` 是**内存里的 tmpfs** —— 重启即清空，且**占用的是内存不是磁盘**（这点在排查“内存去哪了”时经常被忽略）。

## 二、inode：文件真正的身份证

用 `ext4` 举例，inode 里存的是：文件类型与权限、属主与属组、文件大小、三个时间戳（`atime`/`mtime`/`ctime`）、**链接计数**、以及指向数据块的 extent 指针。它**不存文件名**——名字存在目录项（directory entry）里，由目录自己维护一张“名字 → inode 号”的表。

```bash
ls -i  a.txt                # 最左边那列就是 inode 号
stat   a.txt                # 完整元数据：Inode / Links / Access / Modify / Change
df   -h /                   # 容量
df   -i /                   # inode 使用率（这一行最容易被忽略）
```

**我的批注**：`ls -l` 看到的信息大部分来自 inode，只有一个字段来自目录——**文件名**。这也是“同一份数据可以有很多个名字”的物理基础。

## 三、硬链接、软链接，以及“删除”的真相

```bash
echo hello > a.txt
ln    a.txt hard.txt        # 硬链接
ln -s a.txt soft.txt        # 软链接
ls -li a.txt hard.txt soft.txt
```

```text
131072 -rw-r--r-- 2 user user 6  ... a.txt
131072 -rw-r--r-- 2 user user 6  ... hard.txt     ← 同一个 inode 号，Links=2
131073 lrwxrwxrwx 1 user user 3  ... soft.txt -> a.txt
```

| | 硬链接 | 软链接 |
| --- | --- | --- |
| 本质 | 同一 inode 的另一个名字 | 一个单独的 inode，内容是路径字符串 |
| inode 号 | 与源文件相同 | 不同 |
| 链接数 | `Links` 增加 | 不影响源文件计数 |
| 跨文件系统 | ❌ 不行（inode 号只在单个文件系统内唯一） | ✅ 可以 |
| 指向目录 | ❌（只有内核自己造的 `.` 与 `..` 例外） | ✅ 可以 |
| 源文件被删 | 数据仍在，直到计数归零 | 变成悬空链接（`readlink` 还能看到路径） |

然后是关键一句：

```bash
rm a.txt        # 实际发生的是 unlink：链接计数 2 → 1
```

`rm` **不删数据，只把名字从目录里摘掉**；当链接计数减到 0、且没有进程还开着这个文件时，内核才回收数据块。所以“误删之后磁盘空间没释放”也是同一套机制：进程还持有那个已删除文件的句柄。

还有一个由此推出的日常现象：`mv` 在**同一个文件系统内**只是改目录项（瞬间完成）；跨文件系统时是**复制 + unlink**（大文件会很慢，也可能因为空间不足而失败）。

顺手验证跨设备：

```bash
findmnt -no SOURCE /          # 例：/dev/sda2
findmnt -no SOURCE /boot      # 例：/dev/sda1  ← 不同文件系统，mv 过去就是复制
```

## 四、真实故障：`df -h` 还有空间，却写不进去

这是我这几年遇到最“反直觉”的一类报障：`df -h` 显示还有几个 G，可写文件就是报 `No space left on device`。原因通常是 **inode 用满**，而不是容量用满。

```bash
df -h /
df -i /
```

```text
Filesystem      Inodes  IUsed  IFree IUse% Mounted on
/dev/sda2      6553600 6553600     0  100% /
```

`IUse%` 100% 时，容量再大也写不进新文件——因为**每个新文件都要占一个 inode**。

高发位置：`/var/spool`（邮件队列、任务队列）、会话文件目录、以及被程序疯狂创建小文件的地方。定位方法不是找“最大的文件”，而是找“**文件数最多**的目录”：

```bash
# 按“文件数”排序，而不是按体积（GNU find）
sudo find /var -xdev -type f -printf '%h\n' 2>/dev/null \
  | sort | uniq -c | sort -rn | head
```

顺带记住 `du` 与 `df` 会对不上账的三种常见原因：已删除但被进程占用的文件、稀疏文件、以及 `du` 会按块向上取整。

## 五、动手清单

```bash
# 1. 目录职责的“实证”
ls -ld /bin /sbin /lib; findmnt -o TARGET,SOURCE,FSTYPE /tmp /var

# 2. inode 与链接
echo hi > f; ln f g; ln -s f s; ls -li f g s; stat -c '%i %h %n' f g s

# 3. 删除的真相：数据块在链接归零前不消失
ln f f2; rm f; ls -li f2      # f2 还在，inode 号不变

# 4. 两个空间维度
df -h /; df -i /
```

## 小结

- 目录职责的判据是三条：**谁写、重启后是否消失、是磁盘还是内存**（`/tmp`、`/run`、`/proc`、`/sys` 都是“假文件系统”）。
- 文件名属于**目录项**，不属于文件；inode 才是文件系统的身份证，且只在单个文件系统内唯一。
- `rm` 是 unlink，`mv` 同盘是改名、跨盘是复制。
- 报“没空间”时，`df -h` 和 `df -i` 都要看。

## 下一节预告

下一节回到最日常的几个命令：`ls`、`cp`、`mv`、`rm` 的真实语义——glob 是 **shell** 展开的、`--` 有什么用、`cp -a` 到底保留哪些东西，以及 `rm -rf` 为什么不该随手敲。
