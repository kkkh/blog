---
title: 'Linux 基础 12：磁盘与文件系统——从块设备到挂载点'
description: '块设备/分区表/文件系统/挂载点四层视角、lsblk -f 与 blkid 各看什么、fstab 六个字段与"必须写 UUID"的原因、mount -a 为什么是改 fstab 后的必做动作，以及删了文件却不释放空间的四种成因。'
link: linux-12-disks-and-filesystems
catalog: true
date: 2022-04-20 20:30:00
updated: 2022-04-20 22:10:00
categories: ['笔记']
tags: ['Linux', '基础']
draft: false
---

## 这一节要解决什么

"磁盘满了""挂载丢了""重启后盘没挂上"——这些问题要先在脑子里建好四层结构：**块设备 → 分区 → 文件系统 → 挂载点**。看清每一层用什么命令观察，剩下的就是操作纪律：动手前先认设备名。

## 一、四层结构，四个观察命令

```text
/dev/sda (块设备)
  └── /dev/sda1, /dev/sda2 (分区表：MBR 或 GPT)
        └── ext4 / xfs (文件系统：mkfs 创建，带 UUID)
              └── 挂载到 / 或 /data (挂载点：mount 建立)
```

```bash title="每层一个主力命令" command:("$":1-5)
lsblk -f                          # ⭐ 一张图看全：设备树 + FSTYPE + UUID + MOUNTPOINT
blkid                             # 只看文件系统的 UUID/LABEL/TYPE（写 fstab 时抄这里）
findmnt                           # 挂载关系（还有 findmnt /data 单查）
df -hT                            # 容量 + 文件系统类型（-T 才有类型列）
du -xsh /var/log                  # 目录体积（-x 不跨文件系统，避免统计到别的盘）
```

**批注**：`lsblk -f` 是我排"挂载类"问题的第一命令——它一次就把"设备、类型、UUID、挂载点"四层摆平。`lsblk` 看到 `MOUNTPOINT` 为空，就说明这个分区没挂上。

## 二、分区：MBR 与 GPT 的取舍

| | MBR | GPT |
| --- | --- | --- |
| 容量上限 | 2 TB | 很大（EB 级） |
| 主分区 | 最多 4 个 | 最多 128 个 |
| 引导 | 传统 BIOS | UEFI（配合 ESP 分区） |

```bash title="查看与新建（⚠️ 危险操作前先确认设备名）" command:("$":1-6)
sudo fdisk -l /dev/sdb            # 看分区表（MBR/老式）
sudo parted /dev/sdb print        # 看是否 GPT（parted 对 GPT 更友好）
sudo parted /dev/sdb mklabel gpt  # ⚠️ 重建分区表 = 清空
sudo parted -a optimal /dev/sdb mkpart primary ext4 1MiB 100%
sudo partprobe /dev/sdb           # 让内核重读分区表（否则看不到新分区）
lsblk -f                           # 复核
```

:::danger
`mkfs` 和 `parted mklabel` 都是**不可逆**操作，而设备名（`/dev/sdb` 还是 `/dev/sdc`）会因插拔顺序变化。我现在固定两步：① 用 `lsblk -f` 确认这个设备**没有挂载、没有数据**；② 把设备名复制粘贴，绝不手敲。
:::

## 三、创建文件系统

```bash title="建文件系统" command:("$":1-4)
sudo mkfs.ext4 -L data1 /dev/sdb1        # ext4，带标签
sudo mkfs.xfs -L data1 /dev/sdb1         # RHEL 系默认 XFS
sudo mke2fs -t ext4 -b 4096 /dev/sdb1    # 更底层的写法（调块大小、inode 比例）
sudo tune2fs -l /dev/sda1 | head         # ext 系：看/调参数（如保留块比例 -m）
```

**批注**：ext4 默认给 root 保留 5% 空间（`Reserved block count`），大容量数据盘上这 5% 很可观，纯数据盘可以降到 1%：`tune2fs -m 1 /dev/sdX`。这是我在 4 TB 数据盘上省出 160 GB 的一次经历。

## 四、挂载与 fstab：六字段，三个要点

