// 收集页面实际用到的中文字符（index.html + src 下的 js/json，去掉注释）。build-font 与 check 共用
import { readFile, readdir } from 'node:fs/promises';

const ROOT = new URL('../', import.meta.url);

// 中日韩统一表意文字 + CJK 标点 + 全角字符
const CJK = /[　-〿一-鿿＀-￯]/gu;

export const collectChars = async () => {
  const files = ['index.html'];
  for (const name of await readdir(new URL('src/', ROOT))) {
    if (/\.(js|json)$/.test(name)) files.push(`src/${name}`);
  }
  let text = '';
  for (const f of files) {
    let src = await readFile(new URL(f, ROOT), 'utf8');
    // 注释里的字不需要
    if (f.endsWith('.js')) src = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`])\/\/.*$/gm, '$1');
    if (f.endsWith('.html')) src = src.replace(/<!--[\s\S]*?-->/g, '');
    text += src;
  }
  return [...new Set(text.match(CJK))];
};
