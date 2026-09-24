// 入口：地图与视图切换（全国 ⇄ 省）、路由、标记交互、侧栏
// 其余界面各自成模块：picker.js（等级弹窗）、locator.js（搜索定位）、image-ui.js（保存图片）、backup-ui.js（数据备份）
import './card.css';
import { LEVELS, levelOf, levelButtons, tally } from './levels.js';
import { getLevel, setLevel, allLevels, onChange } from './store.js';
import {
  buildMap, paint, bringToFront, animateView, loadFine, setDetail, setScale, fitView, provinceView, unitsPerPixel,
  currentView, svgRect, units, unitByCode, provinceByCode, unitsOf, FULL_VIEW,
} from './map.js';
import { attachGestures } from './gesture.js';
import { createLocator } from './locator.js';
import { openPicker, closePicker, isPickerOpen, pickerContains } from './picker.js';
import { isOutputOpen, closeOutput } from './image-ui.js';
import './backup-ui.js';
import { $, narrowScreen } from './dom.js';

const svg = $('#map');
const root = document.documentElement;

const LABEL_PX = 13;       // 省视图中城市名的屏幕字号
const PROV_LABEL_PX = 14;  // 全国视图放大后省名的屏幕字号
const PROV_LABEL_ZOOM = 2; // 全国视图放大到几倍后显示省名、换精细版
const MAX_ZOOM = { country: 12, province: 4 }; // 相对 home 视图的最大放大倍数

// ---------- 初始化 ----------
for (const l of LEVELS) if (l.value) root.style.setProperty(`--l${l.value}`, l.color);

buildMap(svg);
const paintAll = () => {
  const levels = allLevels();
  for (const u of units) paint(svg, u.code, levels[u.code] ?? 0);
};
paintAll();

// ---------- 视图状态 ----------
let activeProvince = null; // 当前省；null 为全国视图
let home = null;           // 当前视图的完整范围（缩放下限、复位目标）
let pendingFocus = null;   // 视图切换后要聚焦的城市

// ---------- 侧栏：全国统计 / 本省进度、画笔、城市列表 ----------
const renderStats = () => {
  const levels = allLevels();
  const { counts, score, visited, total } = tally(levels, units);
  $('#score-num').textContent = score;
  $('#visited').innerHTML = `已去 <b>${visited}</b> / ${total} 城`;
  $('#level-stats').innerHTML = LEVELS.filter(l => l.value).map(l => `<li style="--c:${l.color}">
      <i></i><span>${l.name}<small>${l.hint}</small></span><b>${counts[l.value]}</b></li>`).join('');
  if (activeProvince) {
    const t = tally(levels, unitsOf(activeProvince));
    $('#province-progress').textContent = `${t.visited} / ${t.total} 城 · ${t.score} 分`;
  }
};

// 画笔：省视图中选中一个等级后，点城市直接涂色（再点一次取消）
let brush = null;
const brushBar = $('#brush .options');
brushBar.innerHTML = levelButtons(() => ' aria-pressed="false"');
const setBrush = level => {
  brush = level;
  for (const b of brushBar.querySelectorAll('button')) {
    b.classList.toggle('active', +b.dataset.level === brush);
    b.setAttribute('aria-pressed', +b.dataset.level === brush);
  }
};
brushBar.addEventListener('click', e => {
  const b = e.target.closest('button');
  if (b) setBrush(brush === +b.dataset.level ? null : +b.dataset.level);
});

// 标记一个城市：画笔模式直接涂色，否则弹出等级菜单
const mark = (code, x, y, avoid = null) => {
  if (brush !== null) setLevel(code, getLevel(code) === brush ? 0 : brush);
  else openPicker(code, x, y, avoid);
};

// 城市列表：小城市、三沙等不好在地图上点的在这里选
const renderCityList = code => {
  $('#city-list').innerHTML = unitsOf(code).map(u =>
    `<button data-code="${u.code}" style="--c:${levelOf(getLevel(u.code)).color}">${u.short}</button>`).join('');
};
$('#city-list').addEventListener('click', e => {
  const b = e.target.closest('button');
  if (!b) return;
  const r = b.getBoundingClientRect();
  mark(b.dataset.code, r.left + r.width / 2, r.top + r.height / 2, r);
});

