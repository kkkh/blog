---
title: 'Linux 基础 16：SELinux——当权限都对，服务还是被拒绝'
description: '三种模式与 enforcing 的真正含义、ls -Z / ps -Z 里的安全上下文怎么读、chcon 与 restorecon 的区别、semanage fcontext 才是正确做法、booleans 开关，以及"服务读不到自己目录"的标准定位流程。'
link: linux-16-selinux
catalog: true
date: 2022-04-24 20:30:00
updated: 2022-04-24 22:10:00
categories: ['笔记']
tags: ['Linux', '基础']
draft: false
---

## 这一节要解决什么

有一种故障特别费解：文件权限、属主、路径全都对，`namei -l` 一路畅通，**服务还是被拒绝**——日志里只有一句 `Permission denied`。如果你在 RHEL/CentOS/Rocky 上，八成撞上了 SELinux。

它检查的不是"你是谁"，而是"**你这个进程带着什么标签，要去碰什么标签的东西**"。这是完全另一套模型。

## 一、三种模式（先搞清楚在不在拦你）

```bash title="三个命令先摸底" command:("$":1-4)
getenforce                     # Enforcing / Permissive / Disabled
sestatus                       # 完整状态：策略类型、加载的策略名、当前模式
sestatus -b | head             # booleans 概览
sudo setenforce 0              # 临时切成 permissive（重启后失效，仅用于验证假设）
```

| 模式 | 行为 |
| --- | --- |
| `enforcing` | **真的拦截**，并记录 AVC 拒绝日志 |
| `permissive` | **不拦截**，但照样记录 AVC（排障黄金档位：能验证"是不是 SELinux 干的"） |
| `disabled` | 完全不加载策略 |

:::info
**排障的第一步永远是"切 permissive 复现一次"**：如果切到 permissive 问题就消失了，那 100% 是 SELinux；如果照样失败，就该回去看权限/路径，而不是在 SELinux 上耗时间。
`setenforce 0` 只是临时验证，**别当成修复手段长期开着**。
:::

## 二、安全上下文：`ls -Z` 在说什么

```bash title="给文件和进程打上 -Z 看上下文" command:("$":1-4)
ls -Z /var/www/html/index.html       # 文件的 context: user:role:type:level
ps -efZ | grep nginx | head          # 进程的 context（进程带的是什么标签）
id -Z                                # 当前 shell 的 context
matchpathcon /var/www/html/index.html  # 该路径“按策略应该”是什么标签 ⭐
```

```text
system_u:object_r:httpd_sys_content_t:s0  /var/www/html/index.html
                     ↑ 这一段（type）才是日常最常打交道的
```

日常真正起作用的是**第三段 type**：

| type | 典型含义 |
| --- | --- |
| `httpd_sys_content_t` | 允许 httpd 读的网站内容 |
| `httpd_sys_rw_content_t` | 允许 httpd 读写（上传目录用） |
| `var_log_t` | 日志目录 |
| `ssh_port_t` / `http_port_t` | 允许对应服务监听的端口类型 |
| `unconfined_t` | 未受限制（默认用户态） |

**批注**：`matchpathcon`（新系统用 `matchpathcon -n` 或 `selabel_lookup`）能回答"这个路径**应该**是什么标签"——这是判断"标签是否被弄脏"的最快方式。

## 三、修标签：`chcon` 是临时的，`restorecon` 是恢复，`semanage fcontext` 才是正解

```bash title="三种改法，用途完全不同" command:("$":1-5)
# ① 临时改（重启/relabel 后会丢，只适合验证）
sudo chcon -t httpd_sys_content_t /srv/www/index.html

# ② 恢复成“策略规定的默认值”（最常用）
sudo restorecon -Rv /srv/www            # -R 递归，-v 显示改了什么

# ③ ⭐ 正确做法：先写进策略，再恢复
sudo semanage fcontext -a -t httpd_sys_content_t '/srv/www(/.*)?'
sudo restorecon -Rv /srv/www
sudo semanage fcontext -l | grep '/srv/www'
```

**为什么 `chcon` 不够**：它是"一次性打补丁"。下次系统做全盘 relabel（`touch /.autorelabel` 后重启、或 `restorecon -R /`）时，所有手工 `chcon` 的标签都会**被重置回策略默认值**——你的服务又坏了。`semanage fcontext` 把规则写进策略数据库，才是持久解法。

## 四、booleans：策略提供的"开关"

很多 "SELinux 不允许" 的场景，官方早就准备了开关，只是默认关着：

