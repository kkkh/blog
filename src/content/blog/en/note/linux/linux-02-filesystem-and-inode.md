---
title: 'Linux Basics 02: Why / Looks Like This, and What An Inode Really Stores'
description: 'The job of every FHS directory and who writes into it, then one level deeper: a filename is not part of the file, rm is not deletion, and “no space left” is often inodes.'
link: linux-02-filesystem-and-inode
catalog: true
date: 2022-04-10 20:30:00
updated: 2022-04-10 22:00:00
categories: ['笔记']
tags: ['Linux', '基础']
draft: false
---

## What This Chapter Solves

Most people remember two things about `/`: `/etc` holds config, `/home` holds users. What actually decides your debugging direction are three other questions: **who writes here, does it survive a reboot, and is it disk or memory?** One level deeper there is something more fundamental: in Linux, the file name and the file itself are separate objects. That single idea explains `rm`, `mv`, hard links, and the famous `No space left on device`.

## 1. FHS: Whose Territory Is Each Directory

| Directory | Holds | Written by | Watch out |
| --- | --- | --- | --- |
| `/bin`, `/sbin` | basic commands (`ls`, `ip`) | package manager | on modern distros these are symlinks into `/usr` |
| `/usr` | most installed software: `bin/ lib/ share/ local/` | package manager | the biggest thing on disk; `/usr/local` is for hand-made installs |
| `/etc` | configuration | you and packages | config only — never write logs here |
| `/var` | anything that grows at runtime: `log/ cache/ spool/ lib/` | daemons | **`/var/log` is suspect number one for a full disk** |
| `/home`, `/root` | user and root home directories | you | your backup target |
| `/tmp` | temporary files | anyone | often tmpfs or periodically cleaned — **never park data here** |
| `/opt` | self-contained third-party software | you | software that ignores the package manager |
| `/srv` | data served to the outside | you | by convention; often empty |
| `/run` | runtime state for this boot (PIDs, sockets) | services | `/var/run` now points here |
| `/proc`, `/sys` | virtual files exposed by the kernel | kernel | reading them reads kernel state, not a disk |
| `/dev` | device nodes | kernel/udev | `/dev/sda`, `/dev/null` |
| `/mnt`, `/media` | mount points | you / desktop | temporary mounts |

Looking at the machine in front of you beats memorising FHS:

```bash title="Where do these actually live?" command:("$":1-2)
ls -ld /bin /sbin /lib /usr/bin /tmp /var /run
findmnt /tmp /var /home /            # which device, and is it tmpfs?
```

Real output from an Ubuntu box (excerpt):

```text
$ ls -ld /bin
lrwxrwxrwx 1 root root 7 Feb  2 08:55 /bin -> usr/bin

$ findmnt /tmp
TARGET SOURCE FILESYSTEM OPTIONS
/tmp   tmpfs  tmpfs      rw,nosuid,nodev,size=...
```

Two conclusions immediately usable: `/bin` is only an entrance, the real one is `/usr/bin`; and `/tmp` is **tmpfs in RAM** — cleared on reboot, and it consumes **memory, not disk** (frequently forgotten when hunting “where did the memory go”).

## 2. Inodes: The Real Identity Card

For `ext4`, an inode stores: file type and permissions, owner and group, size, three timestamps (`atime`/`mtime`/`ctime`), the **link count**, and pointers to data extents. It stores **no file name** — names live in directory entries, where the directory keeps its own “name → inode number” table.

```bash title="Inode number, metadata, and inode usage" command:("$":1-3)
ls -i  a.txt        # the left-most column is the inode number
stat   a.txt        # full metadata: Inode / Links / Access / Modify / Change
df -i  /            # inode usage — the line everyone forgets
df -h  /            # capacity
```

**My note:** almost everything in `ls -l` comes from the inode. Exactly one field comes from the directory — **the file name**. That is the physical basis for “one body of data can have many names”.

## 3. Hard Links, Soft Links, And What “Delete” Means

