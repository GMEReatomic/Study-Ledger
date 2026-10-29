# 一页工作台 · Study Ledger

一个纯前端的「类笔记本手账」学习工作台。没有 React / Vue，没有构建步骤，所有页面共享 `css/style.css` 与 `js/common.js`，用原生 HTML、CSS、JavaScript 直接运行。

包含一套完整的学生工具：加密密码保险箱、Aster 个人知识库（Markdown + LaTeX + 可编辑思维导图）、可自定义学习网站导航、天气、时间、随机站点和外部工具跳转。

## 快速开始

> 必须通过 `localhost` 或 HTTPS 访问。`file://` 无法使用 Web Crypto、Service Worker 和 IndexedDB 的安全能力。

### 方式一：Python（推荐）

```bash
# 在项目目录运行
python -m http.server 8000
```

然后打开：<http://localhost:8000/>

如果使用 Windows，也可以直接双击 `start.bat`，脚本会自动启动服务器并打开浏览器。

### 方式二：Docker

```bash
docker build -t yipan-toolbox .
docker run --rm -p 8000:8000 yipan-toolbox
```

然后打开：<http://localhost:8000/>

## 项目结构

```text
project1/
├── index.html                # 今日手账 / 主页
├── password.html             # 加密密码保险箱
├── notes.html                # Aster 个人知识库 / 可编辑导图
├── resources.html            # 可自定义学习网站导航 + 复杂度附页
├── weather.html              # Open-Meteo 天气
├── datetime.html             # 日期、星期与实时时钟
├── random.html               # 随机站点
├── external.html             # 外部工具跳转合集
├── 404.html                  # 找不到页面
├── css/
│   └── style.css             # 全站共享视觉系统与响应式样式
├── js/
│   ├── common.js             # 公共工具：主题、命令面板、时钟、天气、IndexedDB、Crypto
│   ├── home.js               # 今日任务
│   ├── password.js           # 保险箱逻辑
│   ├── notes.js              # Aster：编辑、文件夹、Callout、命令面板、导出
│   ├── notes-mindmap.js      # 大纲解析、SVG 导图、节点编辑与回写
│   ├── resources.js          # 学习网站导航 CRUD 与 localStorage
│   ├── weather.js            # 天气搜索、定位与渲染
│   ├── datetime.js           # 双时钟
│   ├── random.js             # 随机站点签筒
│   └── external.js           # 邮箱本地备忘
├── assets/
│   ├── icons.svg             # 单色线稿图标库
│   ├── curtain-doodle.svg    # 书眉带手绘插画
│   ├── favicon.svg
│   ├── icon-180.png
│   ├── icon-192.png
│   └── icon-512.png
├── tools/
│   └── generate_icons.py     # PWA 图标生成脚本（非运行必需）
├── manifest.json             # PWA 清单
├── sw.js                     # Service Worker 离线缓存
├── Dockerfile
├── start.bat
└── README.md
```

## 视觉设计

- 四套主题共用一套 CSS 变量骨架：`paper`（默认米白手账）、`kraft`（暖褐牛皮纸）、`gray`（浅灰现代工作区）、`dark`（夜间）。切换只改 `<html data-theme>` 下的变量，刷新后从 `localStorage` 恢复。
- 变量骨架包含 `--bg`、`--text`、`--accent`、`--border`、`--card`、`--texture-opacity`、`--icon-stroke`、`--radius`，并继续兼容原有纸色 / 墨色变量。
- 双密度：主页保持手账密度（横帘、便签、日期章、题记、纸纹）；Aster 页切换为现代密度（干净页眉、文件夹树、编辑器、可编辑导图），去掉大纸纹与大装饰。
- `gray` / `dark` 使用 44px 简化现代横栏：背景为 `var(--panel)`，隐藏手绘插画，保留“一页工作台 · STUDY LEDGER”字标与虚线 stitch。现代主题纸纹 `opacity` 低于 `0.03`，图标线宽降到 1.5。
- 主题切换按钮位于页眉右侧：桌面显示“主题 · 当前主题”，移动端只显示调色板图标 + 当前主题简称；面板从按钮下方展开。
- 页面图标统一来自 `assets/icons.svg` 的单色 `currentColor` 线稿图标，全部 symbol 引用已校验。
- 标题使用系统衬线字体与内联 SVG 手绘下划线；Aster 页则使用干净的现代标题密度。

