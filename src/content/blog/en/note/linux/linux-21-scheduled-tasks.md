---
title: 'Linux Basics 21: Scheduled Tasks — The Traps Of crontab And systemd Timers'
description: 'The five cron fields and the OR relationship between day-of-month and day-of-week, cron’s minimal-environment traps (PATH, working directory, % escaping, mailed output, missing variables), crontab versus cron.d, anacron for machines that are often off, and systemd timers with OnCalendar and Persistent.'
link: linux-21-scheduled-tasks
catalog: true
date: 2022-04-29 20:30:00
updated: 2022-04-29 22:10:00
categories: ['笔记']
tags: ['Linux', '基础']
draft: false
---

## What This Chapter Solves

The same script that runs perfectly when you type it in a terminal fails silently the moment you put it in crontab — no output, no error, nobody even knows it never ran. Sometimes it also gets skipped entirely, because the machine happened to be powered off at that moment.

This chapter nails down cron's **environment traps** (the root cause of most "the scheduled job does not work" reports), then looks at its modern replacement, systemd timers, and how they close each of those gaps.

## 1. The Five Fields

```text
*  *  *  *  *  command
│  │  │  │  └─ day of week (0-7, both 0 and 7 are Sunday; MON..SUN also work)
│  │  │  └──── month       (1-12)
│  │  └─────── day of month(1-31)
│  └────────── hour        (0-23)
└───────────── minute      (0-59)
```

| Expression | Meaning |
| --- | --- |
| `*/15 * * * *` | every 15 minutes |
| `0 3 * * *` | daily at 03:00 |
| `0 9 * * 1-5` | 09:00 on weekdays |
| `0 0 1 * *` | 00:00 on the first of each month |
| `@reboot` | once at every boot |

**Bottom line:** when both day-of-month and day-of-week are set, cron treats them as **OR** — `0 0 1 * 5` does not mean "the 1st *if* it is a Friday", it means "the 1st **or** every Friday", so both fire. If you want AND, test for it inside the command.

## 2. The Environment Traps (The Point Of This Chapter)

When cron runs your job, its environment is **a completely different one** from the shell you log into:

```ini title="Top of a crontab: declare the environment explicitly"
PATH=/usr/local/bin:/usr/bin:/bin
MAILTO=
SHELL=/bin/bash
```

```text
PATH=/usr/bin:/bin     ← minimal; /usr/local/bin is often not in it
HOME=/root             ← the working directory is your home, not where you cd'd
everything else empty  ← no alias, no .bashrc, no nvm
```

| Symptom | Cause |
| --- | --- |
| `command not found` | the directory is not in PATH (see chapter 08 on environments) |
| relative paths miss files | the working directory is `$HOME`, not the script's directory |
| the command is cut short | `%` is special in crontab and must be written `\%` |
| nobody sees the error | cron **mails** output to `MAILTO`; set `MAILTO=` to silence it |
| `$VAR` is empty | variables are not inherited; declare them at the top or source them in the script |

:::warning
**The first rule of writing a crontab: use absolute paths, and declare every needed variable at the top.**
The standard way to debug "why doesn't it run" is to paste the command into a terminal and run it under `env -i /bin/bash` — reproducing that minimal environment usually makes the problem obvious at once.
:::

## 3. Managing Cron And Reading Its Logs

```bash title="crontab and system-level jobs" command:("$":1-6)
crontab -l                     # this user's scheduled jobs
crontab -e                     # edit them
crontab -r                     # delete them all, no confirmation — handle with care
ls /etc/cron.d/                # system level: same format plus a user field
cat /etc/cron.allow            # whitelist; if present, only listed users may use cron
sudo journalctl -u cron -n 50  # cron logs on Debian/Ubuntu
```

Files in `/etc/cron.d/` use the same syntax as a crontab, only with an **extra user column**, which makes them easy to ship in a package:

```text
30 2 * * * root /usr/local/bin/backup.sh /srv/data
```

## 4. anacron: When The Machine Is Often Off

