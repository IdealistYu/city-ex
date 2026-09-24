# 开发文档

## 命令

```bash
npm install
npm run data    # 首次或数据变更后：fetch → map → font → check
npm run dev     # 本地开发（启动前自动重新生成字体子集）
npm run build   # 输出 dist/（启动前自动重新生成字体子集）
npm run check   # 自检：地图数据完整性、边界无退化环、字体无缺字
npm test        # 端到端回归测试（首次需 npx playwright install chromium）；npm test -- 备份 只跑名称含"备份"的用例
E2E_URL=https://china.loveyou.moe/ npm test   # 对线上站点跑回归测试
```

README 中的展示图 `docs/preview.png` 由网站的"保存图片"功能导出，再用 ImageMagick 转为 256 色 PNG 以减小体积。

单独的步骤：

| 命令 | 作用 |
|---|---|
| `npm run fetch` | 下载 DataV 边界数据与得意黑到 `data/raw/`（已存在则跳过，`--force` 强制重下） |
| `npm run map` | 生成 `src/map-data.json` 与 `src/map-fine.json` |
| `npm run font` | 生成字体子集 `public/fonts/cityex-sans.woff2`（改了界面文案后需要重跑；dev/build 会自动执行） |

`dist/` 是纯静态文件，使用相对路径，可以直接放到任意路径下部署。

## 部署（Vercel）

1. 把仓库推到 GitHub，在 Vercel 中 Import 该仓库。构建配置已写在 `vercel.json` 中（`npm ci` → `npm run build` → `dist/`），无需手动填写。
2. 在 Vercel 项目的 Settings → Domains 添加自定义域名，DNS 里把该域名 CNAME 到 `cname-china.vercel-dns.com`（Vercel 面向中国大陆优化的解析地址；`*.vercel.app` 在大陆无法访问）。
3. 之后每次推送到 `main` 分支会自动部署。

构建环境里没有 `data/raw/`（未纳入版本管理），所以构建时不会重新生成字体，而是沿用已提交的 `public/fonts/cityex-sans.woff2`，并检查它是否覆盖了所有用到的字；缺字时构建会失败并提示。**修改界面文案后，请在本地运行 `npm run font` 并提交新的字体文件。**

静态资源缓存：`assets/` 下带哈希的文件缓存一年；字体文件名固定，缓存一天，并允许在后台更新。

## 结构

```
scripts/
  fetch-data.mjs   下载省级、全国市级边界（DataV）和得意黑
  build-map.mjs    修复拓扑 → 合并 → 两级简化 → Albers 投影 → SVG path / 标签点 / 省份范围 / 南海插图
  build-font.mjs   收集用到的字 → 得意黑子集 → 重命名为 CityEx Sans → woff2
  chars.mjs        收集页面用到的中文字符（build-font 与 check 共用）
  check.mjs        构建产物自检
  config.mjs       直辖市与港澳台等单一单位、简称规则
src/
  map-data.json    全国视图用的粗略边界 + 元数据（约 170KB，随首屏加载）
  map-fine.json    省视图用的精细边界（约 210KB，首屏后在后台加载）
  main.js          入口：视图切换（全国 ⇄ 省）、hash 路由、地图交互、侧栏（统计、画笔、城市列表）
  map.js           构建 SVG、上色、精度切换、viewBox 缩放动画
  gesture.js       拖动平移、双指 / 滚轮 / 触控板缩放
  picker.js        等级选择弹窗
  locator.js       搜索与定位菜单
  image-ui.js      "保存图片"按钮与结果弹层
  export.js        生成 PNG（独立 SVG + 内联样式与字体 → canvas）
  backup-ui.js     数据备份界面：导出 / 导入 JSON
  backup.js        备份文件格式与宽容解析
  store.js         标记数据（localStorage，以行政区划代码为 key，多标签页同步）
  levels.js        等级定义（名称、颜色、说明；颜色只在这里定义）与统计
  dom.js           页面小工具（选择器、转义、窄屏判断）
  toast.js         底部提示条
  download.js      触发下载、判断内置浏览器
  style.css        界面与地图样式
  card.css         地图卡片投影（页面与导出图共用）
tests/
  e2e.mjs          端到端回归测试（自动启动 Vite，Playwright 驱动）
```

## 数据处理要点

- **单位范围**：333 个地级单位 + 省直辖县级单位（仙桃、济源、海南各县、新疆兵团城市等）+ 京津沪渝港澳台各算一个，共 370 个。
- **拓扑修复**：原始数据相邻区县间有约 7000 处缝隙 / 重叠，用 mapshaper `snap` + `-clean` 修复后再简化。
- **简化后再 clean**：淮北、佳木斯、湛江、日喀则的几块小飞地在简化时会被压成零面积，打乱周围拓扑（省界断开、内陆出现黑点），所以简化后再执行一次 `-clean`；另外还会兜底去掉残留的零面积"扁环"。
- **两级精度**：全国视图用 3% 简化并去掉面积小于约 1 像素的碎岛；进入省视图或全国视图放大 2 倍以上时换成 8% 的精细版。参数在 `build-map.mjs` 的 `DETAIL` 中，可用 `COARSE=4% MIN_ISLAND=0.5 npm run map` 临时试验。
- **小岛**：简化丢掉的岛按原坐标补回（三沙 112 个岛礁、钓鱼岛等始终保留）。
- **港澳**：全国视图里只有几像素大，海岸线改用省界细线，避免糊成黑团；省视图恢复正常。
- **三沙**：不在全国主图绘制，只出现在南海诸岛插图中；可在海南省视图的城市列表或搜索里标记。
- **插图位置**：自动放在台湾以南，避免遮挡。

## 字体

界面与导出图片使用[得意黑 Smiley Sans](https://github.com/atelier-anchor/smiley-sans)（SIL OFL 1.1）。
得意黑声明了保留字体名 "Smiley" 与 "得意黑"，按 OFL 子集化属于修改，因此子集字体内部改名为 **CityEx Sans**，协议全文见 `public/fonts/OFL.txt`。
得意黑缺字时构建会提示，缺的字回退到系统字体；`npm run check` 会检查是否缺字。

## 浏览器支持

近两年的 Chrome、Edge、Firefox、Safari（含 iOS Safari 16.2+）。用到了 CSS `color-mix()`，更旧的浏览器上省视图周边省份的淡化效果会缺失，其余功能正常。

## 注意

- 边界数据来自阿里 DataV GeoAtlas（源自高德），授权未明确允许再分发，仅建议个人非商业使用。
- 在中国大陆公开发布地图需符合标准地图要求（审图号），请勿修改国界线，务必保留南海诸岛与台湾。