// ---------- 随视图同步的显示状态 ----------
const setLabelSize = view => {
  svg.style.setProperty('--label-size', `${LABEL_PX * unitsPerPixel(svg, view)}px`);
};

// 全国视图放大后显示省名
const updateCountryLabels = view => {
  const zoomed = !activeProvince && home && home[2] / view[2] >= PROV_LABEL_ZOOM;
  svg.classList.toggle('zoomed', zoomed);
  if (zoomed) svg.style.setProperty('--prov-label-size', `${PROV_LABEL_PX * unitsPerPixel(svg, view)}px`);
};

const syncLabels = view => (activeProvince ? setLabelSize(view) : updateCountryLabels(view));

// 投影偏移随缩放保持屏幕上的固定像素
const syncScale = view => setScale(svg, unitsPerPixel(svg, view));

// 精度：省视图或全国视图放大后用精细版，其余用粗略版
const syncDetail = () => setDetail(svg, activeProvince || svg.classList.contains('zoomed') ? 'fine' : 'coarse');

// 悬停提示与点击效果一致：全国视图显示省名（点了进入该省）；
// 省视图里本省城市显示城市名（点了标记），邻省显示省名（点了切换过去）
const unitTitles = [...svg.querySelectorAll('.prov .unit > title')].map(t => {
  const u = unitByCode.get(t.parentNode.dataset.code);
  return { t, u, provinceName: provinceByCode.get(u.province).name };
});
const syncTitles = () => {
  for (const { t, u, provinceName } of unitTitles) t.textContent = u.province === activeProvince ? u.name : provinceName;
};

// ---------- 视图范围 ----------
// 地图被界面遮住的边距：顶栏，以及侧栏
//   窄屏：侧栏在底部，让出底部
//   宽屏省视图：侧栏在右侧，让出右侧
//   宽屏全国视图：统计卡片在左下角，那里本来就是地图的空白区（西藏以南），不必让出
const viewInsets = () => {
  const top = $('#topbar').getBoundingClientRect().bottom;
  const panel = $('#panel').getBoundingClientRect();
  if (narrowScreen.matches) return { top, bottom: innerHeight - panel.top };
  if (activeProvince) return { top, right: innerWidth - panel.left };
  return { top };
};

// 屏幕矩形 rect 在视图 view 下是否压到城市轮廓（在矩形内取样点，用实际形状判断）
const coversMap = (view, rect) => {
  const { left, top, width } = svgRect(svg);
  const k = view[2] / width;
  const [x0, y0] = [view[0] + (rect.left - left) * k, view[1] + (rect.top - top) * k];
  const [x1, y1] = [view[0] + (rect.right - left) * k, view[1] + (rect.bottom - top) * k];
  const candidates = units.filter(u => u.d && u.bbox[0] < x1 && u.bbox[2] > x0 && u.bbox[1] < y1 && u.bbox[3] > y0)
    .map(u => svg.querySelector(`.prov .unit[data-code="${u.code}"]`));
  const N = 12;
  for (let i = 0; i <= N; i++) for (let j = 0; j <= N; j++) {
    const pt = new DOMPoint(x0 + (x1 - x0) * i / N, y0 + (y1 - y0) * j / N);
    if (candidates.some(p => p.isPointInFill(pt))) return true;
  }
  return false;
};

// 全国视图：统计卡片一般落在左下空白区；窗口偏窄、卡片会压到地图时，再给它让出左侧
const countryFit = () => {
  const insets = viewInsets();
  const view = fitView(svg, FULL_VIEW, insets);
  if (narrowScreen.matches) return view;
  const card = $('#panel').getBoundingClientRect();
  return coversMap(view, card) ? fitView(svg, FULL_VIEW, { ...insets, left: card.right + 8 }) : view;
};
const provinceFit = code => fitView(svg, provinceView(code), viewInsets());

