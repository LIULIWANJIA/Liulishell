'use strict';
/**
 * 把 xterm 的浏览器产物复制到 renderer/vendor，保证离线可用、打包时可被 asar 收录。
 */
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const outDir = path.join(root, 'src', 'renderer', 'vendor');

const FILES = [
  ['node_modules/@xterm/xterm/lib/xterm.js', 'xterm.js'],
  ['node_modules/@xterm/xterm/css/xterm.css', 'xterm.css'],
  ['node_modules/@xterm/addon-fit/lib/addon-fit.js', 'addon-fit.js']
];

fs.mkdirSync(outDir, { recursive: true });

let missing = 0;
for (const [from, to] of FILES) {
  const src = path.join(root, from);
  const dst = path.join(outDir, to);
  if (!fs.existsSync(src)) {
    console.error('[vendor] 缺少文件: ' + from);
    missing++;
    continue;
  }
  fs.copyFileSync(src, dst);
  console.log('[vendor] ' + to + '  (' + Math.round(fs.statSync(dst).size / 1024) + ' KB)');
}

if (missing) {
  console.error('[vendor] 有 ' + missing + ' 个文件复制失败，请先执行 npm install');
  process.exitCode = 1;
} else {
  console.log('[vendor] 完成 -> ' + outDir);
}