```bash title="Two kinds of link" command:("$":1-4)
echo hello > a.txt
ln    a.txt hard.txt        # hard link
ln -s a.txt soft.txt        # symbolic link
ls -li a.txt hard.txt soft.txt
```

```text
131072 -rw-r--r-- 2 user user 6  ... a.txt
131072 -rw-r--r-- 2 user user 6  ... hard.txt     ← same inode, Links=2
131073 lrwxrwxrwx 1 user user 3  ... soft.txt -> a.txt
```

| | Hard link | Symbolic link |
| --- | --- | --- |
| Essence | another name for the same inode | its own inode containing a path string |
| Inode number | identical to the original | different |
| Link count | `Links` increases | does not affect the original |
| Across filesystems | no (inode numbers are unique per filesystem) | yes |
| To a directory | no (only the kernel’s own `.` and `..`) | yes |
| After removing the original | data survives until the count hits zero | becomes dangling (`readlink` still shows the path) |

And the key sentence:

```bash title="Deletion is unlink" command:("$":1)
rm a.txt        # what really happens: link count 2 → 1
```

`rm` **does not delete data; it removes a name from the directory**. Only when the link count reaches zero *and* no process still has the file open does the kernel reclaim the blocks. The classic “I deleted it but `df` shows no space freed” is the same mechanism: a process still holds the handle.

One more consequence: `mv` **inside one filesystem** just rewrites a directory entry (instant); **across filesystems** it is a **copy + unlink** — slow for large files, and it can fail for lack of space.

```bash title="Same disk, or not?" command:("$":1-2)
findmnt -no SOURCE /          # e.g. /dev/sda2
findmnt -no SOURCE /boot      # e.g. /dev/sda1  → different filesystem: mv will copy
```

## 4. Real Failure: Free Space, Still Cannot Write

This is the most counter-intuitive report I meet regularly: `df -h` shows several GB free, yet writing fails with `No space left on device`. The usual cause is **inodes**, not capacity.

```bash title="Check both dimensions" command:("$":1-2)
df -h /
df -i /
```

```text
Filesystem      Inodes  IUsed  IFree IUse% Mounted on
/dev/sda2      6553600 6553600     0  100% /
```

At `IUse%` 100%, no new file can be created no matter how much space is left — because **every new file consumes one inode**.

Typical hotspots: `/var/spool` (mail and job queues), session directories, anything where an application creates small files by the million. The way to find it is not “biggest file” but “**directory with the most files**”:

```bash title="Rank directories by file count, not size" command:("$":1-3)
sudo find /var -xdev -type f -printf '%h\n' 2>/dev/null \
  | sort | uniq -c | sort -rn | head
```

For completeness, three common reasons `du` and `df` disagree: deleted-but-still-open files, sparse files, and `du` rounding up to block size.

## 5. Hands-On Checklist

```bash title="Prove every claim above" command:("$":1-12)
# 1. directory duties, verified
ls -ld /bin /sbin /lib; findmnt -o TARGET,SOURCE,FSTYPE /tmp /var

# 2. inodes and links
echo hi > f; ln f g; ln -s f s; ls -li f g s; stat -c '%i %h %n' f g s

# 3. deletion is not deletion
ln f f2; rm f; ls -li f2      # f2 survives, same inode number

# 4. two dimensions of space
df -h /; df -i /
```

## Summary

- Judge a directory by three questions: **who writes, does it survive reboot, is it disk or memory**.
- The file name belongs to the **directory entry**, not the file; the inode is the identity card and is unique per filesystem.
- `rm` is unlink; `mv` is a rename on the same disk and a copy across disks.
- When writes fail, check **both** `df -h` and `df -i`.

## Next Up

Back to the most ordinary commands: the real semantics and traps of `ls`, `cp`, `mv` and `rm` — globs are expanded by the **shell**, what `--` is for, what `cp -a` actually preserves, and the reason `rm -rf` deserves more respect.
