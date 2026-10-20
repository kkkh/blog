---
title: 'Linux Basics 25: Wrapping Up — Self-Audit Checklists And Where To Go Deeper'
description: 'Four pre-flight checklists (accounts and permissions, services and boot, network and firewall, storage and backups), a symptom-to-first-command table, the directions worth going deeper into, and a debugging methodology to keep, as the close of the series.'
link: linux-25-wrap-up
catalog: true
date: 2022-05-03 20:30:00
updated: 2022-05-03 22:10:00
categories: ['笔记']
tags: ['Linux', '基础']
draft: false
---

## What This Chapter Solves

Twenty-five chapters in, you have collected plenty of commands, but the real day-to-day comes down to two things: **leaving a new machine or service in good order**, and **knowing what to type first when something breaks**. This chapter offers no new knowledge — just two artefacts (a pre-flight audit and a symptom-to-command table) plus where to go deeper.

## 1. Four Self-Audit Checklists

### (a) Accounts And Permissions

- [ ] home directories are mode `700` (`chmod 700 /home/*`)
- [ ] private keys and `authorized_keys` are `600`, the `.ssh` directory is `700`
- [ ] `awk -F: '$2==""{print $1}' /etc/shadow` prints nothing — no passwordless accounts
- [ ] sudo goes through a whitelist (`/etc/sudoers.d/`), with no casual `NOPASSWD: ALL`
- [ ] `find / -perm -4000 -type f` reveals no suspicious setuid binaries
- [ ] service accounts are `nologin` and cannot be used to log in

### (b) Services And Boot

- [ ] `systemctl --failed` is empty
- [ ] critical services do not run as root — they set `User=`
- [ ] a restart policy such as `Restart=on-failure` is configured
- [ ] logs go to journald or a rotated log file of their own
- [ ] every service that must start at boot is `systemctl enable`d
- [ ] no legacy services fight each other, such as `network` and `NetworkManager` both running

### (c) Network And Firewall

- [ ] `ss -ltnp` shows no unexpected listener; anything meant for local only binds `127.0.0.1`, not `0.0.0.0`
- [ ] the host firewall permits only the ports it must
- [ ] cloud security groups match the host firewall's range
- [ ] container port publishing accounts for the firewall-bypass issue (chapter 17)
- [ ] DNS ordering is sane; check with `resolvectl` when needed

### (d) Storage And Backups

- [ ] neither `df -h` nor `df -i` is full — inodes fill up too
- [ ] fstab uses UUID plus `nofail`, especially for network mounts
- [ ] `findmnt --verify` and `mount -a` report no errors
- [ ] there is a **restorable** backup, not merely "a backup was taken"
- [ ] a restore has actually been rehearsed once
- [ ] log directories have logrotate or capacity monitoring

## 2. Symptom To First Command

| Symptom | First command |
| --- | --- |
| a service will not start | `systemctl status X -l`; `journalctl -u X -n 50` |
| a port is unreachable | `ss -ltnp`; `curl -sv 127.0.0.1:PORT`; then firewall and security group |
| disk full | `df -h`; `df -i`; `lsof +L1` |
| a file will not delete | `lsattr` for the `i` attribute; `lsof file` for a holder |
| ssh refused | `journalctl -u sshd -n 30`; `namei -l ~/.ssh`; the auth log |
| command not found | `echo $PATH`; `type -a cmd`; `command -v cmd` |
| system feels slow | `vmstat -w 1`; `iostat -x 1`; `pidstat`; `strace -T` |
| a scheduled job does not run | `journalctl -u cron`; reproduce with `env -i /bin/bash`; `systemctl list-timers` |
| container port bypasses the firewall | bind `127.0.0.1`, or block in the `DOCKER-USER` chain |
| web page returns 403 | `namei -l`; `ls -Z` and `getenforce` for SELinux |
| memory alert | `free -h` for `available`; `vmstat` for `si/so` |
| certificate expired | `openssl s_client -connect host:443 -servername host` and read the dates |

## 3. Where To Go Deeper

- **Kernel and `/proc`**: once you understand how processes, memory and IO appear in `/proc`, tool behaviour stops being a black box.
- **Networking and eBPF**: after `tcpdump` comes `bpftrace`, tracing syscalls and traffic inside the kernel and moving debugging into the fast lane.
- **Orchestration (K8s)**: beyond single-host containers lie scheduling and self-healing, the mainstream destination for ops and backend work.
- **Observability (Prometheus plus log aggregation)**: shifting from "log in after it breaks" to "metrics alert first".
- **Automation (Ansible / Terraform)**: turning manual steps into repeatable, reviewable code.

:::info
A checklist is not for ticking boxes and moving on — it is something to run **before launch and again when trouble hits**. Every real incident should add one line to it; the list is meant to grow with your experience.
:::

## 4. Finally: A Method

What this series really wants to leave you is not a command list but an order: **observe before acting, read logs before guessing, change one variable at a time, preserve the scene, write down what happened**. Commands get forgotten; the order does not. Follow it and even a machine you have never seen will give up its answers, one step at a time.

## 5. Hands-On Checklist

```bash title="Run these before going live" command:("$":1-8)
systemctl --failed                                   # 1. any failed services?
awk -F: '$2==""{print $1}' /etc/shadow               # 2. passwordless accounts — should be empty
find / -perm -4000 -type f 2>/dev/null | head        # 3. setuid binaries
ss -ltnp | head                                      # 4. listeners and bound addresses
df -h; df -i                                         # 5. space and inodes
findmnt --verify --verbose | head                    # 6. validate fstab
journalctl -p err -b --no-pager | tail -20           # 7. errors from this boot
ls /etc/cron.d /etc/logrotate.d 2>/dev/null          # 8. scheduling and log rotation config
```

## Summary

- Four lists: **accounts and permissions, services and boot, network and firewall, storage and backups** — covering most "quick fix" problems.
- One table maps symptoms to first commands, so start there instead of guessing.
- Go deeper in: kernel and `/proc`, eBPF, K8s, observability, automation — pick one as needed.
- The method: **observe before acting, read logs before guessing, change one variable, preserve the scene, write down the process**.
- The checklist will keep growing — that is your experience growing with it.

## Next Up

This chapter closes the series. The next stop need not be "the next chapter" — pick any direction above and build something small, such as adding a full Prometheus setup to your own box or writing your routine operations as Ansible. That beats reading more.