// 聚焦某个城市的视图：留出边距，但不超过最大缩放
const focusView = code => {
  const u = unitByCode.get(code);
  if (!u.d) return home; // 三沙不在主图上
  const [x0, y0, x1, y1] = u.bbox;
  const w = x1 - x0, h = y1 - y0, m = Math.max(w, h) * 0.6;
  const v = fitView(svg, [x0 - m, y0 - m, w + m * 2, h + m * 2], viewInsets());
  const minW = home[2] / MAX_ZOOM[activeProvince ? 'province' : 'country'];
  if (v[2] >= minW) return v;
  const k = minW / v[2];
  const cx = v[0] + v[2] / 2, cy = v[1] + v[3] / 2;
  return [cx - (v[2] * k) / 2, cy - (v[3] * k) / 2, v[2] * k, v[3] * k];
};

// 闪烁提示并在旁边弹出等级菜单
const highlight = code => {
  const path = bringToFront(svg, code); // 描边不被邻居盖住
  if (!path) return openPicker(code, innerWidth / 2, innerHeight / 2); // 三沙
  path.classList.remove('flash');
  void path.getBoundingClientRect(); // 重启动画
  path.classList.add('flash');
  const r = path.getBoundingClientRect();
  openPicker(code, r.left + r.width / 2, r.top + r.height / 2, r);
};

// ---------- 视图切换 ----------
// 最后一步：飞到 home 或待聚焦的城市
const flyTo = async () => {
  const focus = pendingFocus;
  pendingFocus = null;
  const target = focus ? focusView(focus) : home;
  syncLabels(target);
  if (activeProvince) syncDetail(); // 放大前换精细版
  await animateView(svg, target, 650, syncScale);
  syncDetail(); // 缩回全国后再换粗略版，避免动画途中轮廓跳变
  if (focus) highlight(focus);
};

const enterProvince = async code => {
  const p = provinceByCode.get(code);
  if (!p || p.single) return showCountry();
  activeProvince = code;
  closePicker();
  for (const g of svg.querySelectorAll('[data-province]')) g.classList.toggle('active', g.dataset.province === code);
  root.dataset.view = 'province';
  svg.classList.remove('zoomed');
  $('#crumb-province .crumb-leaf').textContent = p.name;
  $('#crumb-province').hidden = false;
  $('#province-name').textContent = p.name;
  $('#stats').hidden = true;
  $('#province').hidden = false;
  renderCityList(code);
  renderStats();
  syncTitles();
  home = provinceFit(code);
  await flyTo();
};

const showCountry = async () => {
  activeProvince = null;
  closePicker();
  setBrush(null); // 画笔只在省视图有效
  root.dataset.view = 'country';
  $('#crumb-province').hidden = true;
  $('#stats').hidden = false;
  $('#province').hidden = true;
  for (const g of svg.querySelectorAll('.active')) g.classList.remove('active');
  syncTitles();
  home = countryFit();
  await flyTo();
};

