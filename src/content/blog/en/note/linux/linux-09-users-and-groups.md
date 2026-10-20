---
title: 'Linux Basics 09: Users And Groups — passwd, shadow And sudoers'
description: 'The seven fields of /etc/passwd, what ! and * mean in /etc/shadow, how primary and supplementary groups really work, the fallout from leaving -a out of usermod -aG, su versus sudo, and the smallest useful sudoers rule.'
link: linux-09-users-and-groups
catalog: true
date: 2022-04-17 20:30:00
updated: 2022-04-17 22:10:00
categories: ['笔记']
tags: ['Linux', '基础']
draft: false
---

## What This Chapter Solves

Everyone can type the user-management commands; incidents happen in three files (`passwd`, `shadow`, `group`) and in one easily forgotten `-a`. This chapter follows the natural order — read the files, understand permissions, change accounts, then authorise — and traces a few real accidents back to their causes.

## 1. `/etc/passwd`: Seven Fields, None Of Them Guessable

```bash title="Take one record apart" command:("$":1-2)
grep "^$(whoami):" /etc/passwd
getent passwd "$(whoami)"
```

```text
alice:x:1000:1000:Alice:/home/alice:/bin/bash
  ↑   ↑  ↑    ↑     ↑        ↑          ↑
  1   2  3    4     5        6          7
```

| Field | Meaning | Notes |
| --- | --- | --- |
| 1 | user name | the login name |
| 2 | password placeholder | `x` on modern systems; the real hash lives in `/etc/shadow` |
| 3 | **UID** | `0` is root; system accounts usually below 1000 (thresholds differ) |
| 4 | **primary GID** | this field *is* the primary group |
| 5 | GECOS | free-form comment / full name |
| 6 | home directory | note root’s is `/root`, not `/home/root` |
| 7 | login shell | `/usr/sbin/nologin` blocks login — standard for service accounts |

**Note:** do not decide “is this a system account” from the UID number alone; thresholds differ between distributions (RHEL used 500, now 1000). And `getent passwd` beats reading the file, because it goes through NSS and will show LDAP-provided users too.

## 2. `/etc/shadow`: `!` And `*` Are Not The Same

```bash title="Root only" command:("$":1)
sudo grep "^$(whoami):" /etc/shadow
```

```text
alice:$6$xxx...:19000:0:99999:7:::
      ↑            ↑   ↑   ↑   ↑
   password hash  min  max  warn  grace
```

| Value | Meaning |
| --- | --- |
| `$6$...`, `$y$...` | A real hash (`$6$` = SHA-512, `$y$` = yescrypt) |
| `!` prefix | **Account locked** (this is what `passwd -l` writes) |
| `*` | **No password can ever match** — service accounts use this to forbid password login |
| empty | Effectively passwordless — extremely dangerous; confirm none exist |

```bash title="Who has a real password, who is locked" command:("$":1-2)
sudo awk -F: '$2 ~ /^\$/ {print $1" has a password"}' /etc/shadow | head
sudo awk -F: '$2 ~ /^!/ {print $1" locked"}' /etc/shadow | head
```

## 3. Primary Versus Supplementary Groups: Permissions Work On Sets

```bash title="Your own groups" command:("$":1-3)
id                             # uid + gid + every group
id -Gn                         # group names only
getent group sudo wheel        # the admin group on Debian vs RHEL
```

When a process touches a file, the kernel compares permissions against the **effective UID + effective GID + all supplementary groups**:

- The **primary group** is field 4 of `passwd` (it becomes the group of newly created files)
- **Supplementary groups** are what make you “a member of” something (`sudo`, `docker`) — **they are the source of privilege**

**Note:** membership in the `docker` group is effectively root (you can mount host directories and run privileged containers). People treat it as a convenience; it is a privilege path.

## 4. Changing Accounts: Four Commands And One Guaranteed Trap

