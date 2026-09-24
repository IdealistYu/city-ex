// 页面级的小工具
export const $ = (sel, root = document) => root.querySelector(sel);

export const esc = s => String(s).replace(/[&<>"]/g, c => `&#${c.charCodeAt(0)};`);

// 与 style.css 的断点一致：窄屏时侧栏在底部、搜索框收起为图标
export const narrowScreen = matchMedia('(max-width: 700px)');
