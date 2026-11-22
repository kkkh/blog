# 2026-11-22 onnxruntime-node 1.23.0 升级与活动视频改动记录

本文记录 2026-11-22 对本站所做的两类改动：修复 EdgeOne 构建时的 `onnxruntime-node` 安装失败，以及给 TRAE Friends 太原活动文章加入现场视频。内容包括每一处改动的文件、行号、原因、坏处与回退方式，便于以后逐行对照。

> 记录时间：2026-11-22（Asia/Shanghai）
> 仓库：`/Users/qinchao/Movies/qinchao`
> 对照基线：`b08075bafea66946cda1326d4ef588bdabf33079`（`HEAD` 与 `origin/main` 一致）
> 行号说明：以下行号均以基线提交 `b08075b` 为准；后续再改文件时行号会漂移，请结合提交 diff 对照。

---

## 0. 一句话摘要

把 `onnxruntime-node` 从 1.21.0 强制升级到 1.23.0，使它改为从 NuGet 安装 CUDA 运行时（不再下载那个 404 的 GitHub GPU 压缩包），从而让 EdgeOne 的干净安装和构建通过；同时在中英文文章中各加入一个 38 秒的现场视频。

---

## 1. 提交清单

| 提交 | 说明 | 是否为最终改动 |
| --- | --- | --- |
| `312651a` | `fix(ci): skip onnxruntime CUDA postinstall on Linux builds`，临时把 `onnxruntime-node` 从 `onlyBuiltDependencies` 注释掉 | 否，已回退 |
| `80700ed` | `Revert "fix(ci): skip onnxruntime CUDA postinstall on Linux builds"` | 回退提交，净效果为 0 |
| `a1ad2ad` | `fix(deps): install CUDA via onnxruntime-node 1.23.0` | 是 |
| `b08075b` | `feat: add event video to TRAE Friends Taiyuan article` | 是 |
| `75c231c` | `feat: add TRAE Friends Taiyuan OPC Talk article`（文章本体与 10 张图片，属于前置工作） | 背景，不在本文重点 |

---

## 2. 文件总览

| 文件 | 改动性质 | 行数变化 | 对应提交 |
| --- | --- | --- | --- |
| `pnpm-workspace.yaml` | 新增 `overrides` | +3 | `a1ad2ad` |
| `pnpm-lock.yaml` | 依赖解析结果与锁文件噪声 | +24 / -13 | `a1ad2ad` |
| `src/content/blog/life/trae-friends-taiyuan-opc-talk.md` | 新增视频块与说明 | +7 | `b08075b` |
| `src/content/blog/en/life/trae-friends-taiyuan-opc-talk.md` | 新增视频块与说明 | +7 | `b08075b` |
| `public/video/trae-friends-taiyuan-1121.mp4` | 新增二进制视频 | 新增 16,137,214 B | `b08075b` |

说明：上表的行数变化是提交本身的统计。当前工作区在这两个文件里还额外加了说明注释（未提交），所以实际 diff 会比 `+3` / `+24 -13` 多出注释行。

当前工作区状态：`pnpm-workspace.yaml`、`pnpm-lock.yaml` 已修改（仅注释），本文档未跟踪；`HEAD` 仍为 `b08075b`。

---

## 3. 依赖修复：onnxruntime-node 1.21.0 → 1.23.0

### 3.1 起因

EdgeOne 的 `pnpm install` 在 `onnxruntime-node@1.21.0` 的 `postinstall` 阶段失败：

- 1.21.0 在 Linux x64 上会判断是否安装 CUDA 12 运行时；
- 它从 GitHub Releases 下载 `onnxruntime-linux-x64-gpu-1.21.0.tgz`；
- 该地址返回 404，安装脚本随之失败，整个构建中断。

之前的构建之所以正常，是因为依赖安装命中了缓存，没有真正执行这段 `postinstall`。依赖或锁文件一旦变化，缓存失效，问题就暴露出来。

