---
title: 'Linux 基础 03：ls、cp、mv、rm 的真实语义，以及那个由 shell 展开的 *'
description: '通配符不是命令的语法，而是 shell 的展开；`--` 的作用、以 - 开头的文件名、cp -a 到底保留什么、mv 同盘与跨盘的差别，以及 rm -rf 的两个经典事故。'
link: linux-03-file-operations
catalog: true
date: 2022-04-11 20:30:00
updated: 2022-04-11 22:10:00
categories: ['笔记']
tags: ['Linux', '基础']
draft: false
---

## 这一节要解决什么

`ls`、`cp`、`mv`、`rm` 是敲得最多的四个命令，也是最容易出事故的四个。它们真正的行为取决于两件事：**参数是被谁展开的**，以及**它到底是对 inode 动手还是对目录项动手**。

## 一、`*` 不是 ls 的语法，是 shell 的展开

```bash title="谁展开了 * ？" command:("$":1-2)
echo *                 # shell 展开后才交给别的程序
printf '<%s>\n' *      # 看清每一项
```

证明很简单：`echo *` 打出的是当前目录里的文件名。`ls` 收到的**永远是一串已经展开好的名字**——`ls` 自己从没见过 `*` 这个字符。

无匹配时的行为最容易坑人：

```bash title="无匹配的两种命运" command:("$":1-2)
ls *.log                       # 没有匹配 → bash 把字面量 "*.log" 原样传给 ls → No such file
shopt -s nullglob; ls *.log    # 设了 nullglob → 展开为空 → ls 什么也不列（也不报错）
```

- 花括号 `{a,b}` 是 **brace expansion**，它比 glob 更早、且与文件是否存在无关：`echo {a,b}{1,2}` → `a1 a2 b1 b2`
- 字符类：`?` 单字符、`[abc]`、`[a-z]`、`[!0-9]`；`**` 递归要先开 `shopt -s globstar`
- 隐藏文件：`*` 不匹配 `.` 开头，需要 `.[!.]*` 或 `shopt -s dotglob`

**以 `-` 开头的文件名**（真实会遇到）：

```bash title="-- 之后一律当操作数" command:("$":1-3)
touch ./-weird.txt
rm -- -weird.txt
rm ./-weird.txt        # 也可以，但 -- 更通用
```

文件名里带空格、换行、引号时，一律走 `-print0`：

```bash title="怪名字的安全写法" command:("$":1)
find . -maxdepth 1 -name '*.log' -print0 | xargs -0 rm -v
```

## 二、ls 里被忽略的几个细节

```bash title="ls 的常用面" command:("$":1-5)
ls -l        # 第 1 个字符：- 普通文件, d 目录, l 符号链接, c/b 设备, s 套接字, p 管道
ls -a     # 含 . 与 ..
ls -A     # 不含 . 与 ..
ls -d */  # 只列目录本身，不展开内容
ls -ltr   # 按 mtime 反向排序：排现场时最好用
```

**我的批注**：

- `ls -l` 显示的时间是 **mtime**（内容最后修改），既不是 ctime 也不是 atime；三个都要看就用 `stat`。
- 目录那一列的"大小"（常见 4096）是**目录项自己占的块**，和里面文件的总大小无关。想知道目录真实体积：`du -sh dir`。
- `ls -l` 对符号链接做的是 `lstat`（看链接本身），`ls -lL` 才跟随目标——这一点和 `find -L` 的行为要区分。

## 三、cp：`-a` 到底保留了哪些东西

```bash title="cp 的四种模式" command:("$":1-5)
cp    a b            # 内容 + 权限位；时间戳变成"现在"
cp -p a b            # 保留 mode / ownership / timestamps
cp -a src dst        # = -dR --preserve=all：递归、不解引用符号链接、保留一切可保留的
cp -i a b            # 覆盖前询问；-n 表示已存在就不覆盖
cp -v src/*.txt d/   # 打印过程
```

容易忽略的差别：

