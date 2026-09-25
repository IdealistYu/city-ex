// data/raw/*.json → src/map-data.json（全国视图用的粗略版 + 元数据）、src/map-fine.json（省视图用的精细版）
// 拓扑化简化（mapshaper）→ Albers 投影 → SVG path 字符串 + 标签点 + 省份范围 + 南海诸岛插图
import { readFile, writeFile } from 'node:fs/promises';
import mapshaper from 'mapshaper';
import { geoConicEqualArea } from 'd3-geo';
import * as topojson from 'topojson-client';
import polylabel from 'polylabel';
import { SINGLE_UNIT, SANSHA, shortName } from './config.mjs';

const RAW = new URL('../data/raw/', import.meta.url);
const OUT = new URL('../src/map-data.json', import.meta.url);
const OUT_FINE = new URL('../src/map-fine.json', import.meta.url);
const readJSON = async name => JSON.parse(await readFile(new URL(name, RAW), 'utf8'));

const WIDTH = 1000;          // 全国视图 viewBox 宽度
const PAD = 16;
// 两个精度层级：simplify 为 mapshaper 保留的顶点比例；minIsland 为保留小岛的最小面积（viewBox 单位²，全国视图 1 单位约 1 像素）
const DETAIL = {
  coarse: { simplify: process.env.COARSE ?? '3%', minIsland: +(process.env.MIN_ISLAND ?? 1) }, // 全国视图
  fine: { simplify: '8%', minIsland: 0.005 },                                                  // 省视图、全国视图放大后
};
// 无论多小都保留的岛：钓鱼岛及其附属岛屿（三沙整体在插图中绘制，另行处理）
const ALWAYS_KEEP = [[123.3, 25.6, 124.7, 26.0]];
// 南海诸岛插图覆盖的经纬度范围
const INSET_LONLAT = [[106.5, 3], [122.5, 24.5]];
const INSET_WIDTH = 150;

// ---------- 1. 汇总所有标记单位 ----------
const china = await readJSON('100000_full.json');
const provinces = [];
let jd = null;
for (const f of china.features) {
  const code = String(f.properties.adcode);
  if (code === '100000_JD') { jd = f; continue; }
  const single = SINGLE_UNIT.includes(code);
  provinces.push({ code, name: f.properties.name, short: shortName(code, f.properties.name), single });
}
const provinceName = Object.fromEntries(provinces.map(p => [p.code, p.name]));

// 直辖市、港澳台的区县先标成同一个 code，下一步 dissolve 合并
const units = [];
for (const f of (await readJSON('100000_full_city.json')).features) {
  const code = String(f.properties.adcode);
  if (!/^\d{6}$/.test(code) || code === '100000') continue;
  const province = code.slice(0, 2) + '0000';
  const single = SINGLE_UNIT.includes(province);
  units.push({
    type: 'Feature',
    properties: single
      ? { code: province, name: provinceName[province], province }
      : { code, name: f.properties.name, province },
    geometry: f.geometry,
  });
}

// ---------- 2. 合并 + 拓扑化简化 ----------
// 两个精度各自独立处理：snap + clean 修复原始数据的缝隙与重叠 → 合并直辖市等 → 简化 → 再 clean。
// 最后这次 clean 很关键：几块很小的飞地（淮北在宿州/徐州之间、佳木斯在双鸭山一带等）简化时会被压成零面积，
// keep-shapes 又把它们留了下来，打乱周围边界的拓扑（省界断开、内陆出现粗黑点）。clean 会移除这些压扁的部件并重建拓扑。
const levels = {};
for (const name of ['fine', 'coarse']) {
  const out = await mapshaper.applyCommands(
    `-i units.json snap -clean -dissolve code copy-fields=name,province`
    + ` -simplify weighted ${DETAIL[name].simplify} keep-shapes -clean -o ${name}.json format=topojson`,
    { 'units.json': { type: 'FeatureCollection', features: units } },
  );
  const topo = JSON.parse(out[`${name}.json`]);
  topo.objects.units = topo.objects.units ?? Object.values(topo.objects)[0];
  levels[name] = { topo, obj: topo.objects.units, fc: topojson.feature(topo, topo.objects.units) };
}
// 投影、标签、省份范围、插图位置都以精细版为准
const { topo, obj, fc } = levels.fine;

// ---------- 3. 投影 ----------
// 用 d3 只做逐点投影，不走球面裁剪，避免 GeoJSON 环方向问题
const raw = geoConicEqualArea().parallels([25, 47]).rotate([-105, 0]).scale(1).translate([0, 0]);

