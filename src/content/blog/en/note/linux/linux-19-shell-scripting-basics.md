---
title: 'Linux Basics 19: Shell Scripting, Part One — Quoting, Tests And Exit Codes'
description: 'shebang and the two ways to run a script, the quoting traps of "$VAR" versus $VAR and "$@" versus $*, when to use [[ ]] instead of [ ], why while read -r needs that -r, a minimal getopts example, what each part of set -euo pipefail fixes, exit-code conventions and shellcheck.'
link: linux-19-shell-scripting-basics
catalog: true
date: 2022-04-27 20:30:00
updated: 2022-04-27 22:10:00
categories: ['笔记']
tags: ['Linux', '基础']
draft: false
---

## What This Chapter Solves

Paste a few commands that worked fine in your terminal into a script and they often break immediately: a filename with a space gets split into two arguments; a variable in a path is left unquoted and `rm -rf $DIR/` nearly wipes the root directory when `DIR` is empty; the script reports success and yet the command after `&&` still runs.

This chapter covers the three things shells bite you with most: **quoting, tests and exit codes**. Without them, a script is a time bomb.

## 1. Shebang And Two Ways To Run A Script

```bash title="What goes on line one" command:("$":1-3)
#!/usr/bin/env bash      # uses bash from PATH — most portable
#!/bin/bash              # hard-coded path
#!/bin/sh                # POSIX sh, limited features (see below)
```

```bash title="Two ways to run it, and the mode bit" command:("$":1-3)
bash script.sh           # hands the file to bash as input; no x bit needed
chmod +x script.sh       # set the executable bit
./script.sh              # the shebang decides which interpreter runs
```

**Bottom line:** `bash script.sh` ignores the shebang, so `#!/usr/bin/env bash` does nothing there; only `./script.sh` reads it. Use the former while debugging, the latter when shipping.

## 2. Quoting: The Most Expensive Trap

```bash title="Side by side" command:("$":1-4)
f="my file.txt"
cat $f              # split into two arguments, my and file.txt — error
cat "$f"            # ✅ one argument
echo $f             # word splitting plus globbing; the space is lost
echo "$f"           # ✅ printed verbatim
```

The two special variables for arguments must not be confused:

```bash title="Printing arguments in a script" command:("$":1-3)
echo "there are $# arguments"
printf '[%s]\n' "$@"     # ✅ each argument stays a separate item — recommended
printf '[%s]\n' $*       # ❌ split into words and re-joined; nothing is preserved
```

| Form | Meaning |
| --- | --- |
| `"$@"` | **each argument is its own word** — the default in loops |
| `"$*"` | all arguments joined into **one** string |
| unquoted `$*` | split into words, then joined — the worst of both |

**Note:** the default habit is **to quote every variable**, except where you deliberately want word splitting or globbing. That one rule blocks more than half of the strange bugs.

:::warning
When `$DIR` is empty, `rm -rf $DIR/` expands to `rm -rf /`. **Always `echo` a destructive command first** to confirm the expansion, or write `rm -rf "${DIR:?DIR is unset}"` so an empty variable aborts the script instead.
:::

## 3. Tests: `[ ]` Or `[[ ]]`

```bash title="Both kinds of test" command:("$":1-5)
[ -f "$path" ] && echo exists       # POSIX test; the variable must be quoted
[[ -f $path ]] && echo exists       # bash keyword; safe without quotes
[[ $name == *.log ]]                # ✅ glob pattern matching
[[ $s =~ ^[0-9]+$ ]]                # ✅ regular expression matching
[[ $a -lt 10 && $b -gt 5 ]]         # logical operators, no -a/-o needed
```

| Test | Meaning |
| --- | --- |
| `-z "$s"` | string is empty |
| `-n "$s"` | string is non-empty |
| `-e` / `-f` / `-d` | exists / is a regular file / is a directory |
| `-x` | executable |
| `-r` / `-w` | readable / writable |

**Bottom line:** with `#!/usr/bin/env bash`, **prefer `[[ ]]`** — it is not split when a variable is unquoted and it supports `==` and `=~` matching. Fall back to `[ ]` only when you must be POSIX, and then no quote can be dropped.

