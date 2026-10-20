---
title: 'Linux Basics 18: Performance And Tracing — Where Is The Machine Actually Stuck'
description: 'Why available matters more than free, how to read vmstat r/b/si/so/wa, iostat await versus %util, using pidstat to localise the process, the /proc files worth knowing, and a first look at strace for finding the syscall a program hangs on.'
link: linux-18-performance-and-tracing
catalog: true
date: 2022-04-26 20:30:00
updated: 2022-04-26 22:10:00
categories: ['笔记']
tags: ['Linux', '基础']
draft: false
---

## What This Chapter Solves

"Slow" is a fuzzy experience: ssh takes five or six seconds to give you a prompt, a web page occasionally spins, yet `top` shows the CPU nearly idle and memory unconsumed. **Looking idle and being fast are not the same thing** — time can vanish waiting on a disk, a network round trip, or a single syscall that never returns.

This chapter turns "stuck" into measurable quantities: how much memory is really left, what the `vmstat` columns actually watch, how `iostat` and `pidstat` localise a problem to a process, and finally how `strace` answers the most practical question of all — **which system call is it blocked on**.

## 1. Memory: `free` Is Not "Available", `available` Is

```bash title="Start with memory" command:("$":1-3)
free -h
free -w        # list buffers and cache separately
cat /proc/meminfo | grep -E 'MemTotal|MemAvailable|Buffers|Cached'
```

```text
              total        used        free      shared  buff/cache   available
Mem:           15Gi       3.2Gi       640Mi        28Mi        11Gi       11Gi
Swap:         2.0Gi       128Mi       1.9Gi
```

| Column | Meaning |
| --- | --- |
| `free` | Completely unused RAM — **a small value is normal** |
| `buff/cache` | Memory the kernel borrows for caching — **reclaimable** |
| `available` | The kernel's estimate of what new programs can still use |

**Bottom line:** judge memory by `available`, not `free`. A small `free` means the cache is doing its job, not that you are under pressure. The real alarm is `available` creeping toward zero *while* `si/so` stays non-zero.

## 2. `vmstat 1`: Which Kind Of Bottleneck Is It

```bash title="Refresh every second to see movement" command:("$":1-2)
vmstat 1 5         # once a second, five samples
vmstat -w 1        # wide columns, so the numbers do not run together
```

```text
procs -----------memory---------- ---swap-- -----io---- -system-- ------cpu-----
 r  b   swpd   free   buff  cache   si   so    bi    bo   in   cs us sy id wa st
 2  0      0 640000 120000 11000000  0    0    12    40  800 1500 15  3 80  1  0
```

| Column | How to read it |
| --- | --- |
| `r` | runnable queue length; **sustained above the core count** means waiting on CPU |
| `b` | blocked processes waiting on IO; **sustained non-zero** means someone is waiting on disk |
| `si`/`so` | pages swapped in/out; **sustained non-zero means memory is short** — a disaster for performance |
| `wa` | share of CPU time spent waiting on IO; **high wa points at disk, not CPU** |

**Note:** high `r` with low `id` = CPU bound; high `b` and `wa` = IO bound; non-zero `si/so` = memory bound. Three symptoms, three different medicines — do not reach for more CPU first.

:::info
The **first row is an average since boot**, so never judge the present from it. Always watch the second row and later from `vmstat 1`.
:::

## 3. `iostat -x 1`: How Busy Is The Disk Really

```bash title="Per-device detail" command:("$":1-3)
iostat -x 1 3                     # extended, once a second, three samples
iostat -x 1 sda                   # just one device
pidstat -d 1 | head               # flip it around: which process is reading and writing
```

| Column | Meaning |
| --- | --- |
| `%util` | share of time the device had IO in flight |
| `await` | average wait per IO in milliseconds, queuing included |
| `r/s`, `w/s` | reads and writes per second |
| `aqu-sz` | average request queue length |

