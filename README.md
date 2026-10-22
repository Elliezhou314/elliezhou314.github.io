# 周丹娜个人网站

线上地址：https://elliezhou314.github.io/ （GitHub Pages，推送到 `main` 分支后一两分钟自动更新）

纯静态页面，没有构建步骤，改完文件直接推送即可。

## 文件

| 文件 | 作用 |
|---|---|
| `index.html` | 唯一页面：文字内容、SEO 标签（title / description / 结构化数据）都在这里 |
| `css/style.css` | 配色、HUD 面板、首屏三栏、工具区、图签页脚 |
| `css/workbench.css` | 工作台三块：清单对量表、成本 S 曲线、标准层平面图 |
| `js/tower.js` | 首屏线框楼动画（逐层建起、旋转、塔吊回转） |
| `js/clock.js` | 顶栏时钟 |
| `robots.txt` / `sitemap.xml` | 给搜索引擎的收录说明；页面有实质改动时更新 `sitemap.xml` 的 `lastmod` |
| `404.html` | 访问不存在的地址时显示 |

## 本地预览

直接双击 `index.html` 用浏览器打开即可。

## 改内容的口径

- 公开网站，台账数字、项目金额、身份证号、合同内容一律不放。
- 工作台三块标了「示意」，是界面样例不是真实数据；要换成真实内容，必须先脱敏。
- 字体：中文用系统字体；英文标题字体从 Google Fonts 异步加载，国内加载不到时自动退回系统字体，页面不会卡住。

## 搜索收录

- 谷歌：在 Google Search Console 添加 `https://elliezhou314.github.io/`，按提示验证；如果给的是 HTML 验证文件，放到仓库根目录推送。验证通过后提交 `sitemap.xml`。
- 百度：GitHub 屏蔽百度爬虫，这个地址百度基本收录不到。要百度收录，需要国内服务器、自己的域名并完成 ICP 备案，网站文件原样复制过去就能用。
