---
title: 'Linux 基础 14：SSH 与远程运维——密钥、权限与三种隧道'
description: '~/.ssh 里每个文件的职责、密钥权限要求的来龙去脉（StrictModes）、sshd_config 的六个安全项、客户端 config 与 ProxyJump、rsync 的增量与 --delete 的风险，以及 -L/-R/-D 三种端口转发。'
link: linux-14-ssh-and-remote-ops
catalog: true
date: 2022-04-22 20:30:00
updated: 2022-04-22 22:10:00
categories: ['笔记']
tags: ['Linux', '基础']
draft: false
---

## 这一节要解决什么

SSH 是远程运维的唯一入口，所以它既是"最好用"的工具，也是"最容易被配错"的地方——权限、配置、转发、批量传文件，每一块都有一个经典坑。这一节按"密钥 → 服务端 → 客户端 → 传文件 → 隧道"的顺序讲透。

## 一、`~/.ssh`：六个文件的职责

| 文件 | 作用 | 权限 |
| --- | --- | --- |
| `id_ed25519` | **私钥**（绝不外传、绝不进仓库） | `600` |
| `id_ed25519.pub` | 公钥（贴到服务器上） | `644` |
| `authorized_keys`（服务端） | 允许登录的公钥清单 | `600`/`644` |
| `known_hosts` | 记录过的服务端指纹（防中间人） | `644` |
| `config` | 客户端配置（别名、跳板、保活） | `600`/`644` |
| `~/.ssh` 目录本身 | —— | **`700`** |

```bash title="检查权限（SSH 拒绝连接的第一个原因）" command:("$":1-3)
ls -ld ~ ~/.ssh; ls -l ~/.ssh
chmod 700 ~/.ssh; chmod 600 ~/.ssh/id_* 2>/dev/null; chmod 644 ~/.ssh/*.pub
```

:::warning
**为什么权限这么严？** 服务端的 `StrictModes yes`（默认开启）会检查：私钥不能被组/其他人读写，**家目录和 `.ssh` 也不能被其他用户可写**。只要有一处不满足，ssh 会直接拒绝并提示 `UNPROTECTED PRIVATE KEY FILE` 或 `bad permissions`。第 04 节的权限知识在这里第一次真正派上用场。
:::

## 二、生成与分发密钥

```bash title="推荐做法（ed25519 已足够安全且短）" command:("$":1-4)
ssh-keygen -t ed25519 -C "qinchao@43322.cn" -f ~/.ssh/id_ed25519
ssh-copy-id -i ~/.ssh/id_ed25519.pub deploy@host        # 自动追加到远端 authorized_keys
ssh-copy-id -i ~/.ssh/id_ed25519.pub -p 2222 deploy@host  # ⚠️ 非 22 端口要 -p
# 手工等价写法：
cat ~/.ssh/id_ed25519.pub | ssh deploy@host 'umask 077; mkdir -p ~/.ssh; cat >> ~/.ssh/authorized_keys'
```

**批注**：`ssh-copy-id` 比手抄公钥可靠，因为它同时处理目录与权限。手工写时要加 `umask 077`，否则 `authorized_keys` 可能变成 `644` 而被 StrictModes 拒绝。

## 三、服务端：六个该改的项

```bash title="sshd_config 的安全清单" command:("$":1-6) mark:2,3
# /etc/ssh/sshd_config 里值得确认的几项
PermitRootLogin prohibit-password      # root 只允许密钥（或干脆 no）
PasswordAuthentication no             # 关掉密码登录（防爆破的关键一步）
PubkeyAuthentication yes
AllowUsers deploy ops                 # 白名单：只允许指定用户登录
MaxAuthTries 3                        # 试错次数
ClientAliveInterval 300               # 保活（配合客户端）
```

```bash title="改完必做两步" command:("$":1-4)
sudo sshd -t                     # ⭐ 先校验语法（写错就断线 = 把自己关在门外）
sudo systemctl reload ssh           # 再 reload（不是 restart，避免现有连接全断）
sudo sshd -T | grep -i permitroot   # 看最终生效值（含 include/drop-in 之后的合并结果）
```

**批注**：生产上换 SSH 配置的稳妥姿势是**先开一个新端口**（`Port 2222`）验证能连，再把 22 关掉；直接改 22 端口或关掉密码认证又不确认密钥能用时，你会彻底失去这台机器——我见过这种事故，最后只能走控制台。

## 四、客户端：让命令短一点、稳一点

```text title="~/.ssh/config" mark:5
Host prod
  HostName 203.0.113.10
  User deploy
  Port 2222
  IdentityFile ~/.ssh/id_ed25519
  ServerAliveInterval 30          # 长任务不被 NAT 掉线
  ServerAliveCountMax 3
  ControlMaster auto              # 连接复用：第二条以后几乎秒开
  ControlPath ~/.ssh/cm-%r@%h:%p
  ControlPersist 10m

Host db
  HostName 10.0.0.5
  User deploy
  ProxyJump prod                  # ⭐ 经 prod 跳板（不用再手写 -J）
```

