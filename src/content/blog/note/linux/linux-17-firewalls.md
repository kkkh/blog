---
title: 'Linux 基础 17：防火墙——iptables、nftables、firewalld 与 ufw 的关系'
description: 'netfilter 在内核里的位置、iptables 与 nftables 的差别、firewalld 的 zone 模型与 --reload 的必要性、ufw 的常用规则、Docker 插入的 DOCKER-USER 链为什么让 ufw 失效，以及"机器放行了但外网不通"的检查顺序。'
link: linux-17-firewalls
catalog: true
date: 2022-04-25 20:30:00
updated: 2022-04-25 22:10:00
categories: ['笔记']
tags: ['Linux', '基础']
draft: false
---

## 这一节要解决什么

"端口开了、服务正常、就是连不上"——防火墙是这一层的常见嫌疑人。但 Linux 上的防火墙名字太多（iptables / nftables / firewalld / ufw），先得搞清它们是**同一件事的四个不同层**，否则你会在错误的工具里找一个不存在的规则。

## 一、四个名字，一种机制

```text
内核：netfilter（真正过滤数据包的地方）
  ├── iptables（老前端，兼容层；现代内核由 nf_tables 后端实现）
  ├── nftables（新前端，nft 命令）
  ├── firewalld（管理框架，RHEL 系默认；内部可用 nftables 或 iptables）
  └── ufw（Uncomplicated FireWall，Ubuntu 的简化前端）
```

```bash title="先看这台机器用的是哪套" command:("$":1-5)
sudo nft list ruleset | head            # 有输出 → 内核里是 nftables 规则
sudo iptables -S | head                 # iptables 视角（可能被 nft 后端翻译）
sudo firewall-cmd --state 2>/dev/null   # RHEL 系
sudo ufw status verbose 2>/dev/null     # Ubuntu 系
ss -ltnp | head                          # 别忘了：服务究竟监听在哪（第 13 节）
```

**批注**：`iptables -S` 与 `nft list ruleset` 看到的是**同一批规则的不同表达**。所以"我明明在 iptables 里没规则，为什么还被拦"——去看看 nft；反过来也一样。

## 二、firewalld：zone 模型 + 一个必须记住的 `--reload`

firewalld 的核心是"**区域（zone）**"：每个网络接口属于一个 zone，zone 决定默认允许什么。

```bash title="firewalld 的日常" command:("$":1-6)
sudo firewall-cmd --get-active-zones        # 哪个接口属于哪个 zone
sudo firewall-cmd --zone=public --list-all  # 看这个 zone 的完整规则
sudo firewall-cmd --add-service=http --permanent     # 放行 http（--permanent 写进配置）
sudo firewall-cmd --add-port=8080/tcp --permanent    # 放行自定义端口
sudo firewall-cmd --reload                  # ⭐ 不加 --permanent 是临时的；加了必须 reload
sudo firewall-cmd --panic-on                # 紧急断网（拒绝一切）
```

:::warning
**`--permanent` 与 `--reload` 是两个独立动作**：`--permanent` 写配置但**不立即生效**，`--reload` 才把配置装载进内核。反过来，不加 `--permanent` 的改动立即生效但**重启就没了**。
所以正确姿势永远是：`--add-xxx --permanent` 然后 `--reload`。我见过太多次"我加了规则啊"——只是忘了 reload。
:::

## 三、ufw：Ubuntu 上的简化用法

```bash title="ufw 的完整套路" command:("$":1-6)
sudo ufw status verbose                    # 状态 + 默认策略
sudo ufw default deny incoming             # 先设默认拒绝入站（再加白名单）
sudo ufw default allow outgoing
sudo ufw allow 22/tcp                      # 放行 SSH（⚠️ 远程操作先放行再 enable！）
sudo ufw allow from 203.0.113.10 to any port 5432 proto tcp   # 只允许某来源访问数据库
sudo ufw status numbered; sudo ufw delete 3   # 按编号删规则
```

**批注**：`ufw enable` 之前**必须确保 SSH 已放行**，否则你会把自己关在门外（这是新手最经典的自杀式操作）。远程机器上正确的顺序是：`allow 22` → `enable` → 验证还能连上 → 再收紧其他规则。

## 四、iptables / nftables：直接写规则

```bash title="iptables 的最小可用集" command:("$":1-5) mark:2
sudo iptables -A INPUT -m conntrack --ctstate ESTABLISHED,RELATED -j ACCEPT  # ⭐ 先放行“已建立”
sudo iptables -A INPUT -p tcp --dport 22 -j ACCEPT
sudo iptables -A INPUT -p tcp --dport 80 -j ACCEPT
sudo iptables -A INPUT -i lo -j ACCEPT                        # 放行本地回环
sudo iptables -P INPUT DROP                                   # 最后才设默认拒绝（⚠️ 会断连）
```

