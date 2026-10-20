---
title: 'Linux Basics 12: Disks And Filesystems — From Block Device To Mount Point'
description: 'The four layers (block device, partition table, filesystem, mount point), what lsblk -f and blkid each show, the six fstab fields and why UUIDs replace device names, why mount -a is mandatory after editing fstab, and four reasons deleted files do not free space.'
link: linux-12-disks-and-filesystems
catalog: true
date: 2022-04-20 20:30:00
updated: 2022-04-20 22:10:00
categories: ['笔记']
tags: ['Linux', '基础']
draft: false
---

## What This Chapter Solves

“The disk is full”, “a mount disappeared”, “the volume wasn’t mounted after a reboot” — all of these are easier once four layers are clear in your head: **block device → partition → filesystem → mount point**. Learn which command observes each layer, and the only discipline that remains is: know your device name before you touch anything.

## 1. Four Layers, Four Commands

```text
/dev/sda (block device)
  └── /dev/sda1, /dev/sda2 (partition table: MBR or GPT)
        └── ext4 / xfs (filesystem: created by mkfs, carries a UUID)
              └── mounted at / or /data (mount point: established by mount)
```

```bash title="One command per layer" command:("$":1-5)
lsblk -f                          # ⭐ the full picture: device tree + FSTYPE + UUID + MOUNTPOINT
blkid                             # just UUID/LABEL/TYPE (copy from here when writing fstab)
findmnt                           # the mount relationships (or findmnt /data for one)
df -hT                            # capacity and filesystem type (-T adds the type column)
du -xsh /var/log                  # directory size (-x stays on one filesystem)
```

**Note:** `lsblk -f` is my first command for anything mount-related — it settles all four layers at once. If MOUNTPOINT is empty, that partition is not mounted.

## 2. Partitioning: MBR Versus GPT

| | MBR | GPT |
| --- | --- | --- |
| Size limit | 2 TB | effectively unlimited (EB scale) |
| Primary partitions | max 4 | max 128 |
| Booting | legacy BIOS | UEFI (with an ESP partition) |

```bash title="Inspect and create (⚠️ confirm the device name first)" command:("$":1-6)
sudo fdisk -l /dev/sdb            # partition table (MBR / legacy layout)
sudo parted /dev/sdb print        # is it GPT? (parted handles GPT better)
sudo parted /dev/sdb mklabel gpt  # ⚠️ rewrites the partition table = wipes it
sudo parted -a optimal /dev/sdb mkpart primary ext4 1MiB 100%
sudo partprobe /dev/sdb           # make the kernel re-read the table, or the new partition is invisible
lsblk -f                           # double-check
```

:::danger
`mkfs` and `parted mklabel` are **irreversible**, and device names (`/dev/sdb` or `/dev/sdc`?) shift with plug order. My fixed routine: ① confirm with `lsblk -f` that this device is unmounted and holds no data; ② copy-paste the device name instead of typing it.
:::

## 3. Creating Filesystems

```bash title="mkfs family" command:("$":1-4)
sudo mkfs.ext4 -L data1 /dev/sdb1        # ext4 with a label
sudo mkfs.xfs  -L data1 /dev/sdb1        # XFS, the RHEL default
sudo mke2fs -t ext4 -b 4096 /dev/sdb1    # lower level: block size, inode ratio
sudo tune2fs -l /dev/sda1 | head         # ext family: inspect and tune (e.g. reserved blocks)
```

**Note:** ext4 reserves 5% of the space for root by default (`Reserved block count`). On a large data disk that is a lot, and for a pure data volume 1% is plenty: `tune2fs -m 1 /dev/sdX`. I once reclaimed about 160 GB on a 4 TB disk that way.

## 4. Mounting And fstab: Six Fields, Three Rules

