---
title: 'Linux Basics 07: Processes And Signals — The Real Difference Between TERM And KILL'
description: 'Reading ps state codes, what load average and %wa actually mean, how nice works, the essential signal table, foreground/background and the signal Ctrl+Z sends, zombies versus orphans, and why closing your terminal kills the process.'
link: linux-07-processes-and-signals
catalog: true
date: 2022-04-15 20:30:00
updated: 2022-04-15 22:10:00
categories: ['笔记']
tags: ['Linux', '基础']
draft: false
---

## What This Chapter Solves

The name `kill` is misleading: it **sends a signal**, it does not kill. Once that lands, you can explain why some processes exit on the first `kill`, some need `-9`, and some ignore even `-9`. This chapter links the observation tools (`ps`/`top`/`uptime`) to the semantics of signals.

## 1. ps: Learn To Read The State Column First

```bash title="The two classic long formats" command:("$":1-5)
ps -ef | head                        # System V style: UID PID PPID ... CMD
ps aux | head                        # BSD style: USER PID %CPU %MEM ... COMMAND
ps -eo pid,ppid,stat,%cpu,%mem,etime,cmd --sort=-%cpu | head   # custom columns + sort
ps -ejH | head                       # process tree (parent/child)
```

The `STAT` column answers about eighty percent of “what is this process doing”:

| State | Meaning |
| --- | --- |
| `R` | running or runnable |
| `S` | interruptible sleep (waiting for an event — the most common by far) |
| `D` | **uninterruptible sleep** (waiting on I/O, usually disk) |
| `T` | stopped (`Ctrl+Z`, or a STOP signal) |
| `Z` | zombie (exited, parent has not reaped it) |
| `I` | idle kernel thread (recent kernels) |
| Modifiers | `<` high priority, `N` low priority, `l` multithreaded, `s` session leader, `+` foreground group |

**My notes:** a `D`-state process **cannot respond to signals at all** — that is the one legitimate reason `kill -9` appears to do nothing. A `Z` cannot be killed either; only its parent calling `wait()` removes it. Long-lived zombies are a bug in the parent, not a problem with the zombie.

## 2. Load, CPU, I/O: Three Numbers That Get Confused

```bash title="Three views of the same system" command:("$":1-4)
uptime                       # load: 1/5/15-minute average of runnable + uninterruptible processes
top -b -n1 | head -12        # %us user / %sy kernel / %wa waiting on I/O / %id idle
nproc                        # core count: load only means something divided by this
vmstat 1 3                   # r runnable, b blocked, si/so swapping
```

**Note:** high load with idle CPU almost always means `%wa` or a pile of `D`-state processes; and only load ÷ cores gives a “pressure ratio”. I use exactly this to separate “CPU saturated” from “disk stalled” — two completely different incidents.

nice / renice: priority runs from `-20` (highest) to `19` (lowest), and **only root may lower the nice value** (raise priority).

```bash title="Adjusting priority" command:("$":1-3)
nice -n 10 tar czf backup.tar.gz /data     # start a backup with low priority
renice -n 5 -p 12345                       # change a running process
ionice -c2 -n7 -p 12345                    # I/O priority matters for backups too
```

## 3. Signals: TERM Can Be Ignored, KILL Cannot

```bash title="The table worth memorising" command:("$":1)
kill -l | head -20
```

| Signal | No. | Meaning | Ignorable |
| --- | --- | --- | --- |
| `SIGHUP` | 1 | terminal hangup / “reload your config” for daemons | ✅ yes |
| `SIGINT` | 2 | `Ctrl+C` | ✅ yes |
| `SIGTERM` | 15 | “please exit gracefully” — the **default** | ✅ yes (and you may choose how) |
| `SIGKILL` | 9 | the kernel removes it; cannot be caught, blocked or ignored | ❌ no |
| `SIGSTOP` | 19 | pause (uncatchable) | ❌ no |
| `SIGTSTP` | 20 | what `Ctrl+Z` sends | ✅ yes |
| `SIGCONT` | 18 | continue | — |

