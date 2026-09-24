// 数据备份：导出为人能直接阅读、手工编辑的 JSON，导入时宽容解析
import { LEVELS } from './levels.js';
import { units, unitByCode, provinceByCode } from './map.js';

const VERSION = 1;
const HELP = 'level 可填 1~5 或等级名称：居住/短居/游玩/出差/路过；删掉一行即取消标记；code 可省略，按 name 匹配';

const today = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

// ---------- 导出 ----------
export const toBackup = levels => ({
  app: '城市制霸',
  version: VERSION,
  exportedAt: today(),
  说明: HELP,
  cities: units
    .filter(u => levels[u.code])
    .map(u => ({
      name: u.name,
      province: provinceByCode.get(u.province).name,
      level: LEVELS.find(l => l.value === levels[u.code]).name,
      code: u.code,
    })),
});

// 每个城市一行，方便手工编辑
export const stringifyBackup = backup => JSON.stringify({ ...backup, cities: [] }, null, 2)
  .replace('"cities": []', `"cities": [\n${backup.cities.map(c => `    ${JSON.stringify(c)}`).join(',\n')}\n  ]`);

export const backupFileName = () => `城市制霸-${today()}.json`;

// ---------- 导入 ----------
// 名称索引：全称与简称都能匹配（"广州市"/"广州"），港澳台、直辖市的简称同理
const byName = new Map();
for (const u of units) {
  byName.set(u.name, u);
  byName.set(u.short, u);
}
const levelByName = new Map(LEVELS.filter(l => l.value).map(l => [l.name, l.value]));

const parseLevel = v => {
  if (typeof v === 'string') v = v.trim();
  if (levelByName.has(v)) return levelByName.get(v);
  const n = Number(v);
  return Number.isInteger(n) && n >= 0 && n <= 5 ? n : null;
};

const findUnit = (code, name) => {
  if (code != null && unitByCode.has(String(code))) return unitByCode.get(String(code));
  if (typeof name === 'string') return byName.get(name.trim()) ?? null;
  return null;
};

// 返回 { levels: {code: level}, skipped: [描述] }；格式完全不对时抛错
// 兼容三种写法：本工具导出的 { cities: [...] }、直接的数组、以及简单对象 { "广州": "游玩", "440300": 5 }
export const parseBackup = text => {
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error('文件不是有效的 JSON');
  }
  let entries;
  if (Array.isArray(data?.cities)) entries = data.cities;
  else if (Array.isArray(data)) entries = data;
  else if (data && typeof data === 'object') entries = Object.entries(data).map(([k, v]) => ({ code: k, name: k, level: v }));
  else throw new Error('没有找到城市数据');

  const levels = {};
  const skipped = [];
  for (const e of entries) {
    const label = e?.name ?? e?.code ?? JSON.stringify(e);
    const u = e && typeof e === 'object' ? findUnit(e.code, e.name) : null;
    if (!u) { skipped.push(`${label}（找不到这个城市）`); continue; }
    const level = parseLevel(e.level);
    if (level === null) { skipped.push(`${label}（等级"${e.level}"无效）`); continue; }
    if (level) levels[u.code] = Math.max(levels[u.code] ?? 0, level);
  }
  return { levels, skipped };
};
