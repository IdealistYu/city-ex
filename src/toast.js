// 底部提示条
import { $, narrowScreen } from './dom.js';

const el = $('#toast');
let timer = 0;

export const toast = (message, ms = 3000) => {
  el.textContent = message;
  // 窄屏时底部是面板，提示条放在面板上方
  el.style.bottom = narrowScreen.matches ? `${innerHeight - $('#panel').getBoundingClientRect().top + 12}px` : '';
  el.hidden = false;
  clearTimeout(timer);
  timer = setTimeout(() => { el.hidden = true; }, ms);
};