cron assumes the **machine is always on** — any job whose slot falls during downtime is simply lost. `anacron` remembers "the last day it ran" and catches up on a daily or weekly basis after boot:

```ini title="/etc/anacrontab"
1  5   cron.daily    run-parts /etc/cron.daily
7  10  cron.weekly   run-parts /etc/cron.weekly
```

| Field | Meaning |
| --- | --- |
| period (days) | run at least once every N days |
| delay (minutes) | wait this long after boot before running, to spread the load |

## 5. systemd Timers: Modern, And Able To Catch Up

```ini title="backup.timer"
[Unit]
Description=Run backup daily

[Timer]
OnCalendar=*-*-* 03:00:00
Persistent=true
RandomizedDelaySec=10m

[Install]
WantedBy=timers.target
```

```ini title="backup.service"
[Unit]
Description=Nightly backup

[Service]
Type=oneshot
ExecStart=/usr/local/bin/backup.sh /srv/data
```

```bash title="Enable it and inspect it" command:("$":1-4)
sudo systemctl enable --now backup.timer
systemctl list-timers --all            # when everything fires next
systemctl status backup.timer
sudo journalctl -u backup.service -n 30
```

**Bottom line:** three things beat cron here — `Persistent=true` makes a job **missed during downtime run after the next boot** (exactly anacron's job), `RandomizedDelaySec` spreads jobs so a fleet does not hit one server at the same second, and logs land in journald automatically.

**Note:** I first wrote `OnCalendar` as `03:00` without seconds; systemd parses it, but the catch-up behaviour is clearer with the full `*-*-* 03:00:00`. `systemctl list-timers` is the single most useful command — **it tells you exactly when the job runs next**.

## 6. logrotate

Left alone, logs will fill the disk. `logrotate` splits, compresses and retains N copies, then asks the service to reopen its file:

```ini title="/etc/logrotate.d/myapp"
/var/log/myapp/*.log {
    daily
    rotate 14
    compress
    missingok
    notifempty
    postrotate
        systemctl reload myapp >/dev/null 2>&1 || true
    endscript
}
```

It is usually driven by `/etc/cron.daily/logrotate` or a systemd timer. The `postrotate` block tells the service to **reopen its log file**, otherwise it keeps writing to the old inode that has been renamed away.

## 7. Hands-On Checklist

```bash title="Practice (in a safe environment)" command:("$":1-7)
crontab -l                                               # 1. existing jobs
printf '#!/bin/sh\ndate >> ~/cron.log\n' | tee ~/bin/t.sh >/dev/null; chmod +x ~/bin/t.sh   # 2. make a script
env -i /bin/bash -c '~/bin/t.sh'                         # 3. reproduce cron’s minimal environment
systemd-analyze calendar '*-*-* 03:00:00'                # 4. validate an OnCalendar expression
systemctl list-timers --all | head                       # 5. every timer on the system
sudo journalctl -u cron -n 20 2>/dev/null || sudo journalctl -u crond -n 20   # 6. cron logs
sudo logrotate -d /etc/logrotate.d/myapp                 # 7. dry run, changes nothing
```

## Summary

- In the five cron fields, day-of-month and day-of-week together mean **OR**; both `0` and `7` are Sunday.
- Environment traps are cron's number one problem: **minimal PATH, `$HOME` as working directory, variables not inherited, `%` needing an escape, output sent by mail**.
- `crontab -r` wipes jobs without asking — be careful; system jobs go in `/etc/cron.d/` with the extra user field.
- For machines that are often off, use **anacron** or a systemd timer with `Persistent=true` to catch up.
- A systemd timer adds catch-up, randomised jitter and journald logging; `systemctl list-timers` shows the next run.
- Keep logs pruned with `logrotate` rather than waiting for a full disk.

## Next Up

Logs and a debugging method: how journald and `/var/log` divide the work, a six-step path from symptom to root cause, and three real cases — a full disk, a taken port, and a permission denial.