- `-a` / `-p` 会尽力保留**时间戳、属主（需 root）、ACL、xattr、以及 SELinux 上下文**（`--preserve=context`）；普通 `cp` 只带权限位。
- `cp` 覆盖**已存在的文件**是"打开 + 截断"，不是先 unlink：所以**硬链接关系会被破坏**（另一个名字看到的是新内容）；如果目标正被进程占用，还可能被原地清空。
- 大目录、断点续传、增量同步请用 `rsync -aHAX --info=progress2`，不要拿 `cp -a` 硬扛。

## 四、mv：同盘改名 vs 跨盘搬家

```bash title="mv 的两种物理行为" command:("$":1-5)
mv a.txt b.txt          # 同一文件系统：只改目录项，瞬间完成
mv big.iso /mnt/usb/    # 跨文件系统：复制 + unlink，慢，可能因空间不足失败
mv dir1 dir2            # dir2 已存在 → dir1 被"移进"dir2，而不是覆盖
mv -i / -n / -b         # 覆盖前问 / 不覆盖 / 备份旧文件
```

**批注**：`mv` 默认**静默覆盖**——和直觉相反。我自己的机器上 `alias mv='mv -i'`，脚本里则显式写 `-n`，以免重命名时默默吞掉别人的文件。

## 五、rm 是 unlink，以及两个经典事故

```bash title="rm 的几个面" command:("$":1-4)
rm a.txt        # 解除目录项；链接归零且无进程占用 → 数据块才回收
rm -r dir       # 递归
rm -d dir       # 只删空目录（等价 rmdir）
rm -rf dir      # 递归 + 不提示 ← 危险就在这两个字母的组合
```

:::warning
**两个真实事故，根源都是"变量没有值"**
```bash title="事故 1：$DIR 为空"
DIR=""
rm -rf "$DIR"/*        # 展开成 rm -rf /*  → 整机被删
```
```bash title="事故 2：路径里多了一个空格"
rm -rf "$HOME/data "   # 引号内带空格 → 删掉的不是你以为的那个目录
```
:::

我现在固定遵守的几条：

1. 脚本开头 `set -u`：引用未定义变量直接报错，不给"空展开"留机会
2. 危险命令前先**打印**：`echo rm -rf "$DIR"/*`，或 `find` 先 `-print` 再 `-delete`
3. 写 `${VAR:?}` 而不是裸 `$VAR`：`rm -rf -- "${VAR:?}/"`
4. 想要"可回收"就用 `trash-cli`（`apt install trash-cli`），或者先 `mv` 进 `.trash/`

```bash title="先看，再删" command:("$":1-2)
find /tmp -maxdepth 2 -name '*.tmp' -mtime +7 -print     # 先确认清单
find /tmp -maxdepth 2 -name '*.tmp' -mtime +7 -delete    # 再动手
```

## 六、动手清单

```bash title="把本节结论逐条验一遍" command:("$":1-6)
echo *                                   # 1. glob 由 shell 展开
touch ./-weird.txt; rm -- -weird.txt     # 2. -- 的用途
mkdir -p d; cp -a d d2; stat -c '%a %n' d d2   # 3. cp -a 保留权限
ln f f2; echo new > f; cat f2            # 4. 覆盖写会破坏硬链接（同一 inode 一起变）
mv d d2; ls -d d2/*                      # 5. mv 到已存在目录 = 移进去
find . -maxdepth 1 -name '*.tmp' -print  # 6. 删之前永远先 print
```

## 小结

- `*` 由 **shell** 展开；无匹配时默认把字面量交给命令，只有 `nullglob` 才展开为空。
- 文件名以 `-` 开头用 `--`；怪异文件名用 `-print0 | xargs -0`。
- `ls -l` 展示的是 inode 元数据；目录"大小"是目录项占的块，看时间戳用 `stat`。
- `cp -a` 才是"保留一切"；覆盖写会破坏硬链接。
- `mv` 同盘改名、跨盘复制；`mv dir1 dir2` 是移进去而不是覆盖。
- `rm` 是 unlink；`rm -rf` 的危险来自变量为空或路径拼错。

## 下一节预告

下一节讲权限与属主：`rwx` 在**文件**和**目录**上的含义为什么不同、`umask` 的算法、粘滞位（`/tmp` 为什么需要它），以及 `setuid` 到底是个什么机制。
