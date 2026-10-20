---
title: 'Linux Basics 20: Shell Scripting, Part Two — trap, Logging, Idempotence And Locking'
description: 'Functions and local, the difference between return and exit, using trap to guarantee cleanup on the way out, a single logging function with an exec redirect, idempotent and atomic writes, using flock so a script never runs twice, and a complete runnable backup script explained line by line.'
link: linux-20-shell-scripting-advanced
catalog: true
date: 2022-04-28 20:30:00
updated: 2022-04-28 22:10:00
categories: ['笔记']
tags: ['Linux', '基础']
draft: false
---

## What This Chapter Solves

A nightly backup script ran twice one day — a leftover cron entry was not the only trigger, I also clicked it by hand, and both wrote the same destination directory at once, corrupting data. Another day it was interrupted midway and left a half-written temp file and a lock nobody released, so it never ran again.

The previous chapter was about getting a script right **once**. This one is about making it **safe to run repeatedly**: functions, `trap`, consistent logging, idempotence, a concurrency lock, and finally a backup script you can put to work.

## 1. Functions: `local`, `return` And `exit`

```bash title="Functions and scope" command:("$":1-6)
log() { printf '[%s] %s\n' "$(date '+%F %T')" "$*"; }

work() {
  local tmp=${1:?need an argument}   # local is visible only inside this function
  echo "$tmp"
  return 0                            # hand a status code back to the caller
}

work "x" || exit 1                    # let the return value decide whether to continue
```

**The key difference:** `return` ends only the **current function** and hands back a status code (0–255); `exit` **ends the whole script**. Call `exit` inside a function and the caller never gets a chance to tidy up.

## 2. `trap`: Guarantee The Scene Is Cleared

```bash title="Cleaning up temporary files" command:("$":1-4)
tmp=$(mktemp -d)
cleanup() { rm -rf "$tmp"; }
trap cleanup EXIT                # fires on normal exit, on error, and on Ctrl-C
trap 'echo interrupted; exit 130' INT
```

| Signal | When it fires |
| --- | --- |
| `EXIT` | when the script exits, error exits included |
| `ERR` | when a command fails, in combination with `set -e` |
| `INT` / `TERM` | on Ctrl-C / `kill` |

**Note:** an `EXIT` trap is the standard home for fallback cleanup. I put temp directories, lock files and background PIDs all in one place — **far more reliable than hand-writing cleanup before every `exit`**.

## 3. Logging: One Function And One Redirect

```bash title="Consistent logging" command:("$":1-3)
log() { printf '[%s] %s\n' "$(date '+%F %T')" "$*"; }
log "start backup"
exec > >(tee -a /var/log/backup.log) 2>&1   # every later line goes to file and terminal
```

After `exec > >(tee -a …) 2>&1`, **the whole script's output is redirected** — no need to append `>> log` to each command. Under cron, with no terminal attached, it still writes to the file.

One caveat: a single growing log file still needs rotation. Pair this with a logrotate rule (chapter 21) or the file will eventually fill the disk. And since under cron you have also silenced cron's own mail, this file **is** your only record — make sure the timestamp format is one you can grep.

## 4. Idempotence: Safe To Run Again

```bash title="Idempotent patterns" command:("$":1-4)
mkdir -p /srv/backups            # no error if it already exists
install -d -m 750 /srv/backups   # create the directory and set its mode in one step
# atomic write: write a temp file, then mv, so readers never see a half file
printf '...' > "$out.tmp" && mv "$out.tmp" "$out"
```

**Bottom line:** a script must be **repeatable without side effects** — directories via `mkdir -p`, files via "temp name plus `mv`", configuration via "render a temp file then swap it in atomically".

## 5. Locking: Prevent Running Twice

```bash title="Two flavours of flock" command:("$":1-4)
# approach one: a file-descriptor lock
exec 9>/var/lock/backup.lock
flock -n 9 || { log "another run in progress"; exit 0; }   # -n fails at once if the lock is held

# approach two: lock a command directly
flock -n /var/lock/backup.lock -c '/usr/local/bin/backup.sh'
```

