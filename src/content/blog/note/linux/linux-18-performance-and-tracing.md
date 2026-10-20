---
title: 'Linux 基础 18：性能观测与 strace——机器到底卡在哪'
description: 'free 里 available 与 free 的区别、vmstat 的 r/b/si/so/wa 怎么读、iostat 的 await 与 %util、pidstat 按进程看 CPU 与 IO、/proc 下几个必看文件，以及用 strace 一眼看出程序卡在哪个系统调用。'
link: linux-18-performance-and-tracing
catalog: true
date: 2022-04-26 20:30:00
updated: 2022-04-26 22:10:00
categories: ['笔记']
tags: ['Linux', '基础']
draft: false
---

## 这一节要解决什么

服务器慢是种模糊的体验：ssh 登录要等五六秒才出提示符，网页偶尔转圈，但 `top` 里 CPU 很闲、内存也没满。**"看起来不忙"和"真的快"是两回事**——大量时间可能耗在等磁盘、等网络、等一个卡住的系统调用上。

这一节把"卡"拆成可测量的量：内存怎么算"还剩多少"，`vmstat` 几个列到底在看什么，`iostat`/`pidstat` 怎么定位到进程，最后用 `strace` 回答那个最实用的问题——**程序卡在哪一个系统调用上**。

## 一、内存：`free` 不是"可用"，`available` 才是

```bash title="先看内存" command:("$":1-3)
free -h
free -w        # 分别列出 buffers 与 cache
cat /proc/meminfo | grep -E 'MemTotal|MemAvailable|Buffers|Cached'
```

```text
              total        used        free      shared  buff/cache   available
Mem:           15Gi       3.2Gi       640Mi        28Mi        11Gi       11Gi
Swap:         2.0Gi       128Mi       1.9Gi
```

| 列 | 含义 |
| --- | --- |
| `free` | 完全没被用的内存，**常年很小是正常的** |
| `buff/cache` | 内核用空闲内存做的缓存，**可回收** |
| `available` | 估算"还能给新程序用多少"，约等于 free 加上大部分可回收缓存 |

**关键结论**：判断内存够不够看 `available`，不看 `free`。`free` 小不代表内存紧张，反而是缓存用得好；真正该担心的是 `available` 逼近 0 且 `si/so` 持续非零。

## 二、`vmstat 1`：一眼看出瓶颈属于哪一类

```bash title="每秒刷新看变化" command:("$":1-2)
vmstat 1 5         # 每秒一次，共 5 次
vmstat -w 1        # 宽列显示，避免数字挤在一起
```

```text
procs -----------memory---------- ---swap-- -----io---- -system-- ------cpu-----
 r  b   swpd   free   buff  cache   si   so    bi    bo   in   cs us sy id wa st
 2  0      0 640000 120000 11000000  0    0    12    40  800 1500 15  3 80  1  0
```

| 列 | 读法 |
| --- | --- |
| `r` | 可运行队列长度；**持续大于 CPU 核数**说明在 CPU 排队 |
| `b` | 阻塞（等 IO）的进程数；**持续非零**说明有人在等磁盘 |
| `si`/`so` | 从/向 swap 换页；**持续非零 = 内存不够**，性能灾难 |
| `wa` | CPU 等 IO 的时间占比；**高 wa 说明瓶颈在磁盘而非 CPU** |

**批注**：`r` 高 + `id` 低 = CPU 瓶颈；`b` 高 + `wa` 高 = IO 瓶颈；`si/so` 非零 = 内存瓶颈。三个症状三副药，别一上来就加 CPU。

:::info
`vmstat` 输出的**第一行是自开机以来的平均值**，别拿它判断当下。永远看 `vmstat 1` 第二行往后的瞬时值。
:::

## 三、`iostat -x 1`：磁盘到底有多忙

```bash title="看每块盘" command:("$":1-3)
iostat -x 1 3                     # 扩展模式，每秒一次共 3 次
iostat -x 1 sda                   # 只看某块盘
pidstat -d 1 | head               # 反过来说：哪个进程在读写
```

| 列 | 含义 |
| --- | --- |
| `%util` | 该设备有 IO 请求在进行的时间占比 |
| `await` | 平均每次 IO 的等待时间（毫秒，含排队） |
| `r/s`、`w/s` | 每秒读写次数 |
| `aqu-sz` | 平均请求队列长度 |

