---
title: 'Linux Basics 17: Firewalls — How iptables, nftables, firewalld And ufw Relate'
description: 'Where netfilter sits in the kernel, the difference between iptables and nftables, the firewalld zone model and why --reload is mandatory, everyday ufw rules, why Docker’s DOCKER-USER chain makes published ports bypass ufw, and the outside-in checking order when a host allows a port but the world still cannot reach it.'
link: linux-17-firewalls
catalog: true
date: 2022-04-25 20:30:00
updated: 2022-04-25 22:10:00
categories: ['笔记']
tags: ['Linux', '基础']
draft: false
---

## What This Chapter Solves

“The port is open, the service is healthy, and it still will not connect” — the firewall is the usual suspect. But Linux has too many names for it (iptables, nftables, firewalld, ufw), so the first job is to see them as **four layers of one mechanism**. Otherwise you will hunt for a rule in the wrong tool.

## 1. Four Names, One Mechanism

```text
kernel: netfilter (where packets are actually filtered)
  ├── iptables   (the old front end, kept for compatibility; implemented by nf_tables on modern kernels)
  ├── nftables   (the new front end — the nft command)
  ├── firewalld  (a management framework, default on RHEL; uses nftables or iptables underneath)
  └── ufw        (Uncomplicated FireWall, Ubuntu’s simplified front end)
```

```bash title="Find out which stack this machine uses" command:("$":1-5)
sudo nft list ruleset | head            # output here → nftables rules live in the kernel
sudo iptables -S | head                 # the iptables view (may be translated from nft)
sudo firewall-cmd --state 2>/dev/null   # RHEL family
sudo ufw status verbose 2>/dev/null     # Ubuntu family
ss -ltnp | head                          # and never forget: where is the service listening? (ch. 13)
```

**Note:** `iptables -S` and `nft list ruleset` show **the same rules in two dialects**. So “there is no rule in iptables, why am I blocked?” — go look at nft, and vice versa.

## 2. firewalld: The Zone Model, Plus One Mandatory `--reload`

firewalld is built around **zones**: each interface belongs to a zone, and the zone decides what is allowed by default.

```bash title="Everyday firewalld" command:("$":1-6)
sudo firewall-cmd --get-active-zones        # which interface is in which zone
sudo firewall-cmd --zone=public --list-all  # the full rule set of a zone
sudo firewall-cmd --add-service=http --permanent     # allow http, written to config
sudo firewall-cmd --add-port=8080/tcp --permanent    # allow a custom port
sudo firewall-cmd --reload                  # ⭐ without --permanent it is temporary; with it you must reload
sudo firewall-cmd --panic-on                # emergency: drop everything
```

:::warning
**`--permanent` and `--reload` are two separate actions.** `--permanent` writes the configuration but **does not apply it**; `--reload` loads it into the kernel. Conversely, a change without `--permanent` applies immediately but **disappears on reboot**.
The correct move is always: `--add-xxx --permanent` then `--reload`. I have lost count of the times someone said “but I added the rule” — they simply forgot the reload.
:::

## 3. ufw: The Simplified Ubuntu Way

```bash title="The complete ufw routine" command:("$":1-6)
sudo ufw status verbose                    # state plus default policies
sudo ufw default deny incoming             # start from deny, then whitelist
sudo ufw default allow outgoing
sudo ufw allow 22/tcp                      # allow SSH (⚠️ on a remote box, do this before enabling!)
sudo ufw allow from 203.0.113.10 to any port 5432 proto tcp   # database reachable from one source only
sudo ufw status numbered; sudo ufw delete 3   # remove a rule by number
```

**Note:** before `ufw enable` you **must** have allowed SSH, or you lock yourself out — the classic beginner self-immolation. On a remote host the safe order is: `allow 22` → `enable` → verify you can still connect → tighten everything else.

## 4. iptables / nftables: Writing Rules Directly

```bash title="The minimal usable iptables set" command:("$":1-5) mark:2
sudo iptables -A INPUT -m conntrack --ctstate ESTABLISHED,RELATED -j ACCEPT  # ⭐ established traffic first
sudo iptables -A INPUT -p tcp --dport 22 -j ACCEPT
sudo iptables -A INPUT -p tcp --dport 80 -j ACCEPT
sudo iptables -A INPUT -i lo -j ACCEPT                        # loopback is fine
sudo iptables -P INPUT DROP                                   # set the default deny LAST (⚠️ it cuts you off)
```

