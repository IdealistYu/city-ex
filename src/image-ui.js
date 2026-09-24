// "保存图片"按钮与导出结果弹层
import { allLevels } from './store.js';
import { exportImage } from './export.js';
import { $ } from './dom.js';

const output = $('#output');
const saveButton = $('#save');
const closeButton = output.querySelector('button');
let outputUrl = null;

export const isOutputOpen = () => !output.hidden;

export const closeOutput = () => {
  output.hidden = true;
  saveButton.focus();
};

saveButton.addEventListener('click', async () => {
  if (saveButton.disabled) return; // 生成中，防止重复点击
  saveButton.disabled = true;
  document.documentElement.dataset.busy = '';
  try {
    const url = await exportImage(allLevels());
    if (outputUrl) URL.revokeObjectURL(outputUrl); // 释放上一次导出的图片
    outputUrl = url;
    output.querySelector('img').src = url;
    output.hidden = false;
    closeButton.focus();
  } catch (err) {
    console.error(err);
    alert('图片生成失败，请重试');
  } finally {
    saveButton.disabled = false;
    delete document.documentElement.dataset.busy;
  }
});

closeButton.addEventListener('click', closeOutput);
output.addEventListener('click', e => { if (e.target === output) closeOutput(); }); // 点背景关闭