```bash title="临时挂载" command:("$":1-5)
sudo mount /dev/sdb1 /data                 # 临时挂
sudo mount -o remount,rw /                 # 已挂载的重新挂（改选项）
sudo mount --bind /srv/app /var/www/app    # 目录镜像（同一个 inode 出现在两处）
sudo umount /data                          # 卸载（被占用会拒绝）
sudo fuser -vm /data ; sudo lsof +f -- /data   # 谁在占用（umount 失败时看这个）
```

```bash title="/etc/fstab 的六字段" command:("$":1-3) mark:1
UUID=3f1a...-9c  /data  ext4  defaults,noatime,nofail  0  2
# ↑设备           ↑挂载点 ↑类型  ↑选项                  ↑dump ↑fsck顺序
/dev/sdb1        /data  ext4  defaults                 0  2   # ❌ 别写 /dev/sdX
```

| 字段 | 说明 |
| --- | --- |
| ① 设备 | **必须写 `UUID=`**：`/dev/sdX` 的顺序会变（插拔、换控制器都会变），UUID 不会 |
| ② 挂载点 | 目录要存在（`mkdir` 先建好） |
| ③ 类型 | `ext4` / `xfs` / `swap` 等 |
| ④ 选项 | `defaults`、`noatime`（减少写）、**`nofail`**（设备缺失也不卡启动）、`_netdev`（网络存储）、`ro` |
| ⑤ dump | 一般 0 |
| ⑥ fsck 顺序 | 根分区 1，其他 2，不检查 0 |

**三个要点**：

1. **改完 fstab 先 `sudo mount -a`**——它按 fstab 重新挂一遍，**有错当场报错**；不要直接 reboot 赌运气（写错的 fstab 能让机器起不来）。
2. **云服务器上一定加 `nofail`**：云盘可能因为故障或未挂载而消失，没有 `nofail` 时 systemd 会等它而卡住启动。
3. 用 `UUID=` 之后，即使设备名从 `sdb` 变成 `sdc`，挂载关系也不会错。

## 五、真实故障：删了文件，空间却没释放

`df -h` 显示没变，但 `du` 算出来小很多——八成是**已删除但被进程持有的文件**：

```bash title="找出那些'幽灵文件'" command:("$":1-3)
lsof +L1                       # 列出 link count < 1 的文件（已 unlink 但仍被打开）
lsof +L1 | awk '{print $1,$2,$7,$9}' | head
# 处理：重启/重载持有它的进程（systemctl reload），或让它下次写新文件
```

还有三种可能：**挂载点被覆盖**（原目录里还占着数据，`mount` 之后被挡住了）、**日志/临时文件暴涨**（`du -xsh /var/* | sort -h | tail`）、**inode 用满**（第 02 节讲过，`df -i` 看）。

```bash title="容量排障四步" command:("$":1-4)
df -hT | sort -k5 -h | tail -5            # 哪些文件系统快满
du -xsh /var/* 2>/dev/null | sort -h | tail -5
df -i /                                    # inode 维度
lsof +L1 | head                            # 幽灵文件
```

## 六、动手清单

```bash title="在不重要的机器上练" command:("$":1-6)
lsblk -f; blkid; findmnt / | head          # 1. 四层观察
sed -n '1,20p' /etc/fstab                  # 2. 读自己的 fstab，找 UUID
findmnt -no SOURCE,OPTIONS /data 2>/dev/null   # 3. 某挂载点的来源与选项
sudo tune2fs -l /dev/sda1 | grep -Ei 'reserved|block count'   # 4. 保留块比例
sudo mount -a && echo 'fstab 语法通过'       # 5. 改 fstab 后的必做动作
lsof +L1 2>/dev/null | head                # 6. 看看有没有幽灵文件
```

## 小结

- 四层：块设备 → 分区 → 文件系统 → 挂载点；`lsblk -f` 一次看全。
- `fstab` 用 **UUID**，加 **`nofail`**；改完必须 `mount -a` 验证，别用重启试错。
- `df` 与 `du` 不一致时，先查 `lsof +L1`（已删但被持有的文件），再查挂载覆盖与 inode。
- `mkfs`/`parted` 是不可逆操作：动手前 `lsblk -f` 确认设备，复制粘贴设备名。

## 下一节预告

下一节：网络基础——`ip`/`ss` 取代 `netstat` 的用法、自下而上的排查顺序、`ss` 显示 LISTEN 却连不上的真实原因（绑了 127.0.0.1），以及 `getent` 与 `dig` 在 DNS 排障里的分工。
