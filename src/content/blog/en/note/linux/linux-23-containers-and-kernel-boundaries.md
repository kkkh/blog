---
title: 'Linux Basics 23: Containers And Kernel Boundaries — Namespaces, Cgroups And What docker exec Does'
description: 'Why a container is an ordinary process and not a virtual machine, what each of the six namespaces isolates, reading a process ownership with ls -l /proc/<pid>/ns, how docker exec relates to nsenter, cgroup v1 and v2 limit files, and why the docker group is effectively root.'
link: linux-23-containers-and-kernel-boundaries
catalog: true
date: 2022-05-01 20:30:00
updated: 2022-05-01 22:10:00
categories: ['笔记']
tags: ['Linux', '基础']
draft: false
---

## What This Chapter Solves

Inside `docker run`, `ps aux` shows a single process, yet `uname` matches the host exactly; you cap a container at half a CPU and the host's `top` shows no such limit; wiping `/etc` inside the container does not touch the host. These contradictions have one explanation — **a container is an isolated view built from kernel features, not a small machine**.

This chapter starts from the kernel mechanisms and splits a container into two parts: **namespaces (what it can see)** and **cgroups (how much it may use)** — then shows what `docker exec` really does underneath.

## 1. A Container Is A Constrained Ordinary Process

```text
host: PID 1 (systemd)
        └─ containerd / dockerd
            └─ <your process>     ← on the host it is just an ordinary PID, plus a few “filters”
```

**Bottom line:** containers **share the host kernel** — that is why `uname -r` matches. An image carries no kernel at all, only a userspace filesystem; and a kernel escape vulnerability threatens the whole host. That is the fundamental difference from a virtual machine, which runs its own kernel.

## 2. The Six Namespaces

| namespace | What it isolates |
| --- | --- |
| `mnt` | mount points and the filesystem view behind layered images |
| `pid` | process IDs; PID 1 inside the container is its first process |
| `net` | interfaces, IPs, ports and routes; the container has its own stack |
| `uts` | hostname and domain name |
| `ipc` | SysV IPC and shared memory |
| `user` | mapping of user and group IDs; root inside need not be host root |

**Bottom line:** the `pid` namespace hides the host's process list from inside, and the `net` namespace gives the container its own port space — exactly why `ss -ltnp` inside a container only sees the container itself.

## 3. Seeing Which Namespaces A Process Is In, And `nsenter`

```bash title="Look at a container process from the host" command:("$":1-5)
pid=$(docker inspect -f '{{.State.Pid}}' myapp)
ls -l /proc/$pid/ns/               # which namespaces it belongs to
sudo nsenter -t $pid -n ss -ltnp   # enter its net namespace and list ports
sudo nsenter -t $pid -m ls /       # enter its mnt namespace and see the root filesystem
sudo nsenter -t $pid -a /bin/sh    # enter all namespaces at once
```

**Bottom line:** what `docker exec` does is essentially the same as `nsenter` — **enter the target container's namespaces and start a new process**. Grasp that and you understand why `exec` "sees the container's world", and why the process it starts shows up in the host's `ps`.

**Note:** each namespace in `ls -l /proc/<pid>/ns/` is represented by an inode number; **two processes with the same inode share a namespace**. That is exactly how you can tell that containers in one pod share a `net` namespace.

## 4. cgroups: Where The Real Limits Live

```bash title="cgroup v2 limit files" command:("$":1-5)
cat /sys/fs/cgroup/system.slice/cpu.max         # "200000 100000" means a 2-core cap
cat /sys/fs/cgroup/system.slice/memory.max      # the byte limit; max means unlimited
cat /sys/fs/cgroup/system.slice/memory.current  # current usage
echo 536870912 | sudo tee /sys/fs/cgroup/system.slice/memory.max   # temporary change via the writable interface
systemd-cgtop                                   # CPU and memory ranking by cgroup
```

| Version | Characteristics |
| --- | --- |
| v1 | each subsystem mounted separately, files such as `cpu.cfs_quota_us`, `tasks` |
| v2 | a single hierarchy, files such as `cpu.max`, `memory.max`, `memory.current` |

**Note:** `docker run --memory=512m --cpus=0.5` ultimately writes values into cgroup files. **`free` inside a container reports host memory** (total memory is not namespaced); for the limit read `memory.max`, for current usage read `memory.current`.

## 5. Security Boundaries

- **The `docker` group is effectively root**: a member can `docker run -v /:/host` and mount the host root, which is the whole machine. Do not add ordinary users to it casually.
- `--privileged`: turns off almost every restriction (all capabilities, access to all devices); reserve it for genuinely system-level containers.
- `:ro` read-only mounts, `--cap-drop=ALL` and `--read-only` are the routine ways to **narrow the boundary**, echoing the capabilities discussion in chapter 15.
- The `user` namespace makes root inside the container **a different identity** from host root — an uncommon but genuine way to drop privilege.

:::warning
Commands such as `unshare` and `nsenter` switch namespace views directly, and **experimenting with them on a production host can let a process see things it should not, or modify host configuration by accident**. Do this on a dedicated test machine or VM.
:::

## 6. Hands-On Checklist

```bash title="Practise with a throwaway container" command:("$":1-7)
docker run -d --rm --name demo -m 512m --cpus=0.5 nginx    # 1. start a limited container
pid=$(docker inspect -f '{{.State.Pid}}' demo); echo $pid  # 2. get its host PID
sudo ls -l /proc/$pid/ns/                                  # 3. the namespaces it sits in
sudo nsenter -t $pid -n ss -ltnp                           # 4. enter its network view
cat /sys/fs/cgroup/system.slice/docker-*.scope/memory.max  # 5. its memory limit
systemd-cgtop -1 | head                                    # 6. cgroup resource ranking
docker exec demo ps aux                                    # 7. the processes seen inside the container
```

## Summary

- A container is **an ordinary process with namespace-isolated views and cgroup limits**, sharing the host kernel — not a virtual machine.
- Six namespaces: `mnt`, `pid`, `net`, `uts`, `ipc`, `user`, isolating filesystem view, process IDs, networking, hostname, IPC, and user/group mappings.
- `/proc/<pid>/ns/` shows ownership, and identical inodes mean a shared namespace; `docker exec` is roughly `nsenter` into the target's namespaces and starting a process.
- Limits live in **cgroups**: on v2 read `cpu.max`, `memory.max`, `memory.current`; use `systemd-cgtop` for ranking.
- **The `docker` group is close to root**; be careful with `--privileged`, and use `:ro` and `--cap-drop=ALL` to narrow boundaries.
- `nsenter` and `unshare` are powerful and dangerous — practise them only in a test environment.

## Next Up

Boot and rescue: the chain from UEFI to GRUB2 to the kernel, initramfs and systemd, editing kernel parameters in GRUB to reach rescue mode, resetting a root password, and recovering from emergency mode when fstab is mistyped.