1.23.0 改变了安装方式：CUDA 运行时改为从 NuGet 拉取 `Microsoft.ML.OnnxRuntime.Gpu.Linux`（本次验证该包大小为 240,863,908 字节）。同时 `onnxruntime-node` 仍然保留在 `onlyBuiltDependencies` 中，CUDA 包不会被跳过。

### 3.2 `pnpm-workspace.yaml`

第 5–20 行是一段说明注释（工作区额外添加，不属于 `a1ad2ad` 提交），记录固定版本的原因、当前唯一使用方、不要删除 `onlyBuiltDependencies` 里的 `onnxruntime-node`、何时可以删除 override，以及可选的收窄写法。

当前第 21–22 行新增：

```yaml
overrides:
  onnxruntime-node: 1.23.0
```

当前第 24–30 行是原有的 `onlyBuiltDependencies`：

```yaml
onlyBuiltDependencies:
  - esbuild
  - nice-napi
  - onnxruntime-node
  - protobufjs
  - re2
  - sharp
```

要点：第 27 行的 `onnxruntime-node` 必须保留。删掉它等于跳过 `postinstall`，CUDA 包不会被安装，不符合“CUDA GPU 包必须有且不能跳过”的要求。

### 3.3 `pnpm-lock.yaml`

当前锁文件中与本次升级直接相关的行：

| 行号 | 内容 | 说明 |
| --- | --- | --- |
| 7–8 | `overrides:` / `onnxruntime-node: 1.23.0` | 与 `pnpm-workspace.yaml` 同步 |
| 3835–3837 | `adm-zip@0.5.18` 包条目 | 1.23.0 的新依赖 |
| 7139–7140 | `onnxruntime-common@1.23.0` | 替换旧的 1.21.0 条目 |
| 7142–7144 | `onnxruntime-node@1.23.0` | 替换旧的 1.21.0 条目，`os` 字段保留 |
| 10352 | `onnxruntime-node: 1.23.0` | `@huggingface/transformers@3.8.1` 的依赖指向新版本 |
| 12605 | `adm-zip@0.5.18: {}` | 快照占位 |
| 16913 | `onnxruntime-common@1.23.0: {}` | 快照占位 |
| 16915–16919 | `onnxruntime-node@1.23.0` 快照依赖 | `adm-zip 0.5.18`、`global-agent 3.0.0`、`onnxruntime-common 1.23.0` |

旧快照中的 `onnxruntime-node@1.21.0` 对 `tar 7.5.2` 的依赖已移除；`tar` 仍被其他包使用，所以文件里仍能搜到 `tar@7.5.2`，那与本次改动无关。

锁文件里还有两处“噪声”，不是手工改的，而是 pnpm 重新解析时顺带产生的：

| 行号 | 变化 | 影响 |
| --- | --- | --- |
| 5072–5074 区块 | `eslint@9.39.1` 的 `deprecated:` 提示行被删除 | 无语义影响，只是元数据 |
| 14602 | `global-agent` 快照里的 `semver` 由 7.7.3 变为 7.8.5 | 同为主版本范围内的解析变化，暂无已知影响 |

如果以后 review 或 bisect，看到这两处不必当成业务改动。

另外，第 16921–16937 行还保留了一段**注释形式的历史快照**（`onnxruntime-node@1.21.0` 及其 `tar: 7.5.2`），仅用于日后对照，不参与 YAML 解析。这段注释是在基线 `b08075b` 之后额外加到工作区的，`pnpm install` 重新生成锁文件时可能被清除；完整旧条目可用 `git show a1ad2ad^:pnpm-lock.yaml` 查看。

### 3.4 被回退的临时方案

`312651a` 曾把 `onnxruntime-node` 从 `onlyBuiltDependencies` 中注释掉，让 postinstall 不执行，从而绕过 404。这会直接跳过 CUDA 安装，已被 `80700ed` 完整回退。当前任何位置都不存在“跳过 CUDA”的配置。

---

