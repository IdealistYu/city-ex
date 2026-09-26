// SVG 地图：构建 DOM、按等级上色、viewBox 缩放动画
// 地图下方垫一层全国外轮廓做卡片投影（样式见 card.css），偏移按 CSS 变量 --k 换算成固定像素，见 setScale
import data from './map-data.json';

const NS = 'http://www.w3.org/2000/svg';
const INSET_RADIUS = 6; // 南海插图卡片圆角（viewBox 单位，全国视图下约 5～8px）

export const units = data.units;
export const provinces = data.provinces;
export const unitByCode = new Map(units.map(u => [u.code, u]));
export const provinceByCode = new Map(provinces.map(p => [p.code, p]));
const unitsByProvince = new Map();
for (const u of units) (unitsByProvince.get(u.province) ?? unitsByProvince.set(u.province, []).get(u.province)).push(u);
export const unitsOf = code => unitsByProvince.get(code) ?? [];
export const FULL_VIEW = data.viewBox;

// ---------- 精度层级 ----------
// map-data.json 里是全国视图用的粗略版；精细版（省视图、放大后用）单独打包，页面加载后在后台读取
const coarse = { units: Object.fromEntries(units.map(u => [u.code, u.d])), lines: data.lines, outline: data.outline };
let fine = null;
let finePromise = null;
export const loadFine = () => finePromise ??= import('./map-fine.json').then(m => (fine = m.default));
export const hasFine = () => fine !== null;
// 某城市当前可用的最精细轮廓（地图坐标）
export const unitPath = code => fine?.units[code] ?? coarse.units[code];

// 切换主图（不含插图）城市轮廓与边界线的精度；精细版还没加载好时返回 false
export const setDetail = (svg, level) => {
  const src = level === 'fine' ? fine : coarse;
  if (!src) return false;
  if (svg.dataset.detail === level) return true;
  svg.dataset.detail = level;
  for (const p of svg.querySelectorAll('.prov .unit')) p.setAttribute('d', src.units[p.dataset.code]);
  svg.querySelector(':scope > .line-province').setAttribute('d', src.lines.province);
  svg.querySelector(':scope > .line-country').setAttribute('d', src.lines.country);
  svg.querySelector(':scope > .map-shadow').setAttribute('d', src.outline);
  return true;
};

const el = (tag, attrs = {}, parent) => {
  const node = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, v);
  parent?.append(node);
  return node;
};

// 构建地图。withLabels=false 用于导出时生成一份不带城市名的副本
export const buildMap = (svg, { withLabels = true } = {}) => {
  svg.setAttribute('viewBox', FULL_VIEW.join(' '));
  svg.innerHTML = '';

  const [vx, vy, vw, vh] = FULL_VIEW;
  el('rect', { class: 'sea', x: vx - vw, y: vy - vh, width: vw * 3, height: vh * 3 }, svg);
  // 卡片投影：全国外轮廓的偏移副本
  el('path', { class: 'map-shadow', d: data.outline }, svg);

  const provLayer = el('g', { class: 'provinces' }, svg);
  const groups = new Map();
  for (const p of provinces) {
    groups.set(p.code, el('g', { class: 'prov', 'data-province': p.code }, provLayer));
  }
  for (const u of units) {
    if (!u.d) continue; // 三沙只出现在插图中
    const path = el('path', { class: 'unit', d: u.d, 'data-code': u.code }, groups.get(u.province));
    el('title', {}, path).textContent = u.name;
  }

  el('path', { class: 'line-province', d: data.lines.province }, svg);
  el('path', { class: 'line-country', d: data.lines.country }, svg);

  if (withLabels) {
    // 省名：全国视图放大后显示
    const provLabels = el('g', { class: 'prov-labels' }, svg);
    for (const p of provinces) {
      el('text', { x: p.label[0], y: p.label[1], 'data-province': p.code }, provLabels).textContent = p.short;
    }
    // 城市名：省视图显示
    const labelLayer = el('g', { class: 'labels' }, svg);
    for (const p of provinces) {
      if (p.single) continue;
      const g = el('g', { 'data-province': p.code }, labelLayer);
      el('g', { class: 'leaders' }, g); // 引线：放不下名字的小城市，由 main.js 的布局填充
      for (const u of unitsOf(p.code)) {
        if (!u.label) continue;
        el('text', { x: u.label[0], y: u.label[1], 'data-code': u.code }, g).textContent = u.short;
      }
    }
  }

  // 南海诸岛插图：做成和 UI 卡片同款的迷你卡片；只做显示（随标记上色），不响应点击
  const [bx, by, bw, bh] = data.inset.box;
  const box = { x: bx, y: by, width: bw, height: bh, rx: INSET_RADIUS };
  const inset = el('g', { class: 'inset' }, svg);
  const clipId = `inset-clip-${Math.random().toString(36).slice(2, 8)}`;
  el('rect', box, el('clipPath', { id: clipId }, inset));
  el('rect', { class: 'inset-shadow', ...box }, inset);
  el('rect', { class: 'inset-bg', ...box }, inset);
  const clipped = el('g', { 'clip-path': `url(#${clipId})` }, inset);
  // 三沙的岛礁只有几个像素，单独描深色边，才看得出星星点点的岛
  for (const u of data.inset.units) {
    el('path', { class: u.code === SANSHA ? 'unit sansha' : 'unit', d: u.d, 'data-code': u.code }, clipped);
  }
  el('path', { class: 'line-province', d: data.inset.province }, clipped);
  el('path', { class: 'line-country', d: data.inset.country }, clipped);
  el('path', { class: 'jd', d: data.inset.jd }, clipped);
  el('rect', { class: 'inset-frame', ...box }, inset);
  el('text', { class: 'inset-title', x: bx + bw - 7, y: by + bh - 7 }, inset).textContent = '南海诸岛';

  return svg;
};