**批注**：`ESTABLISHED,RELATED` 那条是"状态防火墙"的关键——没有它，你的出站请求的回包会被拦住（表现为"能连出去但收不到响应"）。另外 `-P INPUT DROP` 一定**最后**设：顺序错了就是当场断线。

```bash title="nftables 等价写法" command:("$":1-5)
sudo nft add table inet filter
sudo nft add chain inet filter input '{ type filter hook input priority 0 ; policy drop ; }'
sudo nft add rule inet filter input ct state established,related accept
sudo nft add rule inet filter input tcp dport { 22, 80, 443 } accept
sudo nft list ruleset | head -20
```

持久化：iptables 用 `iptables-save` / `netfilter-persistent`（Debian）或 `iptables-services`（RHEL）；nftables 规则通常写在 `/etc/nftables.conf`，由 `nftables.service` 加载。

## 五、真实坑：Docker 会让 ufw 失效

```bash title="现象" command:("$":1-3)
sudo ufw status          # 显示 deny incoming
docker run -d -p 8080:80 nginx
curl -s -o /dev/null -w '%{http_code}\n' http://<公网IP>:8080   # 居然通了 ⚠️
```

**原因**：Docker 会自己往 netfilter 里插 `DOCKER` 链做 DNAT，并且**Docker 链的优先级在 ufw 规则之前**，`-p 8080:80` 的端口因此直接从外部可达——ufw 只是"看不见"。

**三种解法**（按推荐度）：

```bash title="三种解法" command:("$":1-3)
# ① ⭐ 最稳：只发布到本机，由宿主机的反代来对外
docker run -d -p 127.0.0.1:8080:80 nginx
# ② 在 DOCKER-USER 链里加规则（Docker 保证它先被调用）
sudo iptables -I DOCKER-USER -i eth0 -p tcp --dport 8080 -j DROP
# ③ 改 /etc/docker/daemon.json 的 iptables 行为（影响所有容器，慎用）
```

## 六、检查顺序：从外到内（这一节最实用的一张表）

| 顺序 | 检查项 | 命令 |
| --- | --- | --- |
| ① | 云平台安全组 / 网络 ACL | 控制台（**最容易忘**） |
| ② | 主机防火墙 | `nft list ruleset` / `firewall-cmd --list-all` / `ufw status` |
| ③ | 服务监听地址 | `ss -ltnp`（`127.0.0.1` 还是 `0.0.0.0`） |
| ④ | 服务本身 | `curl -v 127.0.0.1:端口` |
| ⑤ | SELinux 端口类型 | `semanage port -l`（第 16 节） |
| ⑥ | 容器额外的一层 | `iptables -t nat -L DOCKER -n` |

**批注**：①②③ 三步能解决绝大多数"外网访问不了"。特别是 ①：云安全组在**虚拟机之外**，你在机器里怎么改防火墙都不会让它放行。

## 七、动手清单

```bash title="逐条验证" command:("$":1-7)
sudo nft list ruleset | head -20            # 1. 内核里到底有什么规则
sudo iptables -S | head -20                 # 2. iptables 视角
sudo firewall-cmd --get-active-zones 2>/dev/null; sudo ufw status verbose 2>/dev/null   # 3. 框架状态
ss -ltnp | head                             # 4. 监听地址（0.0.0.0 vs 127.0.0.1）
sudo iptables -L DOCKER-USER -n -v 2>/dev/null | head   # 5. Docker 是否插了链
sudo nft list ruleset | grep -c 'ct state'  # 6. 有没有 conntrack 规则
curl -sv --max-time 3 http://127.0.0.1:80 2>&1 | grep -E 'Connected|refused'  # 7. 本机直连测服务
```

## 小结

- 四层一个机制：内核 **netfilter**，前端有 iptables / nftables，管理框架有 firewalld / ufw；`iptables -S` 与 `nft list ruleset` 看的是同一批规则。
- firewalld：`--permanent` 写配置、`--reload` 才生效；ufw：`allow 22` 必须在 `enable` 之前。
- iptables/nftables 写规则顺序：先放行 `ESTABLISHED,RELATED` 与所需端口，**最后**再设默认 DROP。
- **Docker 的 `-p` 发布端口会绕过 ufw**；解法是绑 `127.0.0.1` 或在 `DOCKER-USER` 链里拦。
- 排查顺序从外到内：**云安全组 → 主机防火墙 → 监听地址 → 服务 → SELinux 端口 → 容器**。

## 下一节预告

下一节：性能观测——`free` 里 `available` 为什么比 `free` 更有意义、`vmstat` 的 `r/b/si/so` 怎么读、`iostat` 与 `pidstat` 的分工、`/proc` 下几个关键文件，以及 `strace` 入门（怎样一眼看出程序卡在哪）。还有 2 篇（24 启动救援、25 收尾清单）紧随其后。
