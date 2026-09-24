// 得意黑子集化：收集页面与地图数据中用到的字符 → public/fonts/cityex-sans.woff2
//
// 得意黑以 SIL OFL 1.1 发布，并声明了保留字体名 "Smiley" 与 "得意黑"。
// 子集化属于修改，修改版不得使用保留字体名，因此这里重写 name 表，改名为 CityEx Sans。
import { readFile, writeFile, mkdir, access } from 'node:fs/promises';
import subsetFont from 'subset-font';
import * as fontkit from 'fontkit';
import wawoff2 from 'wawoff2';
import { collectChars } from './chars.mjs';

const ROOT = new URL('../', import.meta.url);
const SRC = new URL('data/raw/font/SmileySans-Oblique.ttf', ROOT);
const OUT_DIR = new URL('public/fonts/', ROOT);
const FAMILY = 'CityEx Sans';
const EXTRA = ' 0123456789/·.:,+-−×%‹›()（）ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';

// ---------- 收集字符：城市名、简称、界面文案 ----------
const chars = await collectChars();
const all = [...new Set([...chars, ...EXTRA])].sort().join('');

// ---------- 没有原始字体（如在 Vercel 等 CI 上构建）：沿用已提交的子集，但必须覆盖所有用到的字 ----------
if (!await access(SRC).then(() => true, () => false)) {
  const committed = fontkit.create(await readFile(new URL('cityex-sans.woff2', OUT_DIR)));
  const uncovered = chars.filter(c => !committed.hasGlyphForCodePoint(c.codePointAt(0)));
  if (uncovered.length) {
    console.error(`✗ 找不到原始字体 ${SRC.pathname}，且已提交的字体缺 ${uncovered.length} 个字：${uncovered.join('')}`);
    console.error('  请在本地运行 npm run fetch && npm run font，并提交 public/fonts/cityex-sans.woff2');
    process.exit(1);
  }
  console.log('未找到原始字体，沿用已提交的字体子集（已覆盖所有用到的字）');
  process.exit(0);
}

// ---------- 子集化 ----------
const buffer = await readFile(SRC);
const font = fontkit.create(buffer);
const missing = chars.filter(c => !font.hasGlyphForCodePoint(c.codePointAt(0)));
const sfnt = Buffer.from(await subsetFont(buffer, all, { targetFormat: 'sfnt' }));

// ---------- 重写 name 表 ----------
const copyright = `Copyright (c) 2022-2024, atelierAnchor. Modified (subset) from Smiley Sans. Licensed under the SIL Open Font License 1.1.`;
const names = {
  0: copyright,
  1: FAMILY,
  2: 'Regular',
  3: `${FAMILY} subset`,
  4: FAMILY,
  5: 'Version 2.0.1',
  6: FAMILY.replace(/\s/g, '') + '-Regular',
  13: 'This Font Software is licensed under the SIL Open Font License, Version 1.1.',
  14: 'https://openfontlicense.org',
};

const buildNameTable = () => {
  const ids = Object.keys(names).map(Number);
  const strings = ids.map(id => {
    const b = Buffer.alloc(names[id].length * 2);
    for (let i = 0; i < names[id].length; i++) b.writeUInt16BE(names[id].charCodeAt(i), i * 2);
    return b;
  });
  const header = Buffer.alloc(6 + ids.length * 12);
  header.writeUInt16BE(0, 0);
  header.writeUInt16BE(ids.length, 2);
  header.writeUInt16BE(header.length, 4);
  let offset = 0;
  ids.forEach((id, i) => {
    const r = 6 + i * 12;
    header.writeUInt16BE(3, r);          // platform: Windows
    header.writeUInt16BE(1, r + 2);      // encoding: Unicode BMP
    header.writeUInt16BE(0x409, r + 4);  // language: en-US
    header.writeUInt16BE(id, r + 6);
    header.writeUInt16BE(strings[i].length, r + 8);
    header.writeUInt16BE(offset, r + 10);
    offset += strings[i].length;
  });
  return Buffer.concat([header, ...strings]);
};

const checksum = buf => {
  let sum = 0;
  const padded = Buffer.concat([buf, Buffer.alloc((4 - (buf.length % 4)) % 4)]);
  for (let i = 0; i < padded.length; i += 4) sum = (sum + padded.readUInt32BE(i)) >>> 0;
  return sum;
};

const replaceTable = (font, tag, data) => {
  const numTables = font.readUInt16BE(4);
  const tables = [];
  for (let i = 0; i < numTables; i++) {
    const r = 12 + i * 16;
    const t = font.toString('latin1', r, r + 4);
    const off = font.readUInt32BE(r + 8), len = font.readUInt32BE(r + 12);
    tables.push({ tag: t, data: t === tag ? data : Buffer.from(font.subarray(off, off + len)) });
  }
  const head = tables.find(t => t.tag === 'head');
  head.data.writeUInt32BE(0, 8); // checkSumAdjustment 先清零

  const dir = Buffer.alloc(12 + numTables * 16);
  font.copy(dir, 0, 0, 12);
  const body = [];
  let offset = dir.length;
  tables.forEach((t, i) => {
    const r = 12 + i * 16;
    dir.write(t.tag, r, 'latin1');
    dir.writeUInt32BE(checksum(t.data), r + 4);
    dir.writeUInt32BE(offset, r + 8);
    dir.writeUInt32BE(t.data.length, r + 12);
    const pad = Buffer.alloc((4 - (t.data.length % 4)) % 4);
    body.push(t.data, pad);
    offset += t.data.length + pad.length;
  });
  const out = Buffer.concat([dir, ...body]);
  const headOffset = dir.readUInt32BE(12 + tables.indexOf(head) * 16 + 8);
  out.writeUInt32BE((0xB1B0AFBA - checksum(out)) >>> 0, headOffset + 8);
  return out;
};

const renamed = replaceTable(sfnt, 'name', buildNameTable());
const woff2 = Buffer.from(await wawoff2.compress(renamed));

await mkdir(OUT_DIR, { recursive: true });
await writeFile(new URL('cityex-sans.woff2', OUT_DIR), woff2);

const check = fontkit.create(renamed);
console.log(`family: ${check.familyName}, chars: ${all.length}, woff2: ${(woff2.length / 1024).toFixed(1)} KB`);
if (missing.length) console.log(`得意黑缺字（将回退到系统字体）: ${missing.join('')}`);