const eachPoint = (geom, fn) => {
  const walk = c => (typeof c[0] === 'number' ? fn(c) : c.forEach(walk));
  walk(geom.coordinates);
};
const boundsOf = (geoms, proj) => {
  const b = [Infinity, Infinity, -Infinity, -Infinity];
  for (const g of geoms) eachPoint(g, p => {
    const [x, y] = proj(p);
    if (x < b[0]) b[0] = x; if (y < b[1]) b[1] = y;
    if (x > b[2]) b[2] = x; if (y > b[3]) b[3] = y;
  });
  return b;
};
const affine = (b, x0, y0, w) => {
  const k = w / (b[2] - b[0]);
  return p => { const [x, y] = raw(p); return [x0 + (x - b[0]) * k, y0 + (y - b[1]) * k]; };
};

// 全国视图：排除三沙
const mainGeoms = fc.features.filter(f => f.properties.code !== SANSHA).map(f => f.geometry);
const mainRaw = boundsOf(mainGeoms, raw);
const main = affine(mainRaw, PAD, PAD, WIDTH - PAD * 2);
let HEIGHT = Math.ceil(PAD * 2 + (mainRaw[3] - mainRaw[1]) * (WIDTH - PAD * 2) / (mainRaw[2] - mainRaw[0]));

// 插图：放在右下角
const [[lo0, la0], [lo1, la1]] = INSET_LONLAT;
const insetFrame = { type: 'LineString', coordinates: [] };
for (let i = 0; i <= 20; i++) {
  const t = i / 20;
  insetFrame.coordinates.push([lo0 + (lo1 - lo0) * t, la0], [lo0 + (lo1 - lo0) * t, la1], [lo0, la0 + (la1 - la0) * t], [lo1, la0 + (la1 - la0) * t]);
}
const insetRaw = boundsOf([insetFrame], raw);
const INSET_HEIGHT = INSET_WIDTH * (insetRaw[3] - insetRaw[1]) / (insetRaw[2] - insetRaw[0]);
// 插图放在台湾（含钓鱼岛）以南，避免遮挡；画布高度不够时加高
const taiwanBottom = boundsOf(fc.features.filter(f => f.properties.code === '710000').map(f => f.geometry), main)[3];
const insetTop = Math.max(HEIGHT - PAD - INSET_HEIGHT, taiwanBottom + 12);
HEIGHT = Math.ceil(Math.max(HEIGHT, insetTop + INSET_HEIGHT + PAD));
const insetBox = [WIDTH - PAD - INSET_WIDTH, insetTop, INSET_WIDTH, INSET_HEIGHT];
const inset = affine(insetRaw, insetBox[0], insetBox[1], INSET_WIDTH);
const inInset = geom => {
  let hit = false;
  eachPoint(geom, ([lo, la]) => { if (lo >= lo0 && lo <= lo1 && la >= la0 && la <= la1) hit = true; });
  return hit;
};

// ---------- 3.5 补回简化时丢失的小岛 ----------
// keep-shapes 只保证要素不消失，面积太小的岛会被整体丢弃（三沙、钓鱼岛等必须保留）。
// 与简化结果中任何部件都对不上的原始部件视为被丢弃，只要在 0.1 精度下仍有面积就按原坐标补回。
const polysOf = g => (g.type === 'Polygon' ? [g.coordinates] : g.coordinates);
const ringBox = ring => boundsOf([{ coordinates: ring }], p => p);
const iou = (a, b) => {
  const w = Math.min(a[2], b[2]) - Math.max(a[0], b[0]);
  const h = Math.min(a[3], b[3]) - Math.max(a[1], b[1]);
  if (w <= 0 || h <= 0) return 0;
  const area = r => (r[2] - r[0]) * (r[3] - r[1]);
  return (w * h) / (area(a) + area(b) - w * h);
};
const rawPolys = new Map();
for (const u of units) {
  const list = rawPolys.get(u.properties.code) ?? [];
  list.push(...polysOf(u.geometry));
  rawPolys.set(u.properties.code, list);
}
// 补回的环是原始精度，按投影后距离抽稀（相邻点至少相距 0.3）
const thin = (ring, proj) => {
  let last = null;
  const out = ring.filter((c, i) => {
    const p = proj(c);
    if (last && i < ring.length - 1 && Math.hypot(p[0] - last[0], p[1] - last[1]) < 0.3) return false;
    last = p;
    return true;
  });
  return out.length >= 4 ? out : ring;
};
const inRing = ([x, y], ring) => {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i], [xj, yj] = ring[j];
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
};
// 多边形面积（平面坐标，经纬度或投影后均可）
const ringArea = ring => {
  let a = 0;
  for (let i = 0, n = ring.length, j = n - 1; i < n; j = i++) a += (ring[j][0] - ring[i][0]) * (ring[j][1] + ring[i][1]);
  return Math.abs(a / 2);
};
const alwaysKeep = ring => ring.some(([lo, la]) => ALWAYS_KEEP.some(b => lo >= b[0] && lo <= b[2] && la >= b[1] && la <= b[3]));

