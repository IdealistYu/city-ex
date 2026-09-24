// 定位菜单：顶栏搜索框获得焦点时展开。无输入时为 一级省份（按大区分组）→ 二级城市；有输入时为搜索结果
import { levelOf } from './levels.js';
import { getLevel } from './store.js';
import { provinces, provinceByCode, units, unitsOf } from './map.js';
import { esc, narrowScreen } from './dom.js';

const REGIONS = [
  ['华北', '1'], ['东北', '2'], ['华东', '3'], ['中南', '4'], ['西南', '5'], ['西北', '6'], ['港澳台', '78'],
];
const MAX_RESULTS = 30;

const color = code => levelOf(getLevel(code)).color;

export const createLocator = ({ box, panel, onCity, onProvince, getActiveProvince }) => {
  const input = box.querySelector('input');
  const topbar = box.closest('#topbar');
  const body = panel.querySelector('.locator-body');
  let current = null; // 当前展开的省；null 为一级列表

  const progress = code => {
    const list = unitsOf(code);
    return `${list.filter(u => getLevel(u.code)).length}/${list.length}`;
  };

  const renderProvinces = () => {
    body.innerHTML = REGIONS.map(([name, digits]) => {
      const items = provinces.filter(p => digits.includes(p.code[0]));
      return `<section><h3>${name}</h3><div class="loc-grid">${items.map(p => p.single
        ? `<button data-city="${p.code}" style="--c:${color(p.code)}">${esc(p.short)}</button>`
        : `<button data-province="${p.code}">${esc(p.short)}<small>${progress(p.code)}</small></button>`).join('')}</div></section>`;
    }).join('');
  };

  const renderCities = code => {
    const p = provinceByCode.get(code);
    body.innerHTML = `<div class="loc-head">
        <button data-back aria-label="返回省份列表">‹ 省份</button>
        <b>${esc(p.name)}</b>
        <button data-view-province="${code}">查看全省</button>
      </div>
      <div class="loc-grid">${unitsOf(code).map(u =>
        `<button data-city="${u.code}" style="--c:${color(u.code)}" title="${esc(u.name)}">${esc(u.short)}</button>`).join('')}</div>`;
  };

  const renderSearch = q => {
    const hits = units.filter(u => u.name.includes(q) || u.short.includes(q))
      .concat(provinces.filter(p => !p.single && p.name.includes(q)).map(p => ({ province: p.code, isProvince: true, name: p.name })))
      .slice(0, MAX_RESULTS);
    body.innerHTML = hits.length
      ? `<div class="loc-list">${hits.map(h => h.isProvince
        ? `<button data-province="${h.province}"><b>${esc(h.name)}</b><small>省份</small></button>`
        : `<button data-city="${h.code}" style="--c:${color(h.code)}"><b>${esc(h.name)}</b><small>${esc(provinceByCode.get(h.province).short)}</small></button>`).join('')}</div>`
      : '<p class="loc-empty">没有找到，试试城市全称或简称</p>';
  };

  const render = () => {
    const q = input.value.trim();
    if (q) renderSearch(q);
    else if (current) renderCities(current);
    else renderProvinces();
  };

  // 高度限制在可见区域内：手机弹出键盘后 visualViewport 变矮，列表不能被键盘挡住
  const fitHeight = () => {
    if (panel.hidden) return;
    const vv = window.visualViewport;
    const bottom = vv ? vv.offsetTop + vv.height : innerHeight;
    panel.style.maxHeight = `${Math.max(160, Math.min(640, bottom - panel.getBoundingClientRect().top - 8))}px`;
  };
  window.visualViewport?.addEventListener('resize', fitHeight);

  const open = () => {
    if (!panel.hidden) return;
    current = getActiveProvince(); // 在省视图打开时直接显示本省城市
    topbar.classList.add('searching'); // 窄屏时搜索框展开占满顶栏
    render();
    // 宽屏时对齐到搜索框下方，窄屏时由 CSS 撑满宽度
    panel.style.top = `${topbar.getBoundingClientRect().bottom - 8}px`;
    panel.style.left = narrowScreen.matches ? '' : `${box.getBoundingClientRect().left}px`;
    panel.hidden = false;
    fitHeight();
    box.setAttribute('aria-expanded', 'true');
  };
  const close = () => {
    if (panel.hidden) return;
    panel.hidden = true;
    input.value = '';
    input.blur();
    topbar.classList.remove('searching');
    box.setAttribute('aria-expanded', 'false');
  };

  box.addEventListener('click', e => {
    e.stopPropagation();
    open();
    input.focus();
  });
  input.addEventListener('focus', open);
  input.addEventListener('input', () => { open(); render(); });
  input.addEventListener('keydown', e => {
    if (e.key === 'Enter') body.querySelector('button[data-city], button[data-province]')?.click();
    if (e.key === 'ArrowDown') { // 方向键进入结果列表，之后用 Tab / 方向键在按钮间移动
      e.preventDefault();
      body.querySelector('button')?.focus();
    }
    if (e.key === 'Escape') {
      e.stopPropagation(); // 只关菜单，不要连带触发全局 Esc（返回全国）
      close();
    }
  });

  // 列表内方向键：在按钮之间按顺序移动；Esc 回到搜索框
  panel.addEventListener('keydown', e => {
    if (e.key === 'Escape') {
      e.stopPropagation();
      close();
      return;
    }
    if (!['ArrowDown', 'ArrowUp', 'ArrowLeft', 'ArrowRight'].includes(e.key)) return;
    const buttons = [...body.querySelectorAll('button')];
    const i = buttons.indexOf(document.activeElement);
    if (i < 0) return;
    e.preventDefault();
    const next = i + (e.key === 'ArrowDown' || e.key === 'ArrowRight' ? 1 : -1);
    if (next < 0) input.focus();
    else buttons[Math.min(next, buttons.length - 1)].focus();
  });

  panel.addEventListener('click', e => {
    e.stopPropagation();
    const b = e.target.closest('button');
    if (!b) return;
    if (b.hasAttribute('data-back')) {
      current = null;
      render();
    } else if (b.dataset.province) {
      current = b.dataset.province;
      input.value = '';
      render();
      if (b.matches(':focus-visible')) body.querySelector('button[data-city]')?.focus();
    } else if (b.dataset.viewProvince) {
      close();
      onProvince(b.dataset.viewProvince);
    } else if (b.dataset.city) {
      close();
      onCity(b.dataset.city);
    }
  });

  document.addEventListener('click', e => {
    if (!panel.hidden && !panel.contains(e.target) && !box.contains(e.target)) close();
  });

  return {
    close,
    isOpen: () => !panel.hidden,
    refresh: () => { if (!panel.hidden) render(); },
  };
};
