// 单省导出图：1080×1440（3:4 竖图），标题"XX制霸"、点亮率、带城市名的地图、全制霸印章、竖版全国位置小图
import { LEVELS, tally } from './levels.js';
import { units as allUnits, provinceByCode, unitsOf, loadFine } from './map.js';
import mapData from './map-data.json';
import { rasterize } from './export.js';
import { esc } from './dom.js';
import { layoutLabels, leaderEnd } from './label-layout.js';

const W = 1080, H = 1440, PAD = 64, SCALE = 2;
const INK = '#222', MUTED = '#6b665c', BG = '#f3efe6', PAPER = '#fbf9f4';
const FONT = `'CityEx Sans','PingFang SC','Hiragino Sans GB','Microsoft YaHei','Noto Sans CJK SC',sans-serif`;
const SANSHA = '460300';
const MAP = { x: PAD, y: 330, w: W - PAD * 2, h: 900 };
const STAMP = { w: 84, h: 200 };
const MINI_H = 250;

const colorOf = Object.fromEntries(LEVELS.map(l => [l.value, l.value ? l.color : '#fff']));

// ---------- 城市名布局（算法见 label-layout.js） ----------
// 视图：省份外框居中，四周留白；k 为输出像素 / 地图单位
const viewOf = prov => {
  const [bx0, by0, bx1, by1] = prov.bbox;
  const bw = bx1 - bx0, bh = by1 - by0;
  const k = Math.min(MAP.w * 0.86 / bw, MAP.h * 0.86 / bh);
  const vw = MAP.w / k, vh = MAP.h / k;
  return { bx0, by0, bx1, by1, bw, bh, k, vw, vh, vx: bx0 + bw / 2 - vw / 2, vy: by0 + bh / 2 - vh / 2 };
};

const layoutFor = (code, fine) => {
  const units = unitsOf(code).filter(u => u.d); // 三沙不在主图上
  const view = viewOf(provinceByCode.get(code));
  const base = Math.max(22, Math.min(34, Math.sqrt((view.bw * view.bh * view.k * view.k) / units.length) * 0.16));
  return {
    view,
    ...layoutLabels({
      units, pathOf: c => fine.units[c], view, base,
      bounds: { x0: 8, y0: 8, x1: MAP.w - 8, y1: MAP.h - 8 },
    }),
  };
};

// 供测试检查：某省导出图的城市名布局
export const provinceLabelReport = async code => {
  const { labels, missing } = layoutFor(code, await loadFine());
  return { labels: labels.map(({ u, x, y, s, leader }) => ({ code: u.code, short: u.short, x, y, s, leader: !!leader })), missing };
};

