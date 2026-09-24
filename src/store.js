// 标记数据：{ 行政区划代码: 等级 }，存 localStorage。以代码为 key，地图数据增删城市不会错位。
const KEY = 'china-ex-city:v1';

// 只接受 6 位代码 + 1～5 的整数等级；手动改坏或旧格式的数据直接丢弃，避免分数算出 NaN
const sanitize = data => {
  const out = {};
  if (data && typeof data === 'object') {
    for (const [code, level] of Object.entries(data)) {
      if (/^\d{6}$/.test(code) && Number.isInteger(level) && level >= 1 && level <= 5) out[code] = level;
    }
  }
  return out;
};

const read = () => {
  try {
    return sanitize(JSON.parse(localStorage.getItem(KEY)));
  } catch {
    return {};
  }
};

let levels = read();
const listeners = new Set();

export const getLevel = code => levels[code] ?? 0;

export const setLevel = (code, level) => {
  if (level) levels[code] = level;
  else delete levels[code];
  try {
    localStorage.setItem(KEY, JSON.stringify(levels));
  } catch { /* 隐私模式等场景写不进去，页面照常可用 */ }
  listeners.forEach(fn => fn(code, level));
};

export const allLevels = () => ({ ...levels });

// 整体替换（导入备份时用），写入后通知全部重绘
export const replaceAll = next => {
  levels = sanitize(next);
  try {
    localStorage.setItem(KEY, JSON.stringify(levels));
  } catch { /* 同上 */ }
  listeners.forEach(fn => fn(null));
};

// fn(code, level)；code 为 null 表示整体变化（其他标签页改了数据），需要全部重绘
export const onChange = fn => listeners.add(fn);

// 多标签页同步：别的标签页写入后这里同步过来，否则两边各自覆盖对方的修改
addEventListener('storage', e => {
  if (e.key !== KEY && e.key !== null) return;
  levels = read();
  listeners.forEach(fn => fn(null));
});