```bash title="Mounting by hand" command:("$":1-5)
sudo mount /dev/sdb1 /data                 # temporary mount
sudo mount -o remount,rw /                 # remount something already mounted with new options
sudo mount --bind /srv/app /var/www/app    # bind mount: one inode visible in two places
sudo umount /data                          # unmount (refused if busy)
sudo fuser -vm /data ; sudo lsof +f -- /data   # who is holding it when umount fails
```

```bash title="The six fields of /etc/fstab" command:("$":1-3) mark:1
UUID=3f1a...-9c  /data  ext4  defaults,noatime,nofail  0  2
# ↑device          ↑mount  ↑type  ↑options               ↑dump ↑fsck order
/dev/sdb1        /data  ext4  defaults                 0  2   # ❌ never use /dev/sdX
```

| Field | Description |
| --- | --- |
| ① device | **use `UUID=`**: `/dev/sdX` changes with plug order and controllers, UUIDs do not |
| ② mount point | the directory must exist (`mkdir` it first) |
| ③ type | `ext4` / `xfs` / `swap`, etc. |
| ④ options | `defaults`, `noatime` (fewer writes), **`nofail`** (boot does not hang if the device is missing), `_netdev` (network storage), `ro` |
| ⑤ dump | normally 0 |
| ⑥ fsck order | root is 1, others 2, “do not check” is 0 |

Three rules:

1. **After editing fstab, run `sudo mount -a`** — it re-mounts per fstab and reports mistakes immediately. Never reboot and hope; a broken fstab can leave a machine unable to boot.
2. **On cloud instances always add `nofail`**: a cloud volume can vanish, and without `nofail` systemd waits for it and stalls the boot.
3. With `UUID=`, a device that changes from `sdb` to `sdc` still mounts in the right place.

## 5. Real Failure: Files Deleted, Space Never Freed

`df -h` shows no change while `du` reports much less — that is almost always **a deleted file still held open by a process**:

```bash title="Finding the ghost files" command:("$":1-3)
lsof +L1                       # files with link count < 1 (unlinked but still open)
lsof +L1 | awk '{print $1,$2,$7,$9}' | head
# fix: reload/restart the process holding it (systemctl reload), or let it write a new file
```

Three other causes: a **mount point covering data** (files still occupy the underlying directory, hidden by the mount), **runaway logs or temp files** (`du -xsh /var/* | sort -h | tail`), and **inodes exhausted** (chapter 02 — `df -i`).

```bash title="Four steps for capacity incidents" command:("$":1-4)
df -hT | sort -k5 -h | tail -5            # which filesystems are nearly full
du -xsh /var/* 2>/dev/null | sort -h | tail -5
df -i /                                    # the inode dimension
lsof +L1 | head                            # ghost files
```

## 6. Hands-On Checklist

```bash title="Practise on a box you do not care about" command:("$":1-6)
lsblk -f; blkid; findmnt / | head          # 1. the four layers
sed -n '1,20p' /etc/fstab                  # 2. read your own fstab and find the UUIDs
findmnt -no SOURCE,OPTIONS /data 2>/dev/null   # 3. source and options of one mount
sudo tune2fs -l /dev/sda1 | grep -Ei 'reserved|block count'   # 4. reserved blocks
sudo mount -a && echo 'fstab syntax OK'     # 5. the mandatory check after editing fstab
lsof +L1 2>/dev/null | head                # 6. any ghost files?
```

## Summary

- Four layers: block device → partition → filesystem → mount point; `lsblk -f` shows them all at once.
- fstab wants **UUID** and **`nofail`**; after editing, verify with `mount -a` instead of gambling on a reboot.
- When `df` and `du` disagree, check `lsof +L1` first, then mount-point coverage and inodes.
- `mkfs` and `parted` are irreversible: confirm with `lsblk -f`, then paste the device name.

## Next Up

Networking basics: `ip`/`ss` instead of `netstat`, a bottom-up troubleshooting order, the real reason `ss` shows LISTEN yet connections fail (bound to 127.0.0.1), and how `getent` and `dig` split the work in DNS debugging.
