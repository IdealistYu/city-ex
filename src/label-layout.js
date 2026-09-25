// 城市名布局（网站省视图与单省导出图共用）
//
// 按面积从大到小放置：
//   1) 标注点原位，放不下就逐级缩小；
//   2) 城市自身范围内的其他位置（文字框须基本落在城市内，避免看起来像在标别的城市）；
//   3) 都不行就在附近空位写名字，并画引线指回城市。
// 所有坐标都是像素，原点为视图左上角；地图坐标 = v + 像素 / k。

const overlaps = (a, b) => a.x0 < b.x1 && a.x1 > b.x0 && a.y0 < b.y1 && a.y1 > b.y0;

export const labelBox = (x, y, text, s) => {
  const w = text.length * s * 0.92 + 8, h = s + 6;
  return { x0: x - w / 2, x1: x + w / 2, y0: y - h / 2, y1: y + h / 2 };
};

/**
 * @param units   城市列表（需 code、short、label、bbox）
 * @param pathOf  code → SVG path 字符串（地图坐标）
 * @param view    { vx, vy, k }：视图左上角的地图坐标、每地图单位对应的像素
 * @param bounds  { x0, y0, x1, y1 }：文字可以放置的像素范围
 * @param base    基准字号（像素）
 * @param scales  逐级缩小的比例，最后一级也用于引线文字
 * @returns { labels: [{ u, x, y, s, leader?: [ax, ay] }], missing: [城市简称], offscreen: [城市] }
 *   标注点在 bounds 之外的城市（放大后移出屏幕）不参与布局，列入 offscreen
 */
export const layoutLabels = ({ units, pathOf, view: { vx, vy, k }, bounds, base, scales = [1, 0.82, 0.7] }) => {
  const placed = [], labels = [], missing = [];
  const inBounds = b => b.x0 > bounds.x0 && b.x1 < bounds.x1 && b.y0 > bounds.y0 && b.y1 < bounds.y1;
  const area = u => (u.bbox[2] - u.bbox[0]) * (u.bbox[3] - u.bbox[1]);
  const all = units.map(u => ({ u, x: (u.label[0] - vx) * k, y: (u.label[1] - vy) * k }));
  const visible = a => a.x > bounds.x0 && a.x < bounds.x1 && a.y > bounds.y0 && a.y < bounds.y1;
  const anchors = all.filter(visible);
  const offscreen = all.filter(a => !visible(a)).map(a => a.u);
  // 所有城市的标注点先占位，别的名字不能盖住
  const dots = anchors.map(a => ({ x0: a.x - 5, x1: a.x + 5, y0: a.y - 5, y1: a.y + 5, code: a.u.code }));
  const free = (box, code) => inBounds(box) && !placed.some(b => overlaps(b, box)) && !dots.some(d => d.code !== code && overlaps(d, box));

  const ctx = document.createElement('canvas').getContext('2d');
  const shapes = new Map(units.map(u => [u.code, new Path2D(pathOf(u.code))]));
  const inside = (code, px, py) => ctx.isPointInPath(shapes.get(code), px / k + vx, py / k + vy);
  // 中心在城市内，且四角至少三个在内（容许轻微出界）
  const fitsIn = (code, b, px, py) => inside(code, px, py)
    && [[b.x0, b.y0], [b.x1, b.y0], [b.x0, b.y1], [b.x1, b.y1]].filter(([qx, qy]) => inside(code, qx, qy)).length >= 3;
  const candidates = (u, x, y, sz) => {
    const [x0, y0, x1, y1] = u.bbox.map((v, i) => (v - (i % 2 ? vy : vx)) * k);
    const step = Math.max(6, Math.min(x1 - x0, y1 - y0) / 14);
    const out = [];
    for (let px = x0; px <= x1; px += step) for (let py = y0; py <= y1; py += step) {
      if (fitsIn(u.code, labelBox(px, py, u.short, sz), px, py)) out.push({ px, py, d: Math.hypot(px - x, py - y) });
    }
    return out.sort((a, b) => a.d - b.d).slice(0, 40);
  };

  for (const { u, x, y } of anchors.sort((a, b) => area(b.u) - area(a.u))) {
    let done = false;
    sizes: for (const sc of scales) {
      const sz = base * sc;
      for (const c of [{ px: x, py: y }, ...candidates(u, x, y, sz)]) {
        const box = labelBox(c.px, c.py, u.short, sz);
        if (fitsIn(u.code, box, c.px, c.py) && free(box, u.code)) {
          placed.push(box);
          labels.push({ u, x: c.px, y: c.py, s: sz });
          done = true;
          break sizes;
        }
      }
    }
    if (done) continue;
    const sz = base * scales.at(-1);
    search: for (const dist of [1.6, 2.2, 2.9, 3.7, 4.6, 5.8].map(m => m * sz)) {
      for (let i = 0; i < 8; i++) {
        const ang = (i / 8) * Math.PI * 2 + Math.PI / 8;
        const tx = x + Math.cos(ang) * dist * 1.4, ty = y + Math.sin(ang) * dist;
        const box = labelBox(tx, ty, u.short, sz);
        if (free(box, u.code)) {
          placed.push(box);
          labels.push({ u, x: tx, y: ty, s: sz, leader: [x, y] });
          done = true;
          break search;
        }
      }
    }
    if (!done) missing.push(u.short);
  }
  return { labels, missing, offscreen };
};

// 引线终点：从城市点连到文字框边缘（像素）
export const leaderEnd = ({ x, y, s, leader: [ax, ay] }) => {
  const dx = x - ax, dy = y - ay, len = Math.hypot(dx, dy) || 1;
  return [x - dx / len * s * 0.9, y - dy / len * s * 0.6];
};