**关键结论**：`await` 升高（SSD 上超过约 10ms、机械盘上超过约 100ms）比 `%util` 更能说明"盘累了"。**现代 NVMe SSD 能并行处理很多请求，`%util` 到 100% 也未必慢**——它是机械盘时代的指标，别拿来当告警阈值。

## 四、`pidstat`：把指标落到进程上

```bash title="按进程看 CPU 与 IO" command:("$":1-4)
pidstat -u 1                      # 每个进程的 CPU
pidstat -u -d -p 1234 1           # 只盯 PID 1234 的 CPU 与磁盘 IO
pidstat -r 1 | head               # 每个进程的内存用量
pidstat -t -p 1234 1              # 展开到线程粒度
```

**批注**：`top` 告诉你"系统在忙"，`pidstat` 告诉你"**谁在忙**"。定位到进程之后再用 `strace -p`，链路就闭合了。

## 五、`/proc`：这些"文件"才是数据源

```bash title="直接读内核暴露的数据" command:("$":1-6)
cat /proc/meminfo | head                 # 内存明细，MemAvailable 就在这里
cat /proc/loadavg                        # 1/5/15 分钟负载 + 运行中/总进程数
cat /proc/1234/status | head             # 进程状态：VmRSS、Threads
cat /proc/1234/limits                    # 该进程可用的资源上限
cat /proc/1234/io                        # 该进程读写的字节数
ls -l /proc/1234/fd | wc -l              # 打开了多少文件描述符
```

**批注**：`/proc/<pid>/io` 里的 `read_bytes` 是**真正落到块设备的字节数**，比 `rchar`（含缓存命中）更接近"磁盘压力"；排查"到底谁在刷盘"时先看它。

## 六、`strace` 入门：卡在哪一个系统调用

```bash title="从附加到进程开始" command:("$":1-4)
sudo strace -p 1234                # 实时附加，看它现在在干什么
sudo strace -p 1234 -T             # 显示每个调用耗时，慢的一眼可见
sudo strace -f -e trace=file ./app # -f 跟子进程；只看文件相关调用
sudo strace -c ./app               # 统计：哪类调用最频繁、总耗时最高
```

**关键结论**：程序"卡住"时，`strace -T` 里**最后一条没有返回的调用**往往就是答案——常见的是 `read()` 阻塞在等网络、`open()` 卡在 NFS、`fsync()` 在等磁盘。

:::warning
`strace` 会给目标进程带来明显开销，**生产环境别长时间挂着**；`-p` 附加期间进程会变慢，查完立刻断开。
:::

## 七、动手清单

```bash title="逐条跑一遍" command:("$":1-7)
free -h; cat /proc/meminfo | grep MemAvailable      # 1. 内存还剩多少
uptime; cat /proc/loadavg                           # 2. 负载与可运行队列
vmstat -w 1 5                                       # 3. 看 r/b/si/so/wa
iostat -x 1 3                                       # 4. 磁盘 await 与 %util
pidstat -u -d 1 3 | tail                            # 5. 谁在吃 CPU 与 IO
sudo strace -p 1 -T 2>&1 | head                     # 6. 附加看最慢的系统调用
ls -l /proc/1/fd | wc -l                            # 7. 打开的文件描述符数
```

## 小结

- `free` 小很正常，判断内存看 **`available`**；`si/so` 持续非零才是真的内存不足。
- `vmstat` 三副药：`r` 高 → CPU 排队；`b`/`wa` 高 → 等磁盘；`si/so` 非零 → 换页；第一行是历史平均，别看。
- `iostat` 看 **`await`** 比看 `%util` 靠谱，NVMe 上 `%util` 100% 也可能不慢。
- `top` 定位系统，**`pidstat` 定位进程**，`strace -T` 定位到"哪一次系统调用"。
- `/proc` 是数据源：`meminfo`、`loadavg`、`<pid>/status`、`limits`、`io`、`fd`。
- `perf top` 能看函数级热点，属于进阶，先把手头这几件用熟。

## 下一节预告

下一节：Shell 脚本（上）——shebang 与两种执行方式的差别、`"$VAR"` 与 `"$@"` 的引号陷阱、`[ ]` 与 `[[ ]]` 的取舍、`while read -r` 为什么要带 `-r`，以及 `set -euo pipefail` 到底各自解决了什么。