```bash title="常用开关" command:("$":1-5)
getsebool -a | grep -i httpd | head          # 看 httpd 相关开关
sudo setsebool -P httpd_can_network_connect on   # ⭐ -P 持久化（重启仍在）
getsebool httpd_can_network_connect
# 其他高频开关：
#   httpd_can_sendmail            允许 httpd 发邮件
#   httpd_read_user_content       允许读家目录内容（网站放家目录时）
#   container_manage_cgroup       容器相关
```

**批注**：`setsebool` **不加 `-P` 就只是临时生效**——这事我在第一次配反代时踩过：本机 `on` 好了，重启后又变回去，服务连不上后端。

## 五、端口与网络：`semanage port`

"非标准端口起服务"会被拦，因为策略里没有声明这个端口：

```bash title="放行自定义端口" command:("$":1-3)
sudo semanage port -l | grep -w http_port_t      # 看 http 允许哪些端口
sudo semanage port -a -t http_port_t -p tcp 8080  # 新增
sudo semanage port -d -t http_port_t -p tcp 8080  # 删除
```

## 六、标准定位流程（照这个顺序走）

```bash title="五步定位" command:("$":1-6)
# 1) 真的拦了吗？切 permissive 复现
sudo setenforce 0     # 问题消失 → 就是它；记得切回 setenforce 1

# 2) 找 AVC 拒绝记录
sudo ausearch -m avc -ts recent                 # 最近的拒绝
sudo ausearch -m avc -ts today | tail -20       # 今天的
sudo journalctl -t audit | grep -i denied | tail -10

# 3) 人类可读的建议（装 setroubleshoot 后才有）
sudo sealert -a /var/log/audit/audit.log | head -40

# 4) 对比标签
ls -Z 目标文件 | head -1; matchpathcon 目标文件

# 5) 按类型修：标签 → semanage fcontext + restorecon；开关 → setsebool -P；端口 → semanage port -a
```

一条真实 AVC 长这样（关注 `scontext`/`tcontext`/`tclass`）：

```text
type=AVC msg=audit(…): avc:  denied  { read } for  pid=1234 comm="nginx"
  name="index.html" scontext=system_u:system_r:httpd_t:s0
  tcontext=unconfined_u:object_r:user_home_t:s0 tclass=file
```

**读法**：`scontext` 是进程（`httpd_t`），`tcontext` 是被访问对象的标签（`user_home_t`）——这里的问题很典型：**网站文件放在家目录里，标签是 `user_home_t`，httpd 读不了**。解法就是 `semanage fcontext` + `restorecon`，或开 `httpd_read_user_content`。

## 七、和 AppArmor 的关系（Ubuntu 用户必看）

| | SELinux | AppArmor |
| --- | --- | --- |
| 模型 | **标签**（不管路径，只管类型） | **路径**（针对具体程序与路径） |
| 默认发行版 | RHEL / CentOS / Rocky / Fedora | Ubuntu / Debian / SUSE |
| 状态命令 | `getenforce`、`sestatus` | `aa-status` |
| 配置目录 | `/etc/selinux/` | `/etc/apparmor.d/` |

**批注**：所以"Ubuntu 上没 SELinux"是正常的——它默认用 AppArmor。看到 Ubuntu 上的 `Permission denied` 却查不到 SELinux，就该去 `aa-status` 看看是不是 AppArmor 在拦。

## 八、动手清单

```bash title="在 RHEL 系机器上练（Ubuntu 可对照 aa-status）" command:("$":1-6)
getenforce; sestatus | head -8                    # 1. 模式与策略
ls -Z /var/www/html/ | head                       # 2. 文件标签
ps -efZ | grep -E 'nginx|httpd' | head            # 3. 进程标签
sudo ausearch -m avc -ts today | tail -20         # 4. 今天的 AVC
getsebool -a | grep -i httpd | head               # 5. booleans
sudo semanage port -l | grep -w http_port_t       # 6. 端口类型
```

## 小结

- SELinux 检查的是**标签**，不是传统权限；`enforcing` 才拦，`permissive` 只记日志——排障第一步是"切 permissive 复现"。
- 日常打交道的是 context 的第三段 **type**；`matchpathcon` 能告诉你"策略里应该是哪个 type"。
- **`chcon` 是临时的**（relabel 后失效），持久修法永远是 `semanage fcontext` + `restorecon`。
- booleans 用 `setsebool -P` 才持久；自定义端口用 `semanage port -a`。
- 定位流程：切 permissive → `ausearch -m avc` → `sealert` 读建议 → 修标签/开关/端口。
- Ubuntu 系默认是 **AppArmor**，别拿 SELinux 的思路硬套。

## 下一节预告

下一节：防火墙——netfilter 与 iptables/nftables 的关系、firewalld 的 zone 模型、ufw 的简化用法、docker 插入的 `DOCKER-USER` 链为什么会"绕过 ufw"，以及"机器放行了但外面还是不通"时的检查顺序（云安全组在更外层）。
