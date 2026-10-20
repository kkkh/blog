---
title: 'Linux Basics 14: SSH And Remote Operations — Keys, Permissions And Three Kinds Of Tunnel'
description: 'What each file in ~/.ssh is for, where the key permission rules come from (StrictModes), six settings worth hardening in sshd_config, a client config with ProxyJump, rsync incrementality and the risk of --delete, and the three forwarding modes -L/-R/-D.'
link: linux-14-ssh-and-remote-ops
catalog: true
date: 2022-04-22 20:30:00
updated: 2022-04-22 22:10:00
categories: ['笔记']
tags: ['Linux', '基础']
draft: false
---

## What This Chapter Solves

SSH is the only door into remote operations, which makes it both the most useful tool and the easiest to misconfigure — keys, server config, client config, bulk transfers and tunnels each have one classic trap. This chapter walks the order: keys → server → client → transfers → tunnels.

## 1. `~/.ssh`: Six Files And Their Jobs

| File | Purpose | Mode |
| --- | --- | --- |
| `id_ed25519` | **private key** (never shared, never committed) | `600` |
| `id_ed25519.pub` | public key (the one you paste onto servers) | `644` |
| `authorized_keys` (server) | the list of keys allowed to log in | `600`/`644` |
| `known_hosts` | remembered server fingerprints (MITM defence) | `644` |
| `config` | client configuration (aliases, jumps, keepalive) | `600`/`644` |
| the `~/.ssh` directory itself | — | **`700`** |

```bash title="Check the modes first (cause #1 of refused connections)" command:("$":1-3)
ls -ld ~ ~/.ssh; ls -l ~/.ssh
chmod 700 ~/.ssh; chmod 600 ~/.ssh/id_* 2>/dev/null; chmod 644 ~/.ssh/*.pub
```

:::warning
**Why so strict?** The server’s `StrictModes yes` (on by default) checks that the private key is not group/world readable and that **neither the home directory nor `.ssh` is writable by other users**. Miss either and ssh refuses with `UNPROTECTED PRIVATE KEY FILE` or `bad permissions`. Chapter 04’s permission knowledge earns its keep here.
:::

## 2. Generating And Distributing Keys

```bash title="The recommended path (ed25519 is strong and short)" command:("$":1-4)
ssh-keygen -t ed25519 -C "qinchao@43322.cn" -f ~/.ssh/id_ed25519
ssh-copy-id -i ~/.ssh/id_ed25519.pub deploy@host        # appends to the remote authorized_keys
ssh-copy-id -i ~/.ssh/id_ed25519.pub -p 2222 deploy@host  # ⚠️ -p for non-default ports
# The manual equivalent:
cat ~/.ssh/id_ed25519.pub | ssh deploy@host 'umask 077; mkdir -p ~/.ssh; cat >> ~/.ssh/authorized_keys'
```

**Note:** `ssh-copy-id` beats pasting by hand because it also gets the directory and modes right. If you do it manually, keep the `umask 077`, or `authorized_keys` may end up `644` and get rejected by StrictModes.

## 3. The Server Side: Six Settings Worth Checking

```bash title="sshd_config hardening checklist" command:("$":1-5) mark:2,3
PermitRootLogin prohibit-password      # key-only root login (or "no" outright)
PasswordAuthentication no              # turn off passwords — the key step against brute force
PubkeyAuthentication yes
AllowUsers deploy ops                  # whitelist: only these users may log in
MaxAuthTries 3                         # limit attempts
ClientAliveInterval 300                # keepalive (paired with the client side)
```

```bash title="Two mandatory steps after editing" command:("$":1-3)
sudo sshd -t                     # ⭐ validate the syntax first (a typo can lock you out)
sudo systemctl reload ssh           # then reload, not restart, so existing sessions survive
sudo sshd -T | grep -i permitroot   # the effective value after includes and drop-ins
```

**Note:** the safe way to change SSH settings in production is to **open a new port first** (`Port 2222`), confirm you can connect there, and only then close 22. Changing port 22 or disabling password auth before verifying key access is how people lose a machine entirely — I have seen it happen, and the only way back in was the console.

## 4. The Client Side: Shorter, More Stable Commands