## 页面与功能

### 主页 `index.html`

- 装饰横帘、实时日期时间、天气概况；日期便签整块进入时间页，天气独立进入天气页。
- 今日任务输入、勾选、单条删除、清空已完成；任务按 `toolbox.tasks.v1.YYYY-MM-DD` 日期隔离，隔天自动换一张清单，旧任务不再出现。
- 主页大标题从 15 条励志格言中按日期 seed 轮换；每日小字副标题使用另一组 14 条短句，不与标题重复。
- 每日问候语优先请求 ZenQuotes today，失败后尝试 Quote Garden random，总超时 3 秒；网络失败时从 14 条内置短句中按日期 seed 取一条，并缓存当天结果。
- 右上角「外部工具」下拉只放外部入口和邮箱快捷入口；右下角「站内工具」只放密码保险箱、Aster 知识库、学习网站导航、随机站点四项。
- 页眉时间与天气文字使用同一字体、字重与字距，时间保留 `tabular-nums` 防止跳秒抖动。

### 密码保险箱 `password.html`

- 首次设置主密码；`PBKDF2(SHA-256, 100000 iterations)` 派生 256 位 AES-GCM 密钥。
- 每条记录使用独立随机 IV，将站点、用户名、密码、网址、备注整体加密后写入 IndexedDB。
- 数据库固定为 `toolboxDB` 版本 `2`，包含 `vault`、`meta`、`notes` 三个对象仓库。
- 主密码不落盘，只保存随机盐与加密验证块。
- 搜索、添加、编辑、复制、显示 / 隐藏、删除密码记录。
- `crypto.getRandomValues()` 安全随机密码生成器（大写、小写、数字、符号、12–32 位）。
- 5 分钟无操作自动锁定；刷新页面后必须重新输入主密码。
- 加密备份导出 / 导入。备份仍是密文，恢复时需要备份对应的原主密码。
- 页面明确说明本地存储边界与主密码不可找回。

### Aster 知识库 `notes.html`

