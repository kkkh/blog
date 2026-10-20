---
title: 'Linux Basics 08: Environment Variables And Shell Startup Files — Why ssh Cannot Find Your PATH'
description: 'Variable scope and snapshot semantics, which files each of the four shell modes loads, why running a command over ssh misses your PATH additions, and how sudo’s secure_path rewrites the environment.'
link: linux-08-env-and-startup-files
catalog: true
date: 2022-04-16 20:30:00
updated: 2022-04-16 22:10:00
categories: ['笔记']
tags: ['Linux', '基础']
draft: false
---

## What This Chapter Solves

“`node -v` works in my terminal, but `ssh host 'node -v'` says command not found.” That complaint ties together environment variables, the four ways a shell can start, and `sudo`’s environment policy. Once this chain is clear, the everyday mysteries — “works locally, fails remotely”, “works in my shell, fails in cron” — stop being mysteries.

## 1. Three Levels Of Variables

```bash title="Three kinds of assignment" command:("$":1-4)
VAR=local          # 1) shell variable: only this shell knows it
export VAR=global  # 2) environment variable: inherited by children
bash -c 'echo "${VAR:-<empty>}"'      # 3) a child reads the snapshot taken at fork time

MYVAR=1; export MYVAR; bash -c 'echo $MYVAR'   # 1
MYVAR=2; bash -c 'echo $MYVAR'                 # 1 ← the running child is unaffected
```

**Note:** environment variables are **copies, not shared state**. Anything the parent changes afterwards is invisible to already-running children — which explains both the `export` experiment in chapter 01 and the classic “I changed PATH in a script but the command still isn’t found”.

```bash title="Three tools to inspect the environment" command:("$":1-4)
env | sort | head              # environment only
printenv PATH                  # one variable
set | head                     # environment + shell variables + functions (everything)
env -i bash -c 'env'           # a clean environment — for “which variable is missing?”
```

## 2. Four Ways A Shell Starts, Four Different Files

| Mode | Typical case | Files loaded |
| --- | --- | --- |
| **login + interactive** | ssh login, console login, `bash -l` | `/etc/profile` → the **first existing** of `~/.bash_profile`, `~/.bash_login`, `~/.profile` |
| **non-login + interactive** | opening a new terminal, typing `bash` | `/etc/bash.bashrc` (Debian family) → `~/.bashrc` |
| **non-login + non-interactive** | `ssh host 'cmd'`, scripts, `bash -c` | **none of them**; only the file named by `$BASH_ENV` |
| **login + non-interactive** | `ssh host 'bash -lc cmd'` | same row as “login + interactive” |

**Note:** this table is the heart of the chapter. Almost every “command not found over ssh” case is row three — your PATH extension lives in `~/.bashrc`, and that file is never read.

## 3. Real Failure 1: `ssh host 'node -v'` Cannot Find node

It is usually not a missing install but two things stacking up:

1. The PATH extension lives in `~/.bashrc` (or an nvm init block);
2. `~/.bashrc` on Ubuntu starts with this:

```bash title="The early return at the top of ~/.bashrc" command:("$":1-5) mark:3
case $- in
  *i*) ;;      # interactive: keep going
  *) return;;  # non-interactive: bail out ← this is the ssh path
esac
```

So `ssh host 'node -v'` loads neither `.bashrc` nor `.profile`, and PATH has no nvm directory.

Four fixes, best first:

```bash title="Four fixes" command:("$":1-4)
ssh host 'bash -lc "node -v"'                       # 1) force a login-shell run
ssh host 'source ~/.bashrc; node -v'                # 2) load it manually
# 3) move the PATH export into ~/.profile (read by login shells, interactive or not)
# 4) restructure ~/.bashrc so PATH/aliases do not sit behind the interactive check
```

What I do: **PATH and nvm init live in `~/.profile`**; only interactive niceties (aliases, prompt) stay in `~/.bashrc`.

## 4. Real Failure 2: `sudo` Changes Your PATH

```bash title="Compare the two" command:("$":1-3)
echo "$PATH"
sudo sh -c 'echo $PATH'      # Debian default: secure_path = /usr/local/sbin:…:/bin
sudo env | grep -i path
```

The cause is `secure_path` in `sudoers`: for safety, `sudo` **resets PATH** to system directories only (`env_reset` + `secure_path`). The practical fallout: a program in `/opt/xxx/bin` will not run under sudo.

```bash title="Two ways out" command:("$":1-2)
sudo -E whoami                     # keep the current environment (works; be aware of what you carry over)
sudo visudo                        # or write rules with absolute paths for specific commands
```

## 5. Make PATH Writes Idempotent

Sourcing startup files repeatedly inflates PATH into a long chain. The safe form checks first:

```bash title="Append to PATH only once" command:("$":1-6) mark:1
case ":$PATH:" in
  *":$HOME/bin:"*) ;;                       # already present, nothing to do
  *) PATH="$HOME/bin:$PATH" ;;
esac
export PATH
```

**Note:** `~/.bashrc` gets sourced once per new terminal, so idempotence saves you from debugging “why does PATH contain `/usr/local/bin` eight times”.

## 6. Hands-On Checklist

```bash title="Run the whole chapter" command:("$":1-7)
MYVAR=1; bash -c 'echo "${MYVAR:-<empty>}"'           # 1. not exported: invisible to children
export MYVAR; bash -c 'echo $MYVAR'                   # 2. visible after export
echo $-                                               # 3. is this shell interactive (contains i)?
bash -lc 'echo login: $0'; bash -c 'echo plain: $0'   # 4. login vs plain
ssh localhost 'echo "$PATH"' 2>/dev/null || true      # 5. the non-interactive PATH
sudo sh -c 'echo "$PATH"'                             # 6. secure_path
env -i bash -c 'env'                                  # 7. clean environment for comparison
```

## Summary

- Environment variables are a **snapshot at fork time**; the parent must `export`, and later changes do not reach running children.
- Login shells read the `profile` family, interactive non-login shells read the `bashrc` family, and **non-interactive runs (`ssh host 'cmd'`, scripts, cron) read neither**.
- Put PATH extensions in `~/.profile`; the interactive check at the top of `~/.bashrc` is the usual reason remote commands cannot find your tools.
- `sudo` resets the environment (`secure_path`); use `-E` or sudoers rules when you really need something else.
- Append to PATH idempotently.

## Next Up

Users and groups: the seven fields of `/etc/passwd`, what `!` and `*` mean in `/etc/shadow`, primary versus supplementary groups, why `usermod -aG` must include `-a`, and how `su`, `sudo` and `sudoers` relate.
