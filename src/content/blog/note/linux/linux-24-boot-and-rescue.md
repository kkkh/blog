---
title: 'Linux 基础 24：启动流程与救援——UEFI、GRUB、initramfs 与 emergency mode'
description: '从固件到 GRUB2 再到内核、initramfs、systemd 的完整启动链、用 systemd-analyze 观察启动、在 GRUB 里改内核参数进救援模式、root 密码重置流程，以及 fstab 写错掉进 emergency mode 的修复步骤与预防纪律。'
link: linux-24-boot-and-rescue
catalog: true
date: 2022-05-02 20:30:00
updated: 2022-05-02 22:10:00
categories: ['笔记']
tags: ['Linux', '基础']
draft: false
---

## 这一节要解决什么

改完 `/etc/fstab` 重启，机器卡在 `emergency mode`，一屏红字末尾一句 `Give root password for maintenance`；或者单纯忘了 root 密码，需要从控制台进去重置。**这时候能不能救回来，取决于你懂不懂启动链条长什么样、以及那条链上哪一环是可以手动干预的。**

这一节先把启动流程走一遍，再讲三个救援入口和两个经典救援场景。

## 一、启动链条

```text
通电 → UEFI/BIOS 自检 → 读启动项 → 引导器（GRUB2）
     → 载入内核 vmlinuz 加 initramfs（临时根，含驱动与解密）
     → 内核挂真正的根文件系统 → systemd (PID 1) → 目标 target
```

| 组件 | 作用 |
| --- | --- |
| 固件 UEFI/BIOS | 找启动设备；ESP 分区挂在 `/boot/efi`，FAT32 格式 |
| GRUB2 | 启动菜单与内核参数；配置在 `/boot/grub2/grub.cfg` |
| initramfs | 迷你根文件系统，负责挂载根、LUKS 解密、加载驱动 |
| systemd | 拉起服务到达 `multi-user.target` 或 `graphical.target` |

**关键结论**：`/boot` 里有两样"救命"的东西——**已知可用的旧内核**和 **GRUB 菜单**。新内核起不来时，能在菜单里选旧的进去修。留着它们，比什么都重要。

## 二、观察启动

```bash title="看启动花了多久、卡在哪" command:("$":1-5)
systemd-analyze                     # 内核加用户态总耗时
systemd-analyze blame | head        # 各服务耗时排行
systemd-analyze critical-chain      # 关键路径，哪一步拖住了主线
cat /proc/cmdline                    # 本次启动的内核参数
journalctl -b -1 -p err              # 上次开机的错误，崩溃后查这个
```

## 三、救援：在 GRUB 里改内核参数

GRUB 菜单里选中条目按 `e` 编辑，在 `linux` 那一行末尾追加：

| 参数 | 用途 |
| --- | --- |
| `single` 或 `1` | 进单用户，旧 SysV 语义，systemd 上约等于 rescue |
| `rd.break` | 在 initramfs 阶段**停下**一个 shell，此时还没挂真正的根 |
| `init=/bin/bash` | 内核直接起 bash，**跳过 systemd** |
| `systemd.unit=rescue.target` | 到 rescue 目标，本地已挂载、少量服务 |
| `rw` 或 `ro` | 根文件系统先挂成可写或只读 |

**批注**：`rd.break` 停在 initramfs 阶段，此时**真正的根还挂在 `/sysroot`**；`init=/bin/bash` 则已经挂了根，但**没有其他服务在跑**。选哪个，取决于你要修的是"挂根之前"还是"起来之后"的问题。

## 四、root 密码重置（RHEL 系标准流程）

```bash title="需要物理或控制台访问" command:("$":1-6) mark:6
# 1) GRUB 菜单按 e，在 linux 行末尾加 rd.break，然后 Ctrl-x 启动
# 2) 停在 initramfs shell 后：
mount -o remount,rw /sysroot        # 把真正的根挂成可写
chroot /sysroot                     # 切进真正的根
passwd root                         # 改密码
touch /.autorelabel                 # 让下次启动重打 SELinux 标签
exit                                # 退出 chroot
```

```bash title="然后重启" command:("$":1)
reboot
```

**为什么必须 `touch /.autorelabel`**：在 initramfs 里改了 `/etc/shadow`，SELinux 上下文会不对；不重打标签，**改完密码可能反而登不进去**。这一条是整套流程最容易漏的。

:::warning
这套流程的**前提是你能物理接触机器或进控制台**（云主机走 VNC 或串口控制台）。它对任何能接触硬件的人开放，所以机房物理安全、云主机控制台权限本身就是安全边界——别把"改个密码就能进"当成理所当然。
:::

## 五、fstab 写错 → emergency mode

改 `/etc/fstab` 手滑写了个不存在的 UUID，重启后 systemd 挂不上，掉进 emergency mode：

```bash title="现场抢救" command:("$":1-6) mark:5
# 在 emergency shell（或输 root 密码进 maintenance）之后：
journalctl -xb | grep -i -E 'failed|fstab|mount' | tail -30   # 找到报错那一行
mount -o remount,rw /                                          # 根通常是只读挂进来的
vi /etc/fstab                                                  # 注释掉或修好坏行
mount -a                                                       # 先验证所有条目都能挂
systemctl default                                              # 回到默认 target 继续启动
```

**批注**：`mount -a` 是改完 fstab 后**必须**的一步——它一次性把所有条目试挂一遍，写得不对**当场报错**，而不是等下次重启掉进 emergency。第 12 节讲 UUID 时就强调过这条。

## 六、纪律

- 改 `/etc/fstab` 或引导参数前，先 `mount -a` 或在测试机上验证。
- 保底**至少留一个已知可用的旧内核**（`dnf install kernel` 可并存多版本，GRUB 菜单里就能选）。
- 动引导链之前，记住三个入口：`e` 编辑、`rd.break`、`init=/bin/bash`——知道进哪儿，也知道怎么退。

## 七、动手清单

```bash title="练手（先拍快照或在虚拟机里）" command:("$":1-6)
systemd-analyze; systemd-analyze blame | head         # 1. 启动耗时
systemd-analyze critical-chain | head                  # 2. 关键路径
cat /proc/cmdline                                      # 3. 当前内核参数
ls /boot/vmlinuz-* /boot/initramfs-* 2>/dev/null       # 4. 装了哪些内核
systemctl get-default                                  # 5. 默认 target
sudo findmnt --verify --verbose | head                 # 6. 校验 fstab 条目
```

## 小结

- 启动链：固件 → **GRUB2** → 内核加 **initramfs** → **systemd** → target；ESP 分区在 `/boot/efi`。
- `systemd-analyze`（`blame`、`critical-chain`）看耗时；`/proc/cmdline` 看本次参数；`journalctl -b -1` 看上次开机。
- 救援入口：GRUB 按 `e` 加 `single`、`rd.break`、`init=/bin/bash` 或 `systemd.unit=rescue.target`。
- root 重置：`rd.break` → `mount -o remount,rw /sysroot` → `chroot` → `passwd` → **`touch /.autorelabel`** → `exit`。
- fstab 写错进 emergency：`journalctl -xb` 找错 → `remount,rw /` → 修 fstab → **`mount -a` 验证** → `systemctl default`。
- 纪律：改 fstab 或引导前先验证，永远留一个已知可用的旧内核。

## 下一节预告

下一节是本系列收尾——四张上线前的自查清单、一张"现象到首选命令"的对照表，以及继续深入的方向与一条可以长期沿用的排障方法论。
