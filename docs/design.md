# 设计与维护说明

目标：让读者快速找到、阅读和引用学习笔记；让作者通过 Markdown 持续写作。

信息架构：首页（搜索与文章列表）、文章详情（目录与正文）、分类索引与分类页、标签索引与标签页、按年归档。只展示实际已发布内容，不用虚构文章填充。

视觉：浅色纸面、墨色正文、蓝色强调、细分隔线；列表而非卡片墙。中文正文行宽控制在约 40 字，代码独立横向滚动，长标题自然换行。

组件树：

```text
BaseLayout
  SiteHeader / PrimaryNav
  Main
    HomeIntro / NoteSearch (React + TypeScript)
      Input / ClearButton / Results / EmptyState
    TaxonomyIndex / NotesList
    ArticleHeader / MobileTOC / ArticleBody / DesktopTOC
  SiteFooter
```

Astro 生成完整静态文章与归档，React 只增强首页搜索；静态路径不依赖客户端路由，适合 GitHub Pages 与直接分享。搜索使用轻量本地控件，不引入整套组件库；无 JS 仍能阅读列表、分类、标签与全文。

状态：搜索为空显示全部；无结果时提供清除按钮；搜索区 hydrate 前显示原有列表且输入禁用；焦点可见；文章缺失返回自定义 404。静态数据无网络加载或权限状态，不制造无用骨架屏。

响应式：小屏导航换行、文章目录折叠、正文单列；桌面文章目录位于右侧。表格和代码块内部滚动，页面不横向溢出。

发布前自检：

| 风险 | 修正 |
|---|---|
| 只有一篇文章却像空仪表盘 | 使用真实文章列表，不填假指标和假笔记 |
| 首页标题过度营销 | 使用直接的笔记站定位与内容摘要 |
| 长文无导航 | 提取标题生成目录，保留锚点链接 |
| 手机代码撑破页面 | pre/table 容器独立滚动，长词可换行 |
| 分类标签依赖手工维护 | 从内容元数据生成路径和数量，支持 URL 编码 |

内容的 source of truth：src/content/notes。文章模板在 docs/new-note.md。draft:true 不参与列表、搜索、文章路由、分类、标签与 sitemap。