```bash title="Sending signals properly" command:("$":1-5)
kill 12345              # = kill -TERM: ask first
kill -HUP $(cat /run/nginx.pid)   # make nginx reload its config
kill -9 12345           # last resort: no cleanup, possible leftover locks
kill -- -12345          # negative = the whole process group (children included)
pkill -f 'python3 worker.py'; pgrep -a python3
```

**Note:** the problem with `-9` is not rudeness, it is that the **process gets no chance to clean up**: temp files stay, database transactions do not roll back, PID files remain (next start complains “already running”). So the order is always `TERM → wait a few seconds → KILL if it truly will not go`.

## 4. Foreground, Background, And Parting Ways

```bash title="Job control" command:("$":1-6)
sleep 300 &              # background; the shell returns the prompt immediately
jobs -l                  # list jobs and their PIDs
fg %1; bg %1             # bring to foreground / send back
Ctrl+Z                   # sends SIGTSTP: suspends the job, does NOT kill it
disown %1                # drop it from the job table so the shell sends no HUP at exit
nohup sleep 300 &        # ignore SIGHUP; output goes to nohup.out
```

**Why a process dies when you close the terminal:** when a terminal goes away, the kernel sends `SIGHUP` to the session and its jobs. The robust answer is not `nohup` but letting something that outlives terminals own the job:

```bash title="Where long-running work belongs" command:("$":1-3)
tmux new -s work         # decouple the session from the terminal (easiest)
systemctl start myjob    # the production answer: a unit owned by systemd (chapter 11)
setsid sleep 300         # leave the session (lightweight, but no restart policy)
```

## 5. Zombies And Orphans: Two Opposite Phenomena

- **Orphan**: the parent exits first, the child is adopted by `init`/`systemd` (PID 1) — nothing wrong.
- **Zombie**: the child exits first and the parent **never calls `wait()`**, so the kernel keeps an entry for the status — `Z` in `ps`, holding a small amount of memory but no CPU.

```bash title="Make a zombie and look at it" command:("$":1-4)
bash -c 'sleep 0.1 & sleep 5' &     # parent never waits; child becomes a zombie
ps -eo pid,ppid,stat,cmd | awk '$3 ~ /Z/'
wait                                # after the parent waits, the zombie is gone
```

**Note:** a zombie cannot be killed (it is already dead). It disappears when the parent reaps it, or when the parent dies and PID 1 takes over. So a pile of `Z` is not a zombie problem — it is a bug in whichever program left them.

## 6. Hands-On Checklist

```bash title="Run the whole chapter" command:("$":1-8)
ps -eo pid,ppid,stat,%cpu,cmd --sort=-%cpu | head      # 1. read the state codes
sleep 300 & ; jobs -l ; kill %1                        # 2. job control
( sleep 5 & ); ps -eo stat,cmd | grep -c Z             # 3. produce a zombie
nice -n 10 sleep 1 & ; ps -o ni,cmd -p $!              # 4. nice in effect
kill -9 12345 2>/dev/null || echo 'no such PID'        # 5. -9 as the last resort
nproc; uptime                                          # 6. load versus cores
vmstat 1 2                                             # 7. the r and b columns
kill -l | head -8                                      # 8. the signal names
```

## Summary

- `kill` sends a signal. `TERM` can be ignored and handled gracefully; `KILL` cannot be caught — so 15 first, 9 last.
- `STAT` is the core of `ps`: `D` is stuck in I/O (signals are useless), `Z` needs the parent to reap, `T` is suspended.
- Job control is `&` / `Ctrl+Z` (TSTP) / `jobs` / `fg` / `bg`; closing the terminal sends `SIGHUP` to the whole job.
- For long-running work use `tmux` or `systemd`, not `nohup`.
- Load must be divided by core count; high load with idle CPU means check `%wa` and `D`.

## Next Up

Environment variables and shell startup files: the scope of `export`, which files a login shell loads versus a non-login shell, why `ssh host 'command'` cannot find your PATH additions, and what `sudo` strips from the environment.
