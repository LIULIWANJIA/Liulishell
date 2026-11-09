'use strict';
/**
 * 目录列表缓存（文件管理器加速）
 *
 * 目标：进入已经看过的目录时立刻出结果，不再等 SFTP round-trip。
 * - 键：`host:port:user` + 绝对路径（同一台服务器重连后仍可命中）
 * - 内存 LRU（最多 MAX_DIRS 个目录），并异步落盘，重启后依然能秒开
 * - 只缓存只读的目录条目，任何写操作都会调用 invalidate() 让相关目录失效
 */
const fs = require('fs');
const path = require('path');
const { app } = require('electron');

const MAX_DIRS = 1500; // 最多缓存的目录数量
const MAX_ENTRIES = 5000; // 单个目录最多缓存的条目数（超大目录只取前 N 条）
const TTL = 7 * 24 * 60 * 60 * 1000; // 7 天后视为过期

const store = new Map(); // key -> { at, conn, dir, entries }
let loaded = false;
let saveTimer = null;

function filePath() {
  try {
    return path.join(app.getPath('userData'), 'liuli-dir-cache.json');
  } catch (_) {
    return '';
  }
}

function makeKey(connKey, dir) {
  return String(connKey || '') + '\u0000' + String(dir || '');
}

function touch(key, rec) {
  store.delete(key);
  store.set(key, rec);
}

function trim() {
  while (store.size > MAX_DIRS) {
    const oldest = store.keys().next();
    if (oldest.done) break;
    store.delete(oldest.value);
  }
}

function loadOnce() {
  if (loaded) return;
  loaded = true;
  const p = filePath();
  if (!p) return;
  try {
    if (!fs.existsSync(p)) return;
    const raw = JSON.parse(fs.readFileSync(p, 'utf8'));
    const now = Date.now();
    for (const rec of (raw && raw.dirs) || []) {
      if (!rec || !rec.conn || !rec.dir || !Array.isArray(rec.entries)) continue;
      if (now - Number(rec.at || 0) > TTL) continue;
      store.set(makeKey(rec.conn, rec.dir), rec);
    }
    trim();
  } catch (err) {
    console.error('[dircache] 读取失败:', err.message);
  }
}

function scheduleSave() {
  if (saveTimer) return;
  saveTimer = setTimeout(() => {
    saveTimer = null;
    const p = filePath();
    if (!p) return;
    try {
      const dirs = Array.from(store.values()).map((r) => ({
        at: r.at,
        conn: r.conn,
        dir: r.dir,
        entries: r.entries
      }));
      fs.mkdirSync(path.dirname(p), { recursive: true });
      const tmp = p + '.tmp';
      fs.writeFileSync(tmp, JSON.stringify({ version: 1, dirs }), 'utf8');
      fs.renameSync(tmp, p);
    } catch (err) {
      console.error('[dircache] 写入失败:', err.message);
    }
  }, 1200);
  if (saveTimer.unref) saveTimer.unref();
}

/** 读取缓存；未命中或过期返回 null */
function get(connKey, dir) {
  loadOnce();
  if (!connKey || !dir) return null;
  const key = makeKey(connKey, dir);
  const rec = store.get(key);
  if (!rec) return null;
  if (Date.now() - Number(rec.at || 0) > TTL) {
    store.delete(key);
    return null;
  }
  touch(key, rec);
  return rec;
}

/** 写入缓存（拷贝一份，避免调用方后续修改污染缓存） */
function set(connKey, dir, entries) {
  loadOnce();
  if (!connKey || !dir || !Array.isArray(entries)) return;
  const rec = {
    at: Date.now(),
    conn: String(connKey),
    dir: String(dir),
    entries: entries.slice(0, MAX_ENTRIES)
  };
  touch(makeKey(connKey, dir), rec);
  trim();
  scheduleSave();
}

/** 让某个目录失效（该目录本身 + 直接上级，上级的 mtime 会变） */
function invalidate(connKey, dir) {
  loadOnce();
  if (!connKey) return;
  const list = Array.isArray(dir) ? dir : [dir];
  for (const one of list) {
    const p = String(one || '');
    if (!p) continue;
    store.delete(makeKey(connKey, p));
    const parent = p.replace(/\/+$/, '').split('/').slice(0, -1).join('/') || '/';
    store.delete(makeKey(connKey, parent));
  }
  scheduleSave();
}

/** 清掉某台服务器的全部缓存（重命名/移动等难以精确判断的操作） */
function invalidateAll(connKey) {
  loadOnce();
  let n = 0;
  for (const [key, rec] of store) {
    if (rec.conn === connKey) {
      store.delete(key);
      n++;
    }
  }
  if (n) scheduleSave();
  return n;
}

/** 目录树节点用：判断是否有缓存（不刷新 LRU） */
function peek(connKey, dir) {
  loadOnce();
  const rec = store.get(makeKey(connKey, dir));
  return rec && Date.now() - Number(rec.at || 0) <= TTL ? rec : null;
}

function clear() {
  store.clear();
  scheduleSave();
}

function stats() {
  loadOnce();
  return { dirs: store.size, bytes: JSON.stringify(Array.from(store.values())).length };
}

module.exports = { get, set, peek, invalidate, invalidateAll, clear, stats, TTL };
