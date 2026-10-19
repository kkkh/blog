# 主题色改造指南（暖白 + 陶土）

本项目主题色从默认的「樱花粉」改为「暖白纸感基底 + 低饱和陶土赭红强调色」。
本文档记录全部改动点、精确色值与验收方法。所有颜色均已通过 WCAG 对比度校验。
粉色残留已按「核心变量 → 结构性渐变 → 组件辉光 → 装饰（花瓣/滚动条） → 404 页」全链路清理完毕。

---

## 一、配色方案总览

### 关键对比度（已校验，全部达标）

| 组合 | 浅色模式 | 深色模式 | 标准 |
|---|---|---|---|
| 正文文字 / 背景 | 12.66:1 | 14.25:1 | AAA ✅ |
| 主色上的文字 / 主色 | 5.55:1 | 6.37:1 | AA ✅ |
| 主色作文字 / 背景 | 4.95:1 | 6.56:1 | AA ✅ |
| 次要文字 / 背景 | 5.15:1 | 6.81:1 | AA ✅ |

### 核心色值

| 角色 | 浅色 | 深色 |
|---|---|---|
| 背景 | `#f0eee9` `43 19% 93%` | `#1c1a17` `36 10% 10%` |
| 正文 | `#2b2823` `37 10% 15%` | `#ece7df` `37 25% 90%` |
| 主色（陶土） | `#a34d2e` `16 56% 41%` | `#d98b6a` `18 59% 63%` |

### 贯穿全站的两个替身色

- **陶土主色** `#b25237` = `rgb(178, 82, 55)` —— 替代原来的粉红 `#ed6ea0` / `rgb(233, 84, 107)`
- **浅陶土** `#d18a68` = `rgb(209, 138, 104)` —— 替代原来的橙 `#ec8c69`

---

## 二、改动清单（按文件）

### 1. `src/styles/theme/shadcn.css`

**浅色模式 `:root`**

```css
--background: 43 19% 93%;
--foreground: 37 10% 15%;
--card: 40 27% 96%;
--card-foreground: 37 10% 15%;
--popover: 40 27% 96%;
--popover-foreground: 37 10% 15%;
--primary: 16 56% 41%;
--primary-foreground: 40 60% 98%;
--secondary: 37 25% 90%;
--secondary-foreground: 37 10% 15%;
--muted: 37 26% 88%;
--muted-foreground: 30 9% 38%;
--accent: 35 23% 86%;
--accent-foreground: 37 10% 15%;
--border: 36 22% 82%;
--input: 36 22% 82%;
--ring: 16 56% 41%;
--badge-primary: 16 56% 41%;
```

**深色模式 `.dark`**

```css
--background: 36 10% 10%;
--foreground: 37 25% 90%;
--card: 42 17% 12%;
--card-foreground: 37 25% 90%;
--popover: 42 17% 12%;
--popover-foreground: 37 25% 90%;
--primary: 18 59% 63%;
--primary-foreground: 25 31% 11%;
--secondary: 34 9% 15%;
--secondary-foreground: 37 25% 92%;
--muted: 30 9% 14%;
--muted-foreground: 32 10% 63%;
--accent: 33 11% 16%;
--accent-foreground: 37 25% 92%;
--border: 33 11% 19%;
--input: 33 11% 19%;
--ring: 18 59% 63%;
--badge-primary: 18 59% 63%;
```

> 注意：`--ring` 色相 `16`（浅）/`18`（深）与 `--primary` 一致；
> `--border` 与 `--input` 同值（深色 19%）——写成 16% 会太暗、边框几乎不可见。
> 顶部注释：浅色 `/* qinchao 配色 */`、深色 `/* 深色模式：暖褐中性色 + 陶土强调色；文字亮度略低于纯白以减少刺眼 */`。

### 2. `src/styles/theme/index.css` — 鼠标选中背景色

变量已从 `--color-pink-a3` 重命名为 `--color-selection-bg`（跟随主题）：

```css
/* :root（浅色） */
--color-selection-bg: rgba(163, 77, 46, 0.22);   /* #a34d2e 的 22% */

/* .dark（深色） */
--color-selection-bg: rgba(217, 139, 106, 0.3);  /* #d98b6a 的 30% */
```

