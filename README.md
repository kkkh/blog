# 超超的博客

> 一个用 Astro 搭起来的个人博客：写文章、记生活，也把折腾过的东西留下来。

静态输出、加载轻快，深浅双主题，支持中文与英文两种语言。内容、配置、样式都按自己的习惯改即可。

## 现在都有什么

### 写作

- Markdown 写作：GFM、代码高亮、数学公式、Mermaid、信息图、链接卡片
- 正文增强：提醒块、折叠块、标签卡、文字特效、隐藏文字、注音、练习题、音视频嵌入，可按需开关
- **写作室 `/editor`**：源码与博客效果实时预览、可搜索的语法手册、浏览器草稿、导入与导出
- **文章落款**：标注创作方式、剧透或过时提醒，并支持归档筛选
- **文章操作**：复制全文、下载 Markdown、在写作室打开
- 整篇或局部加密（AES-256-GCM），密码只在构建阶段使用，不发送到浏览器

### 管理

- 多级分类、标签、归档、草稿、置顶，以及带独立页面与首页高亮的系列文章
- **全文搜索**：Pagefind，纯静态、无需后端
- **友链**：分组展示，附申请格式示例
- **公告**：支持多条、优先级排序、配色、时间窗与链接；按 id 记录已读
- **阅读体验**：章节目录、阅读进度与时长、深浅主题切换
- **多语言**：中文 / English，语言切换、hreflang 与按语言订阅 RSS
- **互动**：Waline 评论、Umami 访问统计
- **音乐**：网易云歌单播放器，可接入自建的 Meting 解析服务
- **内容资产**：LQIP 图片占位色、语义相似度推荐、AI 摘要（可选生成）

### 部署

- 默认静态输出，`dist/` 可直接交给静态托管（本站部署在 EdgeOne Pages）
- 本地预览用 `pnpm preview`；自建服务器可用 nginx 托管 `dist/`

## 本地启动

需要 **Node.js ≥ 22.20.0** 和 **pnpm 10.28.2**。

```bash
git clone https://github.com/kkkh/blog.git
cd blog
pnpm install
pnpm dev
```

打开 `http://localhost:4321`。

## 写作

新建一篇文章：

```bash
pnpm koharu new post
```

或直接在 `src/content/blog/` 里新建 Markdown 文件：

```markdown
---
title: 我的第一篇文章
date: 2026-10-09
link: my-first-post
categories: ['随笔']
tags: ['生活']
---

今天开始记录一点有意思的事。
```

保存后访问 `http://localhost:4321/post/my-first-post`。

想边写边看效果，用写作室 `/editor`（需 `editor.enabled: true`）；要把草稿存成博客文件，另开一个终端跑：

```bash
pnpm cms:install   # 首次
pnpm cms
```

然后打开 `http://localhost:4322`，在 CMS 里选文章、用同一个写作室编辑并保存。

## 部署到 EdgeOne Pages

| 配置项 | 值 |
| --- | --- |
| 构建命令 | `pnpm build` |
| 输出目录 | `dist` |
| Node 版本 | ≥ 22.20 |
| 包管理器 | pnpm |
| 环境变量 | 不需要（静态构建） |

推送代码后平台自动拉取并构建；也可以本地 `pnpm build && pnpm preview` 先自检一遍。

> 其他静态平台同理：把 `dist/` 发布出去即可。若启用碎碎念（动态功能），项目会切换为 Node 常驻服务，不能再部署到纯静态托管。

## 配置在哪

| 想改什么 | 去哪里 |
| --- | --- |
| 站点名称、作者、域名、头像、导航、评论、统计、音乐、公告、友链、语言开关 | `config/site.yaml` |
| 分类名 → URL 映射（`categoryMap`） | `config/site.yaml` |
| 分类、系列、落款的多语言文案 | `config/i18n-content.yaml` |
| 文章 | `src/content/blog/`；英文版放 `src/content/blog/en/`，相对路径与文件名保持一致 |
| 头像、封面、站点图等静态资源 | `public/img/` |
| 主题样式与配色 | `src/styles/` |

改完 `config/site.yaml` 刷新页面即可（构建时才会读取的字段需要重新 `pnpm build`）。

## 常用命令

```bash
pnpm dev            # 开发服务器 http://localhost:4321
pnpm build          # 生产构建，输出到 dist/
pnpm preview        # 预览构建结果
pnpm check          # Astro 类型检查
pnpm test           # 运行测试
pnpm lint:fix       # Biome 格式化与修复
pnpm knip           # 查找未使用的文件与依赖

pnpm koharu         # 交互式菜单：新建文章 / 备份 / 还原 / 更新 / 迁移 / 生成内容
pnpm generate:lqips        # 生成图片占位色
pnpm generate:summaries    # 生成 AI 摘要（需在 .env 配置 AI_API_KEY）
pnpm generate:similarities # 生成相关文章相似度

pnpm cms            # 本地 CMS http://localhost:4322
```

## 许可

见 [LICENSE](./LICENSE)（AGPL-3.0）。