// 三沙卡片（海南省视图用）：南海插图的内容，三沙按等级上色，周边陆地淡色
export const SANSHA = '460300';
export const buildSanshaCard = svg => {
  const [bx, by, bw, bh] = data.inset.box;
  svg.setAttribute('viewBox', `${bx} ${by} ${bw} ${bh}`);
  svg.innerHTML = '';
  for (const u of data.inset.units) {
    el('path', u.code === SANSHA
      ? { class: 'unit sansha', d: u.d, 'data-code': u.code }
      : { class: 'land', d: u.d }, svg);
  }
  el('path', { class: 'jd', d: data.inset.jd }, svg);
};

// k：当前视图下每像素对应的 viewBox 单位。投影偏移按它换算成固定像素
export const setScale = (svg, k) => svg.style.setProperty('--k', k);

export const paint = (svg, code, level) => {
  for (const node of svg.querySelectorAll(`.unit[data-code="${code}"]`)) {
    if (level) node.setAttribute('data-level', level);
    else node.removeAttribute('data-level');
  }
};

// 把某个城市移到本组最上层（闪烁提示时描边不被邻居盖住）
export const bringToFront = (svg, code) => {
  const path = svg.querySelector(`.prov .unit[data-code="${code}"]`);
  path?.parentNode.append(path);
  return path;
};

// ---------- 缩放 ----------
// svg 是 position: fixed 的全屏元素，位置尺寸只随窗口变化；缓存起来，免得动画每帧读取都强制重排
let rectCache = null;
addEventListener('resize', () => { rectCache = null; }); // 先于 main.js 的 resize 处理执行（模块先加载）
const rectOf = svg => (svg.isConnected ? (rectCache ??= svg.getBoundingClientRect()) : svg.getBoundingClientRect());
export const svgRect = rectOf;

export const provinceView = (code, pad = 0.08) => {
  const [x0, y0, x1, y1] = provinceByCode.get(code).bbox;
  const w = x1 - x0, h = y1 - y0;
  const m = Math.max(w, h) * pad;
  return [x0 - m, y0 - m, w + m * 2, h + m * 2];
};

// 让 box 落在屏幕上扣除 inset（像素，被标题栏、面板遮住的部分）后的可见区域中央，返回整个 svg 对应的 viewBox
export const fitView = (svg, box, { top = 0, right = 0, bottom = 0, left = 0 } = {}) => {
  const { width: W, height: H } = rectOf(svg);
  const aw = Math.max(1, W - left - right), ah = Math.max(1, H - top - bottom);
  const s = Math.min(aw / box[2], ah / box[3]); // 像素 / 单位
  const x = box[0] - (left + (aw - box[2] * s) / 2) / s;
  const y = box[1] - (top + (ah - box[3] * s) / 2) / s;
  return [x, y, W / s, H / s];
};

const ease = t => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2);
let animation = 0;

export const stopAnimation = () => cancelAnimationFrame(animation);

export const currentView = svg => svg.getAttribute('viewBox').split(' ').map(Number);

// onFrame(view) 每帧回调（用于同步投影偏移等随缩放变化的量）
export const animateView = (svg, to, duration = 650, onFrame = null) => new Promise(resolve => {
  cancelAnimationFrame(animation);
  const from = currentView(svg);
  if (matchMedia('(prefers-reduced-motion: reduce)').matches) duration = 0;
  const start = performance.now();
  const step = now => {
    const t = duration ? Math.min(1, (now - start) / duration) : 1;
    const k = ease(t);
    const view = from.map((v, i) => v + (to[i] - v) * k);
    svg.setAttribute('viewBox', view.join(' '));
    onFrame?.(view);
    if (t < 1) animation = requestAnimationFrame(step);
    else resolve();
  };
  animation = requestAnimationFrame(step);
});

// 屏幕像素 → viewBox 单位的换算比例（preserveAspectRatio 默认 xMidYMid meet）
export const unitsPerPixel = (svg, view = currentView(svg)) => {
  const { width, height } = rectOf(svg);
  return Math.max(view[2] / width, view[3] / height);
};
