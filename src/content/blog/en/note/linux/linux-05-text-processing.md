---
title: 'Linux Basics 05: Text Processing — Turning grep/sort/uniq Into Your Analysis Toolkit'
description: 'The streaming mindset: one line in, one line out, no intermediate files. grep as a filter, why uniq demands sort, the division of labour between cut/tr/wc/awk, and the real pipeline that yields Top IPs and per-minute request counts from a 2 GB access log.'
link: linux-05-text-processing
catalog: true
date: 2022-04-13 20:30:00
updated: 2022-04-13 22:10:00
categories: ['笔记']
tags: ['Linux', '基础']
draft: false
---

## What This Chapter Solves

“Which endpoint gets hit most?”, “which IP sent the most requests?”, “are 5xx rising?” — the answers are all sitting in text files, and **ninety percent of the time you need no script at all**. What you need is the division of labour between six tools and one habit: `grep → sort → uniq -c → sort -rn`.

## 1. The Streaming Mindset: One Line In, One Line Out

These tools work **line by line**: read a line, process it, emit a line. Memory stays roughly constant (with one exception below), and **no intermediate files are needed**:

```bash title="A classic three-stage pipeline" command:("$":1)
cat access.log | grep ' 500 ' | awk '{print $7}' | sort | uniq -c | sort -rn | head
```

Learn the roles first:

| Tool | The one job it does |
| --- | --- |
| `grep` | **filter lines** (keep or drop) |
| `sort` | **reorder lines** (must see everything) |
| `uniq` | **collapse adjacent duplicates** (hence: sort first) |
| `cut` / `awk` | **slice columns** |
| `tr` | **character-level translate / squeeze** |
| `wc` | count lines / words / bytes |

## 2. grep Is A Filter, Not A Search Box

```bash title="Six useful faces of grep" command:("$":1-6)
grep -c 'ERROR' app.log         # matched *lines*
grep -o 'ERROR' app.log | wc -l # matched *occurrences* ← not the same number!
grep -n 'ERROR' app.log         # with line numbers
grep -v 'DEBUG' app.log         # invert: lines without DEBUG
grep -i 'error' app.log         # case-insensitive
grep -A3 -B1 'panic' app.log    # context: 3 lines after, 1 line before
```

**My notes:**

- The default is **basic regex** — a literal `|` needs escaping or the `-E` flag; `-x` matches the whole line.
- For fixed strings (IPs, UUIDs) use `-F`: no regex parsing, so it is faster and cannot be bitten by a stray `.`.
- **`-c` counts lines**, not hits: one line containing `ERROR` twice still counts once. For occurrences, use `grep -o | wc -l`. The difference bit me when I wired up an alert threshold.

## 3. sort And uniq: Order Decides The Result

```bash title="Sorting" command:("$":1-5)
sort file               # lexicographic: "10" sorts before "9"
sort -n file            # numeric
sort -k2,2 -n file      # by column 2 only (specify the range as 2,2)
sort -u file            # sort + dedupe: the easy path when you only want uniqueness
sort -t: -k3,3n /etc/passwd   # custom delimiter, numeric third field
```

```bash title="uniq only compares neighbours" command:("$":1-3)
sort ips.txt | uniq -c | sort -rn | head     # ⭐ the classic Top-N quartet
uniq -d ips.txt      # only repeated entries (useless without sort)
uniq -u ips.txt      # only unique entries
```

**Note:** `uniq` literally compares each line with the previous one, so **without sorting it dedupes nothing** — the number-one beginner trap. Output of `uniq -c` is **spaces + count + content**, so read fields with `awk '{print $2}'`.

## 4. The Division Of Labour: cut / tr / wc / awk

```bash title="Columns and characters" command:("$":1-6)
cut -d' ' -f1,7 access.log | head     # default delimiter is TAB; use -d' ' for spaces
tr -s ' '                             # squeeze runs of spaces
tr 'A-Z' 'a-z' < file                 # case conversion (character by character)
wc -l file; wc -c file; wc -w file    # lines / bytes / words
awk '{print $7}' access.log           # splits on any whitespace run — more robust than cut
```

**Note:** `cut -d' '` treats a *single* space as the delimiter, so runs of spaces create empty fields. `awk` splits on whitespace runs by default — for production logs I now reach for `awk` straight away.

## 5. A Real Case: Three Answers From One Access Log

Nginx’s default combined format — always look at one line first:

```bash title="Confirm the format first" command:("$":1) mark:1
head -1 /var/log/nginx/access.log
# 127.0.0.1 - - [13/Apr/2022:20:31:02 +0800] "GET /post/linux-01 HTTP/1.1" 200 5123 "-" "curl/7.81.0"
```

```bash title="Top IPs / per-minute load / 5xx endpoints" command:("$":1-3)
# 1) the ten busiest client IPs
awk '{print $1}' /var/log/nginx/access.log | sort | uniq -c | sort -rn | head -10

# 2) requests per minute (time is $4, shaped like [13/Apr/2022:20:31:02)
awk '{print $4}' /var/log/nginx/access.log | cut -d: -f1-3 | sort | uniq -c | sort -rn | head

# 3) only 5xx, and which endpoints they are
awk '$9 ~ /^5/ {print $7, $9}' /var/log/nginx/access.log | sort | uniq -c | sort -rn | head
```

**Note:** these three lines have served me in far more incidents than any script I have written. `$4` and `$9` are positions in the **Nginx combined format**; Apache combined differs, which is why step one is always `head -1`.

For large logs, narrow before you count:

```bash title="A habit for big logs" command:("$":1-3)
grep -F '13/Apr/2022' big.log > /tmp/today.log   # cut down to a time window
wc -l /tmp/today.log
awk '{print $1}' /tmp/today.log | sort | uniq -c | sort -rn | head
```

## 6. Hands-On Checklist

```bash title="Six commands that prove this chapter" command:("$":1-6)
printf 'b\na\nb\nc\n' > l.txt
sort l.txt | uniq -c                       # 1. counting
sort -u l.txt; sort -n <<< $'10\n9\n2'     # 2. lexicographic vs numeric
printf 'a a  a\n' | tr -s ' '              # 3. squeeze spaces
echo 'ERROR ERROR' | grep -c ERROR         # 4. 1 (lines)
echo 'ERROR ERROR' | grep -o ERROR | wc -l # 5. 2 (occurrences)
wc -l l.txt; wc -c l.txt                   # 6. lines and bytes
```

## Summary

- Each tool has one job; **the canonical counting pipeline is `sort | uniq -c | sort -rn | head`**.
- `grep -c` counts lines, `grep -o | wc -l` counts occurrences.
- `uniq` only collapses neighbours, so it **requires sorting**; `sort` is the one stage that must swallow all data.
- Prefer `awk` for column slicing (whitespace-run friendly); `cut` needs an explicit single-character delimiter.
- In real incidents: `head -1` first, then build the pipeline.

## Next Up

Pipelines and redirection: the three streams `stdin/stdout/stderr`, why the **order** in `2>&1` matters, exit codes through a pipeline and `pipefail`, and why `sudo echo > /root/file` is silently refused.