### 3. `src/styles/global/reset.css` — 引用处

```css
::selection {
  background-color: var(--color-selection-bg);
}
```

### 4. `tailwind.config.mjs` — 同步变量名

```js
pink: {
  a3: 'var(--color-selection-bg)',
  DEFAULT: 'var(--color-pink)',
},
```

### 5. `src/styles/theme/index.css` — 结构性渐变（配套改，否则仍是粉/紫）

**浅色模式 `:root`**

| 变量 | 旧值 | 新值 |
|---|---|---|
| `--gradient-bg-start` | `#fdfbfb` | `#f6f3ee` |
| `--gradient-bg-end` | `#ebedee` | `#eae6de` |
| `--gradient-header` | `linear-gradient(-225deg, #e3fdf5 0, #ffe6fa 100%)` | `linear-gradient(-225deg, #f6efe7 0, #efe4d9 100%)` |
| `--gradient-shoka-button-start` | `#ed6ea0` | `#b25237` |
| `--gradient-shoka-button-end` | `#ec8c69` | `#d18a68` |

**深色模式 `.dark`**

| 变量 | 旧值 | 新值 |
|---|---|---|
| `--gradient-bg-start` | `#1d1a27`（紫） | `#211d18` |
| `--gradient-bg-end` | `#15121d`（紫） | `#16130f` |
| `--gradient-header` | `linear-gradient(-225deg, #2a2438 0, #372739 100%)` | `linear-gradient(-225deg, #2b2420 0, #362d26 100%)` |
| `--gradient-shoka-button-start` | `#f18bb3cc` | `#c9795bcc` |
| `--gradient-shoka-button-end` | `#f0a387cc` | `#e0a284cc` |

> 这些变量驱动：整页背景、波浪装饰、顶部遮罩、header、抽屉、侧栏、搜索框、编辑器、
> 滚动条、TOC 圆环、分段控件、阅读进度圈。不改就会出现「深色背景发紫、按钮发粉橙」。

### 6. `src/pages/404.astro` — 逐行替换颜色值

#### 6a. 深色模式猫插画配色（第 172–176 行）

| 行 | 改前 | 改后 |
|---|---|---|
| 172 | `--c-stroke: rgba(241, 139, 179, 0.7);` | `--c-stroke: rgba(201, 121, 91, 0.7);` |
| 173 | `--c-head-bg: rgba(241, 139, 179, 0.1);` | `--c-head-bg: rgba(201, 121, 91, 0.1);` |
| 174 | `--c-ear-fill: rgba(240, 163, 135, 0.15);` | `--c-ear-fill: rgba(224, 162, 132, 0.15);` |
| 175 | `--c-nose: rgba(240, 163, 135, 0.8);` | `--c-nose: rgba(224, 162, 132, 0.8);` |

（177 行 `--c-features: #bbb;` 是中性灰，不动。）

#### 6b. 按钮区（第 389–432 行）

颜色映射（只换数值，**alpha 保持不变**）：

| 旧颜色 | 新颜色 |
|---|---|
| `#ed6ea0` | `#b25237` |
| `#ec8c69` | `#d18a68` |
| `#f18bb3` | `#c9795b` |
| `rgba(237, 110, 160,` | `rgba(178, 82, 55,` |
| `rgba(236, 140, 105,` | `rgba(209, 138, 104,` |
| `rgba(241, 139, 179,` | `rgba(201, 121, 91,` |
| `rgba(240, 163, 135,` | `rgba(224, 162, 132,` |

逐行对照（16 行）：