**Bottom line:** a rising `await` (roughly over 10ms on an SSD, over 100ms on a spinning disk) says "the disk is tired" far better than `%util` does. **Modern NVMe drives handle many requests in parallel, so `%util` can sit at 100% while nothing is actually slow** — it is a spindle-era metric, so do not use it as an alert threshold.

## 4. `pidstat`: Bring The Numbers Down To A Process

```bash title="CPU and IO per process" command:("$":1-4)
pidstat -u 1                      # CPU per process
pidstat -u -d -p 1234 1           # only PID 1234, CPU and disk IO
pidstat -r 1 | head               # memory usage per process
pidstat -t -p 1234 1              # break down to threads
```

**Note:** `top` tells you the system is busy; `pidstat` tells you **who**. Once you have the process, attach `strace -p` and the loop is closed.

## 5. `/proc`: These Files Are The Real Source

```bash title="Read what the kernel exposes" command:("$":1-6)
cat /proc/meminfo | head                 # memory detail; MemAvailable lives here
cat /proc/loadavg                        # 1/5/15-minute load plus running/total processes
cat /proc/1234/status | head             # process state: VmRSS, Threads
cat /proc/1234/limits                    # resource limits for that process
cat /proc/1234/io                        # bytes that process has read and written
ls -l /proc/1234/fd | wc -l              # how many file descriptors it holds
```

**Note:** `read_bytes` in `/proc/<pid>/io` counts **bytes that actually reached the block device**; unlike `rchar` (which includes cache hits) it tracks disk pressure, so check it first when asking "who is hammering the disk".

## 6. First Steps With `strace`: Which Syscall Is It

```bash title="Start by attaching to a process" command:("$":1-4)
sudo strace -p 1234                # attach live and watch what it is doing
sudo strace -p 1234 -T             # show time per call — the slow one stands out
sudo strace -f -e trace=file ./app # -f follows children; only file-related calls
sudo strace -c ./app               # summary: which call types dominate time and count
```

**Bottom line:** when a program hangs, **the last call in `strace -T` that has not returned** is usually the answer — commonly `read()` blocked on a network peer, `open()` stuck on NFS, or `fsync()` waiting on disk.

:::warning
`strace` adds real overhead to the traced process, so **do not leave it attached in production for long**. The target slows down while attached; detach as soon as you have your answer.
:::

## 7. Hands-On Checklist

```bash title="Run these in order" command:("$":1-7)
free -h; cat /proc/meminfo | grep MemAvailable      # 1. how much memory is left
uptime; cat /proc/loadavg                           # 2. load and run queue
vmstat -w 1 5                                       # 3. watch r/b/si/so/wa
iostat -x 1 3                                       # 4. disk await and %util
pidstat -u -d 1 3 | tail                            # 5. who is eating CPU and IO
sudo strace -p 1 -T 2>&1 | head                     # 6. attach and find the slowest call
ls -l /proc/1/fd | wc -l                            # 7. open file descriptor count
```

## Summary

- A small `free` is normal; judge memory by **`available`**. Only sustained non-zero `si/so` means memory is truly short.
- `vmstat` has three diagnoses: high `r` → CPU queueing; high `b`/`wa` → waiting on disk; non-zero `si/so` → swapping. Row one is a lifetime average — ignore it.
- Trust **`await`** over `%util` in `iostat`; `%util` can hit 100% on NVMe without being slow.
- `top` localises the system, **`pidstat` localises the process**, `strace -T` localises the single system call.
- `/proc` is the data source: `meminfo`, `loadavg`, `<pid>/status`, `limits`, `io`, `fd`.
- `perf top` gets you to function-level hotspots and is a next step — master these tools first.

## Next Up

Shell scripting, part one: shebang and the two ways to run a script, the quoting traps of `"$VAR"` and `"$@"`, `[ ]` versus `[[ ]]`, why `while read -r` needs that `-r`, and what `set -euo pipefail` each actually fixes.
