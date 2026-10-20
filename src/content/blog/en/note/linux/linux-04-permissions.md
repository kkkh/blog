---
title: 'Linux Basics 04: Permissions And Ownership — rwx Is Not The Same On Files And Directories'
description: 'What the nine bits really mean, why you can delete a file you cannot write, why ls shows a name you cannot read, how umask computes, what the sticky bit protects, and how setuid turns passwd into a privilege entry point.'
link: linux-04-permissions
catalog: true
date: 2022-04-12 20:30:00
updated: 2022-04-12 22:10:00
categories: ['笔记']
tags: ['Linux', '基础']
draft: false
---

## What This Chapter Solves

For most people permissions stop at “just `chmod 777` it”. In real incidents the usual 403 is not a lack of permission on the file at all — it is a **missing `x` on one directory along the path**. And the usual misunderstanding is “I can’t write this file, so how did I just delete it?”. Both have one explanation: **`rwx` means one thing on files and another thing on directories.**

## 1. Nine Bits: Three Identities × Three Permissions

```bash title="Reading ls -l properly" command:("$":1)
ls -l /etc/passwd /tmp /usr/bin/passwd; stat -c '%a %A %U:%G %n' /etc/passwd /tmp
```

```text
-rw-r--r--  1 root root 2612 ... /etc/passwd
drwxrwxrwx   9 root root 4096 ... /tmp        ← really 777? read on for the sticky bit
```

| Bit | Meaning | Value |
| --- | --- | --- |
| `r` | read | 4 |
| `w` | write | 2 |
| `x` | execute / traverse | 1 |

The three groups are **owner (u) / group (g) / others (o)**. Two ways to change them: numeric (`chmod 644 f`) or symbolic (`chmod u+x,g-w,o=r f`). I read results in numeric form and make incremental changes symbolically:

```bash title="Everyday chmod" command:("$":1-5)
chmod 640 secret.txt            # owner rw, group r, others nothing
chmod u+x script.sh             # add execute for the owner only
chmod -R o-rwx /srv/private     # strip everything from others, recursively
chmod --reference=a.txt b.txt   # copy a's permissions onto b
umask -S                        # show the current umask symbolically
```

## 2. The Core Idea: rwx On A Directory Is A Different Language

:::info
**On files:** `r` read content, `w` change content, `x` executable.
**On directories:** `r` list entries (`ls`), `w` add/remove/rename entries, `x` traverse (enter, `cd`, reach children).
:::

Because the three are independent, two classic situations appear:

```bash title="r without x on a directory" command:("$":1-4)
mkdir -p t/sub; echo hi > t/sub/f
chmod 400 t        # directory: r--
ls t               # ✅ names are listed (r is enough)
cat t/sub/f        # ❌ Permission denied (no x, cannot traverse)
```

```bash title="x without r on a directory" command:("$":1-2)
chmod 100 t        # directory: --x
ls t               # ❌ cannot list (no r)
cat t/sub/f        # ✅ readable if you know the exact path (x is enough)
```

**My note:** the first case is the key to debugging. Most “web 403” and “Permission denied opening a folder” reports are **a directory missing `x` somewhere up the path** — even when the target file is 644. Walk the path level by level:

```bash title="Permission of every level (the 403 killer)" command:("$":1) mark:1
namei -l /srv/www/site/public/index.html
```

The second case is more counter-intuitive: **whether you can delete a file depends on the `w`+`x` of its parent directory, not on the file’s own permissions.**

```bash title="The file's w bit is irrelevant to deletion" command:("$":1-3)
mkdir d; echo secret > d/f; sudo chown root:root d/f; chmod 444 d/f
ls -l d/f              # -r--r--r--  ← you have no write permission
rm d/f                 # ✅ still deleted (d belongs to you and is writable + traversable)
```

`rm` operates on the **directory entry**, not the content — the practical consequence of “the file name belongs to the directory” from chapter 02.

## 3. umask: The Default Mode Of New Files

The rule is a subtraction by bitwise AND with the complement:

```text
file:      666 & ~umask
directory: 777 & ~umask
```

```bash title="What umask actually computes" command:("$":1-3)
umask            # commonly 0022
umask 027 ; touch f ; mkdir d ; stat -c '%a %n' f d      # file 640, directory 750
umask 077 ; touch f2 ; mkdir d2 ; stat -c '%a %n' f2 d2  # file 600, directory 700
```

Two exceptions to remember: `cp -p`, `cp -a` and `mv` carry the source permissions and **ignore umask**; `chmod` overrides everything.

A real consequence: ssh private keys must be tight, or the connection is refused.