- Aster 定位为个人知识库，收算法、课程与零散知识；文案、导图根节点和导出页统一使用 Aster 品牌。保留 Markdown、KaTeX、自动保存、问 AI、Markdown / HTML 导出。
- 左侧 Markdown + LaTeX 编辑，右侧实时预览；Aster 页使用独立的 1560px 宽容器，页眉、页脚同步对齐。
- 编辑区去除横线背景；编辑区与预览区按 `scrollTop / (scrollHeight - clientHeight)` 比例跟随滚动，不做 AST 行级同步。
- 预览支持全屏，Esc 退出；全屏状态不会触发返回主页。工具栏支持导入本地 `.md` / `.txt`（FileReader，2 MB 限制），导入会新建笔记并填入编辑器。
- ASTER V2 将顶部、工具栏、侧栏与导图控制全部换成单色 SVG 图标；图标按钮带 `title` 和 0.5 秒延迟的 CSS Tooltip，默认透明、hover 才显示浅背景。
- 编辑区上方提供多标签页：侧栏点击笔记会打开或切换 Tab；关闭当前 Tab 自动激活相邻 Tab，全部关闭显示空状态。打开列表和当前 Tab 只存 `sessionStorage`，刷新当前会话仍保留。
- 全屏预览时 Tab 栏固定在顶部并保持可切换；切换前会先 `flushSave()`，避免快速切换丢失未保存内容。
- 「新建」旁提供模板菜单：内置定理证明、错题复盘、算法模板；自定义模板通过前端表单添加，保存到 localStorage 的 `asterCustomTemplates.v1`，可删除。
- 删除按钮为图标按钮，点击后显示内联确认条，不使用浏览器 `confirm()`。
- 工具栏常驻分数、根号、上下标、积分、求和；其余矩阵、极限、对齐、分段、希腊字母收进「更多」。选中文本可执行独立公式、行内公式、加粗、斜体、删除线、下划线。
- 颜色只提供墨蓝、棕红、橄榄绿、灰紫四个预设；下划线与颜色在 markdown-it 渲染前用占位符保护，渲染后恢复受控 HTML，内容再次 `escapeHtml`，同时保持 `html: false`。
- 支持 Obsidian 风格 Callout：`> [!note]`、`> [!warning]`、`> [!tip]`，`+` / `-` 控制默认展开 / 折叠，基于 blockquote 后处理，支持嵌套。
- 笔记保存在 IndexedDB 的 `notes` 仓库，新增 `folder` 字段（空字符串为未分类）；支持文件夹树筛选、搜索范围「当前文件夹 / 全部」、文件夹新建与拖拽排序。
- 支持笔记右键菜单（重命名 / 移动到文件夹 / 删除）、笔记列表拖拽排序、`Ctrl/Cmd+K` 命令面板、`Ctrl/Cmd+S` 保存、`Ctrl/Cmd+N` 新建、Esc 返回 / 关闭。
- 笔记列表和天气加载使用浅灰骨架屏，不使用“加载中…”文字。
- 「思维导图」第三视图解析 `#`–`######` 标题与嵌套列表，生成可折叠 SVG + CSS 树；根节点和一级分支使用唯一 key。
- 导图支持节点重命名、添加子节点、删除节点、拖拽调整层级，并回写 Markdown 大纲；表单解析会保留各节点下的正文、公式、代码块和 Callout。
- 点击导图节点读取当前笔记对应段落，用同一套 markdown-it + KaTeX 管线渲染；节点标题只显示纯文本，不在节点内渲染 LaTeX。
- 「问 AI」优先复制编辑框中选中的文字，否则复制整篇内容，然后打开 DeepSeek / ChatGPT / Kimi。
- 支持导出 `.md` 和带排版的独立 `.html`。导出 HTML 时会尝试把 KaTeX CSS 与 WOFF2 字体一起内嵌，公式不依赖网络；Callout / 下划线 / 预设颜色也会带出。
- markdown-it 配置 `html: false`；渲染到页面前的笔记标题、标签、搜索结果等均经过 `escapeHtml`。
- CDN 渲染库加载失败时提供基础排版兜底，并显示提示，不让页面直接空白。

### 学习网站导航 `resources.html`

- 主入口为 <https://oi-wiki.org/>；默认收录 OI Wiki、OI Wiki 复杂度速查、Hello 算法、CS 自学指南、MDN、洛谷、Desmos。
- 支持添加、编辑、删除、按标题 / 描述 / 分类搜索；所有外部链接在新标签页打开。
- 自定义数据保存到 `localStorage` 的 `studyResources` 键，刷新页面后仍保留。
- 删除内置条目后可用「恢复默认」找回；恢复默认会替换当前书架。
- 复杂度速查保留为可折叠附页：Θ / O / Ω / o / ω 含义、常见复杂度排序和 OI Wiki 外链，不使用 iframe。

### 天气 `weather.html`

- 使用 Open-Meteo 免费 API，无需 API Key。
- 支持浏览器定位和手动城市搜索。
- 天气主信息旁显示当前地点与来源标签；手动搜索显示城市名，定位无法反查城市时至少显示“当前定位（纬度, 经度）”。
- 显示温度、体感温度、天气状况、风速、风向风力、湿度、观测时间。
- 处理定位拒绝、定位超时、城市无结果、网络失败和请求超时，不会停在加载中。
- 同地点天气会缓存到 `localStorage`，网络失败时可继续显示上一次结果。

### 时间显示 `datetime.html`

- 当前日期、星期、实时数字时钟，每秒刷新。
- 模拟时针、分针、秒针与数字时钟同步。
- 显示时区、一年中的第几天和手账周数。

