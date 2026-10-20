---
title: 'Linux 基础 07：进程与信号——TERM 和 KILL 到底差在哪'
description: 'ps 状态码怎么读、负载与 %wa 的含义、nice 值的作用、老牌信号表、前台/后台与 Ctrl+Z 的真实信号、僵尸与孤儿进程，以及"关掉终端进程就死了"的原因与正确替代方案。'
link: linux-07-processes-and-signals
catalog: true
date: 2022-04-15 20:30:00
updated: 2022-04-15 22:10:00
categories: ['笔记']
tags: ['Linux', '基础']
draft: false
---

## 这一节要解决什么

`kill` 这个名字很误导：它其实是"**发信号**"，不是"杀掉"。理解这一点，才能解释为什么有的进程 `kill` 一下就退出、有的必须 `-9`、还有的连 `-9` 都没用。这一节把进程的观察口径（`ps`/`top`/`uptime`）和信号的语义串起来。

## 一、ps：先学会读状态码

```bash title="最常用的两种长格式" command:("$":1-4)
ps -ef | head                       # 全量（System V 风格：UID PID PPID ... CMD）
ps aux | head                       # 全量（BSD 风格：USER PID %CPU %MEM ... COMMAND）
ps -eo pid,ppid,stat,%cpu,%mem,etime,cmd --sort=-%cpu | head   # 自定义列 + 排序
ps -ejH | head                      # 进程树（看父子关系）
```

`STAT` 那列的含义（**这一列能回答八成"进程怎么了"**）：

| 状态 | 含义 |
| --- | --- |
| `R` | 运行中或就绪 |
| `S` | 可中断睡眠（等事件，最常见） |
| `D` | **不可中断睡眠**（等 IO，通常是磁盘） |
| `T` | 已停止（`Ctrl+Z` 或被 STOP 信号） |
| `Z` | 僵尸（已退出，父进程还没回收） |
| `I` | 空闲内核线程（新内核） |
| 附加符号 | `<` 高优先级、`N` 低优先级、`l` 多线程、`s` 会话首进程、`+` 前台进程组 |

**我的批注**：`D` 状态的进程**发信号也没用**（它连信号都处理不了），这是 `kill -9` 失效的唯一正当理由；而 `Z` 不能被杀，只能等父进程 `wait()`——如果父进程不回收又长期存在，那就是代码问题。

## 二、负载、CPU、IO：三个别混在一起的数字

```bash title="三个观察口径" command:("$":1-4)
uptime                       # 负载：1/5/15 分钟平均“可运行 + 不可中断”的进程数
top -b -n1 | head -12        # %us 用户态 / %sy 内核态 / %wa 等 IO / %id 空闲
nproc                        # 核数：负载要除以它才有意义（16 核负载 8 = 一半）
vmstat 1 3                   # r 队列、b 阻塞、si/so 换页
```

**批注**：负载高但 CPU 空闲，八成是 `%wa` 或 `D` 状态堆着；负载除以核数才是"压力比"。这条判断我用来区分"CPU 打满"和"磁盘卡住"两类完全不同的故障。

nice / renice：优先级从 `-20`（最高）到 `19`（最低），**只有 root 能调低 nice 值**（即提高优先级）。

```bash title="调整优先级" command:("$":1-3)
nice -n 10 tar czf backup.tar.gz /data     # 以低优先级启动（备份不影响线上）
renice -n 5 -p 12345                       # 调整已运行的进程
ionice -c2 -n7 -p 12345                    # IO 优先级也值得调（备份场景）
```

## 三、信号：TERM 可以忽略，KILL 不能

```bash title="记住这张表" command:("$":1)
kill -l | head -20
```

| 信号 | 编号 | 语义 | 能否被忽略 |
| --- | --- | --- | --- |
| `SIGHUP` | 1 | 终端断开 / 让守护进程重读配置 | ✅ 可以 |
| `SIGINT` | 2 | `Ctrl+C` | ✅ 可以 |
| `SIGTERM` | 15 | "请你优雅退出"——**默认信号** | ✅ 可以（也可以自己决定怎么退） |
| `SIGKILL` | 9 | 内核直接干掉，不能被捕获/阻塞/忽略 | ❌ 不行 |
| `SIGSTOP` | 19 | 暂停（不可捕获） | ❌ 不行 |
| `SIGTSTP` | 20 | `Ctrl+Z` 发的就是它 | ✅ 可以 |
| `SIGCONT` | 18 | 继续 | — |