```text title="~/.ssh/config" mark:5
Host prod
  HostName 203.0.113.10
  User deploy
  Port 2222
  IdentityFile ~/.ssh/id_ed25519
  ServerAliveInterval 30          # keep long jobs alive across NAT timeouts
  ServerAliveCountMax 3
  ControlMaster auto              # connection reuse: the second connection is instant
  ControlPath ~/.ssh/cm-%r@%h:%p
  ControlPersist 10m

Host db
  HostName 10.0.0.5
  User deploy
  ProxyJump prod                  # ⭐ hop through prod without typing -J every time
```

```bash title="Everyday use" command:("$":1-3)
ssh prod                    # the alias works directly
ssh -J deploy@prod db       # a one-off jump host
scp -r ./dist prod:/srv/www/            # simple copy (overwrite, no incrementality)
```

## 5. rsync: Incrementality And The Risk Of `--delete`

```bash title="Four combinations worth knowing" command:("$":1-5)
rsync -av --info=progress2 ./dist/ prod:/srv/www/     # ⭐ the trailing slash matters
rsync -av --dry-run --delete ./site/ prod:/srv/www/   # ⭐ see what would be deleted first
rsync -av --delete ./site/ prod:/srv/www/             # make the target identical (removes extras)
rsync -avz --partial --append-verify big/ prod:/data/  # resumable for large files
rsync -av -e 'ssh -p 2222' ./x deploy@host:/tmp/       # custom SSH options
```

**Notes:**

- **The trailing slash on the source decides the meaning**: `./dist/` syncs *the contents* of dist, `./dist` syncs *the directory itself*.
- `--delete` is the parameter I treat most carefully: it **removes files on the target that the source does not have**. Always `--dry-run` first, and never point it at a path containing user uploads.
- For big files use `--partial` (keep the half-finished file) plus `--append-verify`; both beat `scp`.

## 6. Three Kinds Of Port Forwarding

```bash title="Local forward (-L): local port → remote" command:("$":1-3)
ssh -L 5432:127.0.0.1:5432 prod        # local 5432 goes to 5432 on prod
# now psql -h 127.0.0.1 on your laptop is really talking to prod's database
ssh -N -L 8080:10.0.0.5:8080 prod      # -N runs no command; add -f to background it
```

```bash title="Remote forward (-R) and dynamic proxy (-D)" command:("$":1-3)
ssh -R 9000:127.0.0.1:3000 prod        # remote 9000 goes to my local 3000 (a baby reverse tunnel)
ssh -D 1080 prod                        # open a SOCKS5 proxy locally, traffic exits via prod
# check: curl --socks5-hostname 127.0.0.1:1080 http://example.com
```

**Note:** `-L` is for “I need to reach a service inside the remote network” (databases, admin panels bound to 127.0.0.1); `-R` is for “expose something of mine on the remote side”; `-D` is an actual proxy exit. Remember the direction: **`-L` listens locally, `-R` listens remotely.**

## 7. Hands-On Checklist

```bash title="Verify each claim" command:("$":1-6)
ls -l ~/.ssh; stat -c '%a %n' ~ ~/.ssh ~/.ssh/id_* 2>/dev/null   # 1. permission audit
ssh-keygen -t ed25519 -f /tmp/tkey -N ''                          # 2. generate one (empty passphrase)
ssh -o BatchMode=yes -o ConnectTimeout=5 prod true                # 3. non-interactive connectivity test
sudo sshd -T | grep -Ei 'permitroot|passwordauth|pubkey'          # 4. effective settings
rsync -av --dry-run ./dist/ /tmp/rsync-test/                      # 5. a dry-run listing
ssh -N -L 15432:127.0.0.1:5432 prod & sleep 1; ss -ltn | grep 15432   # 6. the forward is listening
```

## Summary

- Key modes are a hard requirement (`700` directory, `600` private key); StrictModes also checks that **the home directory and `.ssh` are not writable by others**.
- Server hardening in four moves: disable passwords, forbid root password login, `AllowUsers` whitelist, `MaxAuthTries`; check with `sshd -t`, then `reload`.
- Spend ten minutes on `~/.ssh/config`: aliases, jump hosts, keepalive, connection reuse.
- `rsync` beats `scp` for incrementality and resuming; **the trailing slash and `--delete` deserve thought first**.
- `-L` local forward, `-R` remote forward, `-D` SOCKS proxy — do not mix up the direction.

## Next Up

Advanced permissions: why wildcards in sudoers are dangerous, how ACLs interact with their mask, what the trailing `+` in `ls -l` means, and how capabilities break “root can do everything” into fine-grained powers (`ping`, binding low ports).
