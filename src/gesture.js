// 地图平移缩放：单指/鼠标拖动平移，双指捏合与滚轮缩放。
// 直接操作 viewBox；要求 viewBox 宽高比与 svg 一致（由 fitView 保证），屏幕与地图坐标才是简单的线性关系。
import { currentView, stopAnimation, svgRect } from './map.js';

const DRAG_THRESHOLD = 6; // 像素，超过才算拖动，否则仍是点击

export const attachGestures = (svg, { getHome, maxZoom, onStart, onChange }) => {
  const pointers = new Map();
  let moved = false;
  let suppressClick = false;

  const toMap = (view, x, y) => {
    const r = svgRect(svg);
    const k = view[2] / r.width;
    return [view[0] + (x - r.left) * k, view[1] + (y - r.top) * k, k];
  };

  // 视图宽度限制在 [home/maxZoom, home] 之间
  const clampWidth = w => {
    const home = getHome();
    return Math.min(home[2], Math.max(home[2] / maxZoom(), w));
  };

  // 视图整体不超出 home：缩到最小时正好等于 home（回到居中），放大后只能在 home 范围内平移
  const clamp = view => {
    const home = getHome();
    const w = clampWidth(view[2]);
    const h = w * (home[3] / home[2]);
    let x = view[0] + (view[2] - w) / 2;
    let y = view[1] + (view[3] - h) / 2;
    x = Math.min(Math.max(x, home[0]), home[0] + home[2] - w);
    y = Math.min(Math.max(y, home[1]), home[1] + home[3] - h);
    return [x, y, w, h];
  };

  const apply = view => {
    const v = clamp(view);
    svg.setAttribute('viewBox', v.join(' '));
    onChange?.(v);
  };

  // 以屏幕点 (x, y) 为中心缩放 factor 倍（>1 放大）；先把倍数截到缩放范围内，鼠标下的点才不会漂移
  const zoomAt = (x, y, factor, view = currentView(svg)) => {
    const [mx, my] = toMap(view, x, y);
    factor = view[2] / clampWidth(view[2] / factor);
    const w = view[2] / factor, h = view[3] / factor;
    return [mx - (mx - view[0]) / factor, my - (my - view[1]) / factor, w, h];
  };

  const center = () => {
    const ps = [...pointers.values()];
    const x = ps.reduce((a, p) => a + p.x, 0) / ps.length;
    const y = ps.reduce((a, p) => a + p.y, 0) / ps.length;
    const d = ps.length > 1 ? Math.hypot(ps[0].x - ps[1].x, ps[0].y - ps[1].y) : 0;
    return { x, y, d };
  };

  let last = null;
  let startPoint = null;

  svg.addEventListener('pointerdown', e => {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    stopAnimation();
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pointers.size === 1) {
      moved = false;
      suppressClick = false;
      startPoint = { x: e.clientX, y: e.clientY };
    }
    last = center();
  });

  addEventListener('pointermove', e => {
    if (!pointers.has(e.pointerId)) return;
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    const now = center();
    if (!moved) {
      if (pointers.size < 2 && Math.hypot(e.clientX - startPoint.x, e.clientY - startPoint.y) < DRAG_THRESHOLD) return;
      moved = true;
      onStart?.();
    }
    let view = currentView(svg);
    if (pointers.size >= 2 && last.d && now.d) view = zoomAt(now.x, now.y, now.d / last.d, view);
    const k = view[2] / svgRect(svg).width;
    view[0] -= (now.x - last.x) * k;
    view[1] -= (now.y - last.y) * k;
    apply(view);
    last = now;
  });

  const release = e => {
    if (!pointers.delete(e.pointerId)) return;
    if (pointers.size) last = center();
    else if (moved) suppressClick = true;
  };
  addEventListener('pointerup', release);
  addEventListener('pointercancel', release);

  // 拖动结束后浏览器仍会派发 click，在捕获阶段拦掉
  svg.addEventListener('click', e => {
    if (!suppressClick) return;
    suppressClick = false;
    e.stopImmediatePropagation();
  }, true);

  // 滚轮缩放。触控板双指捏合会以 ctrlKey + 小幅 deltaY 的 wheel 事件发出，灵敏度要调高
  svg.addEventListener('wheel', e => {
    e.preventDefault();
    stopAnimation();
    onStart?.();
    const delta = e.deltaMode === 1 ? e.deltaY * 20 : e.deltaY;
    apply(zoomAt(e.clientX, e.clientY, Math.exp(-delta * (e.ctrlKey ? 0.01 : 0.0025))));
  }, { passive: false });

  // Safari（含 iOS）的捏合走私有的 gesture 事件：在页面任何位置都拦下，否则会把整个页面放大、固定布局错乱
  for (const type of ['gesturestart', 'gesturechange']) document.addEventListener(type, e => e.preventDefault());
};
