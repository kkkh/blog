---
title: 'Linux Basics 06: Pipelines And Redirection — Three Streams, One Ordering Trap'
description: 'What stdin/stdout/stderr really are, why the order inside 2>&1 decides the outcome, why > truncates first, exit codes through a pipeline and pipefail, tee and process substitution, and the real reason sudo redirection fails.'
link: linux-06-pipes-and-redirection
catalog: true
date: 2022-04-14 20:30:00
updated: 2022-04-14 22:10:00
categories: ['笔记']
tags: ['Linux', '基础']
draft: false
---

## What This Chapter Solves

Redirection and pipelines are the most magical-looking part of the shell: why does the string `> log 2>&1 &` decide where output goes, where errors go, and where the process lives? The answer is file descriptors — and there is one ordering trap serious enough to cause real incidents: `2>&1 > file` is not the same thing as `> file 2>&1`.

## 1. Start By Admitting: A Program Has Exactly Three Exits

When a process starts, the kernel hands it three already-open “files”:

| fd | Name | Points at, by default | Purpose |
| --- | --- | --- | --- |
| 0 | stdin | your keyboard (the pty) | input |
| 1 | stdout | the terminal | normal output |
| 2 | stderr | the terminal | errors and diagnostics |

**Redirection is really `dup2()`**: the shell forks the child and, before exec, points fd 1 (or 2) at a file you named. “Redirection is the shell’s job” is the fact that explains every trap below.

```bash title="Separating the three streams" command:("$":1-3)
ls /etc > out.txt              # stdout → out.txt, errors still on the terminal
ls /nope 2> err.txt             # stderr → err.txt
ls /etc /nope > out.txt 2>&1    # both into out.txt ← order matters
```

## 2. `2>&1` And The Ordering Trap

`2>&1` means “**copy stderr to wherever stdout currently points**”, so its effect **depends on where it appears**:

```bash title="Two orders, two different outcomes" command:("$":1-2) mark:2
ls /etc /nope > all.txt 2>&1    # ✅ first 1 → all.txt, then 2 follows it: both land in the file
ls /etc /nope 2>&1 > all.txt    # ❌ 2 follows the *old* 1 (the terminal), then 1 is moved to the file
```

**Note:** in the second form the error output still hits your terminal while normal output goes to the file — that is behind many “why is the error missing from the log?” puzzles. The mnemonic: **left to right, effective immediately**. bash also offers `&>` as short for `> file 2>&1`; zsh writes it `>&`.

What `>` itself does is worth knowing: it **opens and truncates**:

```bash title="Why > wipes the file first" command:("$":1-3)
echo hi > f; echo there > f; cat f            # there (the old hi is gone)
set -o noclobber; echo x > f 2>&1 | head -1   # refuses to overwrite an existing file
echo x >| f                                   # force the overwrite anyway
```

## 3. Pipelines: Two Pipes Built By The Shell

```bash title="What happens underneath" command:("$":1-2)
ls -l /etc | grep passwd          # two processes and one pipe(2)
# ls's stdout is wired to the pipe's write end; grep's stdin to the read end
```

A pipeline is **concurrent**: in `a | b`, a and b run at the same time — not one after the other. That is why `yes | head -1` does not run forever: `head` exits once satisfied and `yes` dies of SIGPIPE.

**The exit-code trap:** `$?` reports only the **last** command in the pipeline.

```bash title="pipefail fixes this" command:("$":1-3)
false | true; echo $?                    # 0 ← the earlier failure is swallowed
set -o pipefail; false | true; echo $?   # 1 ✅ any failing stage fails the pipeline
echo "${PIPESTATUS[@]}"                  # per-stage codes (bash only)
```

## 4. tee, Process Substitution, Here-Documents

```bash title="tee: watch and store at once" command:("$":1-3)
make 2>&1 | tee build.log                     # one copy on screen, one in the file
make 2>&1 | tee -a build.log | grep -i error  # append, and keep the stream flowing
```

```bash title="Process substitution and heredocs" command:("$":1-5)
diff <(sort a) <(sort b)           # use a command's output as if it were a file
cat <<'EOF' > cfg.sh
echo "$HOME"        # quoted EOF: no expansion — the trick for config templates
EOF
wc -c <<< 'hello'                  # here-string: same as printf 'hello\n' | wc -c
```

## 5. Real Failure: `sudo echo x > /root/f` Says Permission Denied

```bash title="The classic complaint" command:("$":1-2)
sudo echo hello > /root/f
# bash: /root/f: Permission denied     ← but I used sudo!
```

**Why:** **the redirection is done by the shell, not by sudo.** The shell tries to open `/root/f` as *your* user, fails, and `sudo echo` never even runs.

Three correct forms:

```bash title="Three ways that work" command:("$":1-3)
sudo sh -c 'echo hello > /root/f'            # let root's shell do the redirection
echo hello | sudo tee /root/f                # tee opens the file as root
sudo dd of=/root/f <<< hello 2>/dev/null     # unusual, but valid
```

By the same rule, `sudo cat /etc/shadow > shadow.bak` copies nothing — **the redirection happens as the current user**.

## 6. Hands-On Checklist

```bash title="Run every claim" command:("$":1-7)
ls /etc /nope > a.txt 2>&1; wc -l a.txt       # 1. correct order: both merged
ls /etc /nope 2>&1 > b.txt; wc -l b.txt       # 2. wrong order: stderr went to the terminal
set -o pipefail; false | true; echo $?        # 3. the pipeline failure becomes visible
yes | head -3                                 # 4. concurrency and SIGPIPE
printf 'x\n' | tee c.txt | wc -l              # 5. a tee branch
diff <(seq 3) <(seq 4)                        # 6. process substitution
sudo sh -c 'echo ok > /tmp/rootfile'; ls -l /tmp/rootfile   # 7. redirection as root
```

## Summary

- Redirection rewires fd 1/2 with `dup2` **in the shell** — hence the position of `2>&1` decides the result, and `sudo cmd > f` cannot save you.
- `>` opens and truncates; `noclobber` blocks overwrites and `>|` forces them.
- Pipelines run concurrently; `$?` reflects only the last stage, `set -o pipefail` reflects the whole chain.
- `tee` means “watch and store”, `<(...)` turns a command into a file, `<<'EOF'` is how templates get written.

## Next Up

Processes and signals: reading `ps` state codes, the fundamental difference between `TERM` and `KILL`, foreground/background and what `Ctrl+Z` actually sends, zombies and orphans, and why killing your terminal kills the process.
