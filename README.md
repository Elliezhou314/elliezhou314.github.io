# 周丹娜个人网站

线上地址：https://elliezhou314.github.io/ （GitHub Pages，推送到 `main` 分支后一两分钟自动更新）

纯静态单页，没有 JavaScript、没有构建步骤（`naowu/` 子目录里的游戏除外，见下）；只有改了页面文字时需要重新生成一次字体（见下）。

## 文件

| 文件 | 作用 |
|---|---|
| `index.html` | 唯一页面：文字内容、SEO 标签（title / description / Open Graph / 结构化数据）都在这里 |
| `css/base.css` | 字体 `@font-face`、设计变量、重置、页眉、页脚、通用类 |
| `css/sections.css` | 主图区、宣言区、作品区、业务条、手机版响应式 |
| `art/stair.svg` | 首屏台阶与拱门插图 |
| `art/radar.svg` / `art/columns.svg` / `art/overlap.svg` | 三件作品的插图（标讯雷达 / 经营一体化平台 / 对量工具） |
| `fonts/*.woff2` | 自托管字体子集：Noto Serif SC 300/400、Noto Sans SC 300/400、Jost 400/500 |
| `fonts/OFL-*.txt` | 三套字体的 SIL OFL 许可文本 |
| `tools/subset_fonts.py` | 按页面实际用到的字符生成上面的字体子集 |
| `favicon.svg` | 墨绿底、象牙色拱门图标 |
| `robots.txt` / `sitemap.xml` | 给搜索引擎的收录说明；页面有实质改动时更新 `sitemap.xml` 的 `lastmod` |
| `404.html` | 访问不存在的地址时显示 |
| `naowu/` | 益智游戏「脑雾克星」的网页应用版（生成物，见下一节） |

## `naowu/`：脑雾克星（网页应用版）

`naowu/` 是单机益智游戏「脑雾克星」的网页应用版，地址 https://elliezhou314.github.io/naowu/ 。
手机浏览器打开后「添加到主屏幕」，就能像应用一样全屏、断网使用（离线缓存由里面的 `sw.js` 负责）。

- **是生成物，不要手改。** 源码在另一个本地仓库 `E:\Claude工作区\德扑训练器`，在那里运行
  `node tools/build_pwa.mjs` 生成 `dist/pwa/`，再把 `dist/pwa/` 整个复制成这里的 `naowu/`。
  手改任何一个文件，离线缓存核对内容指纹时就对不上，新版本装不上。
- **更新**：在游戏仓库重新生成 → 删掉这里的 `naowu/` → 把新的 `dist/pwa/` 整个复制过来 → 提交、推送。
  玩家下次联网打开时在后台取新版，页面上出「有新版本，点这里更新」，点了才换；进度不受影响。
- 页面带 `noindex,nofollow`；主页、`sitemap.xml`、`robots.txt` 里都没有指向它的链接，不让搜索引擎收录。
- 根目录的 `.nojekyll` 要留着：GitHub Pages 不经 Jekyll 处理、文件原样发布。`naowu/` 里的文件名全是 ASCII，没有以下划线或点开头的。
- 游戏进度存在浏览器的本地存储（键名 `squid.progress.v1`），和主页同一个域名；主页不用本地存储，不会撞。
  离线缓存的名字带 `naowukexing-pwa|` 前缀和子目录地址，只清理它自己的旧缓存。

## 本地预览

直接双击 `index.html` 用浏览器打开即可。

## 改了页面文字之后

字体只保留了页面上出现过的字，新加的字会退回系统字体。改完 `index.html` 或 `404.html` 的文字后运行：

```
python -X utf8 tools/subset_fonts.py
```

脚本读取 `tools/_src/` 下的字体源文件（不入库）。源文件缺了就从 Google Fonts 官方仓库 https://github.com/google/fonts/tree/main/ofl/ 重新下载，改名后放进 `tools/_src/`：

- `notoserifsc/NotoSerifSC[wght].ttf` → `NotoSerifSC-VF.ttf`
- `notosanssc/NotoSansSC[wght].ttf` → `NotoSansSC-VF.ttf`
- `jost/Jost[wght].ttf` → `Jost-VF.ttf`

需要 `pip install fonttools brotli`。

## 改内容的口径

- 公开网站，台账数字、项目金额、身份证号、合同内容一律不放。
- 插图是示意画，不是真实项目图纸或数据。
- 字体：全部自托管在 `fonts/`，不连 Google Fonts，国内也能正常显示；个别字缺失时自动退回系统字体。

## 搜索收录

- 谷歌：在 Google Search Console 添加 `https://elliezhou314.github.io/`，按提示验证；如果给的是 HTML 验证文件，放到仓库根目录推送。验证通过后提交 `sitemap.xml`。
- 百度：GitHub 屏蔽百度爬虫，这个地址百度基本收录不到。要百度收录，需要国内服务器、自己的域名并完成 ICP 备案，网站文件原样复制过去就能用。
