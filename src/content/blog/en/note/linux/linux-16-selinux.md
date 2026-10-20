---
title: 'Linux Basics 16: SELinux — When Every Permission Is Correct And The Service Is Still Denied'
description: 'The three modes and what enforcing really means, reading contexts with ls -Z and ps -Z, the difference between chcon and restorecon, why semanage fcontext is the only durable fix, boolean switches, and the standard procedure for “the service cannot read its own directory”.'
link: linux-16-selinux
catalog: true
date: 2022-04-24 20:30:00
updated: 2022-04-24 22:10:00
categories: ['笔记']
tags: ['Linux', '基础']
draft: false
---

## What This Chapter Solves

One class of failure is genuinely baffling: file modes, ownership and paths are all correct, `namei -l` walks cleanly, and the **service is still denied** — with nothing in the log but `Permission denied`. On RHEL/CentOS/Rocky that usually means SELinux.

It does not ask “who are you”. It asks “**what label does this process carry, and what label does the object it wants carry?**” That is an entirely different model.

## 1. Three Modes (First, Find Out Whether It Is Even Involved)

```bash title="Three commands to get your bearings" command:("$":1-4)
getenforce                     # Enforcing / Permissive / Disabled
sestatus                       # full status: policy type, policy name, current mode
sestatus -b | head             # boolean overview
sudo setenforce 0              # switch to permissive temporarily (gone after reboot; for testing)
```

| Mode | Behaviour |
| --- | --- |
| `enforcing` | **Actually blocks** and logs AVC denials |
| `permissive` | **Does not block**, but still logs AVC — the golden state for diagnosis |
| `disabled` | Policy not loaded at all |

:::info
**Step one is always “switch to permissive and try to reproduce”.** If the problem disappears, it is 100% SELinux. If it persists, go back to permissions and paths instead of burning time on SELinux.
`setenforce 0` is a test, **never a permanent fix**.
:::

## 2. Security Contexts: What `ls -Z` Is Telling You

```bash title="Add -Z to see contexts on files and processes" command:("$":1-4)
ls -Z /var/www/html/index.html       # file context: user:role:type:level
ps -efZ | grep nginx | head          # process context — the label the process carries
id -Z                                # this shell’s context
matchpathcon /var/www/html/index.html  # what the policy says this path *should* be ⭐
```

```text
system_u:object_r:httpd_sys_content_t:s0  /var/www/html/index.html
                     ↑ the type — the field you actually work with daily
```

The **third field (type)** is what matters in practice:

| Type | Typically means |
| --- | --- |
| `httpd_sys_content_t` | content httpd is allowed to read |
| `httpd_sys_rw_content_t` | content httpd may read *and* write (upload directories) |
| `var_log_t` | log directories |
| `ssh_port_t` / `http_port_t` | ports a service is allowed to listen on |
| `unconfined_t` | unrestricted (the default for ordinary users) |

**Note:** `matchpathcon` answers “what type *should* this path have?” — the fastest way to detect a label that has been polluted.

## 3. Fixing Labels: `chcon` Is Temporary, `restorecon` Restores, `semanage fcontext` Is The Real Fix

```bash title="Three approaches with very different lifetimes" command:("$":1-5)
# ① temporary (lost after relabel; only for verifying a hypothesis)
sudo chcon -t httpd_sys_content_t /srv/www/index.html

# ② restore to what the policy defines (the most common action)
sudo restorecon -Rv /srv/www            # -R recursive, -v show what changed

# ③ ⭐ the correct fix: record the rule in policy, then restore
sudo semanage fcontext -a -t httpd_sys_content_t '/srv/www(/.*)?'
sudo restorecon -Rv /srv/www
sudo semanage fcontext -l | grep '/srv/www'
```

**Why `chcon` is not enough:** it stamps a one-off patch. The next full relabel (`touch /.autorelabel` then reboot, or `restorecon -R /`) resets every hand-changed label back to the policy default — and your service breaks again. `semanage fcontext` writes the rule into the policy database, which is the durable answer.

## 4. Booleans: Switches The Policy Already Provides

Many “SELinux will not allow that” situations have an official switch that is simply off by default:

```bash title="The ones you will actually use" command:("$":1-4)
getsebool -a | grep -i httpd | head              # httpd-related switches
sudo setsebool -P httpd_can_network_connect on   # ⭐ -P makes it persistent
getsebool httpd_can_network_connect
# other frequent ones:
#   httpd_can_sendmail            allow httpd to send mail
#   httpd_read_user_content       allow reading home-directory content (site in $HOME)
#   container_manage_cgroup       container-related
```

