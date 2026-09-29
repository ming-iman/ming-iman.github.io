# Ming 的学习笔记

站点：https://ming-iman.github.io

一个以中文长文阅读为主的静态笔记站，支持搜索标题/摘要/分类/标签、自动分类页、标签页、按年归档、文章目录、代码高亮与复制、站点地图和移动端布局。

## 本地运行

需要 Node.js 22.12+（CI 使用 Node.js 22）或兼容版本。

```bash
npm ci
npm run dev
npm run build
npm run preview
```

## 新增一篇笔记

1. 将 `docs/new-note.md` 复制为 `src/content/notes/your-topic.md`，使用稳定的英文文件名作为 URL。
2. 修改 title、description、date、category、tags，撰写正文。
3. 预览无误后，把 draft 改为 false 或移除该字段。
4. 提交并推送到 main，GitHub Actions 自动检查、构建和发布。

分类只有一个，用于大主题；标签可有多个，用于语言、技术与关键词。分类和标签从元数据自动生成，无需修改导航。draft:true 的文章不会出现在任何公开路由或索引中。

文章内容唯一来源是 `src/content/notes/`。同一文章不要在多个目录分别维护。已有文章修改时可以新增 `updated: YYYY-MM-DD`。站点首页、文章和分类都是静态 HTML，关闭 JavaScript 仍可阅读；客户端搜索与复制代码是渐进增强功能。

## GitHub Pages

仓库 Settings → Pages → Source 选择 GitHub Actions。部署工作流位于 `.github/workflows/deploy.yml`，构建产物为 dist。若变更域名，同步修改 astro.config.mjs 的 site 和 public/robots.txt。

### 自动检查与发布

- 推送到 `main`：安装锁定版本的依赖，运行 Astro 类型检查和静态构建，成功后自动发布到 https://ming-iman.github.io/。
- 提交或更新目标为 `main` 的 Pull Request：执行相同构建检查，不发布网站。合并到 `main` 后自动发布。
- 手动重发：在仓库 Actions → Publish notes to GitHub Pages → Run workflow 中选择 `main`。

日常更新文章后，在本站仓库目录执行：

```bash
git add src/content/notes/
git commit -m "Update learning notes"
git push origin main
```

查看 [Actions 运行记录](https://github.com/ming-iman/ming-iman.github.io/actions/workflows/deploy.yml)。`build` 和 `deploy` 均成功后刷新网页；构建失败时不会部署，已发布网页继续保留。修改其他站点文件时，也要将相应文件加入提交。

本地保存文件不会触发发布，需要推送到站点仓库 `ming-iman/ming-iman.github.io`；课程工程中的 Kotlin / Swift 文件不属于本站仓库。

## 目录

- src/content/notes：文章 Markdown
- src/pages：静态路由
- src/layouts：公共页面框架
- src/components：文章列表和 React 搜索
- src/styles/global.css：视觉样式与响应式布局
- docs/design.md：设计和维护说明

此仓库仅包含公开站点资料，不包含个人聊天记录、未完成学习自评或本地缓存。