### 随机站点 `random.html`

- 维护一份学习 / 开发站点数组，使用 `crypto.getRandomValues()` 随机抽取。
- 抽取后显示结果并在 3 秒后跳转，可点「留在这里」取消。
- 避免连续两次抽到同一个站点。

### 外部工具 `external.html`

- 微信文件助手：<https://filehelper.weixin.qq.com/>
- 歌曲下载：第三方站点外链，页面明确注明可用性不保证与版权提示。
- 文档转换：BentoPDF 与 PDFBEAR。
- 一键激活：只提供外部说明和链接，不实现任何激活逻辑。
- 邮箱入口：Gmail、QQ 邮箱、163、Outlook。
- 邮件备忘使用 `localStorage` 自动保存，只留在当前浏览器。

### 404 页面 `404.html`

- 保持同一套手账视觉，提供返回主页、Aster 知识库和学习网站导航入口。
- Python 自带静态服务器不会自动使用自定义 404 页；部署到 Nginx、Cloudflare Pages、GitHub Pages 等平台时，可将 `404.html` 配置为自定义错误页。

## 数据与安全

### 密码保险箱安全模型

1. 主密码经 PBKDF2-SHA-256、100,000 次迭代派生 AES-GCM 256 密钥。
2. 元信息 `meta` 中只保存：
   - 16 字节随机盐（Base64）
   - 迭代次数与算法标识
   - 用派生密钥加密的验证块
3. `vault` 中每条记录只保存 `{ id, payload: { iv, data }, createdAt, updatedAt }`；站点名、用户名、密码、备注均在密文中。
4. 主密码和派生 CryptoKey 只存在于当前页面内存；刷新、关闭、手动锁定或 5 分钟无操作后清除。
5. 备份导出的也是密文；主密码遗失后无法恢复。

> 这是浏览器本地工具的威胁模型：它能防止 IndexedDB 中的明文泄露，但无法防御已控制你浏览器或操作系统的攻击者，也无法替代密码管理器在设备层面的安全能力。

### 数据清除

- 密码与笔记：浏览器开发者工具 → Application → IndexedDB → 删除 `toolboxDB`。
- 今日任务：`localStorage` 键 `toolbox.tasks.v1.YYYY-MM-DD`（每天一条）。
- 天气地点与缓存：`toolbox.weatherPlace.v1`、`toolbox.weatherCache.v1`。
- 邮件备忘：`toolbox.emailMemo.v1`。
- 随机站点上次结果：`toolbox.randomLast.v1`。
- 学习网站导航：`localStorage` 键 `studyResources`。
- 主题：`toolbox.theme.v1`；每日短句缓存：`toolbox.dailyQuote.v1`。
- Aster 文件夹顺序 / 笔记拖拽顺序：`asterFolders`、`asterNoteOrder`。

清除前请先在保险箱内导出加密备份。

## 外部依赖与离线

- 笔记渲染库通过 CDN 动态加载：
  - markdown-it 14.1.0
  - KaTeX 0.16.22（含 CSS 与字体）
- 采用 `jsDelivr` 优先、`unpkg` 兜底的双源加载；加载失败会显示提示并使用基础排版模式。
- 跨域 CDN 资源不再由 Service Worker 改写，避免浏览器与 SW 网络策略不一致时把样式或脚本错误地回成 503；常规浏览器 HTTP 缓存仍可复用。
- 天气 API 不缓存；离线时依赖 `localStorage` 中上一次天气结果。
- 每日问候语尝试 ZenQuotes（`/api/today`）与 Quote Garden（`/api/v3/quotes/random`），无需密钥；总超时 3 秒，失败时使用内置中文短句并按日期缓存。
- PWA 预缓存本站页面、CSS、JS、图标等核心静态资源；笔记渲染库属于跨域资源，完全离线且浏览器 HTTP 缓存不可用时会自动进入基础排版模式。更新静态文件后如果看到旧页面，可在开发者工具中注销 Service Worker，或递增 `sw.js` 中的缓存版本号（当前 `v1.7.2`）。