## 4. 活动视频

### 4.1 中文文章

文件：`src/content/blog/life/trae-friends-taiyuan-opc-talk.md`

当前第 28–33 行新增：

```markdown
{% media video %}
- name: 活动现场 · 38 秒
  url: /video/trae-friends-taiyuan-1121.mp4
{% endmedia %}

*38 秒，先看一眼那天的无为里。*
```

位置在签到大横幅照片之后、正文第一节“一个人，为什么需要一场 OPC Talk”之前。

### 4.2 英文文章

文件：`src/content/blog/en/life/trae-friends-taiyuan-opc-talk.md`

当前第 28–33 行新增：

```markdown
{% media video %}
- name: The room in 38 seconds
  url: /video/trae-friends-taiyuan-1121.mp4
{% endmedia %}

*Thirty-eight seconds inside Wuweili.*
```

中英文共用同一个视频文件，只有 `name` 与图注不同。

### 4.3 视频文件

文件：`public/video/trae-friends-taiyuan-1121.mp4`

| 属性 | 值 |
| --- | --- |
| 大小 | 16,137,214 字节（约 15.4 MiB） |
| 分辨率 | 1920×1080 |
| 帧率 | 30 fps |
| 视频编码 | H.264 |
| 音频编码 | AAC |
| 时长 | 38.451995 秒 |
| 其他 | faststart（moov 前置），可边下边播 |

### 4.4 渲染链路

这段 Markdown 不是原生 Markdown 图片语法，而是主题兼容的 Hexo/Shoka 标签：

1. `src/lib/markdown/shoka-preprocessor.ts` 第 250–280 行识别 `{% media video %}`，把块内 YAML 解析成数组；
2. 第 272 行调用 `renderVideoMedia()`；
3. `src/lib/markdown/shoka-renderers.ts` 第 75–83 行输出 `<div data-video-player data-src="[...]"></div>`；
4. 前端 `src/components/markdown/VideoPlayer.tsx` 读取 `data-src`，用 `useVideoPlayer` / `useMediaPlayer` 渲染自定义播放器；
5. 该功能依赖 `config/site.yaml` 第 453 行的 `enableShokaHexoTags: true`。

单条视频不会显示播放列表；播放器使用 `preload="metadata"`，没有设置 `poster`。

---

## 5. 坏处与风险

按影响从大到小排列：

1. **Linux 安装体积和构建时间增加。** 干净安装会下载约 230 MiB 的 CUDA NuGet 包，并解压出数百 MB 的 `.so` 文件。EdgeOne 每次冷安装都要付这份成本；缓存命中时才会快。这是“必须保留 CUDA”的直接代价。
2. **版本被全仓库强制锁定。** `pnpm overrides` 对所有工作区、所有传递依赖生效。以后 `@huggingface/transformers` 若升级并期望其他 `onnxruntime-node` 版本，会被这里强制覆盖；排查依赖问题时必须先想到 `pnpm-workspace.yaml` 第 5–7 行。目前 `pnpm why onnxruntime-node` 只显示 `@huggingface/transformers 3.8.1 → 1.23.0`，没有其他使用方。
3. **跨两个 minor 的升级有潜在兼容风险。** 1.21.0 → 1.23.0 涉及 onnxruntime 内部实现变化。当前使用场景是构建期生成语义相似度的 embedding，本地实测可正常输出 384 维向量；但若以后调用更冷门的 session 选项，需要重新验证。
4. **锁文件噪声会干扰 review。** `eslint` 的 deprecated 字段删除、`global-agent` 的 `semver` 7.7.3 → 7.8.5，都不是本次意图，但混在同一个提交里，容易让人误以为有额外变更。
5. **视频体积偏大。** 15.4 MiB 单文件、无多码率、无 CDN 转码。`preload="metadata"` 只预取元数据，点击播放仍要下载整段；移动网络下首播可能等待。播放器也没有 `poster`，首帧可能是黑屏。
6. **视频没有字幕轨道。** 组件里对 `<video>` 显式忽略了字幕告警，视频本身有 AAC 音轨但没有 caption，可访问性一般。
7. **隐私风险。** 合影已经做了人脸柔焦，但视频没有打码，包含现场人物画面与声音。视频一旦公开部署，无法收回已被下载的副本；如果参与者提出异议，需要重新剪辑并更换文件名，避免 CDN 缓存继续命中旧文件。
8. **绝对路径依赖站点根目录。** 视频地址写死为 `/video/...`。当前站点部署在根路径（`43322.cn`）没有问题；若以后部署到子路径，需要改成带 base 的路径。
9. **孤儿资产风险。** 视频放在 `public/`，`knip` 不会检查它。以后若删除文章却忘记删视频，文件会继续被打包部署。

