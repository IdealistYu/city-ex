import { defineConfig } from 'vite';

// 样式只有几 KB：构建时直接内联进 index.html，省掉一次阻塞首屏渲染的请求。
// CSS 里的资源路径相对于 assets/，内联到根目录的 HTML 后要补上 assets/ 前缀
const inlineCss = () => ({
  name: 'inline-css',
  apply: 'build',
  enforce: 'post',
  generateBundle(_, bundle) {
    const html = bundle['index.html'];
    if (!html) return;
    for (const [name, file] of Object.entries(bundle)) {
      if (!name.endsWith('.css')) continue;
      const link = new RegExp(`<link rel="stylesheet"[^>]*href="\\./${name.replace(/[.$]/g, '\\$&')}"[^>]*>`);
      if (!link.test(html.source)) continue;
      const css = file.source.replace(/url\(\.\//g, 'url(./assets/');
      html.source = html.source.replace(link, () => `<style>${css}</style>`);
      delete bundle[name];
    }
  },
});

// 相对路径部署：dist/ 可以放在任意子路径下（如 GitHub Pages 的 /仓库名/）
export default defineConfig({
  base: './',
  plugins: [inlineCss()],
});