## 浏览器要求

- 现代 Chrome / Edge / Firefox / Safari（支持 Web Crypto、IndexedDB、`<dialog>`、CSS Grid）。
- 密码保险箱必须在安全上下文中运行：`localhost`、`127.0.0.1` 或 HTTPS。
- 浏览器定位和剪贴板写入可能需要用户授权；拒绝后页面会给出可操作提示。

## 下一步（暂缓，不在本版实现）

- 双向链接与反向引用
- 全局知识图谱视图
- Dataview 式查询
- 插件系统
- 实时协同
- 行级精确滚动同步
- 自由取色
- 主题商店

## 验收清单

- [x] `python -m http.server 8000` 后可访问。
- [x] 主页横帘、日期便签、天气、外部工具入口在同一视觉区域；时间便签进时间页，天气独立进天气页。
- [x] 右上角只放外部工具，右下角只放四项站内工具，两处不再重复。
- [x] 密码保险箱刷新后锁定；错误主密码无法解锁；IndexedDB 中只有密文。
- [x] Aster V2 控制按钮使用单色 SVG 图标，带 `title` 与 0.5 秒延迟 Tooltip；删除使用图标与内联确认条；所有 `assets/icons.svg#icon-*` 引用可解析。
- [x] Aster 支持多标签页、关闭相邻激活、全部关闭空状态、全屏 Tab 切换；快速切换前保存当前笔记。
- [x] 模板菜单包含定理证明、错题复盘、算法模板；自定义模板可新增、持久化和删除。
- [x] 笔记页实时渲染 Markdown 与 LaTeX，公式错误不崩溃；编辑 / 预览滚动比例跟随；预览全屏可 Esc 退出。
- [x] 本地 `.md` / `.txt` 导入成功；Ctrl/Cmd+S 保存、Ctrl/Cmd+N 新建、Ctrl/Cmd+K 命令面板可用；非输入状态 Esc 返回主页。
- [x] 常用公式常驻、更多命令折叠；选中文本可独立公式 / 行内公式 / 加粗 / 斜体 / 删除线 / 下划线 / 四种预设颜色。
- [x] `> [!note]`、`> [!warning]`、`> [!tip]` Callout 可渲染、可折叠并支持嵌套。
- [x] Aster 文件夹可新建、筛选、拖拽排序；笔记可归档、右键移动、拖拽排序；搜索支持当前文件夹 / 全部。
- [x] 思维导图支持节点增删改、拖拽调整层级，并回写 Markdown 大纲；正文、公式、代码块和 Callout 不丢失。
- [x] 笔记页在 1366 / 1920 / 2560 宽度下不拥挤，编辑与预览可独立滚动；LaTeX 速查分组完整且内部滚动。
- [x] 四套主题可切换并持久化；gray/dark 保留 44px 简化横栏和品牌字标，纸纹低于 0.03，图标 1.5 线宽。
- [x] 主题按钮位于页眉右侧；Aster V2 中显示为调色板图标，Tooltip 显示当前主题；其他页面保留“主题 · 当前主题”胶囊。
- [x] 笔记颜色标签在预览与导出 HTML 中生效；全屏预览可上下滚动，Esc 退出。
- [x] 夜间模式日期便签和今日清单输入栏使用深色表面，文字对比度正常。
- [x] 主页标题按日期轮换格言，小字副标题独立不重复；今日任务按日期隔离、单条可删除；每日短句有 API 与 14 条内置兜底。
- [x] 学习网站导航主入口为 OI Wiki，可添加、编辑、删除、搜索、持久化和恢复默认。
- [x] 天气页显示当前地点或经纬度定位信息，定位失败和请求失败均有明确提示；天气和笔记列表使用骨架屏。
- [x] 全站统一为类笔记本手账风，Aster 切换为现代密度，无网页 Banner 感。
- [x] 移动端适配、PWA manifest、Service Worker、Dockerfile、start.bat。
