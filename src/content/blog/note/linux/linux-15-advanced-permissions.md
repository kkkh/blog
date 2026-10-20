---
title: 'Linux 基础 15：权限进阶——sudoers 的通配陷阱、ACL 与 capabilities'
description: 'sudoers 里通配符为什么等于送 root、ACL 与 mask 的相互作用、ls -l 末尾那个 + 的含义、默认 ACL 让目录"继承"权限，以及 capabilities 如何把 root 拆成细粒度能力（setcap 的真实用法与失效场景）。'
link: linux-15-advanced-permissions
catalog: true
date: 2022-04-23 20:30:00
updated: 2022-04-23 22:10:00
categories: ['笔记']
tags: ['Linux', '基础']
draft: false
---

## 这一节要解决什么

第 04 篇讲了传统的 `rwx`，但它只能表达"属主 / 属组 / 其他人"三档。现实需求经常更细：**只给某个人读写**（ACL）、**只给某个特权**（capabilities）、**只给某条命令的 root 权限**（sudoers，但要写对）。这一节把这三层补齐，并给出各自的失效场景。

## 一、sudoers：通配符 = 把 root 送出去

```bash title="看起来很方便，其实很危险" command:("$":1-3) mark:2
# ❌ 危险：允许重启“任何”服务，也能执行 `systemctl edit` 改单元再重启
deploy ALL=(root) NOPASSWD: /bin/systemctl restart *
# ✅ 限定到具体单元，并禁止交互式编辑
deploy ALL=(root) NOPASSWD: /bin/systemctl restart nginx.service
deploy ALL=(root) NOPASSWD: /bin/systemctl status nginx.service
```

```bash title="核查与调试" command:("$":1-4)
sudo -l                     # 当前身份有哪些规则（含来源文件）
sudo -ll                    # 长格式
sudo visudo -c              # 语法检查全部 sudoers 文件
sudo -u deploy sudo -l      # 以目标身份验证规则是否符合预期
```

**批注**：

- 通配符的风险不在"语义"，在**参数的组合空间**。`systemctl restart *` 可以被用来 `edit` 覆盖 unit 文件，或重启一个你精心做过的安全边界；`/usr/bin/vi *` 更直接——`vi` 本身就能起 shell。
- 安全写法是**列举具体命令 + 具体参数**，能用别名（`Cmnd_Alias`）就集中管理。另外 `Defaults env_keep` 要谨慎：保留 `LD_PRELOAD`、`PATH` 这类变量等于给了绕过手段。

## 二、ACL：把权限给到"某一个人"

传统九位权限没有"指定第三人"的表达力，ACL 补上这一层：

```bash title="ACL 的基本用法" command:("$":1-6)
getfacl /srv/app/log              # 查看（含默认规则与 mask）
setfacl -m u:alice:rw /srv/app/log        # 给 alice 单独的读写
setfacl -m g:devs:r /srv/app/log          # 给一个组只读
setfacl -x u:alice /srv/app/log           # 删除某条
setfacl -b /srv/app/log                   # 清空所有 ACL
setfacl -R -m u:alice:rwX /srv/app/shared # 递归（注意大写 X：只给目录加执行位）
```

```bash title="默认 ACL：让新文件自动继承" command:("$":1-3)
setfacl -d -m u:alice:rwX /srv/app/team   # -d = default：此后新建文件继承这套规则
getfacl /srv/app/team | sed -n '/^default/,$p'
# 效果：team 里新建的文件/子目录都会自动带上 alice 的权限
```

:::warning
**`mask` 是 ACL 里最容易困惑的一块。** `getfacl` 输出里的 `mask::rwx` 会**限制所有"命名用户/命名组"条目的有效权限**：
```bash title="被 mask 截断的例子"
setfacl -m u:alice:rw file
setfacl -m m::r file          # mask 只给 r → alice 实际也只有 r（getfacl 里会显示 #effective:r--）
```
所以"我明明给了 rw 却不生效"，先看 `mask`；要么显式设置 `setfacl -m m::rw`，要么用 `-n`（`setfacl -n` 不自动重算 mask）。
:::

还有一个"忘记检查"的信号：`ls -l` 里权限末尾的 **`+`** 说明这个文件有 ACL。

```bash title="ls 与 getfacl 对照" command:("$":1-2)
ls -l /srv/app/log     # -rw-rw----+  ← 末尾的 + 表示“还有 ACL 没显示出来”
getfacl /srv/app/log   # 看完整的
```

