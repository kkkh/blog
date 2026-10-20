---
title: 'Linux Basics 03: The Real Semantics Of ls, cp, mv, rm — And The * That The Shell Expands'
description: 'Globs belong to the shell, not to the command; what -- is for, files that begin with a dash, what cp -a really preserves, mv across disks, and the two classic rm -rf accidents.'
link: linux-03-file-operations
catalog: true
date: 2022-04-11 20:30:00
updated: 2022-04-11 22:10:00
categories: ['笔记']
tags: ['Linux', '基础']
draft: false
---

## What This Chapter Solves

`ls`, `cp`, `mv` and `rm` are the four most-typed commands and the four most likely to cause an accident. What they really do comes down to two questions: **who expands the arguments**, and **whether the command works on the inode or on the directory entry**.

## 1. `*` Is Not ls Syntax — The Shell Expands It

```bash title="Who expanded the *?" command:("$":1-2)
echo *                 # expanded by the shell, then handed to another program
printf '<%s>\n' *      # see each item separately
```

The proof is trivial: `echo *` prints the file names in the current directory. `ls` **never receives a `*`** — it receives an already-expanded list of names.

The behaviour when nothing matches catches people out:

```bash title="Two fates of an unmatched glob" command:("$":1-2)
ls *.log                       # no match → bash passes the literal "*.log" → No such file
shopt -s nullglob; ls *.log    # with nullglob → expands to nothing → ls lists nothing, no error
```

- Braces `{a,b}` are **brace expansion**, which happens earlier than globbing and has nothing to do with files: `echo {a,b}{1,2}` → `a1 a2 b1 b2`
- Character classes: `?`, `[abc]`, `[a-z]`, `[!0-9]`; `**` needs `shopt -s globstar`
- Hidden files: `*` does not match names starting with `.` — use `.[!.]*` or `shopt -s dotglob`

**File names that start with a dash** — you will meet them:

```bash title="Everything after -- is an operand" command:("$":1-3)
touch ./-weird.txt
rm -- -weird.txt
rm ./-weird.txt        # also works, but -- is the general answer
```

For names with spaces, newlines or quotes, go through `-print0`:

```bash title="The safe way with weird names" command:("$":1)
find . -maxdepth 1 -name '*.log' -print0 | xargs -0 rm -v
```

## 2. The ls Details Everyone Skips

```bash title="The useful faces of ls" command:("$":1-5)
ls -l        # first char: - file, d directory, l symlink, c/b device, s socket, p pipe
ls -a        # includes . and ..
ls -A        # excludes . and ..
ls -d */     # list the directories themselves, not their contents
ls -ltr      # sort by mtime, oldest first — the best view when debugging an incident
```

**My notes:**

- The timestamp in `ls -l` is **mtime** (last content change) — not ctime, not atime. To see all three, use `stat`.
- The size column for a directory (often 4096) is the **space its entries occupy**, unrelated to the total size of the files inside. For that: `du -sh dir`.
- `ls -l` does `lstat` on symbolic links (shows the link itself); `ls -lL` follows them — the same distinction that matters with `find -L`.

## 3. cp: What `-a` Actually Preserves

```bash title="Four modes of cp" command:("$":1-5)
cp    a b            # content + permission bits; timestamps become “now”
cp -p a b            # keep mode / ownership / timestamps
cp -a src dst        # = -dR --preserve=all: recursive, no dereference, preserve everything possible
cp -i a b            # ask before overwrite; -n means never overwrite
cp -v src/*.txt d/   # show progress
```

Easy to miss:

- `-a` / `-p` do their best to keep **timestamps, ownership (root required), ACLs, xattrs and the SELinux context** (`--preserve=context`). Plain `cp` carries only permission bits.
- Copying **over an existing file** opens and truncates it rather than unlinking it: so **hard links break** (the other name now sees the new content), and a file still held open by a process can be blanked in place.
- For big trees, resumable transfers or incremental sync use `rsync -aHAX --info=progress2` instead of brute-forcing `cp -a`.

## 4. mv: Rename On One Disk, Move Across Disks

```bash title="mv's two physical behaviours" command:("$":1-5)
mv a.txt b.txt          # same filesystem: only the directory entry changes, instant
mv big.iso /mnt/usb/    # across filesystems: copy + unlink — slow, can fail on space
mv dir1 dir2            # if dir2 exists, dir1 is moved *into* dir2, not overwritten
mv -i / -n / -b         # ask / never overwrite / back up the old file
```

**Note:** `mv` **overwrites silently by default**, which is the opposite of most people’s intuition. On my own machines I set `alias mv='mv -i'`, and in scripts I write `-n` explicitly so a rename never quietly eats someone else’s file.

## 5. rm Is unlink — Plus The Two Classic Accidents

```bash title="The faces of rm" command:("$":1-4)
rm a.txt        # removes a directory entry; blocks are reclaimed when count is 0 and nobody holds it
rm -r dir       # recursive
rm -d dir       # empty directories only (same as rmdir)
rm -rf dir      # recursive + no questions ← the danger is exactly this pairing
```

:::warning
**Two real accidents, both from an empty variable**
```bash title="Accident 1: $DIR is empty"
DIR=""
rm -rf "$DIR"/*        # expands to rm -rf /*  → the machine deletes itself
```
```bash title="Accident 2: a stray space in the path"
rm -rf "$HOME/data "   # the space inside the quotes deletes something else
```
:::

The rules I now follow:

1. `set -u` at the top of scripts: using an unset variable becomes an error instead of an empty expansion
2. Print before destroying: `echo rm -rf "$DIR"/*`, or `find … -print` before `-delete`
3. Prefer `${VAR:?}`: `rm -rf -- "${VAR:?}/"`
4. Want recoverable deletion? Use `trash-cli` (`apt install trash-cli`) or `mv` into `.trash/`

```bash title="Look first, delete second" command:("$":1-2)
find /tmp -maxdepth 2 -name '*.tmp' -mtime +7 -print     # confirm the list
find /tmp -maxdepth 2 -name '*.tmp' -mtime +7 -delete    # then act
```

## 6. Hands-On Checklist

```bash title="Verify each claim in this chapter" command:("$":1-6)
echo *                                   # 1. the shell expands globs
touch ./-weird.txt; rm -- -weird.txt     # 2. what -- is for
mkdir -p d; cp -a d d2; stat -c '%a %n' d d2   # 3. cp -a keeps permissions
ln f f2; echo new > f; cat f2            # 4. truncating a file breaks hard links
mv d d2; ls -d d2/*                      # 5. mv into an existing directory = move inside
find . -maxdepth 1 -name '*.tmp' -print  # 6. always print before deleting
```

## Summary

- `*` is expanded by the **shell**; when nothing matches, the literal is passed through unless `nullglob` is set.
- Names starting with `-` need `--`; weird names need `-print0 | xargs -0`.
- `ls -l` shows inode metadata; a directory’s “size” is its own entries — use `stat` for timestamps.
- `cp -a` is the “preserve everything” form; truncating overwrites break hard links.
- `mv` renames on one disk and copies across disks; `mv dir1 dir2` moves *into* dir2.
- `rm` is unlink; `rm -rf` bites when a variable is empty or a path is mistyped.

## Next Up

Permissions and ownership: why `rwx` means different things on files and directories, how `umask` really computes, what the sticky bit protects in `/tmp`, and what `setuid` physically does.
