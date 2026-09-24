// 等级选择弹窗
import { levelOf, levelButtons } from './levels.js';
import { getLevel, setLevel } from './store.js';
import { unitByCode } from './map.js';
import { $, narrowScreen } from './dom.js';

const picker = $('#picker');
const title = $('#picker-title');
let target = null;       // 正在标记的城市代码
let returnFocus = null;  // 由键盘打开时，关闭后把焦点还给的元素

picker.querySelector('.options').innerHTML = levelButtons(l => ` title="${l.hint}"`);

export const isPickerOpen = () => !picker.hidden;
export const pickerContains = node => picker.contains(node);

// 弹窗默认以 (x, y) 为中心；传入 avoid（屏幕矩形）时放在它旁边，不遮挡。
// 由键盘操作的按钮（城市列表、搜索结果）打开时，把焦点移进弹窗，关闭后再还给原按钮
export const openPicker = (code, x, y, avoid = null) => {
  target = code;
  const trigger = document.activeElement;
  returnFocus = trigger && trigger !== document.body && trigger.matches(':focus-visible') ? trigger : null;

  const level = getLevel(code);
  title.textContent = unitByCode.get(code).name;
  title.style.setProperty('--c', levelOf(level).color);
  for (const b of picker.querySelectorAll('button')) b.classList.toggle('current', +b.dataset.level === level);
  picker.hidden = false;

  const { width, height } = picker.getBoundingClientRect();
  const m = 8, gap = 12;
  // 可用区域的下边界：窄屏时底部是面板，弹窗不能压在面板上
  const bottom = narrowScreen.matches ? $('#panel').getBoundingClientRect().top : innerHeight;
  const fits = ([l, t]) => l >= m && t >= m && l + width <= innerWidth - m && t + height <= bottom - m;
  let left = x - width / 2, top = y - height / 2;
  if (avoid) {
    // 依次尝试右、左、下、上，取第一个放得下的位置
    const cy = avoid.top + avoid.height / 2 - height / 2, cx = avoid.left + avoid.width / 2 - width / 2;
    const spot = [
      [avoid.right + gap, cy], [avoid.left - gap - width, cy],
      [cx, avoid.bottom + gap], [cx, avoid.top - gap - height],
    ].find(fits);
    if (spot) [left, top] = spot;
  }
  picker.style.left = `${Math.max(m, Math.min(left, innerWidth - width - m))}px`;
  picker.style.top = `${Math.max(m, Math.min(top, bottom - height - m))}px`;
  if (returnFocus) (picker.querySelector('button.current') ?? picker.querySelector('button')).focus();
};

export const closePicker = () => {
  if (picker.hidden) return;
  picker.hidden = true;
  target = null;
  // 标记后城市列表会重新渲染，原按钮已被替换，按城市代码找回新按钮
  const back = returnFocus?.isConnected ? returnFocus
    : returnFocus?.dataset.code && document.querySelector(`button[data-code="${returnFocus.dataset.code}"]`);
  back?.focus();
  returnFocus = null;
};

picker.addEventListener('click', e => {
  const b = e.target.closest('button');
  if (!b || !target) return;
  setLevel(target, +b.dataset.level);
  closePicker();
});

// 上下方向键切换选项
picker.addEventListener('keydown', e => {
  if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
  e.preventDefault();
  const buttons = [...picker.querySelectorAll('button')];
  const i = buttons.indexOf(document.activeElement);
  buttons[(i + (e.key === 'ArrowDown' ? 1 : -1) + buttons.length) % buttons.length].focus();
});