**Note:** the `ESTABLISHED,RELATED` rule is what makes this a *stateful* firewall. Without it, replies to your own outbound requests are dropped — which looks like “traffic leaves but no answer comes back”. And `-P INPUT DROP` must be set last: wrong order means losing the connection instantly.

```bash title="The nftables equivalent" command:("$":1-5)
sudo nft add table inet filter
sudo nft add chain inet filter input '{ type filter hook input priority 0 ; policy drop ; }'
sudo nft add rule inet filter input ct state established,related accept
sudo nft add rule inet filter input tcp dport { 22, 80, 443 } accept
sudo nft list ruleset | head -20
```

Persistence: iptables uses `iptables-save` with `netfilter-persistent` (Debian) or `iptables-services` (RHEL); nftables rules usually live in `/etc/nftables.conf`, loaded by `nftables.service`.

## 5. A Real Trap: Docker Silently Disables ufw

```bash title="The symptom" command:("$":1-3)
sudo ufw status          # shows deny incoming
docker run -d -p 8080:80 nginx
curl -s -o /dev/null -w '%{http_code}\n' http://<public-ip>:8080   # and it works ⚠️
```

**Why:** Docker inserts its own `DOCKER` chain into netfilter to do DNAT, and **that chain is consulted before your ufw rules**, so a port published with `-p 8080:80` is directly reachable from outside — ufw simply cannot see it.

**Three fixes, best first:**

```bash title="Three fixes" command:("$":1-3)
# ① ⭐ safest: publish only on localhost, and let a host-level proxy face the world
docker run -d -p 127.0.0.1:8080:80 nginx
# ② add a rule in the DOCKER-USER chain (Docker guarantees it runs first)
sudo iptables -I DOCKER-USER -i eth0 -p tcp --dport 8080 -j DROP
# ③ change iptables behaviour in /etc/docker/daemon.json (affects all containers; use with care)
```

## 6. Checking Order: Outside In (The Most Useful Table Here)

| # | What to check | Command |
| --- | --- | --- |
| ① | cloud security group / network ACL | the console (**most often forgotten**) |
| ② | host firewall | `nft list ruleset` / `firewall-cmd --list-all` / `ufw status` |
| ③ | listening address | `ss -ltnp` (`127.0.0.1` versus `0.0.0.0`) |
| ④ | the service itself | `curl -v 127.0.0.1:<port>` |
| ⑤ | SELinux port type | `semanage port -l` (chapter 16) |
| ⑥ | the extra container layer | `iptables -t nat -L DOCKER -n` |

**Note:** steps ①②③ settle the overwhelming majority of “not reachable from outside”. Step ① especially: the cloud security group sits **outside the VM**, so no amount of host firewall editing will open it.

## 7. Hands-On Checklist

```bash title="Verify each item" command:("$":1-7)
sudo nft list ruleset | head -20            # 1. what the kernel actually holds
sudo iptables -S | head -20                 # 2. the iptables view
sudo firewall-cmd --get-active-zones 2>/dev/null; sudo ufw status verbose 2>/dev/null   # 3. framework state
ss -ltnp | head                             # 4. listening address (0.0.0.0 versus 127.0.0.1)
sudo iptables -L DOCKER-USER -n -v 2>/dev/null | head   # 5. has Docker inserted chains?
sudo nft list ruleset | grep -c 'ct state'  # 6. is there a conntrack rule?
curl -sv --max-time 3 http://127.0.0.1:80 2>&1 | grep -E 'Connected|refused'  # 7. direct local test
```

## Summary

- Four layers, one mechanism: **netfilter** in the kernel, iptables/nftables as front ends, firewalld/ufw as frameworks. `iptables -S` and `nft list ruleset` describe the same rules.
- firewalld: `--permanent` writes, `--reload` applies; ufw: `allow 22` must come before `enable`.
- Rule order for iptables/nftables: allow `ESTABLISHED,RELATED` and the needed ports first, and set the default DROP **last**.
- **Docker’s published ports bypass ufw**; fix it by binding to `127.0.0.1` or adding rules in `DOCKER-USER`.
- Troubleshoot outside in: **cloud security group → host firewall → listening address → service → SELinux port → containers**.

## Next Up

Performance observation: why `available` in `free` matters more than `free` itself, how to read `r/b/si/so` in `vmstat`, the division of labour between `iostat` and `pidstat`, a few key files under `/proc`, and `strace` for seeing exactly where a program is stuck — followed by the last two chapters (boot rescue, and a closing checklist).