```bash title="Create, modify, lock, delete" command:("$":1-6)
sudo useradd -m -s /bin/bash -G sudo alice     # create (-m home, -G supplementary groups)
sudo adduser bob                               # Debian's friendly wrapper: interactive, /etc/skel, password
sudo usermod -aG docker alice                  # ⭐ append a supplementary group (-a is mandatory)
sudo passwd -l alice                           # lock (prepends ! to the hash)
sudo userdel -r alice                          # delete user *and* home directory (⚠️ data goes too)
sudo chage -l alice                            # password ageing policy
```

:::danger
**`usermod -G` without `-a` overwrites the whole supplementary list.**
```bash title="A real accident"
sudo usermod -G docker alice     # ❌ alice is removed from sudo and loses admin rights
sudo usermod -aG docker alice    # ✅ append
```
The nasty part is that nothing looks broken — until the next time you need sudo.
:::

## 5. su Versus sudo: Not The Same Tool

| | `su` | `sudo` |
| --- | --- | --- |
| Whose password | the **target user’s** (to become root, you need root’s password) | **your own** |
| Granularity | all or nothing | per-command rules in sudoers |
| Environment | `su` keeps part of yours; only `su -` behaves like a login | reset by default (`env_reset`, `secure_path`) |
| Audit trail | essentially none | `/var/log/auth.log` (Debian) / `secure` (RHEL) |

```bash title="Try them side by side" command:("$":1-4)
su -                     # become root with a login-like environment
su                       # become root but keep your environment and cwd
sudo -i                  # a root login shell — the better replacement for su -
sudo -u postgres psql    # run a single command as another user (common in service ops)
```

## 6. sudoers: Edit With visudo, Never By Hand

```bash title="The smallest useful rule" command:("$":1-5) mark:3
sudo visudo -f /etc/sudoers.d/deploy      # use a drop-in file, never the main one
# contents, for example:
#   deploy ALL=(root) NOPASSWD: /bin/systemctl restart nginx
#   %sudo ALL=(ALL:ALL) ALL               # group rules use a % prefix
sudo -l                                   # what am I allowed to do?
```

**Notes:**

- `visudo` matters because it **validates the syntax before saving and replaces the file atomically** — one wrong character in sudoers can lock you out of sudo entirely.
- `NOPASSWD` exists for unattended jobs; prefer not to use it, and when you must, pin the command to a full path instead of a broad `/bin/systemctl` wildcard.
- The admin group is `sudo` on Debian/Ubuntu and `wheel` on RHEL — a detail scripts get wrong when moving between families.

## 7. Hands-On Checklist

```bash title="Verify on a test machine" command:("$":1-8)
id; groups                                  # 1. identity and group set
getent passwd "$(whoami)"                    # 2. the seven fields
sudo awk -F: '$2 ~ /^!/ {print $1}' /etc/shadow | head   # 3. who is locked
sudo useradd -m -s /bin/bash t1; id t1       # 4. create (primary group defaults to a same-named group)
sudo usermod -aG docker t1; id -Gn t1        # 5. append a supplementary group
sudo passwd -l t1; sudo awk -F: '$1=="t1"{print substr($2,1,1)}' /etc/shadow   # 6. the "!" mark
sudo userdel -r t1                           # 7. cleanup (removes the home directory)
sudo -l                                      # 8. your sudo rights
```

## Summary

- `passwd` holds identity (UID/GID/home/shell); `shadow` holds passwords. `!` means locked, `*` means no password can match.
- **Supplementary groups are where privilege comes from** (`sudo`, `docker`); `docker` membership is effectively root.
- `usermod -aG` needs the `-a`; `userdel -r` takes the home directory with it.
- `su` needs the target’s password, `sudo` needs yours and authorises per command; the audit trail lives in `/var/log/auth.log`.
- Only ever edit drop-ins under `/etc/sudoers.d/`, and always through `visudo`.

## Next Up

Package management: what happens between `apt update` and `install`, finding which package owns a file with `dpkg -S`, pinning versions (`apt-mark hold` and preferences), the four most common errors and their causes, and the `dnf` equivalents on the RHEL side.