// hash 路由：#/440000 表示广东省视图，浏览器返回即缩回全国
const route = () => {
  const code = location.hash.match(/^#\/(\d{6})$/)?.[1];
  if (code && provinceByCode.has(code) && !provinceByCode.get(code).single) enterProvince(code);
  else showCountry();
};
addEventListener('hashchange', route);

const goProvince = (code, focus = null) => {
  pendingFocus = focus;
  const hash = `#/${code}`;
  if (location.hash === hash) return flyTo();
  // 从全国进入时新增历史记录（返回键回到全国）；省与省之间切换则替换当前记录
  if (activeProvince) history.replaceState(history.state, '', hash);
  else history.pushState({ fromCountry: true }, '', hash);
  route();
};

// 返回全国：若是从全国进来的就退一步历史，否则直接改 hash
const goBack = () => {
  if (history.state?.fromCountry) history.back();
  else location.hash = '';
};

const goCountry = (focus = null) => {
  pendingFocus = focus;
  if (!activeProvince) return flyTo();
  goBack();
};

const focusCity = code => {
  const u = unitByCode.get(code);
  if (provinceByCode.get(u.province).single) goCountry(code);
  else goProvince(u.province, code);
};

// 复位到当前视图的完整范围
const resetView = () => {
  closePicker();
  syncLabels(home);
  animateView(svg, home, 400, syncScale).then(syncDetail);
};

// ---------- 顶栏：面包屑与搜索定位 ----------
// 根节点在省视图时返回全国、在全国视图时复位；省名复位本省视图
$('#crumb-root').addEventListener('click', () => (activeProvince ? goBack() : resetView()));
$('#crumb-province .crumb-leaf').addEventListener('click', resetView);

const locator = createLocator({
  box: $('#search'),
  panel: $('#locator'),
  onCity: focusCity,
  onProvince: code => goProvince(code),
  getActiveProvince: () => activeProvince,
});

// ---------- 地图交互 ----------
// 点击点周围的一小块区域：弹窗放在它旁边而不是正中间，避免挡住刚点的城市
const nearClick = e => new DOMRect(e.clientX - 16, e.clientY - 16, 32, 32);

svg.addEventListener('click', e => {
  e.stopPropagation();
  if (locator.isOpen()) return locator.close(); // 点地图先关菜单
  const unit = e.target.closest('.unit');
  const provCode = unit?.closest('[data-province]').dataset.province;
  const single = provCode && provinceByCode.get(provCode).single;

  if (!activeProvince) {
    closePicker();
    if (single) mark(provCode, e.clientX, e.clientY, nearClick(e)); // 港澳、直辖市：直接标记
    else if (provCode) goProvince(provCode);
    return;
  }
  if (provCode === activeProvince) return mark(unit.dataset.code, e.clientX, e.clientY, nearClick(e)); // 弹窗开着也直接换到新城市
  if (isPickerOpen()) return closePicker();                   // 弹窗开着时点别处只关弹窗
  if (!provCode) goBack();                                    // 点海面：回全国
  else if (single) mark(provCode, e.clientX, e.clientY, nearClick(e));
  else goProvince(provCode);                                  // 邻省：直接切过去
});

attachGestures(svg, {
  getHome: () => home,
  maxZoom: () => MAX_ZOOM[activeProvince ? 'province' : 'country'],
  onStart: () => { closePicker(); locator.close(); },
  onChange: view => {
    syncLabels(view);
    syncScale(view);
    syncDetail();
  },
});

// ---------- 全局事件 ----------
document.addEventListener('click', e => {
  if (isPickerOpen() && !pickerContains(e.target) && !e.target.closest('#city-list')) closePicker();
});

document.addEventListener('keydown', e => {
  if (e.key !== 'Escape') return;
  if (isOutputOpen()) closeOutput();
  else if (locator.isOpen()) locator.close();
  else if (isPickerOpen()) closePicker();
  else if (activeProvince) goBack();
});

// 窗口尺寸变化（旋转屏幕、调整窗口）：重新计算 home，并保留用户当前的放大倍数和视图中心。
// 手机上输入框聚焦时弹出键盘只是临时遮挡，只有高度变化时不重新适配，避免地图随键盘来回跳动
let lastWidth = innerWidth;
addEventListener('resize', () => {
  const widthChanged = innerWidth !== lastWidth;
  lastWidth = innerWidth;
  if (!widthChanged && document.activeElement?.matches('input, textarea')) return;
  const old = currentView(svg);
  const zoom = home ? home[2] / old[2] : 1;
  const cx = old[0] + old[2] / 2, cy = old[1] + old[3] / 2;
  home = activeProvince ? provinceFit(activeProvince) : countryFit();
  const w = home[2] / zoom, h = home[3] / zoom;
  const view = [
    Math.min(Math.max(cx - w / 2, home[0]), home[0] + home[2] - w),
    Math.min(Math.max(cy - h / 2, home[1]), home[1] + home[3] - h),
    w, h,
  ];
  svg.setAttribute('viewBox', view.join(' '));
  syncScale(view);
  syncLabels(view);
});

// 数据变化（code 为 null 表示整体变化：导入备份、其他标签页修改）
onChange((code, level) => {
  if (code === null) paintAll();
  else paint(svg, code, level);
  renderStats();
  if (activeProvince) renderCityList(activeProvince);
  locator.refresh();
});

// ---------- 启动 ----------
renderStats();
root.dataset.view = 'country';
svg.setAttribute('viewBox', countryFit().join(' '));
syncScale(currentView(svg));
route();

// 首屏之后在后台加载精细版边界，加载完若已在省视图就立即换上
const preloadFine = () => loadFine().then(syncDetail).catch(() => { /* 加载失败就一直用粗略版 */ });
if ('requestIdleCallback' in window) requestIdleCallback(preloadFine, { timeout: 2000 });
else setTimeout(preloadFine, 500);
