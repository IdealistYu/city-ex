// 触发浏览器下载。微信、微博、QQ 的内置浏览器不支持 <a download>，调用方需另行处理（展示图片或文本让用户长按/复制）
export const canDownload = () => !/weibo|micromessenger|qq\//i.test(navigator.userAgent);

export const download = (url, filename) => {
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
};