**Note:** my worst incident was exactly this — "the 3 a.m. cron job was still running and I clicked it by hand too", so both wrote the same destination at once. Since adding `flock -n`, it has never happened again.

Why `flock` rather than a hand-rolled lock file? Because the kernel releases a `flock` lock **automatically when the process exits, crash included**, so there is never a stale lock to clean up by hand. A "lock directory" approach has to remember to delete its marker at the end, and one bad exit leaves the script permanently blocked.

## 6. A Complete, Runnable Backup Script

```bash title="backup.sh" command:("$":1-3) mark:10-11
#!/usr/bin/env bash
set -euo pipefail

SRC=${1:?usage: backup.sh dir}
DEST=/srv/backups
KEEP=7

log() { printf '[%s] %s\n' "$(date '+%F %T')" "$*"; }

exec 9>"$DEST/.lock"
flock -n 9 || { log "another backup running, abort"; exit 0; }

tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT

mkdir -p "$DEST"
name="$(basename "$SRC")-$(date +%F-%H%M).tar.gz"
tar -czf "$tmp/$name" -C "$(dirname "$SRC")" "$(basename "$SRC")"
gzip -t "$tmp/$name"
mv "$tmp/$name" "$DEST/$name"

ls -1t "$DEST"/"$(basename "$SRC")"-*.tar.gz | tail -n +$((KEEP+1)) | xargs -r rm -f
log "ok: $DEST/$name, kept last $KEEP"
```

## 7. Line By Line

- `exec 9>"$DEST/.lock"` with `flock -n 9`: the lock sits on fd 9 and, **if it cannot be taken, the script exits immediately** with status 0, because "someone else is running it" is not a failure.
- `tmp=$(mktemp -d)` with `trap 'rm -rf "$tmp"' EXIT`: intermediates live only in the temp directory and **every exit path clears them**, leaving no litter.
- `gzip -t` before `mv`: **only a verified archive is a product**, and `mv` within one filesystem is atomic, so readers never see half a file.
- `ls -1t … | tail -n +$((KEEP+1)) | xargs -r rm -f`: keep the newest `KEEP` archives by time, and `xargs -r` makes sure `rm` does not run when there is nothing to remove.

## 8. Hands-On Checklist

```bash title="Verify each piece" command:("$":1-7)
bash -n backup.sh; shellcheck backup.sh             # 1. syntax and static checks
bash -x backup.sh /tmp/test 2>&1 | tail             # 2. trace execution
flock -n /tmp/demo.lock -c 'echo locked'            # 3. confirm the lock is taken
flock -n /tmp/demo.lock -c 'echo locked'            # 4. a second run should fail at once
bash -c 'trap echo bye EXIT; true'                  # 5. watch the trap fire on exit
mkdir -p /tmp/a && install -d -m 700 /tmp/b         # 6. idempotent directory creation
printf 'x' > /tmp/f.tmp && mv /tmp/f.tmp /tmp/f     # 7. atomic write
```

## Summary

- `local` scopes a variable to its function; `return` ends a function, **`exit` ends the script**.
- `trap … EXIT` is the standard home for fallback cleanup; `INT` handles Ctrl-C.
- Logging is one `log()` function plus a global `exec > >(tee -a …) 2>&1` redirect.
- Idempotence rests on `mkdir -p`, `install -d`, and "temp file plus atomic `mv`".
- Prevent double runs with `flock -n`, exiting cleanly when the lock is held.
- Every good script follows the same skeleton: **lock → temp area → trap cleanup → verify → atomic landing → keep N copies**.

## Next Up

Scheduled tasks: the five cron fields, its classic "minimal environment" traps, `/etc/cron.d` and allow/deny, and how a systemd timer's `Persistent=` covers the case where the machine simply was not powered on.
