---
title: 'Linux Basics 15: Advanced Permissions — sudoers Wildcards, ACLs And Capabilities'
description: 'Why a wildcard in sudoers hands over root, how ACLs interact with their mask, what the trailing + in ls -l means, default ACLs that directories inherit, and how capabilities split root into fine-grained powers — including when setcap silently stops working.'
link: linux-15-advanced-permissions
catalog: true
date: 2022-04-23 20:30:00
updated: 2022-04-23 22:10:00
categories: ['笔记']
tags: ['Linux', '基础']
draft: false
---

## What This Chapter Solves

Chapter 04 covered classic `rwx`, but those nine bits only express three buckets: owner, group, others. Real needs are finer — **read/write for one specific person** (ACLs), **one specific privilege** (capabilities), **root for one specific command** (sudoers, written correctly). This chapter adds those three layers, each with its own failure mode.

## 1. sudoers: A Wildcard Is A Handover Of Root

```bash title="Looks convenient, actually dangerous" command:("$":1-3) mark:2
# ❌ dangerous: allows restarting *any* service — and "systemctl edit" too
deploy ALL=(root) NOPASSWD: /bin/systemctl restart *
# ✅ pinned to an exact unit, with interactive editing excluded
deploy ALL=(root) NOPASSWD: /bin/systemctl restart nginx.service
deploy ALL=(root) NOPASSWD: /bin/systemctl status nginx.service
```

```bash title="Inspect and debug" command:("$":1-4)
sudo -l                     # what the current identity may do (with source files)
sudo -ll                    # long form
sudo visudo -c              # syntax-check every sudoers file
sudo -u deploy sudo -l      # verify the rule as the target identity
```

**Notes:**

- The risk of a wildcard is not semantics but **the space of argument combinations**. `systemctl restart *` can be steered into `edit` to overwrite unit files, or into restarting whatever security boundary you built. `/usr/bin/vi *` is even more direct — `vi` can spawn a shell.
- The safe form lists **specific commands with specific arguments**, and uses `Cmnd_Alias` to manage them centrally. Be careful with `Defaults env_keep`: keeping variables like `LD_PRELOAD` or `PATH` is the same as handing over a bypass.

## 2. ACLs: Permissions For One Specific Person

The nine bits cannot name a third party; ACLs can:

```bash title="Everyday ACL use" command:("$":1-6)
getfacl /srv/app/log              # inspect (including default rules and the mask)
setfacl -m u:alice:rw /srv/app/log        # read/write for alice alone
setfacl -m g:devs:r /srv/app/log          # read-only for a group
setfacl -x u:alice /srv/app/log           # remove one entry
setfacl -b /srv/app/log                   # clear all ACLs
setfacl -R -m u:alice:rwX /srv/app/shared # recursive (capital X: execute only on directories)
```

```bash title="Default ACLs: new files inherit" command:("$":1-3)
setfacl -d -m u:alice:rwX /srv/app/team   # -d = default: future files inherit these rules
getfacl /srv/app/team | sed -n '/^default/,$p'
# result: every new file and subdirectory under team automatically carries alice's entry
```

:::warning
**`mask` is the confusing part of ACLs.** The `mask::rwx` line in `getfacl` **caps the effective permissions of all named user and named group entries**:
```bash title="Truncated by the mask"
setfacl -m u:alice:rw file
setfacl -m m::r file          # mask allows r only → alice effectively gets r (shown as #effective:r--)
```
So when “I granted rw but it does not apply”, read the mask first. Either set it explicitly (`setfacl -m m::rw`) or use `-n` so setfacl does not recompute it.
:::

One signal worth knowing: a **`+`** at the end of the mode column in `ls -l` means the file carries ACLs.

```bash title="ls versus getfacl" command:("$":1-2)
ls -l /srv/app/log     # -rw-rw----+  ← the + means “there is more than the nine bits show”
getfacl /srv/app/log   # the whole story
```

