---
title: 'Linux 基础 04：权限与属主——rwx 在文件和目录上不是一回事'
description: '九位权限的真正含义、为什么"能删掉自己没写权限的文件"、"ls 看得到名字却读不了内容"的原因、umask 的算法、粘滞位保护了什么，以及 setuid 是怎么把 passwd 变提权入口的。'
link: linux-04-permissions
catalog: true
date: 2022-04-12 20:30:00
updated: 2022-04-12 22:10:00
categories: ['笔记']
tags: ['Linux', '基础']
draft: false
---

## 这一节要解决什么

很多人对权限的理解停在“`chmod 777` 就能解决”。但真实现场里最常见的 403 不是权限不够，而是**某一级目录缺了 `x`**；最常见的误解是“我没有这个文件的写权限，怎么可能删掉它”。这两个问题只有一个解释：**`rwx` 在文件上和目录上是两套语义**。

## 一、九位权限：三种身份 × 三组权限

```bash title="把 ls -l 拆开读" command:("$":1)
ls -l /etc/passwd /tmp /usr/bin/passwd; stat -c '%a %A %U:%G %n' /etc/passwd /tmp
```

```text
-rw-r--r--  1 root root 2612 ... /etc/passwd
drwxrwxrwx   9 root root 4096 ... /tmp        ← 真的 777 吗？继续看粘滞位
```

| 位 | 含义 | 数字 |
| --- | --- | --- |
| `r` | 读 | 4 |
| `w` | 写 | 2 |
| `x` | 执行 / 穿过 | 1 |

三组分别是**属主（u）/ 属组（g）/ 其他（o）**。改权限两种写法：`chmod 644 f`（数字）或 `chmod u+x,g-w,o=r f`（符号）。我平时用数字看结果、用符号做增量修改：

```bash title="改权限的常用姿势" command:("$":1-5)
chmod 640 secret.txt            # 属主读写，属组只读，其他人无权
chmod u+x script.sh             # 只给属主加执行位
chmod -R o-rwx /srv/private     # 递归去掉其他人的一切权限
chmod --reference=a.txt b.txt   # 抄 a 的权限
umask -S                        # 看当前 umask 的符号形式
```

## 二、核心：`rwx` 在目录上完全不同

:::info
**文件上**：`r` 读内容、`w` 改内容、`x` 可执行。
**目录上**：`r` 列举目录项（`ls`）、`w` 增删改目录项（改名、删除、新建）、`x` 穿过/进入（`cd`、访问子项）。
:::

这三种能力可以互相独立，于是出现了两个经典现象：

```bash title="只有 r、没有 x 的目录" command:("$":1-4)
mkdir -p t/sub; echo hi > t/sub/f
chmod 400 t        # 目录: r-- 
ls t               # ✅ 能看到名字（r 够用）
cat t/sub/f        # ❌ Permission denied（没有 x，穿不过去）
```

```bash title="只有 x、没有 r 的目录" command:("$":1-2)
chmod 100 t        # 目录: --x
ls t               # ❌ 不能列举（没有 r）
cat t/sub/f        # ✅ 知道确切路径就能读（x 够用）
```

**我的批注**：第一条是排障的钥匙。很多“网页 403”“打开某目录报 Permission denied”都是**路径上某一级目录缺 x**——哪怕目标文件本身是 644。排查时从 `/` 开始逐级 `namei -l <路径>`：

```bash title="逐级看路径上的权限（排 403 神器）" command:("$":1) mark:1
namei -l /srv/www/site/public/index.html
```

第二条更反直觉：**能不能删掉一个文件，取决于父目录的 `w`+`x`，跟文件自己的权限无关**。

```bash title="文件的 w 权限不影响删除" command:("$":1-3)
mkdir d; echo secret > d/f; sudo chown root:root d/f; chmod 444 d/f
ls -l d/f              # -r--r--r--  ← 你自己没有写权限
rm d/f                 # ✅ 照样删得掉（因为 d 属于你，且可写可穿）
```

`rm` 动的是**目录项**，不是文件内容——这就是第 02 篇“文件名属于目录”的实际后果。

## 三、umask：新建文件/目录的默认权限

新建时的规则是**减（按位取反后再与）**：

```text
文件：666 & ~umask
目录：777 & ~umask
```

```bash title="umask 的实际算法" command:("$":1-3)
umask            # 常见 0022
umask 027 ; touch f ; mkdir d ; stat -c '%a %n' f d     # 文件 640，目录 750
umask 077 ; touch f2 ; mkdir d2 ; stat -c '%a %n' f2 d2 # 文件 600，目录 700
```

注意两个例外：`cp -p`、`cp -a`、`mv` 保留源权限，**不受 umask 影响**；`chmod` 更是直接覆盖。

真实场景：ssh 私钥必须收紧到 600，否则连接直接被拒。