// 补回被简化丢掉的岛，再按面积去掉该层级看不见的碎岛
const fixIslands = (features, minIsland) => {
  let restoredCount = 0, droppedCount = 0;
  for (const f of features) {
    const { code } = f.properties;
    const simplified = polysOf(f.geometry);
    const boxes = simplified.map(p => ringBox(p[0]));
    const proj = code === SANSHA ? inset : main;
    const restored = rawPolys.get(code)
      .filter(p => {
        const b = ringBox(p[0]);
        if (boxes.some(sb => iou(sb, b) > 0.3)) return false;           // 简化后仍保留
        const pt = polylabel(p, 1e-3);
        return !simplified.some(sp => inRing(pt, sp[0]));                // 被合并进大轮廓（直辖市的区县）
      })
      .filter(p => new Set(p[0].map(c => proj(c).map(v => Math.round(v * 10)).join())).size >= 3)
      .map(p => [thin(p[0], proj)]);
    restoredCount += restored.length;
    let parts = [...simplified, ...restored];
    if (code !== SANSHA) {
      // 最大的部件（本土）总是保留
      const areas = parts.map(p => ringArea(p[0].map(main)));
      const max = Math.max(...areas);
      const kept = parts.filter((p, i) => areas[i] === max || areas[i] >= minIsland || alwaysKeep(p[0]));
      droppedCount += parts.length - kept.length;
      parts = kept;
    }
    f.geometry = { type: 'MultiPolygon', coordinates: parts };
  }
  return { restoredCount, droppedCount };
};
const islandStats = Object.fromEntries(Object.entries(levels).map(([name, l]) => [name, fixIslands(l.fc.features, DETAIL[name].minIsland)]));

// ---------- 4. 生成 SVG path ----------
const r1 = v => Math.round(v * 10) / 10;
const lineToD = (coords, proj, close) => {
  let d = '', px, py;
  for (const c of coords) {
    const [x, y] = proj(c).map(v => Math.round(v * 10));
    if (d && x === px && y === py) continue;
    d += d ? `l${(x - px) / 10} ${(y - py) / 10}` : `M${x / 10} ${y / 10}`;
    px = x; py = y;
  }
  return d + (close ? 'z' : '');
};
const toD = (geom, proj) => {
  const polys = geom.type === 'Polygon' ? [geom.coordinates]
    : geom.type === 'MultiPolygon' ? geom.coordinates : null;
  if (polys) return polys.flat().map(ring => lineToD(ring, proj, true)).join('');
  const lines = geom.type === 'LineString' ? [geom.coordinates] : geom.coordinates;
  return lines.map(l => lineToD(l, proj, false)).join('');
};

const projPolys = (geom, proj) => (geom.type === 'Polygon' ? [geom.coordinates] : geom.coordinates)
  .map(poly => poly.map(ring => ring.map(proj)));

const coarseByCode = new Map(levels.coarse.fc.features.map(f => [f.properties.code, f]));
const unitsOut = fc.features.map(f => {
  const { code, name, province } = f.properties;
  const polys = projPolys(f.geometry, main);
  const largest = polys.reduce((a, b) => (ringArea(b[0]) > ringArea(a[0]) ? b : a));
  const label = polylabel(largest, 0.5).map(r1);
  const bbox = boundsOf([f.geometry], main).map(r1);
  return {
    code, name, short: shortName(code, name), province,
    d: code === SANSHA ? '' : toD(coarseByCode.get(code).geometry, main),
    label: code === SANSHA ? null : label,
    bbox,
  };
});

// 省份范围（缩放目标）：三沙不计入；远海小岛（如东沙）也不计入，只取面积不小于该市最大部件 2% 的部件
const mainParts = geom => {
  const polys = polysOf(geom);
  const areas = polys.map(p => ringArea(p[0].map(main)));
  const max = Math.max(...areas);
  return { type: 'MultiPolygon', coordinates: polys.filter((_, i) => areas[i] >= max * 0.02) };
};
for (const p of provinces) {
  const geoms = fc.features.filter(f => f.properties.province === p.code && f.properties.code !== SANSHA).map(f => mainParts(f.geometry));
  p.bbox = boundsOf(geoms, main).map(r1);
  // 省名标注点：合并该省所有城市后取最大多边形的 polylabel
  const merged = topojson.merge(topo, obj.geometries.filter(g => g.properties.province === p.code && g.properties.code !== SANSHA));
  const polys = projPolys(merged, main);
  const largest = polys.reduce((a, b) => (ringArea(b[0]) > ringArea(a[0]) ? b : a));
  p.label = polylabel(largest, 0.5).map(r1);
}