```bash title="用起来" command:("$":1-4)
ssh prod                    # 别名直接用
ssh -J deploy@prod db       # 临时跳板
ssh prod 'systemctl is-active nginx'   # 单命令执行（注意这是"非交互 + 非登录"，见第 08 节）
scp -r ./dist prod:/srv/www/            # 简单拷贝（覆盖式，无增量）
```

## 五、rsync：增量同步与 `--delete` 的风险

```bash title="四个常用组合" command:("$":1-5)
rsync -av --info=progress2 ./dist/ prod:/srv/www/     # ⭐ 结尾的 / 很重要
rsync -av --dry-run --delete ./site/ prod:/srv/www/   # ⭐ 先 dry-run 看会删什么
rsync -av --delete ./site/ prod:/srv/www/             # 让目标与源完全一致（会删多余文件）
rsync -avz --partial --append-verify big/ prod:/data/  # 大文件断点续传
rsync -av -e 'ssh -p 2222' ./x deploy@host:/tmp/       # 指定 SSH 参数
```

**批注**：

- **源目录结尾的斜杠决定行为**：`./dist/` 表示"把 dist 里的内容同步过去"，`./dist` 表示"把 dist 目录本身同步过去"。
- `--delete` 是我最谨慎的参数：它会**删掉目标端源端没有的文件**——先用 `--dry-run` 看清列表，尤其别把 `--delete` 用在带用户上传目录的路径上。
- 传大文件用 `--partial`（保留半成品）+ `--append-verify`，比 `scp` 强。

## 六、三种端口转发

```bash title="本地转发（-L）：本机端口 → 远端" command:("$":1-3)
ssh -L 5432:127.0.0.1:5432 prod        # 本地 5432 转到 prod 上的 5432
# 之后本机 psql -h 127.0.0.1 就等于连到了 prod 的数据库
ssh -N -L 8080:10.0.0.5:8080 prod      # -N 不执行命令；-f 可放后台
```

```bash title="远程转发（-R）与动态代理（-D）" command:("$":1-3)
ssh -R 9000:127.0.0.1:3000 prod        # 把远端 9000 转到我这边的 3000（内网穿透的雏形）
ssh -D 1080 prod                        # 在本地开一个 SOCKS5 代理，流量走 prod 出去
# 验证：curl --socks5-hostname 127.0.0.1:1080 http://example.com
```

**批注**：`-L` 用于"我要访问远端内网的服务"（数据库、只监听 127.0.0.1 的管理后台）；`-R` 用于"把本机服务暴露到远端"；`-D` 才是"代理出口"。三者区别经常被混淆，记住方向：**`-L` 是本机监听，`-R` 是远端监听。**

## 七、动手清单

```bash title="逐条验证" command:("$":1-7)
ls -l ~/.ssh; stat -c '%a %n' ~ ~/.ssh ~/.ssh/id_* 2>/dev/null   # 1. 权限体检
ssh-keygen -t ed25519 -f /tmp/tkey -N ''                          # 2. 生成一次（空密码）
ssh -o BatchMode=yes -o ConnectTimeout=5 prod true                # 3. 非交互连通性测试
sudo sshd -T | grep -Ei 'permitroot|passwordauth|pubkey'          # 4. 看生效的配置
rsync -av --dry-run ./dist/ /tmp/rsync-test/                      # 5. dry-run 看清单
ssh -N -L 15432:127.0.0.1:5432 prod & sleep 1; ss -ltn | grep 15432   # 6. 本地转发生效
kill %1 2>/dev/null                                               # 7. 收拾
```

## 小结

- 密钥权限是"硬要求"（`700` 目录、`600` 私钥），StrictModes 会检查**家目录与 `.ssh` 不能被别人可写**。
- 服务端加固四件套：关密码认证、禁 root 密码登录、`AllowUsers` 白名单、`MaxAuthTries`；改完先 `sshd -t` 再 `reload`。
- 客户端 `~/.ssh/config` 值得花十分钟配好：别名、跳板、保活、连接复用。
- `rsync` 比 `scp` 强在增量与断点；**源末尾斜杠与 `--delete` 是两个必须先想清楚的点**。
- `-L` 本地转发、`-R` 远程转发、`-D` SOCKS 代理；方向别记反。

## 下一节预告

下一节：权限进阶——`sudoers` 里通配符为什么危险、ACL 与 `mask` 的相互作用、`ls -l` 末尾那个 `+` 是什么，以及 capabilities 如何把"root 全能"拆成细粒度能力（`ping`、绑定低端口都靠它）。