// ---------- 生成 SVG ----------
const buildSvg = (code, levels, fine) => {
  const prov = provinceByCode.get(code);
  const all = unitsOf(code);
  const units = all.filter(u => u.d); // 三沙不在主图上
  const t = tally(levels, all);
  const full = t.visited === t.total;
  const pct = Math.round(t.visited / t.total * 100);

  const { view: { bx0, by0, bx1, by1, bw, bh, k, vw, vh, vx, vy }, labels } = layoutFor(code, fine);

  const others = allUnits.filter(u => u.province !== code && u.d);
  const mapSvg = `
<svg x="${MAP.x}" y="${MAP.y}" width="${MAP.w}" height="${MAP.h}" viewBox="${vx} ${vy} ${vw} ${vh}">
  <g fill="#f5f2eb" stroke="#e7e2d7" stroke-width="${1 / k}">${others.map(u => `<path d="${fine.units[u.code]}"/>`).join('')}</g>
  <g transform="translate(${4 / k} ${6 / k})" fill="rgba(0,0,0,.13)">${units.map(u => `<path d="${fine.units[u.code]}"/>`).join('')}</g>
  <g stroke="#cfc8b8" stroke-width="${1.4 / k}" stroke-linejoin="round">
    ${units.map(u => `<path d="${fine.units[u.code]}" fill="${colorOf[levels[u.code] ?? 0]}"/>`).join('')}
  </g>
  <path d="${fine.lines.province}" fill="none" stroke="${INK}" stroke-width="${2.4 / k}" stroke-linejoin="round"/>
  <path d="${fine.lines.country}" fill="none" stroke="${INK}" stroke-width="${3.2 / k}" stroke-linejoin="round"/>
</svg>`;

  const leaders = labels.filter(l => l.leader).map(l => {
    const [ax, ay] = l.leader, [ex, ey] = leaderEnd(l);
    return `<line x1="${MAP.x + ax}" y1="${MAP.y + ay}" x2="${MAP.x + ex}" y2="${MAP.y + ey}" stroke="${INK}" stroke-width="2"/>
<circle cx="${MAP.x + ax}" cy="${MAP.y + ay}" r="5" fill="#fff" stroke="${INK}" stroke-width="2.5"/>`;
  }).join('');
  const labelSvg = leaders + labels.map(({ u, x, y, s }) => `<text x="${MAP.x + x}" y="${MAP.y + y}" font-size="${s}" text-anchor="middle" dominant-baseline="central"
  stroke="rgba(255,255,255,.85)" stroke-width="${s * 0.22}" stroke-linejoin="round" paint-order="stroke">${esc(u.short)}</text>`).join('');

  // 竖版全国位置小图：国界轮廓 + 九段线，当前省涂黑；小省份加红圈
  const mini = `
<g id="mini">
  <svg id="mini-svg" height="${MINI_H}" viewBox="0 0 1000 1300" overflow="visible">
    <path d="${mapData.outline}" fill="#fff" stroke="${INK}" stroke-width="10" stroke-linejoin="round"/>
    ${units.map(u => `<path d="${u.d}" fill="${INK}" stroke="${INK}" stroke-width="4"/>`).join('')}
    <path d="${mapData.jd}" fill="${INK}" stroke="${INK}" stroke-width="14" stroke-linecap="round"/>
    ${Math.max(bw, bh) < 90 ? `<circle cx="${(bx0 + bx1) / 2}" cy="${(by0 + by1) / 2}" r="${Math.max(bw, bh) / 2 + 34}" fill="none" stroke="#e0402a" stroke-width="14"/>` : ''}
  </svg>
</g>`;

  const header = `
<rect x="${PAD}" y="${PAD}" width="132" height="44" rx="10" fill="${INK}"/>
<text x="${PAD + 66}" y="${PAD + 23}" font-size="26" fill="#fff" text-anchor="middle" dominant-baseline="central">城市制霸</text>
<text id="title" x="${PAD - 4}" y="${PAD + 150}" font-size="92">${esc(prov.short)}制霸</text>
<text id="stats" x="${PAD}" y="${PAD + 222}" font-size="38" fill="${MUTED}"><tspan fill="${INK}" font-size="46">${t.visited}</tspan> / ${t.total} 城 · ${t.score} 分 · 点亮 <tspan fill="${INK}" font-size="46">${pct}%</tspan></text>`;

  // 竖排长方形印章：全 / 制 / 霸（全省点亮时显示，位置在渲染后按标题宽度确定）
  const stamp = full ? `
<g id="stamp">
  <rect x="${-STAMP.w / 2}" y="${-STAMP.h / 2}" width="${STAMP.w}" height="${STAMP.h}" rx="12" fill="#FF7E7E" stroke="${INK}" stroke-width="6"/>
  <rect x="${-STAMP.w / 2 + 9}" y="${-STAMP.h / 2 + 9}" width="${STAMP.w - 18}" height="${STAMP.h - 18}" rx="6" fill="none" stroke="${INK}" stroke-width="2.5" stroke-dasharray="6 7"/>
  ${['全', '制', '霸'].map((c, i) => `<text y="${(i - 1) * 52}" font-size="48" text-anchor="middle" dominant-baseline="central">${c}</text>`).join('')}
</g>` : '';

  // 海南：三沙在海南岛地图范围之外，右下角放南海诸岛插图
  let sansha = '';
  if (all.some(u => u.code === SANSHA)) {
    const [ix, iy, iw, ih] = mapData.inset.box;
    const BW = 190, BH = BW * ih / iw;
    const X = MAP.x + MAP.w - BW - 24, Y = MAP.y + MAP.h - BH - 24;
    const c = colorOf[levels[SANSHA] ?? 0];
    sansha = `
<g transform="translate(${X} ${Y})">
  <rect width="${BW}" height="${BH}" rx="14" fill="${PAPER}" stroke="${INK}" stroke-width="3"/>
  <svg width="${BW}" height="${BH}" viewBox="${ix} ${iy} ${iw} ${ih}">
    ${mapData.inset.units.map(u => (u.code === SANSHA
    ? `<path d="${u.d}" fill="${c}" stroke="${INK}" stroke-width="1.2"/>`
    : `<path d="${u.d}" fill="#f5f2eb" stroke="#e7e2d7" stroke-width="0.4"/>`)).join('')}
    <path d="${mapData.inset.jd}" fill="${INK}" stroke="${INK}" stroke-width="0.6"/>
  </svg>
  <rect x="${BW / 2 - 36}" y="${BH * 0.52}" width="72" height="34" rx="8" fill="${c}" stroke="${INK}" stroke-width="2.5"/>
  <text x="${BW / 2}" y="${BH * 0.52 + 17}" font-size="24" text-anchor="middle" dominant-baseline="central">三沙</text>
  <text x="${BW - 10}" y="${BH - 10}" font-size="16" text-anchor="end" fill="${MUTED}">南海诸岛</text>
</g>`;
  }

  const levelsShown = LEVELS.filter(l => l.value);
  const LW = (W - PAD * 2) / levelsShown.length;
  const legend = levelsShown.map((l, i) => `
<g transform="translate(${PAD + i * LW} ${MAP.y + MAP.h + 58})">
  <rect width="34" height="34" rx="8" fill="${l.color}" stroke="${INK}" stroke-width="3"/>
  <text x="46" y="18" font-size="30" dominant-baseline="central">${esc(l.name)} ${t.counts[l.value]}</text>
</g>`).join('');

  // 文字默认颜色写在根元素上（作为可继承的默认值）；写进 CSS 会压过各元素自己的 fill（如黑底白字的标签）
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" fill="${INK}">
  <style>text{font-family:${FONT}}</style>
  <rect width="${W}" height="${H}" fill="${BG}"/>
  ${header}
  ${mini}
  <rect x="${MAP.x + 6}" y="${MAP.y + 9}" width="${MAP.w}" height="${MAP.h}" rx="26" fill="rgba(0,0,0,.12)"/>
  <clipPath id="card"><rect x="${MAP.x}" y="${MAP.y}" width="${MAP.w}" height="${MAP.h}" rx="26"/></clipPath>
  <rect x="${MAP.x}" y="${MAP.y}" width="${MAP.w}" height="${MAP.h}" rx="26" fill="${PAPER}"/>
  <g clip-path="url(#card)">${mapSvg}${labelSvg}</g>
  <rect x="${MAP.x}" y="${MAP.y}" width="${MAP.w}" height="${MAP.h}" rx="26" fill="none" stroke="${INK}" stroke-width="5"/>
  ${sansha}
  ${stamp}
  ${legend}
</svg>`;
};

// 需要实际尺寸的部分（印章跟在标题后面、小图按轮廓实际范围裁切）放进页面里量一下再定位
const finalize = svgText => {
  const host = document.createElement('div');
  host.style.cssText = 'position:fixed;left:-99999px;top:0;visibility:hidden;pointer-events:none';
  host.innerHTML = svgText;
  document.body.append(host);
  try {
    const svg = host.firstElementChild;
    const q = id => svg.querySelector(`#${id}`);
    const stamp = q('stamp');
    if (stamp) {
      const right = id => { const b = q(id).getBBox(); return b.x + b.width; };
      const cx = Math.max(right('title'), right('stats')) + STAMP.w / 2 + 36;
      stamp.setAttribute('transform', `translate(${cx} ${PAD + 130}) rotate(-8)`);
    }
    const mini = q('mini-svg');
    const b = mini.getBBox();
    const pad = 12;
    mini.setAttribute('viewBox', `${b.x - pad} ${b.y - pad} ${b.width + pad * 2} ${b.height + pad * 2}`);
    const w = MINI_H * (b.width + pad * 2) / (b.height + pad * 2);
    mini.setAttribute('width', w);
    q('mini').setAttribute('transform', `translate(${W - PAD - w} ${PAD - 8})`);
    return svg.outerHTML;
  } finally {
    host.remove();
  }
};

export const exportProvinceImage = async (code, levels) => {
  const fine = await loadFine();
  const prov = provinceByCode.get(code);
  await document.fonts.load(`92px 'CityEx Sans'`, `${prov.short}制霸全`);
  const text = finalize(buildSvg(code, levels, fine));
  return rasterize(text, W, H, SCALE, `城市制霸-${prov.short}.png`);
};
