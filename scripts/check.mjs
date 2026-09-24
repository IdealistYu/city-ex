// 构建产物自检：地图数据完整性、边界线无退化环、字体覆盖所有用到的字。
// 用法：npm run check（在 npm run data 之后），有问题时以非零状态退出
import { readFile } from 'node:fs/promises';
import * as fontkit from 'fontkit';
import { collectChars } from './chars.mjs';

const ROOT = new URL('../', import.meta.url);
const read = async p => readFile(new URL(p, ROOT), 'utf8');
const data = JSON.parse(await read('src/map-data.json'));
const fine = JSON.parse(await read('src/map-fine.json'));
const SANSHA = '460300';

const problems = [];
const check = (ok, msg) => { if (!ok) problems.push(msg); };

// ---------- 地图数据 ----------
check(data.provinces.length === 34, `省级单位应为 34 个，实际 ${data.provinces.length}`);
check(data.units.length >= 360, `标记单位数量异常：${data.units.length}`);
const codes = new Set();
for (const u of data.units) {
  check(!codes.has(u.code), `重复的代码 ${u.code}`);
  codes.add(u.code);
  check(u.short && u.name, `${u.code} 缺少名称`);
  check(data.provinces.some(p => p.code === u.province), `${u.name} 的省份 ${u.province} 不存在`);
  if (u.code === SANSHA) continue;
  check(u.d, `${u.name} 缺少粗略轮廓`);
  check(fine.units[u.code], `${u.name} 缺少精细轮廓`);
  check(Array.isArray(u.label) && u.label.every(Number.isFinite), `${u.name} 缺少标签点`);
  check(u.bbox?.length === 4 && u.bbox[2] > u.bbox[0], `${u.name} 范围异常`);
}
for (const p of data.provinces) {
  check(p.bbox?.length === 4 && p.bbox[2] > p.bbox[0], `${p.name} 范围异常`);
  check(p.label?.every(Number.isFinite), `${p.name} 缺少省名标注点`);
}

// ---------- 边界线：不应有零面积的闭合"扁环"（会画成内陆的黑点/短粗线） ----------
const subpaths = d => d.split('M').filter(Boolean).map(seg => {
  const n = seg.replace(/[lz]/g, ' ').trim().split(/\s+/).map(Number);
  let x = n[0], y = n[1];
  const pts = [[x, y]];
  for (let i = 2; i < n.length; i += 2) { x += n[i]; y += n[i + 1]; pts.push([x, y]); }
  return pts;
});
const area = l => { let a = 0; for (let i = 0, j = l.length - 1; i < l.length; j = i++) a += (l[j][0] - l[i][0]) * (l[j][1] + l[i][1]); return Math.abs(a / 2); };
for (const [name, src] of [['粗略', data], ['精细', fine]]) {
  for (const kind of ['country', 'province']) {
    const bad = subpaths(src.lines[kind]).filter(p => p.length > 2 && Math.hypot(p[0][0] - p.at(-1)[0], p[0][1] - p.at(-1)[1]) < 0.05 && area(p) < 0.01);
    check(!bad.length, `${name}版${kind === 'country' ? '国界' : '省界'}有 ${bad.length} 个退化环，位置 ${bad.map(p => p[0].join(',')).join(' ')}`);
  }
}

// ---------- 字体覆盖 ----------
const font = fontkit.create(await readFile(new URL('public/fonts/cityex-sans.woff2', ROOT)));
const missing = (await collectChars()).filter(c => !font.hasGlyphForCodePoint(c.codePointAt(0)));
check(!missing.length, `字体缺字 ${missing.length} 个：${missing.join('')}（运行 npm run font）`);

if (problems.length) {
  console.error(`✗ 发现 ${problems.length} 个问题：\n  ${problems.join('\n  ')}`);
  process.exit(1);
}
console.log(`✓ 检查通过：${data.provinces.length} 个省级单位，${data.units.length} 个标记单位，边界无退化环，字体无缺字`);