```bash title="Private key permissions" command:("$":1-2)
chmod 600 ~/.ssh/id_rsa
ssh -i ~/.ssh/id_rsa host   # the WARNING: UNPROTECTED PRIVATE KEY FILE! goes away
```

## 4. Three Special Bits: setuid, setgid, sticky

```bash title="Where the special bits show up" command:("$":1-2)
ls -l /usr/bin/passwd   # -rwsr-xr-x  ← the owner's x became s
stat -c '%a %n' /tmp    # 1777 → the leading 1 is the sticky bit
```

| Bit | Value | Effect | Typical user |
| --- | --- | --- | --- |
| **setuid** | 4 | On exec, the **effective UID** becomes the file owner | `/usr/bin/passwd` must edit `/etc/shadow`, which ordinary users cannot touch — setuid root does it |
| **setgid** | 2 | File: effective GID becomes the file group. Directory: **new files inherit the directory’s group** | shared team directory: `chmod g+s /srv/team` |
| **sticky** | 1 | Files inside may only be deleted by their owner, the directory owner, or root | `/tmp` is `1777`: anyone can write, nobody can delete your file |

```bash title="Audit: every setuid binary on the box" command:("$":1) mark:1
sudo find / -xdev -perm -4000 -type f 2>/dev/null | sort
```

:::warning
**Two traps worth knowing**
1. **The kernel ignores the setuid bit on shell scripts.** “Put setuid on a script to escalate privileges” simply does not work on Linux (a `#!/bin/sh` script with setuid is a no-op). Use a binary or a `sudo` rule instead.
2. **A custom setuid program is a privilege entry point.** The list produced by the `find -perm -4000` line above is worth reviewing now and then: one unexpected entry usually means something was installed.
:::

## 5. Ownership And Group

```bash title="chown / chgrp done right" command:("$":1-4)
sudo chown alice file                  # new owner
sudo chown alice:devs file             # owner and group at once
sudo chown -R alice:devs /srv/app      # recursive (⚠️ walk down the tree; check the scope first)
sudo chown --reference=/srv/app /srv/app2
```

**Note:** `chown -R` is one of the easiest ways to cause an incident — if another user’s data is mounted inside `/srv/app`, or you mistype the path, the damage spreads instantly. I now always look first:

```bash title="Inspect before recursion" command:("$":1)
find /srv/app -maxdepth 1 -printf '%u:%g %p\n'
```

## 6. Three Real Failures And Where To Look

| Symptom | Real cause | Command |
| --- | --- | --- |
| Web 403 while the file is 644 | **a directory on the path lacks `x`** | `namei -l /srv/www/.../index.html` |
| ssh: `UNPROTECTED PRIVATE KEY FILE` / `bad permissions` | key too open; or the **home dir / `.ssh` writable by others** (StrictModes) | `chmod 700 ~ ~/.ssh; chmod 600 ~/.ssh/id_*` |
| “I can’t change files in this directory” | you have `x` but not `w`: traverse yes, modify entries no | `ls -ld .` |

## 7. Hands-On Checklist

```bash title="Prove each claim" command:("$":1-7)
mkdir -p t/sub; echo hi > t/sub/f
chmod 400 t; ls t; cat t/sub/f                    # 1. r lists, no x means no traversal
chmod 100 t; ls t 2>&1 | head -1; cat t/sub/f     # 2. x traverses, no r means no listing
chmod 755 t; namei -l t/sub/f                     # 3. permissions level by level
mkdir d; echo x > d/f; chmod 444 d/f; rm d/f      # 4. deletion follows the parent directory
umask; umask -S                                   # 5. where default modes come from
ls -l /usr/bin/passwd; stat -c '%a %n' /tmp       # 6. the s bit and sticky
sudo find / -xdev -perm -4000 -type f 2>/dev/null | sort   # 7. setuid audit
```

## Summary

- Directory `r/w/x` = list / modify entries / traverse. **Deletion depends on the parent directory**, not the file.
- `namei -l` is the tool for “permission denied along a path”.
- `umask` subtracts from 666/777; `cp -p` and `mv` ignore it.
- `setuid` swaps the effective UID, `setgid` makes new files inherit the group, `sticky` protects `/tmp`; setuid on scripts does nothing.
- Debug order: **`x` on every directory along the path → the target file’s mode → whether owner/group match the identity actually running**.

## Next Up

Text processing: `grep`, `sort`, `uniq`, `cut`, `tr` — why their combination replaces most hand-written helper scripts, and the **streaming mindset**: one pipe, no intermediate files.