```bash title="发信号的正确姿势" command:("$":1-4)
kill 12345              # = kill -TERM，先礼后兵
kill -HUP $(cat /run/nginx.pid)   # 让 nginx 重载配置
kill -9 12345           # 最后手段（进程无法释放资源、可能有残留锁）
kill -- -12345          # 负号 = 整个进程组（连带子进程一起）
pkill -f 'python3 worker.py'; pgrep -a python3
```

**批注**：`kill -9` 的问题不只是"粗暴"，而是**进程没机会做清理**：临时文件不删、数据库事务不回滚、PID 文件不删（下次启动报"已存在"）。所以顺序永远是 `TERM → 等几秒 → 还不动再 KILL`。

## 四、前台、后台与别离

```bash title="作业控制" command:("$":1-6)
sleep 300 &              # 后台运行，shell 立刻拿回提示符
jobs -l                  # 看作业列表与进程组
fg %1; bg %1             # 调到前台 / 放回后台
Ctrl+Z                   # 发 SIGTSTP，把前台作业暂停（不是杀死！）
disown %1                # 从作业表里摘掉，之后 shell 退出不会再发 HUP 给它
nohup sleep 300 &        # 忽略 SIGHUP，输出默认进 nohup.out
```

**为什么关掉终端进程就死了**：终端关闭时内核会向该会话的前台/所有作业发 `SIGHUP`。真正健壮的做法不是 `nohup`，而是把它们交给"不受终端生死影响"的东西托管：

```bash title="长期运行的正确归宿" command:("$":1-3)
tmux new -s work         # 会话与终端解耦（最省事）
systemctl start myjob    # 生产标准做法：写成 unit，由 systemd 托管（第 11 节详谈）
setsid sleep 300         # 脱离当前会话（轻量，但不负责重启）
```

## 五、僵尸与孤儿：两个方向相反的现象

- **孤儿（orphan）**：父进程先退出，子进程被 `init`/`systemd`（PID 1）接管 —— 无事。
- **僵尸（zombie）**：子进程先退出，父进程**没调用 `wait()`**，内核保留一条记录等父进程读状态 —— `ps` 里是 `Z`，占内存不占 CPU。

```bash title="造一个僵尸看长什么样" command:("$":1-4)
bash -c 'sleep 0.1 & sleep 5' &     # 父进程不 wait，子进程退出后成为僵尸
ps -eo pid,ppid,stat,cmd | awk '$3 ~ /Z/'
wait                                # 父进程调用 wait 后僵尸消失
```

**批注**：僵尸不能 `kill`（它已经死了），只能"让父进程回收"或"杀掉父进程"（由 PID 1 接管并回收）。所以看到大量 `Z` 时，问题不在僵尸，而在**写出那段的程序**。

## 六、动手清单

```bash title="把本节结论跑一遍" command:("$":1-8)
ps -eo pid,ppid,stat,%cpu,cmd --sort=-%cpu | head      # 1. 读状态码
sleep 300 & ; jobs -l ; kill %1                        # 2. 作业控制
( sleep 5 & ); ps -eo stat,cmd | grep -c Z             # 3. 造僵尸（子 shell 退出后成孤儿/僵尸）
nice -n 10 sleep 1 & ; ps -o ni,cmd -p $!              # 4. nice 值生效
kill -HUP $$ ; echo "回来了吗"                          # 5. HUP 可被忽略（交互 shell 会退出，慎用）
kill -9 12345 2>/dev/null || echo '没这个 PID'          # 6. -9 的最后手段
nproc; uptime                                          # 7. 负载与核数对照
vmstat 1 2                                             # 8. r/b 两列的含义
```

## 小结

- `kill` 是"发信号"。`TERM` 可被忽略/优雅处理，`KILL` 不能被捕获——顺序永远是先 15 后 9。
- `ps` 的 `STAT` 是核心：`D` 卡在 IO（信号也无效）、`Z` 需父进程回收、`T` 是被暂停。
- 父目录作业控制靠 `&` / `Ctrl+Z`（TSTP）/ `jobs` / `fg` / `bg`；终端关闭时 `SIGHUP` 会杀掉整组作业。
- 长期运行用 `tmux` 或 `systemd`，不要依赖 `nohup`。
- 负载要除以核数才有意义；负载高而 CPU 空闲，先看 `%wa` 与 `D`。

## 下一节预告

下一节：环境变量与 shell 启动文件——`export` 的作用域、"登录 shell 与非登录 shell"加载文件的不同、为什么 `ssh host '命令'` 找不到你的 PATH 扩展，以及 `sudo` 默认会清空哪些环境。