```text
第 390 行  linear-gradient(135deg, #ed6ea0 0%, #ec8c69 100%)
        → linear-gradient(135deg, #b25237 0%, #d18a68 100%)
第 392 行  rgba(237, 110, 160, 0.25)  → rgba(178, 82, 55, 0.25)
第 397 行  rgba(237, 110, 160, 0.35)  → rgba(178, 82, 55, 0.35)
第 401 行  rgba(237,110,160,0.06) / rgba(236,140,105,0.06)
        → rgba(178,82,55,0.06) / rgba(209,138,104,0.06)
第 402 行  color: #ed6ea0  → color: #b25237
第 403 行  rgba(237, 110, 160, 0.25)  → rgba(178, 82, 55, 0.25)
第 407 行  rgba(237,110,160,0.12) / rgba(236,140,105,0.12)
        → rgba(178,82,55,0.12) / rgba(209,138,104,0.12)
第 408 行  rgba(237, 110, 160, 0.4)   → rgba(178, 82, 55, 0.4)
第 414 行  rgba(241,139,179,0.9) / rgba(240,163,135,0.9)
        → rgba(201,121,91,0.9) / rgba(224,162,132,0.9)
第 415 行  rgba(241, 139, 179, 0.3)   → rgba(201, 121, 91, 0.3)
第 419 行  rgba(241, 139, 179, 0.4)   → rgba(201, 121, 91, 0.4)
第 423 行  rgba(241,139,179,0.08) / rgba(240,163,135,0.08)
        → rgba(201,121,91,0.08) / rgba(224,162,132,0.08)
第 424 行  color: #f18bb3  → color: #c9795b
第 425 行  rgba(241, 139, 179, 0.3)   → rgba(201, 121, 91, 0.3)
第 429 行  rgba(241,139,179,0.18) / rgba(240,163,135,0.18)
        → rgba(201,121,91,0.18) / rgba(224,162,132,0.18)
第 430 行  rgba(241, 139, 179, 0.5)   → rgba(201, 121, 91, 0.5)
```

### 7. 组件粉红辉光阴影 — `rgb(233 84 107 / α)` → `rgb(178 82 55 / α)`

原粉红辉光（悬浮/悬停时的粉色光晕）统一换陶土。**共 14 处，α 保持不变**：

| 文件 | 行 | α |
|---|---|---|
| `src/features/editor/editor.css` | 183 | 0.6 |
| `src/features/editor/editor.css` | 191 | 0.75 |
| `src/components/post/PostItemCard.astro` | 271 | 0.4 |
| `src/components/post/PostItemCard.astro` | 287 | 0.6 |
| `src/styles/components/header.css` | 134 | 0.3 |
| `src/styles/components/header.css` | 195 | 0.4 |
| `src/styles/components/header.css` | 226 | 0.3 |
| `src/styles/components/sider.css` | 72 | 0.55 |
| `src/styles/components/sider.css` | 92 | 0.7 |
| `src/styles/components/sider.css` | 137 | 0.7 |
| `src/styles/components/sider.css` | 415 | 0.75 |
| `src/styles/components/cover.css` | 32 | 0.35 |
| `src/styles/components/series-issues.css` | 211 | 0.55 |
| `src/styles/components/segmented.css` | 20 | 0.55 |

> 做法：把这些行里的 `233 84 107` 改成 `178 82 55`，`rgb(` 前缀与 `/ α` 透明度不动。

### 8. `src/constants/design-tokens.ts` — 阴影 token（第 216、219、220 行）

```js
// 216
'shoka-button': '0px 0px 16px 0px rgb(178, 82, 55, 0.8)',   // 原 233, 84, 105
// 219
'sakura-sm': '0 6px 16px -8px rgb(178 82 55 / 0.45), 0 2px 6px -3px rgb(40 20 40 / 0.12)',
// 220
'sakura-md': '0 10px 24px -10px rgb(178 82 55 / 0.55), 0 3px 8px -4px rgb(40 20 40 / 0.14)',
```

> 每行只改第一个 `rgb(...)` 的粉红数值；后面 `rgb(40 20 40)` 是深色投影，保留。
> `sakura-sm/md` 被悬浮按钮组件 `FloatingGroup` 使用。

### 9. `src/lib/sakura/petal.ts` — 花瓣调色板（第 13–16 行）

花瓣（封面飘落花瓣、点击花瓣爆裂）调色板由粉色改为暖陶土，保持「尖浅 → 根深」：

```ts
['#f7e6dc', '#d08a68'],   // 原 ['#ffe6ee', '#ff9ebd']
['#fbf2ea', '#e0a284'],   // 原 ['#fff3f7', '#ffb8cc']
['#f0dccf', '#c9795b'],   // 原 ['#ffd9e5', '#f7879f']
['#fdf6f0', '#e5b394'],   // 原 ['#fff9fb', '#ffc7d6']
```

