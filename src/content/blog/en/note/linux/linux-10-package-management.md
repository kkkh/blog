---
title: 'Linux Basics 10: Package Management — What apt Actually Does, And The Four Common Errors'
description: 'What happens between apt update and install, the data directories behind dpkg/apt, finding a file’s package with dpkg -S, pinning versions, the real causes of four frequent errors, and the dnf equivalents on RHEL.'
link: linux-10-package-management
catalog: true
date: 2022-04-18 20:30:00
updated: 2022-04-18 22:10:00
categories: ['笔记']
tags: ['Linux', '基础']
draft: false
---

## What This Chapter Solves

Everyone can type `apt install`; far fewer can read its errors at a glance. This chapter explains the three data directories, when dependency resolution happens, and the true causes behind four frequent messages: `Unable to locate package`, `held broken packages`, `Could not get lock`, and `unmet dependencies`.

## 1. What Happens Between `apt update` And `install`

```bash title="The standard two steps" command:("$":1-3)
sudo apt update           # 1) pull indexes from /etc/apt/sources.list* → /var/lib/apt/lists
apt-cache policy nginx    # 2) which versions exist, and from which repository
sudo apt install nginx    # 3) resolve deps → download .deb → dpkg installs → postinst scripts run
```

The directories, so you know where to look when something fails:

| Path | Contains | Maintained by |
| --- | --- | --- |
| `/etc/apt/sources.list`, `sources.list.d/` | **repository URLs** (hand-written) | you |
| `/var/lib/apt/lists/` | cached repository indexes | `apt update` |
| `/var/cache/apt/archives/` | downloaded `.deb` files | `apt` (`apt clean` clears them) |
| `/var/lib/dpkg/` | **database of installed packages** (`status`) | `dpkg` |

**Note:** `apt` is the **higher layer** (dependencies, repositories, downloads) and `dpkg` is the **actual installer** (unpacking, installing, maintaining the database). So `dpkg: error processing …` means the lower layer, while `Unable to locate package` means the index/repository layer.

## 2. Queries: What Is Installed, Who Owns A File

```bash title="Five query moves" command:("$":1-5)
apt list --installed 2>/dev/null | wc -l        # how many packages
apt-cache policy nginx                          # Candidate / Installed / origins
apt show nginx | head -12                       # description, dependencies, size
dpkg -l | grep -i nginx                          # installed version (ii = healthy)
dpkg -S "$(command -v ls)"                       # ⭐ which package owns this file
```

```bash title="Pinning versions: three levels" command:("$":1-6)
sudo apt-mark hold nginx        # the simplest: do not upgrade this one package
apt-mark showhold               # list held packages
sudo apt-mark unhold nginx
# For mixed sources (official + third-party), control priority with a pin:
# /etc/apt/preferences.d/10-nginx-pin
# Package: nginx
# Pin: origin nginx.org
# Pin-Priority: 900
```

**Note:** `apt-mark hold` means “**skip it during upgrades**”, not “freeze this exact version forever”. To pin a version use `apt install nginx=1.18.0-0ubuntu1` (available versions from `apt-cache policy`) and use preferences to control priority.

## 3. Four Frequent Errors: Cause And Order Of Investigation

### 1. `Unable to locate package xxx`

```bash title="Three-step diagnosis" command:("$":1-3)
sudo apt update                     # ① the classic cause: stale or never-pulled indexes
apt-cache policy xxx                # ② is the package in any source at all?
grep -r . /etc/apt/sources.list*    # ③ is the repo enabled, is the suite right (jammy vs noble)?
```

Other possibilities: wrong architecture (`amd64`/`arm64`), typo in the name, or a missing component such as `universe`.

### 2. `The following packages have been kept back` / `held broken packages`

```bash title="Read the Candidate line" command:("$":1-2) mark:2
apt-cache policy the-conflicting-package
# Candidate empty or older than Installed → a dependency is holding it back
apt list --upgradable 2>/dev/null         # which packages are kept back
```

Typical causes: a held package, a third-party source offering a newer version that breaks dependencies, or phased updates. Do not brute-force with `--force`; read the Version table first.

### 3. `Could not get lock /var/lib/dpkg/lock-frontend`