## 3. Capabilities: Splitting Root Into Pieces

Root can do everything because it carries a whole set of capabilities (`cap_net_bind_service`, `cap_sys_admin`, `cap_chown`, and others). Split them out and many tasks stop needing root:

```bash title="Inspect and grant" command:("$":1-5)
getcap -r / 2>/dev/null | head            # which files carry capabilities
getcap /usr/bin/ping                       # the classic: ping needs cap_net_raw
sudo setcap cap_net_bind_service=+ep /usr/local/bin/myapp   # bind ports below 1024
getcap /usr/local/bin/myapp
sudo setcap -r /usr/local/bin/myapp        # remove it
```

| Capability | Effect | Typical use |
| --- | --- | --- |
| `cap_net_bind_service` | bind ports below 1024 | let a non-root process listen on 80/443 |
| `cap_net_raw` | raw sockets | `ping`, packet capture |
| `cap_sys_admin` | mounts and other heavy rights | container tooling — **half of root, grant rarely** |
| `cap_chown` | change file ownership | backup and sync tools |

**Notes on `setcap`, two traps:**

1. **A package upgrade wipes the capability**: replacing the binary loses the `setcap` setting (the xattr is not guaranteed to survive), so this action belongs in deployment automation — otherwise it silently stops working after the next update.
2. For services, prefer systemd’s `AmbientCapabilities=` / `CapabilityBoundingSet=` over tagging a binary: it is more controllable, more auditable, and configuration-as-code friendly.

## 4. Where Each Tool Belongs (One Table)

| Tool | Granularity | Typical problem | When to use |
| --- | --- | --- | --- |
| `chmod`/`chown` | owner / group / others | missing `x` on a directory; 644 files | daily work (chapter 04) |
| **ACL** | a specific user or group | “only alice may read and write this” | shared directories, collaboration |
| **capabilities** | a specific privilege | “non-root binding 80” | dropping service privilege, containers |
| **SELinux** | a specific label (context) | “the service cannot read its own directory” | mandatory access control (next chapter) |
| `sudoers` | command-level elevation | “restarting exactly this one service” | operations delegation |

## 5. Hands-On Checklist

```bash title="Practise in a scratch directory" command:("$":1-7)
mkdir -p /tmp/acl && touch /tmp/acl/f
setfacl -m u:"$(whoami)":rw /tmp/acl/f; getfacl /tmp/acl/f | head    # 1. add an ACL entry
ls -l /tmp/acl/f                                        # 2. the trailing +
setfacl -m m::r /tmp/acl/f; getfacl /tmp/acl/f | grep -E 'mask|effective'  # 3. the mask at work
setfacl -b /tmp/acl/f; ls -l /tmp/acl/f                 # 4. clearing it removes the +
sudo setcap cap_net_bind_service=+ep /usr/bin/env; getcap /usr/bin/env  # 5. set and read back (test box)
sudo setcap -r /usr/bin/env                              # 6. remove immediately
sudo visudo -c                                           # 7. sudoers syntax self-check
```

## Summary

- A **wildcard in sudoers hands over root**; pin rules to exact commands and arguments, then self-check with `visudo -c`.
- ACLs grant permissions to specific users and groups; **the mask caps named entries** — when a grant “does not apply”, read the mask; a trailing `+` in `ls -l` signals ACLs.
- Default ACLs (`setfacl -d`) make new files in a directory inherit permissions — the right answer for shared directories.
- Capabilities split root into fine-grained powers (`cap_net_bind_service`, `cap_net_raw`); **`setcap` settings are lost on package upgrades**.
- Four layers: chmod (three buckets) → ACL (to a person) → capabilities (to a privilege) → SELinux (to a label).

## Next Up

**SELinux**: the `enforcing`/`permissive`/`disabled` modes, what a context looks like in `ls -Z`, the difference between `chcon`, `restorecon` and `semanage fcontext`, boolean switches, and the standard procedure for “the service cannot read its own directory”.
