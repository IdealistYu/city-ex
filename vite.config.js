import { defineConfig } from 'vite';

// 相对路径部署：dist/ 可以放在任意子路径下（如 GitHub Pages 的 /仓库名/）
export default defineConfig({
  base: './',
});