// ---------- 5. 边界线（市界由各城市 path 自身描边绘制）----------
const prov = f => f.properties.province;
const keepLines = (ml, test) => ({ type: 'MultiLineString', coordinates: ml.coordinates.filter(l => test({ type: 'LineString', coordinates: l })) });
const notSansha = (() => {
  const b = fc.features.find(f => f.properties.code === SANSHA);
  const sb = boundsOf([b.geometry], p => p);
  return l => { let out = false; eachPoint(l, ([lo, la]) => { if (lo < sb[0] || lo > sb[2] || la > sb[3]) out = true; }); return out; };
})();
// tinyCoast：全国视图里香港、澳门只有几像素大，它们的海岸线若用国界粗线会糊成黑团，改归入省界细线
const TINY = ['810000', '820000'];
const tiny = f => TINY.includes(f.properties.code);
const meshes = ({ topo, obj }, tinyCoast = false) => ({
  province: topojson.mesh(topo, obj, (a, b) => (a !== b && prov(a) !== prov(b)) || (tinyCoast && a === b && tiny(a))),
  country: topojson.mesh(topo, obj, (a, b) => a === b && !(tinyCoast && tiny(a))),
});
// 兜底：简化后若仍残留零面积的"扁环"（A→B→A），它只属于一个城市，会被当成外边界用国界粗线画出来，
// 显示成内陆的小黑点/短粗线，这里去掉
const isDegenerate = l => l.length > 2 && l[0][0] === l.at(-1)[0] && l[0][1] === l.at(-1)[1] && ringArea(l) < 1e-6;
const dropDegenerate = ml => ({ type: 'MultiLineString', coordinates: ml.coordinates.filter(l => !isDegenerate(l)) });
const linesOf = (level, tinyCoast = false) => {
  const m = meshes(level, tinyCoast);
  return {
    province: toD(dropDegenerate(m.province), main),
    country: toD(dropDegenerate(keepLines(m.country, notSansha)), main),
  };
};
const coarseMesh = meshes(levels.coarse);
// 全国外轮廓（不含三沙），用于地图下方的硬投影
const outlineOf = ({ topo, obj }) => toD(topojson.merge(topo, obj.geometries.filter(g => g.properties.code !== SANSHA)), main);

const insetUnits = levels.coarse.fc.features.filter(f => inInset(f.geometry))
  .map(f => ({ code: f.properties.code, d: toD(f.geometry, inset) }));

const data = {
  viewBox: [0, 0, WIDTH, HEIGHT],
  provinces,
  units: unitsOut,
  lines: linesOf(levels.coarse, true),
  outline: outlineOf(levels.coarse),
  jd: toD(jd.geometry, main), // 九段线（主图坐标，位于主图范围以南；供竖版缩略图使用）
  inset: {
    box: insetBox.map(r1),
    units: insetUnits,
    province: toD(keepLines(coarseMesh.province, inInset), inset),
    country: toD(keepLines(coarseMesh.country, inInset), inset),
    jd: toD(jd.geometry, inset),
  },
};

const fine = {
  units: Object.fromEntries(fc.features.filter(f => f.properties.code !== SANSHA).map(f => [f.properties.code, toD(f.geometry, main)])),
  lines: linesOf(levels.fine),
  outline: outlineOf(levels.fine),
};

const json = JSON.stringify(data);
const fineJson = JSON.stringify(fine);
await writeFile(OUT, json);
await writeFile(OUT_FINE, fineJson);
for (const [name, st] of Object.entries(islandStats)) {
  console.log(`${name} (${DETAIL[name].simplify}): restored ${st.restoredCount} islands, dropped ${st.droppedCount} below ${DETAIL[name].minIsland}`);
}
console.log(`units: ${unitsOut.length}, provinces: ${provinces.length}, inset units: ${insetUnits.length}`);
console.log(`viewBox: ${data.viewBox.join(' ')}, map-data: ${(json.length / 1024).toFixed(0)} KB, map-fine: ${(fineJson.length / 1024).toFixed(0)} KB`);
