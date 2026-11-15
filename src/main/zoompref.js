'use strict';
/* ============================================================
 * 界面缩放偏好（独立存储，刻意不放进 liulishell-data.json）
 *
 * 为什么不放配置文件：
 *   缩放设成 200% 后页面会放大，用户可能点不到设置项；如果这个值又跟着
 *   配置一起被云同步、导出、导入、重装继承，就彻底没法自救了。
 *   所以单独存一个纯文本文件，并且优先放在「安装目录」——
 *   卸载 / 重装 / 换新包解压时目录被整体替换，缩放自然回到 100%。
 *
 * 位置策略：
 *   1. 便携版：exe 同级的 PORTABLE_EXECUTABLE_DIR
 *   2. 安装版：exe 所在目录（NSIS 安装目录 / Linux /opt 等）
 *   3. 上面不可写（Program Files、macOS .app 内部、只读 U 盘）时，
 *      退回 userData 目录；此时由安装器的卸载脚本负责删除。
 *
 * 文件内容就是一行数字，例如 "125"，方便用户自己改回去。
 * ============================================================ */
const { app } = require('electron');
const path = require('path');
const fs = require('fs');

const FILE_NAME = 'zoom.conf';
const LEVELS = [100, 110, 125, 150, 175, 200];
const DEFAULT_PERCENT = 100;

let cachedPath = '';

function normalize(value) {
  const n = Math.round(Number(value));
  if (!Number.isFinite(n)) return DEFAULT_PERCENT;
  // 只接受 90% ~ 300% 之间的值，越界视为损坏，回到 100%
  if (n < 90 || n > 300) return DEFAULT_PERCENT;
  return n;
}

function dirWritable(dir) {
  if (!dir) return false;
  try {
    const probe = path.join(dir, '.liuli-zoom-probe-' + process.pid);
    fs.writeFileSync(probe, 'x');
    fs.unlinkSync(probe);
    return true;
  } catch (_) {
    return false;
  }
}

/** 计算并缓存存储路径；优先安装目录（随卸载 / 重装重置） */
function filePath() {
  if (cachedPath) return cachedPath;

  // 调试 / 高级用法：显式指定文件位置
  if (process.env.LIULI_ZOOM_FILE) {
    cachedPath = process.env.LIULI_ZOOM_FILE;
    return cachedPath;
  }

  const candidates = [];
  if (process.env.PORTABLE_EXECUTABLE_DIR) {
    candidates.push(process.env.PORTABLE_EXECUTABLE_DIR);
  }
  try {
    candidates.push(path.dirname(app.getPath('exe')));
  } catch (_) {}

  for (const dir of candidates) {
    if (dirWritable(dir)) {
      cachedPath = path.join(dir, FILE_NAME);
      return cachedPath;
    }
  }

  try {
    const ud = app.getPath('userData');
    fs.mkdirSync(ud, { recursive: true });
    cachedPath = path.join(ud, FILE_NAME);
  } catch (_) {
    cachedPath = path.join(process.cwd(), FILE_NAME);
  }
  return cachedPath;
}

function readPercent() {
  try {
    const raw = fs.readFileSync(filePath(), 'utf8').trim();
    if (!raw) return DEFAULT_PERCENT;
    // 兼容写成 JSON 的情况：{"percent":125}
    if (raw.startsWith('{')) {
      try {
        return normalize((JSON.parse(raw) || {}).percent);
      } catch (_) {
        return DEFAULT_PERCENT;
      }
    }
    return normalize(parseInt(raw, 10));
  } catch (_) {
    return DEFAULT_PERCENT;
  }
}

function writePercent(percent) {
  const p = normalize(percent);
  try {
    fs.writeFileSync(filePath(), String(p) + '\n', 'utf8');
  } catch (_) {
    return false;
  }
  return true;
}

/** 清掉文件，回到默认 100% */
function clear() {
  try {
    fs.unlinkSync(filePath());
  } catch (_) {}
  return DEFAULT_PERCENT;
}

module.exports = {
  LEVELS,
  DEFAULT_PERCENT,
  normalize,
  filePath,
  readPercent,
  writePercent,
  clear
};
