// 端到端回归测试：自动启动 Vite 开发服务器，用 Playwright（Chromium）驱动页面。
// 用法：npm test（首次需 npx playwright install chromium）；只跑部分用例：npm test -- 备份
// 测试线上站点：E2E_URL=https://china.loveyou.moe/ npm test
import { createServer } from 'vite';
import { chromium } from 'playwright';
import { mkdtemp, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const filter = process.argv[2] ?? '';
const server = process.env.E2E_URL
  ? null
  : await createServer({ root: new URL('..', import.meta.url).pathname, logLevel: 'error', server: { port: 0 } });
await server?.listen();
const BASE = process.env.E2E_URL ?? server.resolvedUrls.local[0];
console.log(`测试地址：${BASE}\n`);
const browser = await chromium.launch();
const tmp = await mkdtemp(join(tmpdir(), 'china-ex-city-'));

const KEY = 'china-ex-city:v1';
const DESKTOP = { viewport: { width: 1280, height: 800 }, acceptDownloads: true };
const MOBILE = { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true };
const cases = [];
const test = (name, fn, options = DESKTOP) => cases.push({ name, fn, options });

// ---------- 辅助 ----------
class AssertionError extends Error {}
const expect = (cond, msg) => { if (!cond) throw new AssertionError(msg); };
const wait = ms => new Promise(r => setTimeout(r, ms));
const helpers = page => ({
  open: async (hash = '', levels = null) => {
    if (levels) await page.addInitScript(([k, v]) => localStorage.setItem(k, v), [KEY, JSON.stringify(levels)]);
    await page.goto(BASE + hash);
    await wait(hash ? 1300 : 700);
  },
  view: () => page.evaluate(() => document.querySelector('#map').getAttribute('viewBox').split(' ').map(v => Math.round(v * 100) / 100)),
  state: () => page.evaluate(() => ({ hash: location.hash, view: document.documentElement.dataset.view })),
  score: async () => +(await page.textContent('#score-num')),
  level: code => page.evaluate(c => document.querySelector(`.prov .unit[data-code="${c}"]`)?.getAttribute('data-level') ?? null, code),
  unit: code => page.locator(`.prov .unit[data-code="${code}"]`),
  clickUnit: async code => {
    const b = await page.locator(`.prov .unit[data-code="${code}"]`).boundingBox();
    await page.mouse.click(b.x + b.width / 2, b.y + b.height / 2);
  },
  pickerTitle: () => page.evaluate(() => !document.querySelector('#picker').hidden && document.querySelector('#picker-title').textContent),
  toast: () => page.textContent('#toast'),
  file: async (name, content) => {
    const p = join(tmp, name);
    await writeFile(p, typeof content === 'string' ? content : JSON.stringify(content));
    return p;
  },
});

// ---------- 地图与视图切换 ----------
test('初始渲染：370 个城市、南海插图、九段线', async (page, h) => {
  await h.open();
  expect(await page.locator('.prov .unit').count() === 369, '主图应有 369 个城市（三沙只在插图）');
  expect(await page.locator('.inset .jd').count() === 1, '缺少九段线');
  expect(await h.score() === 0, '初始分数应为 0');
});

test('点省份进入，返回键回全国', async (page, h) => {
  await h.open();
  await h.unit('440100').click({ force: true });
  await wait(1000);
  expect((await h.state()).hash === '#/440000', '应进入广东');
  await page.goBack();
  await wait(1000);
  expect((await h.state()).view === 'country', '应回到全国');
});

test('省视图：点邻省直接切换、点海面回全国', async (page, h) => {
  await h.open('#/440000');
  await h.clickUnit('450400'); // 梧州
  await wait(1300);
  expect((await h.state()).hash === '#/450000', '应切换到广西');
  await page.goBack();
  await wait(1000);
  expect((await h.state()).hash === '', '返回键应回全国');
  await h.open('#/330000');
  await page.mouse.click(930, 700); // 东海
  await wait(1000);
  expect((await h.state()).view === 'country', '点海面应回全国');
});

test('悬停提示：全国显示省名，省视图本省显示城市名', async (page, h) => {
  const title = c => page.evaluate(x => document.querySelector(`.prov .unit[data-code="${x}"] > title`).textContent, c);
  await h.open();
  expect(await title('440100') === '广东省', '全国视图应显示省名');
  await h.open('#/440000');
  expect(await title('440100') === '广州市' && await title('450100') === '广西壮族自治区', '省视图提示不对');
});

test('精度切换：全国粗略、省视图精细', async (page, h) => {
  await h.open();
  await wait(2500);
  expect(await page.evaluate(() => document.querySelector('#map').dataset.detail) === 'coarse', '全国应为粗略版');
  await h.unit('440100').click({ force: true });
  await wait(1000);
  expect(await page.evaluate(() => document.querySelector('#map').dataset.detail) === 'fine', '省视图应为精细版');
});

test('城市分界：全国视图隐藏，省视图显示', async (page, h) => {
  const stroke = () => page.evaluate(() => getComputedStyle(document.querySelector('.prov .unit[data-code="440100"]')).stroke);
  await h.open();
  expect(await stroke() === 'rgb(255, 255, 255)', '全国视图城市描边应与填充同色');
  await h.open('#/440000');
  expect(await stroke() !== 'rgb(255, 255, 255)', '省视图应显示城市分界');
});

test('南海插图只显示、随标记上色', async (page, h) => {
  await h.open('', { 460300: 5 });
  const f = await page.locator('.inset-frame').boundingBox();
  await page.mouse.click(f.x + f.width / 2, f.y + f.height / 2);
  await wait(300);
  expect((await h.state()).view === 'country', '点插图不应进入省份');
  expect(await page.evaluate(() => document.querySelector('.inset .unit[data-code="460300"]').getAttribute('data-level')) === '5', '插图应上色');
});

// ---------- 标记 ----------
test('等级弹窗标记、分数更新', async (page, h) => {
  await h.open('#/440000');
  await h.clickUnit('440300');
  await wait(200);
  expect(await h.pickerTitle() === '深圳市', '应弹出深圳的等级菜单');
  await page.click('#picker button[data-level="5"]');
  expect(await h.level('440300') === '5', '深圳应标为居住');
  expect(await page.evaluate(k => JSON.parse(localStorage.getItem(k))['440300'], KEY) === 5, '应写入 localStorage');
});

test('画笔连续涂色，再点取消；回全国后画笔失效', async (page, h) => {
  await h.open('#/440000');
  await page.click('#brush button[data-level="3"]');
  await h.clickUnit('440100');
  await h.clickUnit('440600');
  expect(await h.level('440100') === '3' && await h.level('440600') === '3', '画笔应直接涂色');
  await h.clickUnit('440600');
  expect(await h.level('440600') === null, '再点应取消');
  await page.keyboard.press('Escape');
  await wait(1000);
  await h.unit('110000').click({ force: true });
  await wait(200);
  expect(await h.pickerTitle() === '北京市', '全国视图点北京应弹出菜单而不是用画笔');
});

test('非法本地数据被过滤', async (page, h) => {
  await h.open('', { 440100: 3, 440300: 'x', 999: 5, 110000: 9, 310000: 5 });
  expect(await h.score() === 8, '只应保留 广州=3、上海=5');
});

test('多标签页同步', async (page, h, ctx) => {
  await h.open();
  const other = await ctx.newPage();
  await other.goto(BASE + '#/440000');
  await wait(1300);
  await other.locator('#city-list button[data-code="440300"]').click();
  await other.locator('#picker button[data-level="5"]').click();
  await wait(300);
  expect(await h.level('440300') === '5' && await h.score() === 5, '另一个标签页的修改应同步过来');
});

// ---------- 搜索定位 ----------
test('搜索定位：跨省城市、单一单位、三沙', async (page, h) => {
  await h.open('#/440000');
  for (const [q, hash, title] of [['黔东', '#/520000', '黔东南苗族侗族自治州'], ['澳门', '', '澳门特别行政区'], ['三沙', '#/460000', '三沙市']]) {
    await page.click('#search input');
    await page.keyboard.type(q);
    await page.keyboard.press('Enter');
    await wait(1100);
    expect((await h.state()).hash === hash && await h.pickerTitle() === title, `搜索"${q}"应定位到 ${title}`);
    await page.keyboard.press('Escape');
  }
});

test('定位菜单：省份 → 城市 → 查看全省', async (page, h) => {
  await h.open();
  await page.click('#search input');
  await page.click('#locator [data-province="510000"]');
  await page.click('#locator [data-view-province="510000"]');
  await wait(1100);
  expect((await h.state()).hash === '#/510000', '应进入四川');
});

// ---------- 缩放 ----------
test('滚轮缩放：缩到最小回到完整视图，不越界', async (page, h) => {
  await h.open();
  await wait(400); // 等开场动画结束再记录完整视图
  const home = await h.view();
  await page.mouse.move(1200, 780);
  for (let i = 0; i < 8; i++) { await page.mouse.wheel(0, -120); await wait(20); }
  await page.mouse.move(60, 60);
  for (let i = 0; i < 30; i++) { await page.mouse.wheel(0, 120); await wait(20); }
  expect(JSON.stringify(await h.view()) === JSON.stringify(home), '缩到最小应精确回到 home');
});

test('拖动不会误触点击', async (page, h) => {
  await h.open();
  for (let i = 0; i < 4; i++) { await page.mouse.wheel(0, -150); await wait(20); }
  await page.mouse.move(700, 500);
  await page.mouse.down();
  await page.mouse.move(600, 450, { steps: 8 });
  await page.mouse.up();
  await wait(200);
  expect((await h.state()).view === 'country', '拖动后不应进入省份');
});

test('窗口变化保留放大倍数', async (page, h) => {
  await h.open();
  const home = await h.view();
  await page.mouse.move(800, 480);
  for (let i = 0; i < 4; i++) { await page.mouse.wheel(0, -150); await wait(30); }
  await page.setViewportSize({ width: 1100, height: 760 });
  await wait(300);
  expect((await h.view())[2] < home[2] * 0.6, '窗口变化后应仍保持放大');
});

test('手机双指捏合缩放并可点击', async (page, h) => {
  await h.open();
  const before = await h.view();
  const b = await h.unit('110000').boundingBox();
  await page.evaluate(async ([cx, cy]) => {
    const svg = document.querySelector('#map');
    const fire = (type, id, x, y, t = svg) => t.dispatchEvent(new PointerEvent(type, { pointerId: id, clientX: x, clientY: y, pointerType: 'touch', bubbles: true }));
    fire('pointerdown', 1, cx - 20, cy); fire('pointerdown', 2, cx + 20, cy);
    for (let i = 1; i <= 10; i++) {
      fire('pointermove', 1, cx - 20 - i * 10, cy, window); fire('pointermove', 2, cx + 20 + i * 10, cy, window);
      await new Promise(r => setTimeout(r, 16));
    }
    fire('pointerup', 1, cx - 120, cy, window); fire('pointerup', 2, cx + 120, cy, window);
  }, [b.x + b.width / 2, b.y + b.height / 2]);
  expect(Math.abs(before[2] / (await h.view())[2] - 6) < 0.05, '应放大 6 倍');
  const bj = await h.unit('110000').boundingBox();
  await page.touchscreen.tap(bj.x + bj.width / 2, bj.y + bj.height / 2);
  await wait(200);
  expect(await h.pickerTitle() === '北京市', '放大后点北京应弹出菜单');
}, MOBILE);

// ---------- 手机端 ----------
const SMALL_PHONE = { viewport: { width: 375, height: 667 }, isMobile: true, hasTouch: true };

test('手机：控件都在屏幕内，页面不整体滚动，不显示 GitHub 入口', async (page, h) => {
  await h.open();
  const outside = await page.evaluate(() => [...document.querySelectorAll('button, a, input')]
    .filter(e => e.offsetParent)
    .filter(e => { const r = e.getBoundingClientRect(); return r.left < 0 || r.right > innerWidth || r.top < 0 || r.bottom > innerHeight; })
    .map(e => e.id || e.textContent.trim()));
  expect(!outside.length, `超出屏幕：${outside.join('、')}`);
  await page.evaluate(() => window.scrollTo(0, 500));
  expect(await page.evaluate(() => scrollY === 0), '页面不应整体滚动');
  expect(await page.evaluate(() => getComputedStyle(document.querySelector('#repo')).display === 'none'), '手机端不应显示 GitHub 入口');
}, SMALL_PHONE);

test('手机：搜索输入不触发 iOS 自动放大，键盘弹起时列表不被遮挡', async (page, h) => {
  await h.open();
  await page.tap('#search');
  expect(parseFloat(await page.evaluate(() => getComputedStyle(document.querySelector('#search input')).fontSize)) >= 16, '输入框字号应 ≥ 16px');
  const before = await h.view();
  await page.setViewportSize({ width: 375, height: 380 }); // 模拟键盘弹起
  await wait(300);
  expect(await page.evaluate(() => document.querySelector('#locator').getBoundingClientRect().bottom) <= 380, '列表应在键盘上方');
  expect(JSON.stringify(await h.view()) === JSON.stringify(before), '键盘弹起时地图不应跳动');
}, SMALL_PHONE);

test('手机：标记、画笔、旋转屏幕、保存预览', async (page, h) => {
  await h.open('#/330000');
  const b = await h.unit('330100').boundingBox();
  await page.touchscreen.tap(b.x + b.width / 2, b.y + b.height / 2);
  await wait(200);
  const r = await page.evaluate(() => { const x = document.querySelector('#picker').getBoundingClientRect(); return x.top >= 0 && x.bottom <= innerHeight && x.left >= 0 && x.right <= innerWidth; });
  expect(r, '等级菜单应完整显示在屏幕内');
  expect(await page.evaluate(() => document.querySelector('#picker').getBoundingClientRect().bottom <= document.querySelector('#panel').getBoundingClientRect().top), '等级菜单不应压住底部面板');
  await page.tap('#picker button[data-level="5"]');
  expect(await h.level('330100') === '5', '应完成标记');
  await page.setViewportSize({ width: 667, height: 375 });
  await wait(400);
  expect(await page.evaluate(() => document.documentElement.dataset.view === 'province' && document.querySelector('#panel').getBoundingClientRect().bottom <= innerHeight), '横屏后侧栏应在屏幕内');
  await page.setViewportSize({ width: 375, height: 667 });
  await wait(400);
  await page.tap('#save');
  await wait(1500);
  expect(await page.evaluate(() => { const i = document.querySelector('#output img').getBoundingClientRect(); return i.width <= innerWidth && i.height > 100; }), '预览图应适应屏幕');
}, SMALL_PHONE);

test('电脑：顶栏 GitHub 入口与保存按钮等高', async (page, h) => {
  await h.open();
  const [repo, save] = await page.evaluate(() => ['#repo', '#save'].map(s => { const r = document.querySelector(s).getBoundingClientRect(); return [r.top, r.height, getComputedStyle(document.querySelector(s)).display]; }));
  expect(repo[2] !== 'none' && repo[0] === save[0] && repo[1] === save[1], `GitHub 入口应与保存按钮对齐：${repo} / ${save}`);
  expect(await page.getAttribute('#repo', 'href') === 'https://github.com/IdealistYu/city-ex', '链接地址不对');
});

// ---------- 键盘与可访问性 ----------
test('键盘：城市列表 → 等级弹窗 → 焦点归还', async (page, h) => {
  await h.open('#/330000');
  await page.locator('#city-list button[data-code="330100"]').focus();
  await page.keyboard.press('Enter');
  await wait(150);
  expect(await page.evaluate(() => !!document.activeElement.closest('#picker')), '焦点应进入弹窗');
  // 焦点从当前等级"没去过"（最后一项）开始，下移两次：循环到居住 → 短居
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('Enter');
  await wait(150);
  expect(await page.evaluate(() => document.activeElement.dataset.code) === '330100', '焦点应回到城市按钮');
  expect(await h.level('330100') === '4', '应标记为短居');
});

test('减少动态效果时视图立即到位', async (page, h) => {
  await h.open();
  await h.unit('440100').click({ force: true });
  await wait(80);
  expect((await h.view())[2] < 400, '应立即切换到省视图');
}, { ...DESKTOP, reducedMotion: 'reduce' });

// ---------- 导出图片 ----------
test('保存图片：下载 PNG、弹层 Esc / 点背景关闭', async (page, h) => {
  await h.open('', { 440100: 3 });
  let dl = page.waitForEvent('download');
  await page.click('#save');
  expect((await dl).suggestedFilename() === '城市制霸.png', '应下载 PNG');
  await wait(300);
  await page.keyboard.press('Escape');
  expect(await page.evaluate(() => document.querySelector('#output').hidden), 'Esc 应关闭弹层');
  dl = page.waitForEvent('download');
  await page.click('#save');
  await dl;
  await wait(300);
  await page.mouse.click(10, 10);
  expect(await page.evaluate(() => document.querySelector('#output').hidden), '点背景应关闭弹层');
});

test('单省导出：按钮随视图切换，导出 3:4 竖图', async (page, h) => {
  await h.open('', { 320100: 3, 320500: 5 });
  expect((await page.textContent('#save span')) === '保存全国图', '全国视图按钮应为"保存全国图"');
  await h.open('#/320000');
  expect((await page.textContent('#save span')) === '保存江苏图', '省视图按钮应为"保存江苏图"');
  const dl = page.waitForEvent('download');
  await page.click('#save');
  const file = await dl;
  expect(file.suggestedFilename() === '城市制霸-江苏.png', `文件名不对：${file.suggestedFilename()}`);
  const size = await page.evaluate(() => new Promise(r => { const i = document.querySelector('#output img'); const f = () => r([i.naturalWidth, i.naturalHeight]); i.complete ? f() : i.onload = f; }));
  expect(size[0] === 2160 && size[1] === 2880, `尺寸应为 2160×2880：${size}`);
  await page.keyboard.press('Escape');
  await page.goBack();
  await wait(1000);
  expect((await page.textContent('#save span')) === '保存全国图', '回到全国后按钮应恢复');
});

test('单省导出：海南（含三沙插图）与新疆（引线最多）都能生成', async (page, h) => {
  for (const [code, name] of [['460000', '海南'], ['650000', '新疆']]) {
    await h.open(`#/${code}`, { 460300: 3, 650100: 5 });
    const dl = page.waitForEvent('download');
    await page.click('#save');
    expect((await dl).suggestedFilename() === `城市制霸-${name}.png`, `${name}导出失败`);
    await page.keyboard.press('Escape');
  }
});

// ---------- 数据备份 ----------
test('备份：导出可读的 JSON', async (page, h) => {
  await h.open('', { 440100: 3, 330100: 5 });
  const dl = page.waitForEvent('download');
  await page.click('#export-data');
  const file = await dl;
  const json = JSON.parse(await readFile(await file.path(), 'utf8'));
  expect(/^城市制霸-\d{4}-\d{2}-\d{2}\.json$/.test(file.suggestedFilename()), '文件名不对');
  expect(json.cities.some(c => c.name === '杭州市' && c.level === '居住' && c.province === '浙江省'), '内容应为可读的城市与等级');
});

test('备份：导入合并 / 替换 / 取消，宽容解析', async (page, h) => {
  await h.open('', { 440100: 3, 330100: 5 });
  const edited = await h.file('edited.json', { cities: [
    { name: '深圳', level: '居住' }, { name: '苏州市', level: 2 }, { code: '440100', level: '路过' },
    { name: '火星市', level: 3 }, { name: '成都', level: '旅游' },
  ] });
  await page.setInputFiles('#import-file', edited);
  await wait(300);
  expect((await page.textContent('#import-dialog .skipped')).includes('火星市'), '应列出无法识别的条目');
  await page.click('#import-dialog button[value="merge"]');
  await wait(300);
  expect(await h.level('440300') === '5' && await h.level('440100') === '3' && await h.score() === 15, '合并结果不对');
  await page.setInputFiles('#import-file', edited);
  await wait(300);
  await page.click('#import-dialog button[value="cancel"]');
  expect(await h.score() === 15, '取消不应改变数据');
  await page.setInputFiles('#import-file', edited);
  await wait(300);
  await page.click('#import-dialog button[value="replace"]');
  await wait(300);
  expect(await h.score() === 5 + 2 + 1 && await h.level('330100') === null, '替换结果不对');
});

test('备份：无效文件提示、本机为空时直接导入', async (page, h) => {
  await h.open();
  await page.setInputFiles('#import-file', await h.file('bad.json', 'not json {'));
  await wait(300);
  expect((await h.toast()).includes('不是有效的 JSON'), '应提示无效 JSON');
  await page.setInputFiles('#import-file', await h.file('simple.json', { 广州: '游玩', 440300: 5 }));
  await wait(300);
  expect(!(await page.evaluate(() => document.querySelector('#import-dialog').open)) && await h.score() === 8, '本机为空时应直接导入');
});

test('备份：内置浏览器导出改为文本', async (page, h) => {
  await h.open('', { 440100: 3 });
  await page.tap('#export-data');
  await wait(200);
  const text = await page.evaluate(() => document.querySelector('#export-dialog').open && document.querySelector('#export-dialog textarea').value);
  expect(text && JSON.parse(text).cities[0].name === '广州市', '应弹出可复制的文本');
}, { ...MOBILE, userAgent: 'Mozilla/5.0 (iPhone) AppleWebKit/605.1.15 MicroMessenger/8.0' });

// ---------- 运行 ----------
let failed = 0;
const selected = cases.filter(c => c.name.includes(filter));
for (const { name, fn, options } of selected) {
  const ctx = await browser.newContext(options);
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  page.on('console', m => m.type() === 'error' && errors.push(m.text()));
  try {
    await fn(page, helpers(page), ctx);
    expect(!errors.length, `页面报错：${errors.join('; ')}`);
    console.log(`  ✓ ${name}`);
  } catch (err) {
    failed++;
    console.log(`  ✗ ${name}\n      ${err instanceof AssertionError ? err.message : err.stack}`);
  } finally {
    await ctx.close();
  }
}
console.log(`\n${selected.length - failed} 通过，${failed} 失败`);

await browser.close();
await server?.close();
await rm(tmp, { recursive: true, force: true });
process.exit(failed ? 1 : 0);