### 10. `src/styles/global/scrollbar.css` — 滚动条挂的小花瓣（第 27、28 行）

两个内嵌 SVG 的 `stop-color` 是 URL 编码的粉色，替换为陶土：

```plain
%23ffd9e5  →  %23f0dccf
%23f7879f  →  %23c9795b
```

（第 27 行 `--silk-petal`、第 28 行 `--silk-petal-side`，各两处颜色，共 4 个值。）

顶部注释同步：第 3 行 "1px pink thread" → "1px accent thread"；第 14 行 "a thin pink thumb" → "a thin accent thumb"。

### 11. `src/styles/components/toc.css` — 第 281 行渐变

```plain
改前:  background: linear-gradient(#ffe0e9, #f7879f);
改后:  background: linear-gradient(#f0dccf, #c9795b);
```

### 12. `src/styles/theme/markdown.css` — 第 529 行注释

```plain
改前:  ... reads as cool grey against the night-sakura plum.
改后:  ... reads as cool grey against the warm night brown.
```

### 13. `src/components/friends/FriendRequestForm.tsx`（可选）

第 204 行的 Tailwind 内置 `text-pink-600` 可换成 `text-primary`（友链表单提示文字）。

---

## 三、不改动的部分（保留）

以下属于「作者内容工具」，不属于主题结构性颜色，保留不动：

- `--color-pink`、`--color-pink-text`（其中 `--color-pink` 实测全仓无人使用，可留可删）
- `.pink` 类、`.rainbow` 彩虹文字（文章正文手动标记用）
- `--gradient-pink`（定义了但全仓无引用，不影响显示）
- `src/styles/christmas/christmas-theme.css` 的 `--primary` 覆盖（节日主题，正常行为）

---

## 四、验证方法

1. **开发预览**：`pnpm dev`，在浅色/深色各切换一遍，检查：
   - 首页背景、波浪、header、侧栏、搜索框是否为暖褐/暖白（不再是紫调）
   - 按钮、阅读进度圈、滚动条、TOC 圆环是否为陶土色（不再是粉橙）
   - 鼠标选中文字背景是否为淡陶土
   - 悬停卡片/按钮时，辉光是否为陶土（不再是粉红）
   - 封面飘落花瓣、点击花瓣爆裂是否为暖陶土色
   - 访问不存在的路径，看 404 页（含深色插画）是否已变陶土
2. **残留自查**：全仓搜索 `233 84 107`、`#ed6ea0`、`#f7879f`、`#ffe0e9`、`%23ffd9e5` 等，应仅剩「保留项」。
3. **对比度复核**：任何改动后可用 WCAG 对比度工具复核上表四组比值。
4. **可选**：`pnpm lint` 确认无格式问题。

---

## 五、改动文件速查

| 文件 | 内容 |
|---|---|
| `src/styles/theme/shadcn.css` | 主色、徽章、边框、聚焦环、背景（浅/深） |
| `src/styles/theme/index.css` | 选中色变量 + 结构性渐变（浅/深） |
| `src/styles/global/reset.css` | `::selection` 引用 |
| `tailwind.config.mjs` | Tailwind `pink.a3` 变量名同步 |
| `src/pages/404.astro` | 猫插画配色（172–176）+ 按钮区 16 行 |
| `src/constants/design-tokens.ts` | 阴影 token（shoka-button / sakura-sm / sakura-md） |
| `src/lib/sakura/petal.ts` | 花瓣调色板 |
| `src/styles/global/scrollbar.css` | 滚动条小花瓣 SVG + 注释 |
| `src/styles/components/toc.css` | 第 281 行渐变 |
| `src/styles/theme/markdown.css` | 第 529 行注释 |
| `editor.css` / `PostItemCard.astro` / `header.css` / `sider.css` / `cover.css` / `series-issues.css` / `segmented.css` | 14 处粉红辉光阴影 → 陶土 |
| `src/components/friends/FriendRequestForm.tsx` | （可选）`text-pink-600` |
