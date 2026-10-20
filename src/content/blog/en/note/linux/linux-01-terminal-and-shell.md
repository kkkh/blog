---
title: 'Linux Basics 01: Terminals, Shells, and How Commands Are Actually Found'
description: 'Three things to keep apart — the terminal is not the shell, and the shell is not the kernel. Then PATH order, builtins versus external commands, and why cd can be “not found”.'
link: linux-01-terminal-and-shell
catalog: true
date: 2022-04-09 20:30:00
updated: 2022-04-09 22:10:00
categories: ['笔记']
tags: ['Linux', '基础']
draft: false
---

## What This Chapter Solves

The first time you ssh into a machine, the prompt `root@vm:~#` invites a wrong idea: that you are talking to Linux.

There are several layers in between. If you don’t separate them, a lot of things later just look like magic: why `cd` can report “command not found”, why a PATH change has no effect in another terminal, and why `echo $SHELL` does not match the shell you are actually running.

## 1. Four Roles, One Chain

```text
keyboard → terminal (pty) → shell → fork/exec child → kernel → disk/network/CPU
```

- **Kernel** — the one doing the real work: scheduling, memory, filesystems, networking. It does not understand `ls`; it understands system calls.
- **Shell** — an ordinary user-space program whose only job is: read a line, parse it, execute it. bash, zsh, dash are all shells.
- **Terminal emulator** — the window in front of you (iTerm2, GNOME Terminal). It draws characters and collects keystrokes.
- **pty (pseudo-terminal)** — the wire between a program and your window. An ssh session gets one allocated on the remote side.

What actually happens for `ls`: the shell reads `ls\n` from the pty → splits it into words → finds an executable named `ls` in PATH → `fork()`s a child → the child `execve("/usr/bin/ls", …)` → `ls` itself calls `open` / `readdir` / `write` → the kernel reads the directory → output flows back to the pty → you see text.

:::info
**The shell does not execute commands.** It finds programs, starts processes and wires up pipelines. What executes is the program it execs — that is why it is a command *interpreter*, not an executor.
:::

## 2. How A Command Is Found: The Order Of PATH

```bash title="PATH, one entry per line" command:("$":1)
echo "$PATH" | tr ':' '\n' | nl
```

PATH is searched left to right, **first hit wins**, and any later program with the same name will never run. That is how `~/bin` placed early can “shadow” a system command — convenient, and dangerous (section 4 has the accident).

Don’t guess what a name is; ask the shell:

```bash title="What a name really is" command:("$":1-3)
type -a ls        # every match: alias / function / builtin / file on disk
type -a cd
command -v ls     # only answers “how would the shell run this?”
```

On Ubuntu, `type -a ls` prints two lines:

```text
ls is /usr/bin/ls
ls is /bin/ls
```

Two lines, one file: modern distributions are **merged-usr** — `/bin`, `/sbin`, `/lib` are symlinks into `/usr` — while PATH contains both `/usr/bin` and `/bin`, so the same file is listed twice.

`type -a cd` answers differently:

```text
cd is a shell builtin
```

**`cd` is “not found” because it is not a program on disk at all** — it is a shell builtin. It has to be: `cd` must change the working directory of the **current shell process** (the `chdir` syscall), and an external program is a forked child whose changes cannot affect its parent.

Common builtins: `cd`, `export`, `read`, `source`, `type`, `pwd`, `umask`, `echo` (bash has a builtin version and can also call `/bin/echo`).

## 3. Which Shell Am I In? Three Answers, Not One

```bash title="Login shell vs current shell" command:("$":1-5)
echo "$SHELL"                     # login shell, from field 7 of /etc/passwd
echo "$0"                         # name of the shell process you are in
ps -o pid,ppid,cmd -p $$          # $$ is the PID of the current shell
grep "^$(whoami):" /etc/passwd
tty; who am i
```

**My note: `$SHELL` is a hint, never evidence.** It was read from `/etc/passwd` at login; typing `zsh` or `bash` afterwards does not change it. To know what is running *now*, use `$0` / `$$` / `ps`.

`$-` also tells you which mode the shell is in: an `i` means interactive, an `m` means job control is on (that detail comes back when we discuss signals).

```bash title="Shell flags" command:("$":1)
echo "$-"        # e.g. himBH
```

## 4. Two Real Accidents

**Accident one — putting `.` in PATH.**

```bash title="Do not do this"
export PATH=.:$PATH
```

Now the shell looks in the **current directory** first for every command you type. Unpack an archive that happens to contain a file named `ls` or `sudo`, cd into it, type `ls`, and you have run someone else’s program. The attack has a name: **PATH hijacking**.

**Accident two — changing PATH without exporting it.** This one actually bit me:

```bash title="Export or the child never sees it" command:("$":1-4)
PATH="$HOME/bin:$PATH"     # changed, not exported: only the current shell knows
export PATH="$HOME/bin:$PATH"   # correct

FOO=bar        ; bash -c 'echo "${FOO:-<empty>}"'   # <empty>
export FOO=bar ; bash -c 'echo "${FOO:-<empty>}"'   # bar
```

## 5. Hands-On Checklist (Five Minutes)

```bash title="Verify everything from this chapter" command:("$":1-6)
# 1. who am I talking to
echo "$0 | $SHELL | $$"; ps -o pid,ppid,cmd -p $$

# 2. the search order
echo "$PATH" | tr ':' '\n' | nl

# 3. which layer explains each name
type -a ls; type -a cd; type -a sudo

# 4. proof that the shell starts processes: parent PID is your shell
sleep 300 &
ps -o pid,ppid,cmd -p $!      # $! = PID of the most recent background job
kill %1
```

In step 4 the `ppid` is your shell — direct, observable evidence for “the shell only forks and execs”.

## Summary

- Terminal ≠ shell ≠ kernel. The shell only reads a line, finds a program and starts a process.
- Command lookup follows PATH order left to right; builtins never take part in it.
- `$SHELL` is the login shell, not the current process; check `$0` / `$$` / `ps` / `$-`.
- Never put `.` in PATH, and never change PATH without `export`.

## Next Up

Why `/` contains exactly these directories, and what an **inode** really stores — including the failure where the disk has free space but nothing can be written.
