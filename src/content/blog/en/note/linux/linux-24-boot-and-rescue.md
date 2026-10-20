---
title: 'Linux Basics 24: Boot And Rescue — UEFI, GRUB, initramfs And Emergency Mode'
description: 'The full boot chain from firmware to GRUB2 to kernel, initramfs and systemd, observing boot time with systemd-analyze, editing kernel parameters in GRUB to reach rescue mode, the standard root password reset, and how to repair emergency mode after a mistyped fstab plus the discipline that prevents it.'
link: linux-24-boot-and-rescue
catalog: true
date: 2022-05-02 20:30:00
updated: 2022-05-02 22:10:00
categories: ['笔记']
tags: ['Linux', '基础']
draft: false
---

## What This Chapter Solves

You edit `/etc/fstab`, reboot, and the machine stops in `emergency mode` — a wall of red text ending in `Give root password for maintenance`. Or you simply forgot the root password and need to reset it from the console. **Whether you get the machine back depends on knowing what the boot chain looks like and which link in it you can intervene in by hand.**

This chapter walks the boot sequence, then covers three rescue entry points and two classic rescue scenarios.

## 1. The Boot Chain

```text
power on → UEFI/BIOS self test → read a boot entry → boot loader (GRUB2)
     → load the kernel vmlinuz plus initramfs (a temporary root with drivers and unlock)
     → the kernel mounts the real root filesystem → systemd (PID 1) → the target
```

| Component | Role |
| --- | --- |
| firmware UEFI/BIOS | finds a boot device; the ESP is mounted at `/boot/efi`, FAT32 |
| GRUB2 | boot menu and kernel parameters; configured in `/boot/grub2/grub.cfg` |
| initramfs | a mini root filesystem that mounts the root, unlocks LUKS, loads drivers |
| systemd | brings services up to `multi-user.target` or `graphical.target` |

**Bottom line:** `/boot` holds two life-saving things — **a known-good older kernel** and **the GRUB menu**. When a new kernel will not boot, you can select the old one and fix things from there. Keeping them matters more than anything.

## 2. Observing Boot

```bash title="How long boot takes, and where it hangs" command:("$":1-5)
systemd-analyze                     # total kernel plus userspace time
systemd-analyze blame | head        # per-service time, ranked
systemd-analyze critical-chain      # the critical path — what delayed the trunk
cat /proc/cmdline                    # this boot's kernel parameters
journalctl -b -1 -p err             # errors from the previous boot — check after a crash
```

## 3. Rescue: Editing Kernel Parameters In GRUB

Select an entry in the GRUB menu, press `e`, and append to the `linux` line:

| Parameter | Purpose |
| --- | --- |
| `single` or `1` | single-user, old SysV semantics, roughly rescue on systemd |
| `rd.break` | **stop** at an initramfs shell, before the real root is mounted |
| `init=/bin/bash` | boot straight into bash, **skipping systemd** |
| `systemd.unit=rescue.target` | reach the rescue target, local mounts, few services |
| `rw` or `ro` | mount the root filesystem writable or read-only first |

**Note:** `rd.break` stops in initramfs, where **the real root is still mounted at `/sysroot`**; `init=/bin/bash` boots with the root mounted but **no other services running**. Which you choose depends on whether you are fixing something before the root is mounted or after boot.

## 4. Resetting The Root Password (RHEL-Family Standard)

```bash title="Requires physical or console access" command:("$":1-6) mark:6
# 1) In the GRUB menu press e, append rd.break to the linux line, then Ctrl-x to boot
# 2) At the initramfs shell:
mount -o remount,rw /sysroot        # mount the real root writable
chroot /sysroot                     # switch into the real root
passwd root                         # change the password
touch /.autorelabel                 # force SELinux relabelling on the next boot
exit                                # leave the chroot
```

```bash title="Then reboot" command:("$":1)
reboot
```

**Why `touch /.autorelabel` is mandatory:** editing `/etc/shadow` from initramfs leaves the SELinux context wrong; without a relabel, **the new password may actually lock you out**. This is the step people most often miss.

:::warning
This procedure **assumes you can physically reach the machine or enter its console** (cloud hosts via VNC or serial console). It is available to anyone with hardware access, so datacenter physical security and cloud console permissions *are* the security boundary — do not treat "change a password and walk in" as a given.
:::

## 5. A Mistyped fstab → emergency mode

A typo in `/etc/fstab` points at a UUID that does not exist, systemd cannot mount it, and the boot lands in emergency mode:

```bash title="Fixing it on the spot" command:("$":1-6) mark:5
# after the emergency shell (or by entering the root password for maintenance):
journalctl -xb | grep -i -E 'failed|fstab|mount' | tail -30   # find the offending line
mount -o remount,rw /                                          # the root is usually read-only here
vi /etc/fstab                                                  # comment out or fix the bad line
mount -a                                                       # verify every entry mounts
systemctl default                                              # continue to the default target
```

**Note:** `mount -a` is **mandatory** after editing fstab — it tries every entry once and **fails loudly right there** if something is wrong, instead of dropping you into emergency mode on the next reboot. Chapter 12 stressed the same point about UUIDs.

## 6. Discipline

- Before touching `/etc/fstab` or boot parameters, run `mount -a` or verify on a test machine.
- Always keep **at least one known-good older kernel** (`dnf install kernel` can install several in parallel, visible in the GRUB menu).
- Before modifying the boot chain, memorise the three entry points: `e` to edit, `rd.break`, and `init=/bin/bash` — know how to get in and how to get back out.

## 7. Hands-On Checklist

```bash title="Practise (snapshot first, or use a VM)" command:("$":1-6)
systemd-analyze; systemd-analyze blame | head         # 1. boot timing
systemd-analyze critical-chain | head                  # 2. the critical path
cat /proc/cmdline                                      # 3. current kernel parameters
ls /boot/vmlinuz-* /boot/initramfs-* 2>/dev/null       # 4. which kernels are installed
systemctl get-default                                  # 5. the default target
sudo findmnt --verify --verbose | head                 # 6. validate the fstab entries
```

## Summary

- The chain: firmware → **GRUB2** → kernel plus **initramfs** → **systemd** → target; the ESP lives at `/boot/efi`.
- `systemd-analyze` (`blame`, `critical-chain`) shows timing; `/proc/cmdline` shows this boot's parameters; `journalctl -b -1` shows the last boot.
- Rescue entry points: in GRUB press `e` and add `single`, `rd.break`, `init=/bin/bash` or `systemd.unit=rescue.target`.
- Root reset: `rd.break` → `mount -o remount,rw /sysroot` → `chroot` → `passwd` → **`touch /.autorelabel`** → `exit`.
- Emergency mode from fstab: `journalctl -xb` to find the error → `remount,rw /` → fix fstab → **`mount -a` to verify** → `systemctl default`.
- Discipline: validate before touching fstab or boot parameters, and always keep a known-good older kernel.

## Next Up

The final chapter wraps the series: four pre-flight checklists, a symptom-to-first-command table, the directions worth going deeper into, and a debugging methodology you can keep using.
