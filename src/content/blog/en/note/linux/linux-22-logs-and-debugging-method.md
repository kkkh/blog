---
title: 'Linux Basics 22: Logs And A Debugging Method — Six Steps From Symptom To Root Cause'
description: 'How journald and /var/log divide the work, the journalctl combinations worth memorising, logrotate essentials, and a six-step debugging method — describe the symptom, build a timeline, find the recent change, narrow the layer, test one hypothesis, then record it. Three real cases: full disk, taken port, permission denied.'
link: linux-22-logs-and-debugging-method
catalog: true
date: 2022-04-30 20:30:00
updated: 2022-04-30 22:10:00
categories: ['笔记']
tags: ['Linux', '基础']
draft: false
---

## What This Chapter Solves

When something breaks, the most tempting move is `systemctl restart` and hope it fixes itself. **That wipes the scene** — in-memory state is gone, connection counters reset, and the last few log lines before the crash may vanish, so finding out *why* afterwards becomes much harder.

This chapter maps where logs live and how to read them, then offers a reusable **six-step debugging method**, and finally walks it through three real cases.

## 1. Where Logs Live: journald Versus `/var/log`

```bash title="journald is the first stop" command:("$":1-6)
journalctl -n 50                     # last 50 lines
journalctl -p err -b                 # err level and above, this boot only
journalctl --since '1 hour ago'      # a time window
journalctl -b -1                     # the previous boot — reach for this after a crash or reboot
journalctl -u nginx -f               # follow one service live
journalctl -o json-pretty -n 1       # structured fields: _PID, _COMM, unit and more
```

| Location | Written by |
| --- | --- |
| journald | systemd services and kernel messages, queried through `journalctl` |
| `/var/log/syslog`, `messages` | classic syslog, named differently on Debian and RHEL |
| `/var/log/auth.log`, `secure` | logins, sudo, sshd |
| `/var/log/dpkg.log`, `yum.log` | package manager actions |
| `/var/log/nginx/*.log` | the application's own logs |

**Bottom line:** start with `journalctl -u <service>` for the **service view**, then `journalctl -b -1` or `-p err` for the **system view**. Application logs (nginx, databases) are **not in journald** — go to their own directories.

## 2. logrotate Essentials

```ini title="/etc/logrotate.d/app"
/var/log/app/*.log {
    daily          # or: size 100M
    rotate 14      # keep 14 copies
    compress       # gzip the old ones
    missingok
    notifempty
    copytruncate   # for services that will not reopen files: copy then truncate
    postrotate
        systemctl reload app >/dev/null 2>&1 || true
    endscript
}
```

**Note:** if the service can reopen its file, use `postrotate` with a `reload` — the cleanest option. If it cannot, use `copytruncate`, which risks a tiny window of lost log lines but avoids a restart. **Monitor the log directory's capacity too**, or a misconfigured rotation policy will still fill the disk.

## 3. The Six-Step Method

1. **Describe the symptom**: it must be observable and reproducible — "at what time, with what action, what did you see, what did you expect". A vague "it's broken" cannot be investigated.
2. **Build a timeline**: use `journalctl --since/--until/-b -1` to establish **when it started**.
3. **Find the recent change**: a deploy, a config edit, a certificate, a dependency upgrade, disk space. **Eighty percent of failures follow a change.**
4. **Narrow the layer**: application, network, disk, permissions or SELinux. Rule each out with the tools from earlier chapters.
5. **Test one hypothesis**: **change a single variable**, then observe. Change three things at once and you will never know which one mattered.
6. **Record and review**: write down the symptom, the root cause and the action, so the next similar problem is a lookup.

:::info
**Do not rush to restart; preserve the scene first.** A restart clears in-memory state, resets connection counters and discards pre-crash context. Snapshot `journalctl`, `ss`, `df` and `ps` first, then decide whether to act.
:::

## 4. Three Real Cases

**Case A — full disk.** A service suddenly cannot write, and `df -h` shows the root filesystem at 100%. Yet `du -sh /*` adds up to far less, because **a process is holding a large deleted file**: `df` counts allocated blocks while `du` cannot see an inode that has been unlinked. `sudo lsof +L1` lists those "deleted but not freed" files, and restarting that process reclaims the space.

**Case B — port already in use.** A new service will not start and the log says `address already in use`. `ss -ltnp | grep :8080` finds the owner's PID, then `sudo fuser -k 8080/tcp` or a plain `kill`. It may also be a stale old process or leftover `TIME_WAIT` sockets (which you simply wait out). **Identify who holds it first**; do not restart the whole service on reflex.

**Case C — permission denied.** You get `Permission denied` while `ls -l` looks perfectly fine. Run `namei -l /data/app/upload/file` to walk the mode of every directory from the root — **the usual culprit is one directory in the middle missing its `x` bit**. If the modes are all correct, check `getenforce` for SELinux (chapter 16).

## 5. Hands-On Checklist

```bash title="Keep these in your debugging kit" command:("$":1-7)
journalctl -p err -b --no-pager | tail -30          # 1. errors from this boot
journalctl -u myapp --since '30 min ago'            # 2. recent activity of the target service
df -h; df -i                                        # 3. space and inodes
sudo lsof +L1 | head                                # 4. deleted but un-freed files
ss -ltnp | head                                     # 5. listeners and owners
namei -l /path/to/file                              # 6. per-level permissions
sudo logrotate -d /etc/logrotate.d/app              # 7. dry run the rotation config
```

## Summary

- Prefer `journalctl` (`-u`, `-p`, `-b -1`, `--since`, `-o json-pretty`); application logs live in their own `/var/log` directories.
- logrotate: `daily/size` plus `rotate N` plus `compress`, with `postrotate` or `copytruncate`.
- Six steps: **describe → timeline → recent change → narrow the layer → test a hypothesis → record it**.
- A failure right after a change is no coincidence; **change one variable at a time** to attribute cause.
- Full disk: `df -h` then `df -i` then `lsof +L1`. Taken port: `ss -ltnp`. Permission problem: `namei -l`.
- **Preserve the scene before acting**; restarting is the last resort, not the reflex.

## Next Up

Containers and kernel boundaries: a container is really an ordinary process plus namespaces and cgroups, how `docker exec` relates to `nsenter`, cgroup v2 CPU and memory limits, and why membership in the `docker` group is close to being root.
