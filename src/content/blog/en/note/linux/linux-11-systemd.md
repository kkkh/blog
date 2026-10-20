---
title: 'Linux Basics 11: systemd — units, systemctl And journalctl Done Properly'
description: 'The unit types and the three-section structure, the eight systemctl commands worth memorising, a minimal service that actually restarts and starts at boot, how to filter with journalctl, and five traps people really hit — including the forgotten daemon-reload and systemd’s very clean PATH.'
link: linux-11-systemd
catalog: true
date: 2022-04-19 20:30:00
updated: 2022-04-19 22:10:00
categories: ['笔记']
tags: ['Linux', '基础']
draft: false
---

## What This Chapter Solves

“The service won’t start”, “my config change did nothing”, “it isn’t starting at boot” — on modern distributions almost all of it lives inside systemd, whose one central idea is the **unit**. Reading a single unit file teaches you more than memorising a pile of command names.

## 1. What systemd Manages: unit As A Universal Abstraction

| Type | Suffix | Purpose |
| --- | --- | --- |
| service | `.service` | a process or process group (by far the most common) |
| socket | `.socket` | on-demand activation (someone connects → the service is pulled up, saving memory) |
| timer | `.timer` | scheduled tasks (a cron replacement — see chapter 21) |
| target | `.target` | a group of units (roughly the old “runlevel”) |
| mount / path | `.mount` / `.path` | mounts and filesystem-change triggers |

```bash title="Survey the machine first" command:("$":1-5)
systemctl list-units --type=service --state=running | head
systemctl list-unit-files --state=enabled | head        # what starts at boot
systemctl is-active nginx; systemctl is-enabled nginx    # clean output, script-friendly
systemctl cat nginx                                      # the unit file plus drop-ins
systemctl show -p FragmentPath nginx                     # where the unit file actually lives
```

## 2. Eight Commands Worth Memorising, Plus Two Easy Confusions

```bash title="Lifecycle operations" command:("$":1-8)
systemctl start   app     # start now
systemctl stop    app     # stop now
systemctl restart app     # stop then start (interrupts connections)
systemctl reload  app     # reload config only (needs support; keeps existing connections)
systemctl status  app     # state plus recent log lines — always the first look
systemctl enable  app     # create symlinks so it starts at boot
systemctl disable app     # remove those symlinks
systemctl mask    app     # hard-disable (symlink to /dev/null: even start is refused)
```

Two distinctions that matter:

- **`enable` ≠ `start`**: `enable` only answers “should this run at boot”, it does not start it now. Combine with `systemctl enable --now app`.
- **`mask` is stronger than `disable`**: `disable` merely removes the boot link (you can still start it manually); `mask` refuses to start it at all — the right choice for “this must never be pulled up”.

```bash title="Inspect failures and reset them" command:("$":1-4)
systemctl --failed                        # every failed unit — stop one in troubleshooting
journalctl -u app -n 50 --no-pager        # recent log lines
systemctl reset-failed app                # clear the failure counter (otherwise restart logic stacks)
systemctl daemon-reload                   # ⭐ required after editing any unit file
```

## 3. A Minimal Service That Actually Works

Put it in `/etc/systemd/system/myworker.service`:

```ini title="/etc/systemd/system/myworker.service" mark:4,7-9
[Unit]
Description=My background worker
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=deploy
WorkingDirectory=/srv/worker
ExecStart=/usr/local/bin/worker.sh --loop
Restart=on-failure
RestartSec=3
EnvironmentFile=-/etc/default/myworker
TimeoutStopSec=20
KillSignal=SIGTERM

[Install]
WantedBy=multi-user.target
```

```bash title="Make it live" command:("$":1-3)
sudo systemctl daemon-reload            # 1) let systemd re-read the file
sudo systemctl enable --now myworker    # 2) enable at boot and start immediately
systemctl status myworker --no-pager    # 3) confirm
```

The fields that decide whether a service is *stable*:

| Field | Meaning | Notes |
| --- | --- | --- |
| `Type` | process model | `simple` (default, foreground), `forking` (old-style daemons), `oneshot` (runs and exits), `notify` (needs sd_notify) |
| `Restart` | policy after exit | `on-failure` (recommended), `always`, `no` |
| `RestartSec` | delay before restart | never 0, or you get a restart storm |
| `User` / `Group` | identity | **do not** run business processes as root |
| `EnvironmentFile=-…` | env file | the leading `-` means “missing file is not an error” |
| `WorkingDirectory` | cwd | relative-path traps start here |
| `TimeoutStopSec` | stop timeout | after this, the signal escalates to `KILL` |

:::warning
**Always use absolute paths in systemd.** `ExecStart=worker.sh` fails outright, because systemd never goes through your shell, and **its PATH is sparse: `/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin`** (chapter 08’s non-interactive environment in practice). Custom variables must be declared with `Environment=` / `EnvironmentFile=` — never expect `~/.bashrc` to be read.
:::

Logging: **stdout/stderr go straight into the journal**, so printing to standard output is enough — no log files, no logrotate needed.

```bash title="Everyday journalctl filters" command:("$":1-6)
journalctl -u myworker -f                 # follow (≈ tail -f)
journalctl -u myworker --since '1 hour ago'
journalctl -p err -b                      # errors and above, this boot
journalctl -b -1 -u myworker              # the previous boot — gold after a crash
journalctl --disk-usage                   # how much the journal occupies
journalctl --vacuum-time=7d               # keep only seven days
```

## 4. Five Traps People Actually Hit

1. **Editing a unit and forgetting `daemon-reload`** — the change simply appears to do nothing until systemd re-reads the file.
2. **Relative `ExecStart`** — `No such file or directory` even though the file exists (PATH, as above).
3. **`systemctl restart` interrupting service** — prefer `reload` when the daemon supports it (nginx’s `-s reload`, for example); it shrinks the interruption window.
4. **The wrong `Type`** — a foreground process with `Type=forking` makes systemd think the main process exited, producing a restart loop.
5. **The service cannot see your variables** — by design. systemd provides a clean environment; declare what you need.

## 5. Hands-On Checklist

```bash title="Practise on a test box" command:("$":1-6)
systemctl list-units --failed                      # 1. any failed units?
systemctl cat ssh                                  # 2. read a real unit (with drop-ins)
sudo tee /etc/systemd/system/hello.service >/dev/null <<'EOF'
[Unit]
Description=hello
[Service]
ExecStart=/bin/sleep 300
Restart=on-failure
[Install]
WantedBy=multi-user.target
EOF
sudo systemctl daemon-reload; sudo systemctl enable --now hello   # 3. reload + start at boot
systemctl status hello --no-pager; systemctl is-enabled hello      # 4. state and boot link
journalctl -u hello -n 10 --no-pager                     # 5. logs land in the journal
sudo systemctl disable --now hello; sudo systemctl reset-failed hello  # 6. clean up
```

## Summary

- The universal abstraction is the **unit**: `service` for work, `timer` for schedules, `socket` for on-demand activation.
- `enable` controls boot, `start` controls now; `enable --now` does both; `mask` is stronger than `disable`.
- After editing a unit you must `daemon-reload`; `ExecStart` must be absolute and the environment must be declared.
- Logs flow into `journalctl`; the four filters to remember are `-u`, `--since`, `-p err`, `-b -1`.
- Troubleshooting order: `systemctl --failed` → `status` → `journalctl -u`.

## Next Up

Disks and filesystems: what `lsblk -f`, `blkid` and `findmnt` each show, the six `fstab` fields and why UUIDs replace device names, why `mount -a` is mandatory after editing fstab, and the correct answer to “I deleted files but the space never came back”.