**Note:** `setsebool` **without `-P` is temporary only.** I learned this the hard way setting up a reverse proxy: it was `on` on the test box, and after a reboot it was back to `off` and the backend was unreachable.

## 5. Ports And Network: `semanage port`

Running a service on a non-standard port gets blocked because the policy does not declare that port:

```bash title="Allow a custom port" command:("$":1-3)
sudo semanage port -l | grep -w http_port_t      # which ports http may use
sudo semanage port -a -t http_port_t -p tcp 8080  # add
sudo semanage port -d -t http_port_t -p tcp 8080  # remove
```

## 6. The Standard Procedure (Follow This Order)

```bash title="Five steps" command:("$":1-6)
# 1) is it really SELinux? switch to permissive and retry
sudo setenforce 0     # problem gone → it is SELinux; remember setenforce 1 afterwards

# 2) find the AVC denials
sudo ausearch -m avc -ts recent                 # most recent denials
sudo ausearch -m avc -ts today | tail -20       # today
sudo journalctl -t audit | grep -i denied | tail -10

# 3) human-readable advice (needs setroubleshoot installed)
sudo sealert -a /var/log/audit/audit.log | head -40

# 4) compare labels
ls -Z the-file | head -1; matchpathcon the-file

# 5) fix by kind: label → semanage fcontext + restorecon; switch → setsebool -P; port → semanage port -a
```

A real AVC line looks like this (watch `scontext`, `tcontext`, `tclass`):

```text
type=AVC msg=audit(…): avc:  denied  { read } for  pid=1234 comm="nginx"
  name="index.html" scontext=system_u:system_r:httpd_t:s0
  tcontext=unconfined_u:object_r:user_home_t:s0 tclass=file
```

**How to read it:** `scontext` is the process (`httpd_t`), `tcontext` is the label of the object it wants (`user_home_t`). The story here is utterly typical: **the site files live in a home directory, labelled `user_home_t`, which httpd may not read.** The fix is `semanage fcontext` + `restorecon`, or enabling `httpd_read_user_content`.

## 7. Relationship To AppArmor (Ubuntu Readers, This Is For You)

| | SELinux | AppArmor |
| --- | --- | --- |
| Model | **labels** (not paths — types) | **paths** (per program and path) |
| Default on | RHEL / CentOS / Rocky / Fedora | Ubuntu / Debian / SUSE |
| Status command | `getenforce`, `sestatus` | `aa-status` |
| Config | `/etc/selinux/` | `/etc/apparmor.d/` |

**Note:** “there is no SELinux on Ubuntu” is normal — Ubuntu ships AppArmor. If you hit `Permission denied` on Ubuntu and SELinux is nowhere to be found, check `aa-status` before blaming anything else.

## 8. Hands-On Checklist

```bash title="Practise on a RHEL-family box (Ubuntu users: compare with aa-status)" command:("$":1-6)
getenforce; sestatus | head -8                    # 1. mode and policy
ls -Z /var/www/html/ | head                       # 2. file labels
ps -efZ | grep -E 'nginx|httpd' | head            # 3. process labels
sudo ausearch -m avc -ts today | tail -20         # 4. today’s AVCs
getsebool -a | grep -i httpd | head               # 5. booleans
sudo semanage port -l | grep -w http_port_t       # 6. port types
```

## Summary

- SELinux checks **labels**, not traditional permissions; `enforcing` blocks, `permissive` only logs — so step one is “switch to permissive and retry”.
- The field you work with is the **type** in the context; `matchpathcon` tells you what the policy expects.
- **`chcon` is temporary** (a relabel undoes it); the durable fix is always `semanage fcontext` + `restorecon`.
- Booleans need `setsebool -P` to persist; custom ports need `semanage port -a`.
- Procedure: permissive test → `ausearch -m avc` → `sealert` advice → fix label, boolean or port.
- Ubuntu-family systems default to **AppArmor** — do not force SELinux thinking onto them.

## Next Up

Firewalls: how netfilter relates to iptables and nftables, the firewalld zone model, ufw in practice, why Docker’s `DOCKER-USER` chain makes published ports “bypass ufw”, and the checking order when the host allows a port but the outside still cannot reach it (cloud security groups sit further out).