## 三、capabilities：把 root 的全能拆开

root 之所以能"什么都干"，是因为它带着一整套 capabilities（`cap_net_bind_service`、`cap_sys_admin`、`cap_chown` 等）。把特权拆开之后，很多场景就不需要 root 了：

```bash title="看与给" command:("$":1-5)
getcap -r / 2>/dev/null | head            # 系统里哪些文件带能力
getcap /usr/bin/ping                       # 常见例子：ping 需要 cap_net_raw
sudo setcap cap_net_bind_service=+ep /usr/local/bin/myapp   # 允许绑定 80/443
getcap /usr/local/bin/myapp
sudo setcap -r /usr/local/bin/myapp        # 移除（-r 等于清空）
```

| 能力 | 作用 | 典型用途 |
| --- | --- | --- |
| `cap_net_bind_service` | 绑定 < 1024 端口 | 让非 root 进程监听 80/443 |
| `cap_net_raw` | 原始套接字 | `ping`、抓包 |
| `cap_sys_admin` | 挂载等大权 | 容器/工具链内部使用（**等于半个 root，慎给**） |
| `cap_chown` | 改文件属主 | 备份/同步工具 |

**批注**：`setcap` 的两个坑——

1. **包升级会清掉能力**：文件被替换后 `setcap` 设置丢失（xattr 不一定保留），所以你要把这个动作写进部署脚本/自动化，不然下次升级静默失效。
2. 现代服务更推荐用 systemd 的 `AmbientCapabilities=` / `CapabilityBoundingSet=` 声明，比给二进制打标签更可控、也更好审计（也更符合"配置即代码"）。

## 四、四层权限工具的分工（一张表收束）

| 工具 | 粒度 | 典型问题 | 何时用 |
| --- | --- | --- | --- |
| `chmod`/`chown` | 属主/属组/其他人 三档 | 目录缺 `x`、文件 644 | 日常（第 04 节） |
| **ACL** | 具体用户/组 | "只让 alice 读写这个文件" | 共享目录、多方协作 |
| **capabilities** | 具体特权 | "非 root 绑定 80" | 服务降权、容器 |
| **SELinux** | 具体标签（context） | "服务读不到自己的配置目录" | 强制访问控制（下一节） |
| `sudoers` | 命令级提权 | "只允许重启这一个服务" | 运维授权 |

## 五、动手清单

```bash title="在测试目录里练" command:("$":1-7)
mkdir -p /tmp/acl && touch /tmp/acl/f
setfacl -m u:"$(whoami)":rw /tmp/acl/f; getfacl /tmp/acl/f | head    # 1. 加一条 ACL
ls -l /tmp/acl/f                                        # 2. 末尾出现 +
setfacl -m m::r /tmp/acl/f; getfacl /tmp/acl/f | grep -E 'mask|effective'  # 3. 看 mask 的影响
setfacl -b /tmp/acl/f; ls -l /tmp/acl/f                 # 4. 清掉后 + 消失
sudo setcap cap_net_bind_service=+ep /usr/bin/env; getcap /usr/bin/env  # 5. （测试机）设置并回读
sudo setcap -r /usr/bin/env                              # 6. 立即撤销
sudo visudo -c                                           # 7. sudoers 语法自检
```

## 小结

- sudoers 里**通配符等于把 root 送出去**；规则要列举到具体命令与参数，改完用 `visudo -c` 自检。
- ACL 把权限给到具体用户/组；**`mask` 会截断命名条目的有效权限**，"给了却不生效"先查 mask；`ls -l` 末尾的 `+` 表示有 ACL。
- 默认 ACL（`setfacl -d`）能让目录里新建的文件自动继承权限，是共享目录的正确解法。
- capabilities 把 root 拆成细粒度能力（`cap_net_bind_service`、`cap_net_raw`）；`setcap` 的设置在**包升级后会丢失**。
- 四层工具分工：chmod（三档）→ ACL（到人）→ capabilities（到特权）→ SELinux（到标签）。

## 下一节预告

下一节：**SELinux**——`enforcing/permissive/disabled` 三种模式、`ls -Z` 里的上下文长什么样、`chcon`/`restorecon`/`semanage fcontext` 的区别、booleans 开关，以及"服务读不到自己目录"这类故障的标准定位流程。