```bash title="Find out who holds the lock" command:("$":1-4)
ps aux | grep -E 'apt|dpkg' | grep -v grep
sudo fuser -v /var/lib/dpkg/lock-frontend
systemctl status unattended-upgrades     # the automatic updater is often the culprit
sudo lsof /var/lib/dpkg/lock-frontend
```

**Note:** the usual cause is not a crashed apt leaving a lock behind — it is **`unattended-upgrades` running in the background**. The right move is to wait for it (or `systemctl stop unattended-upgrades` and retry), never to `rm` the lock file: deleting locks can corrupt the dpkg database.

### 4. `Unmet dependencies` / `dpkg: error processing`

```bash title="Repairs" command:("$":1-3)
sudo apt --fix-broken install       # let apt complete the missing dependencies
sudo dpkg --configure -a            # reconfigure packages that failed in the configure phase
apt-cache policy the-package         # check the version and its origin
```

## 4. Third-Party Sources And Keys (`apt-key` Is Dead)

```bash title="Adding a third-party repo the modern way" command:("$":1-4)
sudo install -d /etc/apt/keyrings
curl -fsSL https://example.com/key.asc | sudo gpg --dearmor -o /etc/apt/keyrings/example.gpg
echo "deb [signed-by=/etc/apt/keyrings/example.gpg] https://repo.example.com stable main" \
  | sudo tee /etc/apt/sources.list.d/example.list
sudo apt update
```

**Note:** any tutorial still telling you to run `apt-key add` is out of date — it puts the key into **global** trust, which is the same as trusting every repository with that key. `signed-by` scopes the trust to one repository.

## 5. The RHEL Side, Side By Side

| Goal | Debian/Ubuntu | RHEL/Rocky |
| --- | --- | --- |
| Refresh indexes | `apt update` | `dnf makecache` (`dnf check-update` also refreshes) |
| Install | `apt install nginx` | `dnf install nginx` |
| File → package | `dpkg -S /usr/bin/ls` | `rpm -qf /usr/bin/ls` |
| Package contents | `dpkg -L nginx` | `rpm -ql nginx` |
| History | `/var/log/dpkg.log`, `apt history` | `dnf history` (`dnf history undo` rolls back) |
| Groups/modules | (metapackages) | `dnf group list`, `dnf module list` |

## 6. Two Production Rules (My Notes)

```bash title="Do not do these" command:("$":1-2)
sudo apt upgrade -y            # ❌ blind full upgrades: kernel, glibc, databases can jump major versions
cat /var/run/reboot-required    # ✅ after upgrading, check whether a reboot is needed
```

- Automatic security updates: use `unattended-upgrades` with **only the security suite** enabled, never all suites:
  ```bash title="Security updates only" command:("$":1) mark:1
  # in /etc/apt/apt.conf.d/50unattended-upgrades keep only *-security
  ```
- Before upgrading, review `apt list --upgradable` and look specifically at `nginx`, `mysql-server`, `linux-image-*`; hold them if the change is not wanted yet.

## 7. Hands-On Checklist

```bash title="Run the whole chapter" command:("$":1-7)
apt-cache policy bash | head -8          # 1. Candidate / Installed / origins
dpkg -S "$(command -v ls)"               # 2. file ownership
dpkg -L coreutils | head                 # 3. package contents
apt-mark hold bash; apt-mark showhold    # 4. hold and inspect (unhold afterwards)
sudo apt --fix-broken install            # 5. dependency repair (idempotent)
ls /var/lib/apt/lists | wc -l            # 6. the index cache that update writes
ls /var/cache/apt/archives/*.deb 2>/dev/null | wc -l    # 7. the .deb cache
```

## Summary

- `apt` handles dependencies, repositories and downloads; `dpkg` handles unpacking and the database. Identify the layer before fixing.
- `dpkg -S` gives file ownership (`rpm -qf` on RHEL); `apt-cache policy` gives candidate versions.
- Pin versions with `apt-mark hold` (simple) or a preferences pin (mixed sources).
- For lock errors, find the **holder** (often `unattended-upgrades`); never delete lock files.
- Avoid blind upgrades in production, and check `/var/run/reboot-required` afterwards.

## Next Up

Service management: what a systemd unit is, the eight `systemctl` subcommands worth memorising, how to filter with `journalctl`, and how this division of labour compares with SysV init and cron.
