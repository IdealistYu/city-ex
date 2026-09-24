// 导出全国视图 PNG：独立构建一份 SVG（内联样式）→ <img> → canvas
import { LEVELS, tally } from './levels.js';
import CARD_STYLE from './card.css?raw';
import { buildMap, paint, setDetail, hasFine, units, FULL_VIEW } from './map.js';
import { canDownload, download } from './download.js';
import { esc } from './dom.js';

const SCALE = 2;
const FONT = `'CityEx Sans','PingFang SC','Hiragino Sans GB','Microsoft YaHei','Noto Sans CJK SC',sans-serif`;
const FONT_URL = `${import.meta.env.BASE_URL}fonts/cityex-sans.woff2`;

// SVG 作为 <img> 渲染时不能加载外部资源，字体需转成 data URL 内联
let fontFace = null;
const loadFontFace = () => fontFace ??= fetch(FONT_URL)
  .then(res => { if (!res.ok) throw new Error(res.status); return res.blob(); })
  .then(blob => new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(`@font-face{font-family:'CityEx Sans';src:url(${reader.result}) format('woff2')}`);
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  }))
  .catch(() => (fontFace = null, '')); // 取不到字体就用系统字体导出

const BG = '#f3efe6';

const STYLE = `
.sea{fill:${BG}}
.unit{fill:#fff;stroke:#fff;stroke-width:.35;stroke-linejoin:round}
${LEVELS.filter(l => l.value).map(l => `.unit[data-level="${l.value}"]{fill:${l.color};stroke:${l.color}}`).join('')}
.line-province{fill:none;stroke:#222;stroke-width:.55;stroke-linejoin:round}
.line-country{fill:none;stroke:#222;stroke-width:1.1;stroke-linejoin:round}
.inset-bg{fill:#fbf9f4}
.inset-frame{fill:none;stroke:#222;stroke-width:1.1}
.inset-title{font-size:10px;text-anchor:end;fill:#6b665c}
.inset .unit{stroke-width:.2}
.inset .line-province{stroke-width:.35}
.inset .line-country{stroke-width:.55}
.jd{fill:#222;stroke:#222;stroke-width:1.2;stroke-linecap:round}
text{font-family:${FONT};fill:#222}
`;

export const exportImage = async levels => {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  buildMap(svg, { withLabels: false });
  if (hasFine()) setDetail(svg, 'fine'); // 导出图分辨率较高，精细版已加载就用精细版
  for (const [code, level] of Object.entries(levels)) paint(svg, code, level);

  const { counts, score, visited } = tally(levels, units);

  // 标题放在左上角（新疆以北的空白处），图例放在左下角（西藏以南的空白处）
  const [, , W, H] = FULL_VIEW;
  let overlay = `<text x="28" y="62" font-size="44" font-weight="bold">城市制霸</text>
<text x="30" y="98" font-size="20">${visited} / ${units.length} 城 · ${score} 分</text>`;
  LEVELS.filter(l => l.value).forEach((l, i) => {
    const y = H - 30 - (LEVELS.length - 2 - i) * 26;
    overlay += `<rect x="30" y="${y - 15}" width="30" height="18" rx="3" fill="${l.color}" stroke="#222" stroke-width="1"/>
<text x="70" y="${y}" font-size="17">${esc(l.name)}  ${counts[l.value]}</text>`;
  });

  // --k：导出图 1 单位 = SCALE 像素，投影偏移与页面上保持同样的像素
  const text = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${FULL_VIEW.join(' ')}" width="${W}" height="${H}" style="--k:${1 / SCALE}">`
    + `<style>${await loadFontFace()}${STYLE}${CARD_STYLE}</style>${svg.innerHTML}${overlay}</svg>`;

  const img = new Image();
  const svgUrl = URL.createObjectURL(new Blob([text], { type: 'image/svg+xml' }));
  await new Promise((resolve, reject) => {
    img.onload = resolve;
    img.onerror = reject;
    img.src = svgUrl;
  });
  // Safari 在 onload 时内联字体可能还没就绪，稍等再画（china-ex 同样的处理）
  await new Promise(resolve => setTimeout(resolve, 300));

  const canvas = document.createElement('canvas');
  canvas.width = W * SCALE;
  canvas.height = H * SCALE;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = BG;
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
  URL.revokeObjectURL(svgUrl);

  const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/png'));
  const url = URL.createObjectURL(blob);

  // 内置浏览器不支持下载时，只展示图片供长按保存
  if (canDownload()) download(url, '城市制霸.png');
  return url;
};
