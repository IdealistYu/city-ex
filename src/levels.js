// 等级定义（沿用 china-ex 的五级 + 未去过）。颜色只在这里定义，main.js 启动时写成 CSS 变量 --l1…--l5
export const LEVELS = [
  { value: 5, name: '居住', color: '#FF7E7E', hint: '住过一年以上' },
  { value: 4, name: '短居', color: '#FFB57E', hint: '住过一个月以上' },
  { value: 3, name: '游玩', color: '#FFE57E', hint: '旅行过' },
  { value: 2, name: '出差', color: '#A8FFBE', hint: '去过但没怎么玩' },
  { value: 1, name: '路过', color: '#88AEFF', hint: '路过或经停' },
  { value: 0, name: '没去过', color: '#FFFFFF', hint: '' },
];

export const levelOf = value => LEVELS.find(l => l.value === value) ?? LEVELS.at(-1);

// 一组等级按钮（等级弹窗、画笔共用），attrs(level) 返回额外的属性字符串
export const levelButtons = (attrs = () => '') => LEVELS.map(l =>
  `<button data-level="${l.value}" style="--c:${l.color}"${attrs(l)}>${l.name}</button>`).join('');

// 统计：各等级数量、总分、已去城市数
export const tally = (levels, units) => {
  const counts = Object.fromEntries(LEVELS.map(l => [l.value, 0]));
  let score = 0;
  for (const u of units) {
    const lv = levels[u.code] ?? 0;
    counts[lv]++;
    score += lv;
  }
  return { counts, score, visited: units.length - counts[0], total: units.length };
};
