// 数据备份界面：导出 / 导入 JSON（格式与解析见 backup.js）
import { allLevels, replaceAll } from './store.js';
import { toBackup, stringifyBackup, backupFileName, parseBackup } from './backup.js';
import { canDownload, download } from './download.js';
import { toast } from './toast.js';
import { $ } from './dom.js';

// ---------- 导出 ----------
const exportDialog = $('#export-dialog');
const exportText = exportDialog.querySelector('textarea');

$('#export-data').addEventListener('click', () => {
  const backup = toBackup(allLevels());
  if (!backup.cities.length) return toast('还没有标记任何城市');
  const text = stringifyBackup(backup);
  if (canDownload()) {
    const url = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
    download(url, backupFileName());
    setTimeout(() => URL.revokeObjectURL(url), 10000);
    toast(`已导出 ${backup.cities.length} 个城市`);
  } else {
    // 内置浏览器无法下载文件：展示文本让用户复制
    exportText.value = text;
    exportDialog.showModal();
  }
});

$('#copy-data').addEventListener('click', async () => {
  try {
    await navigator.clipboard.writeText(exportText.value);
  } catch {
    exportText.select();
    document.execCommand('copy'); // 旧版内置浏览器没有 clipboard API
  }
  toast('已复制');
});

// ---------- 导入 ----------
const importDialog = $('#import-dialog');
const importFile = $('#import-file');

$('#import-data').addEventListener('click', () => importFile.click());

// 合并：同一城市取较高的等级
const mergeLevels = (a, b) => {
  const out = { ...a };
  for (const [code, level] of Object.entries(b)) out[code] = Math.max(out[code] ?? 0, level);
  return out;
};

const describeSkipped = skipped => (skipped.length
  ? `，${skipped.length} 条无法识别：${skipped.slice(0, 3).join('、')}${skipped.length > 3 ? ' 等' : ''}`
  : '');

// 本机已有数据时询问合并还是替换，返回 'merge' | 'replace' | 其他（取消）
const askMode = (count, currentCount, skipped) => {
  importDialog.querySelector('.summary').textContent = `文件里有 ${count} 个城市，本机现有 ${currentCount} 个。`;
  const skippedEl = importDialog.querySelector('.skipped');
  skippedEl.hidden = !skipped.length;
  skippedEl.textContent = skipped.length ? `另有 ${skipped.length} 条无法识别，将被忽略：${skipped.join('、')}` : '';
  importDialog.returnValue = '';
  importDialog.showModal();
  return new Promise(resolve => importDialog.addEventListener('close', () => resolve(importDialog.returnValue), { once: true }));
};

importFile.addEventListener('change', async () => {
  const file = importFile.files[0];
  importFile.value = ''; // 允许重复选择同一个文件
  if (!file) return;

  let parsed;
  try {
    parsed = parseBackup(await file.text());
  } catch (err) {
    return toast(`导入失败：${err.message}`, 5000);
  }
  const { levels, skipped } = parsed;
  const count = Object.keys(levels).length;
  if (!count) return toast(`文件里没有可导入的城市${describeSkipped(skipped)}`, 5000);

  const current = allLevels();
  const currentCount = Object.keys(current).length;
  const mode = currentCount ? await askMode(count, currentCount, skipped) : 'replace';
  if (mode !== 'merge' && mode !== 'replace') return;

  replaceAll(mode === 'merge' ? mergeLevels(current, levels) : levels);
  toast(`已导入 ${count} 个城市${describeSkipped(skipped)}`, skipped.length ? 5000 : 3000);
});

// ---------- 清空 ----------
const clearDialog = $('#clear-dialog');

$('#clear-data').addEventListener('click', async () => {
  const count = Object.keys(allLevels()).length;
  if (!count) return toast('还没有标记任何城市');
  clearDialog.querySelector('.summary').textContent = `将删除本浏览器中保存的 ${count} 个城市标记，删除后无法恢复。建议先导出备份。`;
  clearDialog.returnValue = '';
  clearDialog.showModal();
  const choice = await new Promise(resolve => clearDialog.addEventListener('close', () => resolve(clearDialog.returnValue), { once: true }));
  if (choice === 'export') $('#export-data').click();
  if (choice === 'clear') {
    replaceAll({});
    toast(`已清空 ${count} 个城市的标记`);
  }
});