```bash title="ssh 私钥权限" command:("$":1-2)
chmod 600 ~/.ssh/id_rsa
ssh -i ~/.ssh/id_rsa host   # @@@ WARNING: UNPROTECTED PRIVATE KEY FILE! 消失
```

## 四、三个特殊位：setuid、setgid、sticky

```bash title="特殊位在 ls -l 里的位置" command:("$":1-2)
ls -l /usr/bin/passwd   # -rwsr-xr-x  ← 属主执行位变成 s
stat -c '%a %n' /tmp    # 1777 → 末位的 1 就是 sticky
```

| 位 | 数字 | 作用 | 典型场景 |
| --- | --- | --- | --- |
| **setuid** | 4 | 执行时把**有效 UID** 换成文件属主 | `/usr/bin/passwd` 需要改 `/etc/shadow`（普通用户本无权），靠 setuid root 完成 |
| **setgid** | 2 | 文件：执行时有效 GID 换成文件属组；目录：**新建文件继承目录的属组** | 团队共享目录 `chmod g+s /srv/team` |
| **sticky** | 1 | 目录内文件**只有属主/目录属主/root 能删** | `/tmp` 是 `1777`，谁都能写，但不能删别人的文件 |

```bash title="审计：列出系统里所有 setuid 程序" command:("$":1) mark:1
sudo find / -xdev -perm -4000 -type f 2>/dev/null | sort
```

:::warning
**两个必须知道的坑**
1. **shell 脚本的 setuid 位会被内核忽略**——所以“给脚本加 setuid 实现提权”在 Linux 上不成立（`#!/bin/sh` 的脚本 setuid 无效）。真要这样做事，用二进制程序或 `sudo` 规则。
2. **自定义 setuid 程序就是提权入口**。上面那条 `find -perm -4000` 列出来的东西值得定期过一眼：多出来的那个，往往是有人装了什么。
:::

## 五、属主与属组

```bash title="chown / chgrp 的正确用法" command:("$":1-4)
sudo chown alice file                  # 改属主
sudo chown alice:devs file             # 同时改属主与属组
sudo chown -R alice:devs /srv/app      # 递归（⚠️ 会一路改下去，先 namei -l 看清范围）
sudo chown --reference=/srv/app /srv/app2
```

**批注**：`chown -R` 是最容易造成事故的递归操作之一——`/srv/app` 里如果挂了别的用户的数据（或者你写错成 `/`），影响面立刻扩散。我现在固定先 `find /srv/app -maxdepth 1 -printf '%u:%g %p\n'` 看一眼再动手。

## 六、三个真实故障的定位顺序

| 现象 | 真正原因 | 检查命令 |
| --- | --- | --- |
| 网页 403，文件本身是 644 | **路径上某一级目录缺 `x`** | `namei -l /srv/www/.../index.html` |
| `ssh` 报 `UNPROTECTED PRIVATE KEY FILE` / `bad permissions` | 私钥权限过宽；或**家目录/.ssh 被其他用户可写**（StrictModes） | `chmod 700 ~ ~/.ssh; chmod 600 ~/.ssh/id_*` |
| “我在这个目录里改不了文件” | 有 `x` 没有 `w`，只能穿过不能改目录项 | `ls -ld .`、`stat -c '%a %n' .` |

## 七、动手清单

```bash title="把本节结论逐条验一遍" command:("$":1-10)
mkdir -p t/sub; echo hi > t/sub/f
chmod 400 t; ls t; cat t/sub/f          # 1. r 能列、无 x 不能穿
chmod 100 t; ls t 2>&1 | head -1; cat t/sub/f   # 2. x 能穿、无 r 不能列
chmod 755 t; namei -l t/sub/f           # 3. 逐级看权限
mkdir d; echo x > d/f; chmod 444 d/f; rm d/f    # 4. 删除看父目录
umask; umask -S                         # 5. 默认权限从哪来
ls -l /usr/bin/passwd; stat -c '%a %n' /tmp      # 6. s 位与 sticky
sudo find / -xdev -perm -4000 -type f 2>/dev/null | sort   # 7. setuid 审计
```

## 小结

- 目录的 `r/w/x` = 列举 / 改目录项 / 穿过；**删除文件看父目录权限**，不看文件自身。
- `namei -l` 是"逐级看权限"的主力工具，专治 403。
- `umask` 是"从 666/777 里减掉"；`cp -p` / `mv` 不受它影响。
- `setuid` 换有效 UID、`setgid` 让新文件继承属组、`sticky` 保护 `/tmp`；脚本的 setuid 位无效。
- 权限问题的排查顺序永远是：**路径每一级的 x → 目标文件权限 → 属主/属组是否匹配运行身份**。

## 下一节预告

下一节转向文本：`grep`、`sort`、`uniq`、`cut`、`tr`——为什么它们组合起来能顶替大部分“手写小工具”，以及“**流式思维**”：数据一次只过一个管道，不做中间文件。
