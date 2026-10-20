---
title: 'Linux 基础 13：网络基础——自下而上的排错顺序'
description: '接口/IP/路由/端口/DNS 五层排查顺序、ip 与 ss 取代 netstat 的用法、ss 显示 LISTEN 却连不上的真实原因、getent 与 dig 在 DNS 排障里的分工，以及 curl 排错工具箱（--resolve / -w / -x）。'
link: linux-13-networking-basics
catalog: true
date: 2022-04-21 20:30:00
updated: 2022-04-21 22:10:00
categories: ['笔记']
tags: ['Linux', '基础']
draft: false
---

## 这一节要解决什么

"网站打不开"是范围最大的报障。要把它拆成可验证的小问题，需要的是一套**固定顺序**：接口 → IP → 路由 → 端口 → DNS → 应用。顺序对了，问题会自己缩到一层里。

## 一、五层排查顺序（自下而上）

```text
① 链路与接口：网卡在不在、有没有 up、有没有丢包
② 地址：本机 IP/掩码对不对
③ 路由：默认网关在不在、能不能出去
④ 端口与服务：监听在不在、绑的地址对不对、防火墙放没放
⑤ DNS：名字能不能解析、解析到哪
⑥ 应用：HTTP 状态码、超时、证书
```

```bash title="① ② ③ 一次性摸清" command:("$":1-5)
ip -br a                      # 简短格式：接口名 + 状态 + 地址（我最常用的第一条）
ip -s link show eth0          # 统计：errors/dropped 是否在涨（硬件层面问题）
ip route                      # 默认网关（default via ...）
ip neigh                      # ARP 邻居表（同网段通不通的线索）
ping -c3 8.8.8.8              # 出网（绕过 DNS，直接测三层）
```

**批注**：`ping` 到 IP 通、到域名不通 → 直接锁定 DNS；`ping` 都不通 → 看看 `ip -br a` 里接口有没有 `UP`、`ip route` 有没有网关。这两步能把大半问题在地三层之内解决。

## 二、端口：ss 取代 netstat

```bash title="列出监听与连接" command:("$":1-5)
ss -tulpen                    # t=TCP u=UDP l=LISTEN p=进程 e=扩展信息 n=数字端口 ⭐
ss -tan state established     # 只看已建立的连接
ss -s                         # 汇总：各种状态的连接数
sudo ss -ltnp                 # 需要进程名时加 sudo（-p 要求权限）
lsof -i :80 ; sudo fuser -n tcp 80    # 另一个视角：谁占着 80
```

```text
LISTEN  0  511   127.0.0.1:80   0.0.0.0:*   users:(("nginx",pid=1234,fd=6))
                 ↑ 注意这里！
```

:::info
**最经典的一个坑**：`ss` 显示端口在 LISTEN，但外部就是连不上——因为进程**只绑在 `127.0.0.1`**（只能本机访问），而不是 `0.0.0.0`（所有地址）。Nginx 的 `listen 127.0.0.1:80`、Node 的 `app.listen(3000, 'localhost')` 都会造成这个现象。
**判定方法**：`ss -ltn` 里看 `Local Address:Port` 那列的地址；写 `0.0.0.0` 或 `*` 才是"对外可达"。
:::

## 三、DNS：`getent` 与 `dig` 分工不同

解析路径是**分层的**：`/etc/hosts` → NSS（由 `/etc/nsswitch.conf` 决定顺序）→ DNS（`/etc/resolv.conf` 或 systemd-resolved 的 `127.0.0.53`）。

```bash title="两个命令各司其职" command:("$":1-5)
getent hosts example.com         # ⭐ 走 NSS：/etc/hosts 也生效（测“程序真正走的路径”）
dig +short example.com           # 直接查 DNS（不走 hosts）
dig @8.8.8.8 +short example.com  # 指定解析器对比
dig -x 8.8.8.8 +short            # 反向解析
cat /etc/nsswitch.conf | grep hosts   # 顺序：files 在前还是 dns 在前
```

**批注**：`/etc/hosts` 里加了一条记录却不生效？因为程序可能走的是 DNS 里查到的地址——`getent hosts` 才是"程序看到的答案"。另外记得看 `resolv.conf` 是不是被指向 `127.0.0.53`（systemd-resolved），那种情况下手改 `resolv.conf` 会被覆盖。

```bash title="名字解析的三个动作" command:("$":1-3)
resolvectl status 2>/dev/null | head -12   # systemd-resolved 环境（Debian/Ubuntu 常见）
systemd-resolve --status 2>/dev/null | head -12
cat /etc/resolv.conf
```

## 四、curl：应用层的听诊器

```bash title="五个必用的 curl 技巧" command:("$":1-6)
curl -v https://example.com | head -20        # 完整握手过程（看它卡在哪一步）
curl --resolve example.com:443:1.2.3.4 https://example.com/  # ⭐ 绕过 DNS 直连某个后端
curl -w '%{http_code} %{time_total} %{time_connect}\n' -o /dev/null -s https://example.com
curl -x http://127.0.0.1:7890 https://example.com            # 走代理测试
curl --max-time 5 -sS https://example.com > /dev/null   # 5 秒超时 + 显示错误
```

**批注**：`--resolve` 是我最常用的排错技巧之一——**它能区分"DNS 解析错"和"后端本身有问题"**。另外注意 `--max-time`：不带它时 curl 可能挂很久，把排障节奏拖死。

## 五、两个真实场景

**场景 1：域名能 ping 通、curl 却超时**

- `ss -ltn` 看服务是否在跑 → 不在就跑起来；
- 看**绑的地址**（127.0.0.1 还是 0.0.0.0）→ 上面那个经典坑；
- 看防火墙（第 17 节详谈）→ `iptables -S` 或 `nft list ruleset`；
- 看是否有代理环境变量（`env | grep -i proxy`）→ 容器里经常继承了一个错误的代理。

**场景 2：`curl: (6) Could not resolve host`**

- `getent hosts 域名` 是否为空 → 空的说明解析链路有问题；
- `cat /etc/resolv.conf` → nameserver 是否可达（`dig @nameserver` 直接问它）；
- 容器里：`/etc/resolv.conf` 常由 Docker 注入，宿主机改了不等于容器里改了。

## 六、动手清单

```bash title="按顺序跑一遍" command:("$":1-7)
ip -br a                                 # 1. 接口与地址
ip route                                 # 2. 默认网关
ping -c2 1.1.1.1                         # 3. 三层连通（绕过 DNS）
ss -tulpen | head                        # 4. 监听清单（看绑的地址）
getent hosts github.com                  # 5. 走 NSS 的解析
dig +short github.com                    # 6. 直接问 DNS
curl -w '%{http_code} %{time_total}\n' -o /dev/null -s https://example.com  # 7. 应用层四要素
```

## 小结

- 顺序固定：**接口 → 地址 → 路由 → 端口 → DNS → 应用**；`ping IP` 通不通是分水岭。
- `ip -br a`、`ip route`、`ss -tulpen` 是这套顺序里的三把主力工具（`netstat` 已被取代）。
- `ss` 显示 LISTEN 却连不上，先看 **Local Address 是不是 127.0.0.1**。
- `getent hosts` 看程序真正走的解析路径；`dig` 直接问 DNS；两者分工不能混。
- `curl -v` + `--resolve` + `-w` 能把应用层的问题定位到具体环节。

## 下一节预告

下一节：SSH 与远程运维——密钥与权限要求的来龙去脉、`sshd_config` 的安全项、`rsync` 的增量与 `--delete` 的风险、三种端口转发，以及"改 sshd 配置前后必须做的事"。
