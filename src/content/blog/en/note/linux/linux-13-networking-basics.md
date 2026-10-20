---
title: 'Linux Basics 13: Networking Fundamentals — Troubleshoot From The Bottom Up'
description: 'The five-layer order (interface, address, route, port, DNS), ip and ss in place of netstat, the real reason a listening port still refuses connections, how getent and dig divide DNS work, and a curl toolkit with --resolve, -w and -x.'
link: linux-13-networking-basics
catalog: true
date: 2022-04-21 20:30:00
updated: 2022-04-21 22:10:00
categories: ['笔记']
tags: ['Linux', '基础']
draft: false
---

## What This Chapter Solves

“The site is down” is the widest-ranging report there is. Turning it into small verifiable questions needs one fixed order: interface → address → route → port → DNS → application. Get the order right and the problem collapses into a single layer.

## 1. Five Layers, Bottom Up

```text
① link and interface: does the NIC exist, is it up, are packets being dropped?
② address: is the local IP and netmask right?
③ route: is there a default gateway, can traffic leave?
④ port and service: is it listening, bound to the right address, allowed by the firewall?
⑤ DNS: does the name resolve, and to what?
⑥ application: HTTP status, timeouts, certificates
```

```bash title="① ② ③ in one sweep" command:("$":1-5)
ip -br a                      # brief format: interface + state + address (my first command)
ip -s link show eth0          # statistics: are errors/drops increasing? (a hardware-level clue)
ip route                      # default gateway (default via ...)
ip neigh                      # ARP neighbours — hints about same-subnet reachability
ping -c3 8.8.8.8              # egress test, bypassing DNS
```

**Note:** ping to an IP works but a name does not → DNS, immediately. Ping fails either way → check `ip -br a` for an `UP` interface and `ip route` for a gateway. These two steps resolve most problems within the first three layers.

## 2. Ports: ss Replaces netstat

```bash title="Listeners and connections" command:("$":1-5)
ss -tulpen                    # t=TCP u=UDP l=LISTEN p=process e=extended n=numeric ⭐
ss -tan state established     # established connections only
ss -s                         # summary counts by state
sudo ss -ltnp                 # include process names (root needed for -p)
lsof -i :80 ; sudo fuser -n tcp 80    # another angle: who holds port 80
```

```text
LISTEN  0  511   127.0.0.1:80   0.0.0.0:*   users:(("nginx",pid=1234,fd=6))
                 ↑ look here!
```

:::info
**The most classic trap of all**: `ss` shows the port listening, yet nothing from outside can connect — because the process is bound to **`127.0.0.1`** (localhost only) instead of `0.0.0.0` (all addresses). Nginx’s `listen 127.0.0.1:80` and Node’s `app.listen(3000, 'localhost')` both produce this.
**How to tell:** in `ss -ltn`, read the address in `Local Address:Port`; only `0.0.0.0` or `*` is reachable from outside.
:::

## 3. DNS: getent And dig Do Different Jobs

Resolution is layered: `/etc/hosts` → NSS (order set by `/etc/nsswitch.conf`) → DNS (`/etc/resolv.conf`, or systemd-resolved on `127.0.0.53`).

```bash title="Two commands, two questions" command:("$":1-5)
getent hosts example.com         # ⭐ goes through NSS: /etc/hosts counts (the path programs take)
dig +short example.com           # asks DNS directly, ignoring /etc/hosts
dig @8.8.8.8 +short example.com  # compare resolvers
dig -x 8.8.8.8 +short            # reverse lookup
grep hosts /etc/nsswitch.conf    # is files before dns?
```

**Note:** added a line to `/etc/hosts` and nothing changed? The program may be resolving through DNS instead — `getent hosts` shows the answer the program actually sees. Also check whether `resolv.conf` points at `127.0.0.53` (systemd-resolved); in that setup editing `resolv.conf` by hand gets overwritten.

```bash title="Three moves for name resolution" command:("$":1-3)
resolvectl status 2>/dev/null | head -12   # systemd-resolved environments (Debian/Ubuntu)
cat /etc/resolv.conf
```

## 4. curl: The Stethoscope Of The Application Layer

```bash title="Five curl tricks worth using" command:("$":1-5)
curl -v https://example.com | head -20        # the whole handshake — see exactly where it stalls
curl --resolve example.com:443:1.2.3.4 https://example.com/  # ⭐ bypass DNS, hit one backend
curl -w '%{http_code} %{time_total} %{time_connect}\n' -o /dev/null -s https://example.com
curl -x http://127.0.0.1:7890 https://example.com            # test through a proxy
curl --max-time 5 -sS https://example.com > /dev/null   # 5s timeout, show errors
```

**Note:** `--resolve` is one of my most-used debugging tricks — it **separates “DNS is wrong” from “the backend itself is broken”.** And without `--max-time`, curl can hang for a long time and destroy your troubleshooting rhythm.

## 5. Two Real Scenarios

**Scenario 1: the name pings fine but curl times out**

- `ss -ltn`: is anything listening? If not, start it.
- Check the **bound address** (127.0.0.1 versus 0.0.0.0) — the trap above.
- Check the firewall (chapter 17): `iptables -S` or `nft list ruleset`.
- Check proxy environment variables (`env | grep -i proxy`) — containers often inherit a wrong proxy.

**Scenario 2: `curl: (6) Could not resolve host`**

- Is `getent hosts <name>` empty? Then the resolution chain is broken.
- `cat /etc/resolv.conf`: is the nameserver reachable (`dig @<nameserver>`)?
- In containers: `/etc/resolv.conf` is injected by Docker; changing it on the host does nothing inside.

## 6. Hands-On Checklist

```bash title="Run the order end to end" command:("$":1-7)
ip -br a                                 # 1. interfaces and addresses
ip route                                 # 2. default gateway
ping -c2 1.1.1.1                         # 3. layer-3 reachability, DNS bypassed
ss -tulpen | head                        # 4. listeners (read the bound address)
getent hosts github.com                  # 5. NSS-based resolution
dig +short github.com                    # 6. ask DNS directly
curl -w '%{http_code} %{time_total}\n' -o /dev/null -s https://example.com  # 7. application layer
```

## Summary

- The order is fixed: **interface → address → route → port → DNS → application**; whether `ping <IP>` works is the watershed.
- `ip -br a`, `ip route`, `ss -tulpen` are the three main tools of that order (netstat is obsolete).
- If `ss` shows LISTEN but connections fail, check whether **Local Address is 127.0.0.1**.
- `getent hosts` shows the resolution path programs use; `dig` asks DNS directly — do not mix them up.
- `curl -v` plus `--resolve` plus `-w` pinpoints which stage of the application layer is broken.

## Next Up

SSH and remote operations: where the key permission requirements come from, the security settings in `sshd_config`, rsync incrementality and the danger of `--delete`, three kinds of port forwarding, and what to do before and after changing sshd config.
