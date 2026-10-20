---
title: 'Linux 基础 23：容器与内核边界——namespace、cgroup 与 docker exec 背后'
description: '容器为什么是普通进程而不是虚拟机、六种 namespace 各自隔离了什么、用 ls -l /proc/<pid>/ns 看进程归属、docker exec 与 nsenter 的关系、cgroup v1/v2 的资源限额文件，以及 docker 组为何几乎等于 root。'
link: linux-23-containers-and-kernel-boundaries
catalog: true
date: 2022-05-01 20:30:00
updated: 2022-05-01 22:10:00
categories: ['笔记']
tags: ['Linux', '基础']
draft: false
---

## 这一节要解决什么

`docker run` 进去以后 `ps aux` 只看得见一个进程，`uname` 却和宿主机一模一样；容器里把 CPU 限到半个核，宿主机的 `top` 却看不到那个限制；删掉容器里的 `/etc` 也伤不到宿主。这些矛盾只有一个解释——**容器是内核特性搭出来的"隔离视图"，不是一台小机器**。

这一节从内核机制出发，把容器拆成两样东西：**namespace（看见了什么）** 与 **cgroup（能用多少）**，然后看 `docker exec` 在背后到底做了什么。

## 一、容器是被限制的普通进程

```text
宿主机: PID 1 (systemd)
         └─ containerd / dockerd
             └─ <你的进程>     ← 在宿主上就是一个普通 PID，只是多了几层“滤镜”
```

**关键结论**：容器**共享宿主机内核**——所以 `uname -r` 一样；镜像里根本没有"内核"，只有一套用户态文件系统；一旦内核有逃逸漏洞，威胁的是整个宿主机。这一点与虚拟机（自己跑一整套内核）是本质区别。

## 二、六种 namespace

| namespace | 隔离了什么 |
| --- | --- |
| `mnt` | 挂载点与文件系统视图，镜像"分层文件系统"的来源 |
| `pid` | 进程号，容器内的 PID 1 是它的第一个进程 |
| `net` | 网卡、IP、端口、路由表，容器有独立一套 |
| `uts` | 主机名与域名 |
| `ipc` | SysV IPC、共享内存 |
| `user` | 用户与组 ID 的映射，容器里的 root 未必是宿主 root |

**关键结论**：`pid` namespace 让容器内看不到外面的一堆进程，`net` namespace 让容器有独立的端口空间——这正是"容器里 `ss -ltnp` 只看到自己"的原因。

## 三、看进程在哪些 namespace 里，以及 `nsenter`

```bash title="从宿主视角看容器进程" command:("$":1-5)
pid=$(docker inspect -f '{{.State.Pid}}' myapp)
ls -l /proc/$pid/ns/               # 它在哪些 namespace 里
sudo nsenter -t $pid -n ss -ltnp   # 进它的 net namespace 看端口
sudo nsenter -t $pid -m ls /       # 进它的 mnt namespace 看根文件系统
sudo nsenter -t $pid -a /bin/sh    # 一次进全部 namespace
```

**关键结论**：`docker exec` 做的事，本质上和 `nsenter` 一样——**进入目标容器那几个 namespace，再起一个新进程**。理解这点，就明白 `exec` 为什么能"看到容器的世界"、又为什么它起的进程会出现在宿主的 `ps` 里。

**批注**：`ls -l /proc/<pid>/ns/` 里每个 namespace 用一个 inode 号表示；**两个进程 inode 相同就是同处一个 namespace**。同一个 pod 里的容器共享 `net` namespace，就是这么看出来的。

## 四、cgroup：真正的资源限额

```bash title="cgroup v2 的限额文件" command:("$":1-5)
cat /sys/fs/cgroup/system.slice/cpu.max         # "200000 100000" = 2 核上限
cat /sys/fs/cgroup/system.slice/memory.max      # 上限字节；max 表示不限
cat /sys/fs/cgroup/system.slice/memory.current  # 当前用量
echo 536870912 | sudo tee /sys/fs/cgroup/system.slice/memory.max   # 临时改（可写接口）
systemd-cgtop                                   # 按 cgroup 看 CPU 与内存排行
```

| 版本 | 特征 |
| --- | --- |
| v1 | 各子系统独立挂载，文件如 `cpu.cfs_quota_us`、`tasks` |
| v2 | 单一层级树，文件如 `cpu.max`、`memory.max`、`memory.current` |

**批注**：`docker run --memory=512m --cpus=0.5` 最终就是往 cgroup 文件里写值。**容器里 `free` 看到的是宿主内存**（内存总量没有被隔离），要看限制得读 `memory.max`、看用量得读 `memory.current`。

## 五、安全边界

- **`docker` 组约等于 root**：成员可以 `docker run -v /:/host` 挂载宿主根目录，等于拿到整台机器。别把普通用户随手加进这个组。
- `--privileged`：几乎关闭所有限制（给全部 capabilities、可访问所有设备），只该用于明确的系统级容器。
- `:ro` 只读挂载、`--cap-drop=ALL`、`--read-only` 都是**收窄边界**的常规手段，呼应第 15 节的 capabilities。
- `user` namespace 让容器内的 root 与宿主 root **不是同一个**，是少见的"降权"隔离。

:::warning
`unshare`、`nsenter` 这类命令能直接切换命名空间视角，在**生产机上乱试可能让进程看到不该看的东西，或误改宿主配置**。要练手请在独占的测试机或虚拟机里做。
:::

## 六、动手清单

```bash title="用一个临时容器练" command:("$":1-7)
docker run -d --rm --name demo -m 512m --cpus=0.5 nginx    # 1. 起一个带限额的容器
pid=$(docker inspect -f '{{.State.Pid}}' demo); echo $pid  # 2. 拿到宿主上的 PID
sudo ls -l /proc/$pid/ns/                                  # 3. 它所在的 namespace
sudo nsenter -t $pid -n ss -ltnp                           # 4. 进它的网络视角
cat /sys/fs/cgroup/system.slice/docker-*.scope/memory.max  # 5. 它的内存上限
systemd-cgtop -1 | head                                    # 6. cgroup 资源排行
docker exec demo ps aux                                    # 7. 容器内看到的进程
```

## 小结

- 容器是**被 namespace 隔离视图加 cgroup 限额**的普通进程，共享宿主内核，不是虚拟机。
- 六种 namespace：`mnt`、`pid`、`net`、`uts`、`ipc`、`user`，分别隔离文件系统视图、进程号、网络、主机名、IPC 与用户映射。
- `/proc/<pid>/ns/` 看归属，inode 相同即同处一个 namespace；`docker exec` 约等于 `nsenter` 进目标 namespace 再起进程。
- 资源限制在 **cgroup**：v2 看 `cpu.max`、`memory.max`、`memory.current`，`systemd-cgtop` 看排行。
- **`docker` 组几乎等于 root**；`--privileged` 要慎用，`:ro` 与 `--cap-drop=ALL` 才是收窄边界的常规做法。
- `nsenter`、`unshare` 很强大也很危险，只在测试环境练。

## 下一节预告

下一节：启动流程与救援——UEFI 到 GRUB2 再到内核、initramfs 与 systemd 这条链、在 GRUB 里改内核参数进救援模式、root 密码重置，以及 fstab 写错掉进 emergency mode 怎么救回来。