## 4. Loops

```bash title="Two kinds of loop" command:("$":1-4)
for f in *.log; do echo "$f"; done

while IFS= read -r line; do        # ✅ -r stops backslashes being interpreted
  echo "$line"
done < input.txt
```

**Why not `for line in $(cat file)`:** command substitution performs **word splitting**, so spaces and blank lines are discarded and one line can become several. `while read -r` reads a line at a time exactly as it is. The `-r` keeps a trailing `\` from being treated as an escape, so **it is almost always what you want**.

## 5. Arguments And `getopts`

```bash title="Positional parameters and option parsing" command:("$":1-6)
echo "$0"             # the script name
echo "$1"; echo "$2"  # first and second arguments
echo "${@:2}"         # everything from the second argument on

while getopts "vho:" opt; do
  case $opt in
    v) set -x ;;
    o) out=$OPTARG ;;
    h) echo "usage: $0 [-v] [-o out]"; exit 0 ;;
    *) exit 2 ;;
  esac
done
shift $((OPTIND-1))   # drop the parsed options; the rest are positional
```

## 6. What Each Of `set -euo pipefail` Fixes

```bash title="Put this at the top of the script" command:("$":1-2)
set -euo pipefail
set -x               # turn on while debugging: prints each executed command
```

| Option | Effect |
| --- | --- |
| `-e` | exit as soon as a command fails (non-zero status) |
| `-u` | error out on an undefined variable |
| `-o pipefail` | a pipeline fails if any stage fails |
| `-x` | print each expanded command, for debugging |

**Note on the `-e` trap:** `-e` does **not** apply in the condition position of `if`, `&&`, `||` or `while` — failure there is expected. So "allowed to fail" must be written as `cmd || true` or `if ! cmd; then`; do not expect `-e` to cover those cases.

## 7. Exit Codes And shellcheck

```bash title="Exit-code conventions" command:("$":1-3)
true; echo $?        # 0 = success
false; echo $?       # non-zero = failure
exit 1               # end the script explicitly as a failure
```

**Bottom line:** `0` means success and **anything non-zero means failure**; `$?` always reflects the last command. Once the script is written, run `shellcheck script.sh` — it finds unquoted variables, misused `[ ]`, pointless calls and more. **It is the cheapest code review you will ever get.**

## 8. Portability

`#!/bin/sh` means POSIX, so bash features are off the table: `[[ ]]`, arrays, the `function` keyword, `${@:2}` and process substitution `<(...)` simply do not exist. If you need to run across distributions (especially Alpine's `busybox sh`), write POSIX honestly or declare bash as a dependency.

## 9. Hands-On Checklist

```bash title="Practice" command:("$":1-7)
bash -n script.sh                                  # 1. syntax check only, no execution
shellcheck script.sh                               # 2. static review
bash -x script.sh 2>&1 | head                      # 3. trace execution
printf '[%s]\n' "$@" | head                        # 4. check argument expansion
[[ -d /tmp && -w /tmp ]] && echo ok                # 5. test a condition
while IFS= read -r l; do echo "$l"; done < /etc/hosts | head   # 6. read a file line by line
bash -c 'set -euo pipefail; false; echo never'     # 7. confirm -e exits early
```

## Summary

- `bash script.sh` ignores the shebang and needs no x bit; only `./script.sh` reads it.
- **Quote variables by default**; `"$@"` keeps every argument, `"$*"` joins them into one.
- Prefer `[[ ]]` in bash scripts (no quoting needed, pattern matching); use `[ ]` for POSIX and quote everything.
- Read a file line by line with `while IFS= read -r line`, not `for x in $(cat file)`.
- `set -euo pipefail` handles "exit on failure", "undefined variables" and "failed pipelines" — but `-e` is inert in condition positions.
- Exit codes: 0 for success, non-zero for failure; `shellcheck` is mandatory for every script.

## Next Up

Shell scripting, part two: functions and `local`, `trap` for cleaning up, a single logging function, idempotent patterns, `flock` to prevent concurrent runs, and a complete, runnable backup script explained line by line.