---

## 6. 验证记录

| 检查项 | 结果 |
| --- | --- |
| 依赖安装 | `pnpm install` 成功；`pnpm why onnxruntime-node` 指向 1.23.0 |
| Embedding 功能 | 本地脚本运行正常，输出 384 维向量 |
| EdgeOne 构建 | 2026-11-22 16:39:20（CST）部署成功 |
| 视频响应头 | `Content-Type: video/mp4`、`Content-Length: 16137214`、`Accept-Ranges: bytes` |
| 线上页面 | 中英文文章页均包含视频播放器标记 |
| Git 同步 | 工作区干净，`HEAD` 与 `origin/main` 均为 `b08075b` |

> 注意：只用 `curl -r 0-0` 看到 206 不能证明视频可访问，静态站点可能对任意路径返回 HTML 回退。必须同时检查 `Content-Type` 和页面中的播放器标记。

---

## 7. 回退方法

### 7.1 只撤视频，保留依赖修复（推荐用于内容下架）

1. 删除中文文章第 28–33 行；
2. 删除英文文章第 28–33 行；
3. 删除 `public/video/trae-friends-taiyuan-1121.mp4`；
4. 重新构建部署。

### 7.2 整体回退视频提交

```bash
git revert b08075b
```

会同时删除两个 Markdown 视频块和 mp4 文件。

### 7.3 回退依赖升级（不推荐）

```bash
git revert a1ad2ad
pnpm install
```

注意：回退后会重新回到 1.21.0，Linux 干净安装仍会遇到那个 404。只有在升级 `@huggingface/transformers` 或官方修复下载地址后才适合撤销这个 override。

---

## 8. 本次没有改动的文件（澄清）

以下文件曾在排查过程中被临时修改，但均已恢复，当前与基线一致：

- `src/components/layout/Navigator.tsx`（曾加 `whitespace-nowrap`，已回退）
- `src/components/layout/DropdownNav.tsx`（曾加 `whitespace-nowrap`，已回退）
- `src/components/layout/Header.astro`（曾加 `shrink-0`，已回退）
- `src/assets/similarities.json`（脚本重跑产生 140 行非确定性差异，已回退）

`config/site.yaml`、`src/assets/lqips.json`、图片资源等属于文章本体提交 `75c231c`，不是本次依赖或视频改动的一部分。

---

## 9. 维护提示

- 想移除 `overrides` 时，先确认 `@huggingface/transformers` 依赖的 `onnxruntime-node` 已 ≥ 1.23.0，且其 `postinstall` 不再访问那个 404 的 GitHub 地址；然后删除 `pnpm-workspace.yaml` 第 5–7 行并重新执行 `pnpm install` 生成锁文件。
- EdgeOne 若再次出现 NuGet 下载失败，不要用 `--onnxruntime-node-install=skip` 绕过，因为那会跳过 CUDA。应检查网络、镜像或 NuGet 源。
- 新增视频建议控制在 10 MiB 以内，1080p、H.264、AAC、faststart；在文章中使用同一套 `{% media video %}` 块。
- 若站点以后改为子路径部署，记得同步处理 `public/video/` 的绝对路径引用。
