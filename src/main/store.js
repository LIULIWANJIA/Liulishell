'use strict';
/**
 * 本地数据存储：连接配置 / 分组 / 快捷命令 / 设置
 * 密码、私钥、私钥口令使用 Electron safeStorage 加密后落盘，永不明文返回渲染进程。
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { app, safeStorage } = require('electron');

const MAX_SNIPPET_BOARDS = 30;
const RECYCLE_GROUP = '待回收';
const MAX_GROUP_LEVEL = 3;

function newGroupId() {
  return 'g-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 7);
}

function newFavoriteGroupId() {
  return 'fg-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 7);
}

/** 分组层级（一级=1），找不到返回 0 */
function groupLevel(groups, id) {
  const byId = new Map((groups || []).map((g) => [g.id, g]));
  let cur = byId.get(id);
  let level = 0;
  let guard = 0;
  while (cur && guard++ < 16) {
    level++;
    cur = cur.parentId ? byId.get(cur.parentId) : null;
  }
  return level;
}

/** 根到当前分组的名称路径（用于导出/同步时跨设备还原层级） */
function groupPath(groups, id) {
  const byId = new Map((groups || []).map((g) => [g.id, g]));
  const names = [];
  let cur = byId.get(id);
  let guard = 0;
  while (cur && guard++ < 16) {
    names.unshift(cur.name);
    cur = cur.parentId ? byId.get(cur.parentId) : null;
  }
  return names;
}

/** 迁移/清洗分组：补 parentId、去重复 id、断环、限制最多三级 */
function normalizeGroups(rawGroups, fallback) {
  const list = [];
  const seen = new Set();
  for (const raw of Array.isArray(rawGroups) ? rawGroups : []) {
    if (!raw || typeof raw !== 'object') continue;
    let id = String(raw.id || '').trim() || newGroupId();
    if (seen.has(id)) id = newGroupId();
    seen.add(id);
    list.push({
      id,
      name: String(raw.name || '').trim() || '未命名分组',
      parentId: raw.parentId ? String(raw.parentId) : ''
    });
  }
  if (!list.length) return (fallback || []).map((g) => Object.assign({}, g));
  const ids = new Set(list.map((g) => g.id));
  const byId = new Map(list.map((g) => [g.id, g]));
  for (const g of list) {
    if (g.parentId && (!ids.has(g.parentId) || g.parentId === g.id)) g.parentId = '';
  }
  for (const g of list) {
    let cur = byId.get(g.parentId);
    let level = 1;
    const chain = new Set([g.id]);
    let bad = false;
    while (cur) {
      if (chain.has(cur.id)) {
        bad = true;
        break;
      }
      chain.add(cur.id);
      level++;
      if (level > MAX_GROUP_LEVEL) {
        bad = true;
        break;
      }
      cur = cur.parentId ? byId.get(cur.parentId) : null;
    }
    if (bad) g.parentId = '';
  }
  return list;
}

function defaults() {
  return {
    groups: [{ id: 'g-default', name: '默认分组', parentId: '' }],
    connections: [],
    keys: [],
    cmdHistory: [],
    snippetBoards: [
      {
        id: 'b-common',
        name: '常用',
        items: [
          { id: 's1', name: '磁盘占用', command: 'df -h', autoRun: true },
          { id: 's2', name: '内存 TOP10', command: 'ps aux --sort=-%mem | head -n 10', autoRun: true },
          { id: 's3', name: 'CPU TOP10', command: 'ps aux --sort=-%cpu | head -n 10', autoRun: true },
          { id: 's4', name: '监听端口', command: 'ss -tunlp 2>/dev/null || netstat -tunlp', autoRun: true }
        ]
      },
      {
        id: 'b-ops',
        name: '运维',
        items: [
          { id: 's5', name: '查看系统版本', command: 'cat /etc/os-release | head -n 5', autoRun: true },
          { id: 's6', name: '实时日志', command: 'tail -f /var/log/syslog', autoRun: true }
        ]
      }
    ],
    settings: {
      fontSize: 13,
      monitorInterval: 1500,
      window: { width: 1240, height: 800, x: null, y: null },
      layout: null,
      theme: 'warm',
      netUnit: 'mbps',
      units: { global: 'mbps', chart: 'global', netDetail: 'global', downloads: 'global' },
      detailRefresh: 3000,
      downloadDir: '',
      proxies: [{ id: 'p-local-socks5', name: '本地Socks5', type: 'socks5', host: '127.0.0.1', port: 7890, user: '' }],
      defaultProxyId: 'p-local-socks5',
      proxySeeded: true,
      proxySecrets: {},
      webdav: { url: '', username: '', syncUser: '', remotePath: '', syncStatus: 'pending', lastSyncAt: 0, lastError: '' },
      webdavSecrets: {},
      connectHistory: [],
      wallpaper: '',
      fonts: {
        size: 13,
        en: 'Consolas, "Cascadia Mono", monospace',
        zh: '"Microsoft YaHei", "PingFang SC", sans-serif'
      },
      mouse: { middle: 'term-paste', right: 'term-menu' },
      shortcuts: { copy: 'Ctrl+C', paste: 'Ctrl+V', find: 'Ctrl+F', reconnect: 'Ctrl+Enter' },
      panels: {
        leftList: true,
        leftMonitors: true,
        leftFoot: true,
        tabs: true,
        cmdBar: true,
        rightInfo: true,
        cmdEditor: true,
        files: true,
        snippets: true
      },
      startDockedRight: true,
      dirSync: true,
      favorites: [],
      favoriteGroups: []
    }
  };
}

/** 嵌套设置做深合并，避免老配置文件缺少新字段 */
function normalizeSettings(raw) {
  const base = defaults().settings;
  const s = Object.assign({}, base, raw || {});
  for (const k of ['fonts', 'mouse', 'shortcuts', 'panels', 'window', 'units', 'webdav']) {
    s[k] = Object.assign({}, base[k], (raw && raw[k]) || {});
  }
  // 老配置迁移：netUnit=bytes -> 全局 MB/s
  if (!raw || !raw.units) {
    s.units = Object.assign({}, base.units);
    if (raw && raw.netUnit === 'bytes') s.units.global = 'mbytes';
  }
  // 首次运行/尚无代理：内置一个本地 SOCKS5；用户主动删除后不再自动添加
  if (!Array.isArray(s.proxies)) s.proxies = [];
  if (!s.proxies.length && !(raw && raw.proxySeeded)) {
    s.proxies = [{ id: 'p-local-socks5', name: '本地Socks5', type: 'socks5', host: '127.0.0.1', port: 7890, user: '' }];
    s.defaultProxyId = 'p-local-socks5';
    s.proxySeeded = true;
  }
  s.proxySecrets = Object.assign({}, (raw && raw.proxySecrets) || {});
  s.webdavSecrets = Object.assign({}, (raw && raw.webdavSecrets) || {});
  if (!Array.isArray(s.favorites)) s.favorites = [];
  if (!Array.isArray(s.favoriteGroups)) s.favoriteGroups = [];
  return s;
}

let cached = null;
let writeTimer = null;
const secretCache = new Map();

function filePath() {
  return path.join(app.getPath('userData'), 'liulishell-data.json');
}

function normalize(raw) {
  const base = defaults();
  if (!raw || typeof raw !== 'object') return base;
  const data = {
    groups: normalizeGroups(raw.groups, base.groups),
    connections: Array.isArray(raw.connections) ? raw.connections : [],
    keys: Array.isArray(raw.keys) ? raw.keys : [],
    cmdHistory: Array.isArray(raw.cmdHistory) ? raw.cmdHistory.slice(0, 300) : [],
    snippetBoards: Array.isArray(raw.snippetBoards) ? raw.snippetBoards.slice(0, MAX_SNIPPET_BOARDS) : base.snippetBoards,
    settings: normalizeSettings(raw.settings)
  };
  // 兜底：连接所属分组不存在时归到默认分组
  const ids = new Set(data.groups.map((g) => g.id));
  for (const c of data.connections) {
    if (!ids.has(c.group)) c.group = data.groups[0].id;
  }
  return data;
}

function load() {
  if (cached) return cached;
  const p = filePath();
  try {
    if (fs.existsSync(p)) {
      cached = normalize(JSON.parse(fs.readFileSync(p, 'utf8')));
    } else {
      cached = defaults();
      saveNow();
    }
  } catch (err) {
    console.error('[store] 读取失败:', err.message);
    // 数据文件损坏：先把坏文件改名留档（绝不覆盖），再尝试从 .bak 恢复
    try {
      if (fs.existsSync(p)) {
        const stamp = new Date().toISOString().replace(/[:.]/g, '-');
        fs.renameSync(p, `${p}.broken-${stamp}`);
        console.warn('[store] 损坏的数据文件已留档为', `${p}.broken-${stamp}`);
      }
    } catch (e2) {
      console.error('[store] 损坏文件留档失败:', e2.message);
    }
    cached = restoreFromBackup(p) || defaults();
  }
  return cached;
}

/** 从 .bak 恢复；成功则写回主文件 */
function restoreFromBackup(p) {
  const bak = p + '.bak';
  try {
    if (!fs.existsSync(bak)) return null;
    const data = normalize(JSON.parse(fs.readFileSync(bak, 'utf8')));
    console.warn('[store] 已从备份恢复数据:', bak);
    cached = data;
    saveNow();
    return data;
  } catch (err) {
    console.error('[store] 备份也无法读取:', err.message);
    return null;
  }
}

/** 覆盖写之前，把上一份「能正常解析」的数据留一份 .bak */
function backupCurrent(p, nextRaw) {
  try {
    if (!fs.existsSync(p)) return;
    const raw = fs.readFileSync(p, 'utf8');
    if (raw === nextRaw) return; // 内容没变，不必备份
    JSON.parse(raw); // 坏文件不覆盖备份
    const bak = p + '.bak';
    const tmp = bak + '.tmp';
    fs.writeFileSync(tmp, raw, 'utf8');
    fs.renameSync(tmp, bak);
  } catch (_) {
    /* 备份失败不影响主流程 */
  }
}

function saveNow() {
  try {
    const p = filePath();
    const tmp = p + '.tmp';
    const raw = JSON.stringify(cached, null, 2);
    fs.mkdirSync(path.dirname(p), { recursive: true });
    backupCurrent(p, raw);
    fs.writeFileSync(tmp, raw, 'utf8');
    fs.renameSync(tmp, p);
  } catch (err) {
    console.error('[store] 写入失败:', err.message);
  }
}

function save() {
  if (writeTimer) clearTimeout(writeTimer);
  writeTimer = setTimeout(() => {
    writeTimer = null;
    saveNow();
  }, 120);
}

/** safeStorage 的异步 API 在部分 Electron 版本返回 { shouldReEncrypt, result } 包装对象，这里统一取 Buffer */
function pickBuffer(out) {
  if (!out) return null;
  if (Buffer.isBuffer(out)) return out;
  if (typeof out === 'string') return Buffer.from(out, 'base64');
  if (Buffer.isBuffer(out.encryptedString)) return out.encryptedString;
  if (Buffer.isBuffer(out.result)) return out.result;
  if (typeof out.encryptedString === 'string') return Buffer.from(out.encryptedString, 'base64');
  if (typeof out.result === 'string') return Buffer.from(out.result, 'base64');
  return null;
}

/** 同理，解密结果可能是字符串，也可能是 { shouldReEncrypt, result } */
function pickString(out) {
  if (out == null) return '';
  if (typeof out === 'string') return out;
  if (Buffer.isBuffer(out)) return out.toString('utf8');
  if (typeof out.result === 'string') return out.result;
  if (Buffer.isBuffer(out.result)) return out.result.toString('utf8');
  if (typeof out.plainText === 'string') return out.plainText;
  return '';
}

/**
 * 机器级密钥：safeStorage 不可用时用于 AES 兜底加密。
 * 单独存放在独立文件（0600），避免密码以明文 base64 落盘。
 */
let _machineSecret = null;
function machineSecret() {
  if (_machineSecret) return _machineSecret;
  const file = path.join(app.getPath('userData'), '.msecret');
  try {
    if (fs.existsSync(file)) {
      const v = fs.readFileSync(file, 'utf8').trim();
      if (v.length >= 32) {
        _machineSecret = v;
        return v;
      }
    }
    const secret = crypto.randomBytes(32).toString('hex');
    try {
      fs.writeFileSync(file, secret, { mode: 0o600 });
    } catch (_) {}
    _machineSecret = secret;
    return secret;
  } catch (_) {
    return 'liuli-shell-local-secret';
  }
}

/** AES-256-GCM 兜底加密（key 由机器密钥 + 随机盐经 scrypt 派生） */
function aesEncrypt(value) {
  const salt = crypto.randomBytes(16);
  const key = crypto.scryptSync(machineSecret(), salt, 32);
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const enc = Buffer.concat([cipher.update(String(value), 'utf8'), cipher.final()]);
  return 'aes:' + Buffer.concat([salt, iv, cipher.getAuthTag(), enc]).toString('base64');
}

function aesDecrypt(payload) {
  const raw = Buffer.from(payload, 'base64');
  const salt = raw.slice(0, 16);
  const iv = raw.slice(16, 28);
  const tag = raw.slice(28, 44);
  const data = raw.slice(44);
  const key = crypto.scryptSync(machineSecret(), salt, 32);
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(data), decipher.final()]).toString('utf8');
}

async function encrypt(value) {
  if (!value) return '';
  try {
    if (
      typeof safeStorage.encryptStringAsync === 'function' &&
      typeof safeStorage.isAsyncEncryptionAvailable === 'function' &&
      safeStorage.isAsyncEncryptionAvailable()
    ) {
      const buf = pickBuffer(await safeStorage.encryptStringAsync(value));
      if (buf) return 'enc:' + buf.toString('base64');
    }
    if (safeStorage.isEncryptionAvailable()) {
      return 'enc:' + safeStorage.encryptString(value).toString('base64');
    }
  } catch (err) {
    console.error('[store] safeStorage 加密失败，改用 AES 兜底:', err.message);
  }
  // 兜底：AES-256-GCM + scrypt(机器密钥)，绝不明文 base64 落盘
  try {
    return aesEncrypt(value);
  } catch (err) {
    console.error('[store] AES 兜底加密失败:', err.message);
    return '';
  }
}

async function decrypt(value) {
  if (!value) return '';
  if (secretCache.has(value)) return secretCache.get(value);
  let result = '';
  try {
    if (value.startsWith('enc:')) {
      const buf = Buffer.from(value.slice(4), 'base64');
      // 新版本走异步 API（避免主线程被 KMS 阻塞），旧版本回退同步 API
      if (typeof safeStorage.decryptStringAsync === 'function') {
        const out = await safeStorage.decryptStringAsync(buf);
        result = pickString(out) || '';
      }
      if (!result) result = pickString(safeStorage.decryptString(buf));
    } else if (value.startsWith('aes:')) {
      result = aesDecrypt(value.slice(4));
    } else if (value.startsWith('b64:')) {
      // 兼容旧版本的 base64 兜底
      result = Buffer.from(value.slice(4), 'base64').toString('utf8');
    }
  } catch (err) {
    console.error('[store] 解密失败:', err.message);
  }
  if (result) secretCache.set(value, result);
  return result;
}

/* ---------------- 命令历史 ---------------- */

function listHistory() {
  return load().cmdHistory || [];
}

function addHistory(cmd) {
  const text = String(cmd || '');
  if (!text.trim()) return listHistory();
  const d = load();
  const next = (d.cmdHistory || []).filter((x) => x && x.cmd !== text);
  next.unshift({
    id: 'h-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 6),
    cmd: text,
    ts: Date.now()
  });
  d.cmdHistory = next.slice(0, 300);
  save();
  return d.cmdHistory;
}

function deleteHistory(id) {
  const d = load();
  d.cmdHistory = (d.cmdHistory || []).filter((x) => x.id !== id);
  save();
  return d.cmdHistory;
}

function clearHistory() {
  const d = load();
  d.cmdHistory = [];
  save();
  return d.cmdHistory;
}

/* ---------------- 代理 ---------------- */

async function saveProxy(input) {
  const d = load();
  d.settings.proxies = Array.isArray(d.settings.proxies) ? d.settings.proxies : [];
  d.settings.proxySecrets = d.settings.proxySecrets || {};
  const id = input.id || 'p-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 6);
  const rec = {
    id,
    name: String(input.name || '').trim() || `${input.type || 'http'}://${input.host}:${input.port}`,
    type: input.type === 'socks5' ? 'socks5' : 'http',
    host: String(input.host || '').trim(),
    port: Number(input.port) || 8080,
    user: String(input.user || '').trim()
  };
  const idx = d.settings.proxies.findIndex((p) => p.id === id);
  if (idx >= 0) d.settings.proxies[idx] = rec;
  else d.settings.proxies.push(rec);
  if (input.password !== undefined) {
    d.settings.proxySecrets[id] = input.password ? await encrypt(input.password) : '';
  }
  d.settings.proxySeeded = true;
  // 只有一个代理时它自动成为默认
  if (d.settings.proxies.length === 1) d.settings.defaultProxyId = id;
  else if (!d.settings.proxies.some((p) => p.id === d.settings.defaultProxyId)) {
    d.settings.defaultProxyId = d.settings.proxies[0] ? d.settings.proxies[0].id : '';
  }
  save();
  return { id, state: publicState() };
}

function deleteProxy(id) {
  const d = load();
  d.settings.proxies = (d.settings.proxies || []).filter((p) => p.id !== id);
  if (d.settings.proxySecrets) delete d.settings.proxySecrets[id];
  if (d.settings.defaultProxyId === id) {
    d.settings.defaultProxyId = d.settings.proxies.length ? d.settings.proxies[0].id : '';
  }
  d.settings.proxySeeded = true;
  d.connections.forEach((c) => { if (c.proxyId === id) c.proxyId = ''; });
  save();
  return publicState();
}

function setDefaultProxy(id) {
  const d = load();
  if ((d.settings.proxies || []).some((p) => p.id === id)) d.settings.defaultProxyId = id;
  save();
  return publicState();
}

/* ---------------- WebDAV 云同步配置 ---------------- */

const WEBDAV_SYNC_DIR = 'liuli-shell';

/** 同步用户名 → 固定目录下的文件名：用户名-12位派生串.lscfg（同一用户名在任何设备得到同一文件） */
function webdavRemotePath(syncUser) {
  const user = String(syncUser || '').trim();
  if (!user) return '';
  const safe = user.replace(/[^A-Za-z0-9._-]/g, '_').slice(0, 32) || 'user';
  const h = crypto.createHash('sha256').update('liuli-shell-sync-v1|' + user, 'utf8').digest();
  let n = 0n;
  for (let i = 0; i < 8; i++) n = (n << 8n) | BigInt(h[i]);
  const token = n.toString(36).padStart(12, '0').slice(-12);
  return `${WEBDAV_SYNC_DIR}/${safe}-${token}.lscfg`;
}

async function saveWebdav(input) {
  const d = load();
  const w = Object.assign(
    { url: '', username: '', syncUser: '', remotePath: '', syncStatus: 'pending', lastSyncAt: 0, lastError: '' },
    d.settings.webdav || {}
  );
  const beforeKey = `${w.url}\n${w.username}\n${w.syncUser || ''}`;
  if (input.url !== undefined) w.url = String(input.url || '').trim();
  if (input.username !== undefined) w.username = String(input.username || '').trim();
  if (input.syncUser !== undefined) w.syncUser = String(input.syncUser || '').trim();
  w.remotePath = w.syncUser ? webdavRemotePath(w.syncUser) : '';
  d.settings.webdav = w;
  d.settings.webdavSecrets = d.settings.webdavSecrets || {};
  let changed = false;
  if (input.password !== undefined) {
    d.settings.webdavSecrets.password = input.password ? await encrypt(String(input.password)) : '';
    changed = true;
  }
  if (input.syncPass !== undefined) {
    d.settings.webdavSecrets.syncPass = input.syncPass ? await encrypt(String(input.syncPass)) : '';
    changed = true;
  }
  const afterKey = `${w.url}\n${w.username}\n${w.syncUser || ''}`;
  if (changed || beforeKey !== afterKey) {
    w.syncStatus = 'pending';
    w.lastError = '';
  }
  save();
  return publicState();
}

/** 记录同步状态（pending / syncing / success / error），供左侧状态文字使用 */
function markWebdavSync(status, error) {
  const d = load();
  const w = Object.assign({}, d.settings.webdav || {});
  if (status === 'success') {
    w.syncStatus = 'success';
    w.lastSyncAt = Date.now();
    w.lastError = '';
  } else if (status === 'syncing') {
    w.syncStatus = 'syncing';
    w.lastError = '';
  } else {
    w.syncStatus = 'error';
    w.lastError = String(error || '同步失败');
  }
  d.settings.webdav = w;
  save();
}

/** 主进程使用：取出解密后的 WebDAV 连接参数 */
async function webdavConfig() {
  const d = load();
  const w = Object.assign(
    { url: '', username: '', syncUser: '', remotePath: '', syncStatus: 'pending', lastSyncAt: 0, lastError: '' },
    d.settings.webdav || {}
  );
  const sec = d.settings.webdavSecrets || {};
  return {
    url: w.url,
    username: w.username,
    syncUser: w.syncUser || '',
    remotePath: w.syncUser ? webdavRemotePath(w.syncUser) : '',
    password: await decrypt(sec.password),
    syncPass: await decrypt(sec.syncPass)
  };
}

/** 连接时解析代理（strict=true 时只用节点自己选择的代理，不回退默认代理） */
async function proxyFor(conn, strict) {
  const s = load().settings;
  const list = s.proxies || [];
  if (!conn || !conn.proxyEnabled || !list.length) return null;
  const one = list.length === 1 ? list[0] : null;
  const p = list.find((x) => x.id === conn.proxyId) || one || (strict ? null : list.find((x) => x.id === s.defaultProxyId)) || null;
  if (!p) return null;
  const enc = (s.proxySecrets || {})[p.id];
  const password = enc ? await decrypt(enc) : '';
  return Object.assign({}, p, { password });
}

/** 解析默认代理（忽略连接的 proxyEnabled 设置，用于「通过默认代理连接」） */
async function proxyByDefault() {
  const s = load().settings;
  const list = s.proxies || [];
  if (!list.length) return null;
  const p = list.find((x) => x.id === s.defaultProxyId) || list[0];
  if (!p) return null;
  const enc = (s.proxySecrets || {})[p.id];
  const password = enc ? await decrypt(enc) : '';
  return Object.assign({}, p, { password });
}

/* ---------------- 密钥库 ---------------- */

function fingerprintOf(privateKey) {
  try {
    return crypto
      .createHash('sha256')
      .update(String(privateKey || '').trim())
      .digest('hex')
      .slice(0, 16)
      .replace(/(.{2})(?=.)/g, '$1:');
  } catch (_) {
    return '';
  }
}

function keyTypeOf(privateKey) {
  const s = String(privateKey || '');
  if (/-----BEGIN OPENSSH PRIVATE KEY-----/.test(s)) return 'OpenSSH';
  if (/-----BEGIN RSA PRIVATE KEY-----/.test(s)) return 'RSA (PEM)';
  if (/-----BEGIN EC PRIVATE KEY-----/.test(s)) return 'ECDSA (PEM)';
  if (/-----BEGIN DSA PRIVATE KEY-----/.test(s)) return 'DSA (PEM)';
  if (/-----BEGIN PRIVATE KEY-----/.test(s)) return 'PKCS#8';
  if (/^PuTTY-User-Key-File/.test(s.trim())) return 'PuTTY (不支持，请转换)';
  return '未知';
}

async function upsertKey(input) {
  const d = load();
  const now = Date.now();
  const name = String((input && input.name) || '').trim();
  if (!name) throw new Error('请填写密钥名称');
  let rec = input && input.id ? d.keys.find((k) => k.id === input.id) : null;
  if (!rec) {
    rec = { id: 'k-' + now.toString(36) + '-' + Math.random().toString(36).slice(2, 6), createdAt: now };
    d.keys.push(rec);
  }
  rec.name = name;
  if (input.privateKey !== undefined) {
    const raw = String(input.privateKey || '').trim();
    if (!raw && !rec.privateKey) throw new Error('请粘贴或选择私钥内容');
    if (raw) {
      rec.privateKey = await encrypt(raw);
      rec.fingerprint = fingerprintOf(raw);
      rec.keyType = keyTypeOf(raw);
    }
  }
  if (input.passphrase !== undefined) {
    rec.passphrase = input.passphrase ? await encrypt(input.passphrase) : '';
  }
  save();
  return { id: rec.id, state: publicState() };
}

function deleteKey(id) {
  const d = load();
  d.keys = d.keys.filter((k) => k.id !== id);
  // 引用该密钥的连接退回“手动粘贴”模式，避免连接时找不到密钥
  d.connections.forEach((c) => {
    if (c.keyId === id) {
      c.keyId = '';
      delete c.keyId;
    }
  });
  save();
  return publicState();
}

function getKey(id) {
  return load().keys.find((k) => k.id === id) || null;
}

async function keySecret(id) {
  const rec = getKey(id);
  if (!rec) return null;
  return { privateKey: await decrypt(rec.privateKey), passphrase: await decrypt(rec.passphrase) };
}

function publicKeyView(k) {
  return {
    id: k.id,
    name: k.name,
    keyType: k.keyType || '',
    fingerprint: k.fingerprint || '',
    hasPassphrase: !!k.passphrase,
    createdAt: k.createdAt,
    usedBy: load().connections.filter((c) => c.keyId === k.id).length
  };
}

/** 返回给渲染进程的安全视图：不含任何凭据 */
function publicState() {
  const d = load();
  return {
    groups: d.groups,
    connections: d.connections.map((c) => ({
      id: c.id,
      name: c.name,
      group: c.group,
      host: c.host,
      port: c.port,
      user: c.user,
      authType: c.authType,
      keyPath: c.keyPath || '',
      keyId: c.keyId || '',
      proxyEnabled: !!c.proxyEnabled,
      proxyId: c.proxyId || '',
      clearMotd: c.clearMotd !== false,
      hasPassword: !!c.password,
      hasPrivateKey: !!c.privateKey,
      hasPassphrase: !!c.passphrase,
      createdAt: c.createdAt,
      lastUsed: c.lastUsed
    })),
    keys: d.keys.map(publicKeyView),
    snippetBoards: d.snippetBoards,
    settings: publicSettings(d)
  };
}

/** 设置视图：代理 / WebDAV 密码不出现在渲染进程 */
function publicSettings(d) {
  const s = Object.assign({}, load().settings);
  const secrets = s.proxySecrets || {};
  s.proxies = (s.proxies || []).map((p) => Object.assign({}, p, { hasAuth: !!secrets[p.id] }));
  delete s.proxySecrets;
  const wsec = s.webdavSecrets || {};
  s.webdav = Object.assign(
    { url: '', username: '', syncUser: '', remotePath: '', syncStatus: 'pending', lastSyncAt: 0, lastError: '' },
    s.webdav || {},
    { hasPassword: !!wsec.password, hasSyncPass: !!wsec.syncPass }
  );
  delete s.webdavSecrets;
  // 同步基线只是标识清单，不需要下发给渲染进程
  delete s.syncBaseline;
  return s;
}

function getConnection(id) {
  return load().connections.find((c) => c.id === id) || null;
}

async function secretsOf(conn) {
  const out = {
    password: await decrypt(conn.password),
    privateKey: await decrypt(conn.privateKey),
    passphrase: await decrypt(conn.passphrase)
  };
  // 引用密钥库时以密钥库内容为准（密钥库支持命名与复用）
  if (conn.authType === 'key' && conn.keyId) {
    const fromLib = await keySecret(conn.keyId);
    if (fromLib && fromLib.privateKey) {
      out.privateKey = fromLib.privateKey;
      if (fromLib.passphrase) out.passphrase = fromLib.passphrase;
    }
  }
  return out;
}

/** 连接的缓存/收藏标识：主机 + 端口 + 用户名 */
function connKeyOf(c) {
  return `${String((c && c.host) || '')}:${Number((c && c.port) || 22) || 22}:${String((c && c.user) || '')}`;
}

/**
 * 服务器地址变更（改 IP / 端口 / 用户名）后，把归属该配置的收藏一起迁到新的连接标识。
 * 否则旧收藏仍挂在老 host 上，界面上就表现为「收藏文件夹凭空消失」。
 */
function migrateFavoritesOfConnection(d, conn, fromKey) {
  const list = Array.isArray(d.settings.favorites) ? d.settings.favorites : [];
  const toKey = connKeyOf(conn);
  if (!fromKey || fromKey === toKey) return 0;
  const owns = (f) => (f.connId ? f.connId === conn.id : f.server === fromKey);
  let moved = 0;
  for (const f of list) {
    if (!f || !owns(f)) continue;
    f.server = toKey;
    f.host = conn.host;
    f.port = conn.port;
    f.user = conn.user;
    f.connId = conn.id;
    moved++;
  }
  if (moved) {
    // 改地址后又手动收藏过同一目录 → 同路径只保留最新一条，避免出现重复行
    const keep = new Map();
    for (const f of list) {
      if (!f || f.connId !== conn.id) continue;
      const p = String(f.path || '');
      const cur = keep.get(p);
      if (!cur || Number(f.createdAt || 0) > Number(cur.createdAt || 0)) keep.set(p, f);
    }
    d.settings.favorites = list.filter((f) => {
      if (!f || f.connId !== conn.id) return true;
      return keep.get(String(f.path || '')) === f;
    });
  }
  return moved;
}

async function upsertConnection(input) {
  const d = load();
  const now = Date.now();
  let conn = input.id ? d.connections.find((c) => c.id === input.id) : null;
  const fromKey = conn ? connKeyOf(conn) : '';
  if (!conn) {
    conn = { id: 'c-' + now.toString(36) + '-' + Math.random().toString(36).slice(2, 6), createdAt: now };
    d.connections.push(conn);
  }
  conn.name = (input.name || '').trim() || input.host;
  conn.group = input.group || d.groups[0].id;
  conn.host = (input.host || '').trim();
  conn.port = Number(input.port) || 22;
  conn.user = (input.user || '').trim() || 'root';
  conn.authType = input.authType === 'key' ? 'key' : 'password';
  if (input.proxyEnabled !== undefined) conn.proxyEnabled = !!input.proxyEnabled;
  if (input.proxyId !== undefined) conn.proxyId = String(input.proxyId || '');
  if (input.clearMotd !== undefined) conn.clearMotd = input.clearMotd !== false;
  if (input.keyPath !== undefined) conn.keyPath = input.keyPath;
  if (input.keyId !== undefined) {
    if (input.keyId) conn.keyId = String(input.keyId);
    else delete conn.keyId;
  }

  // 密码/私钥：只有显式传入新值才覆盖；传空字符串表示清除
  if (input.password !== undefined) conn.password = input.password ? await encrypt(input.password) : '';
  if (input.privateKey !== undefined) conn.privateKey = input.privateKey ? await encrypt(input.privateKey) : '';
  if (input.passphrase !== undefined) conn.passphrase = input.passphrase ? await encrypt(input.passphrase) : '';

  // 地址变了：收藏跟着走，同时丢掉旧地址的目录缓存
  if (fromKey && fromKey !== connKeyOf(conn)) {
    migrateFavoritesOfConnection(d, conn, fromKey);
    try {
      require('./dircache').invalidateAll(fromKey);
    } catch (_) {}
  }

  save();
  return { id: conn.id, state: publicState() };
}

function deleteConnection(id) {
  const d = load();
  d.connections = d.connections.filter((c) => c.id !== id);
  save();
  return publicState();
}

function touchConnection(id) {
  const c = getConnection(id);
  if (c) {
    c.lastUsed = Date.now();
    save();
  }
}

function upsertGroup(group) {
  const d = load();
  const name = String((group && group.name) || '').trim();
  if (!name) throw new Error('分组名不能为空');
  if (group.id) {
    const g = d.groups.find((x) => x.id === group.id);
    if (!g) throw new Error('分组不存在');
    g.name = name;
    if (group.parentId !== undefined) {
      const parentId = group.parentId ? String(group.parentId) : '';
      if (parentId) {
        if (!d.groups.some((x) => x.id === parentId)) throw new Error('上级分组不存在');
        if (groupLevel(d.groups, parentId) >= MAX_GROUP_LEVEL) throw new Error('最多支持三级分组');
      }
      g.parentId = parentId;
    }
  } else {
    const parentId = group.parentId ? String(group.parentId) : '';
    if (parentId) {
      if (!d.groups.some((x) => x.id === parentId)) throw new Error('上级分组不存在');
      if (groupLevel(d.groups, parentId) >= MAX_GROUP_LEVEL) throw new Error('最多支持三级分组');
    }
    d.groups.push({ id: newGroupId(), name, parentId });
  }
  save();
  return publicState();
}

/** 删除分组及其子分组：组内配置统一移动到「待回收」（不存在则自动创建） */
function dropGroupTree(d, id) {
  const group = d.groups.find((g) => g.id === id);
  if (!group) return false;

  const ids = new Set([id]);
  let changed = true;
  while (changed) {
    changed = false;
    for (const g of d.groups) {
      if (!ids.has(g.id) && ids.has(g.parentId)) {
        ids.add(g.id);
        changed = true;
      }
    }
  }

  const affected = d.connections.filter((c) => ids.has(c.group));
  if (affected.length) {
    let recycle = d.groups.find((g) => !g.parentId && g.name === RECYCLE_GROUP);
    if (!recycle) {
      recycle = { id: newGroupId(), name: RECYCLE_GROUP, parentId: '' };
      d.groups.push(recycle);
    }
    affected.forEach((c) => {
      c.group = recycle.id;
    });
  }

  d.groups = d.groups.filter((g) => !ids.has(g.id));
  if (Array.isArray(d.settings && d.settings.collapsedGroups)) {
    d.settings.collapsedGroups = d.settings.collapsedGroups.filter((gid) => !ids.has(gid));
  }
  return true;
}

function deleteGroup(id) {
  const d = load();
  const group = d.groups.find((g) => g.id === id);
  if (!group) return publicState();
  if (!group.parentId && group.name === RECYCLE_GROUP) throw new Error(`「${RECYCLE_GROUP}」分组不可删除`);
  if (d.groups.length <= 1) throw new Error('至少保留一个分组');
  dropGroupTree(d, id);
  save();
  return publicState();
}

function saveSnippetBoards(boards) {
  const d = load();
  if (!Array.isArray(boards)) throw new Error('参数错误');
  d.snippetBoards = boards.slice(0, MAX_SNIPPET_BOARDS);
  save();
  return publicState();
}

function patchSettings(patch) {
  const d = load();
  d.settings = Object.assign({}, d.settings, patch || {});
  save();
  return d.settings;
}

/** 清空全部软件数据：先关闭并清除 WebDAV，再重置为出厂状态 */
function clearAllData() {
  const d = load();
  const windowBounds = d.settings && d.settings.window;
  d.settings.webdav = {
    url: '',
    username: '',
    syncUser: '',
    remotePath: '',
    syncStatus: 'pending',
    lastSyncAt: 0,
    lastError: ''
  };
  d.settings.webdavSecrets = {};
  if (writeTimer) {
    clearTimeout(writeTimer);
    writeTimer = null;
  }
  saveNow();

  const base = defaults();
  if (windowBounds) base.settings.window = windowBounds;
  cached = base;
  secretCache.clear();
  saveNow();
  return publicState();
}

async function exportBundle() {
  const d = load();
  const conns = [];
  const proxies = [];
  for (const p of d.settings.proxies || []) {
    const sec = (d.settings.proxySecrets || {})[p.id];
    proxies.push({
      name: p.name,
      type: p.type === 'socks5' ? 'socks5' : 'http',
      host: p.host,
      port: Number(p.port) || 8080,
      user: p.user || '',
      password: sec ? await decrypt(sec) : ''
    });
  }
  for (const c of d.connections) {
    const sec = await secretsOf(c);
    const g = d.groups.find((x) => x.id === c.group);
    const keyRec = c.keyId ? d.keys.find((k) => k.id === c.keyId) : null;
    const proxyRec = c.proxyId ? (d.settings.proxies || []).find((p) => p.id === c.proxyId) : null;
    conns.push({
      name: c.name,
      group: g ? g.name : '默认分组',
      groupPath: groupPath(d.groups, c.group),
      host: c.host,
      port: c.port,
      user: c.user,
      authType: c.authType,
      keyPath: c.keyPath || '',
      keyName: keyRec ? keyRec.name : '',
      keyFingerprint: keyRec ? keyRec.fingerprint || '' : '',
      password: sec.password,
      privateKey: sec.privateKey,
      passphrase: sec.passphrase,
      clearMotd: c.clearMotd !== false,
      proxyEnabled: !!c.proxyEnabled,
      proxyName: proxyRec ? proxyRec.name : ''
    });
  }
  // 密钥库一并导出（重名密钥在下一次导入时复用）
  const keys = [];
  for (const k of d.keys) {
    const sec = await keySecret(k.id);
    keys.push({
      name: k.name,
      privateKey: (sec && sec.privateKey) || '',
      passphrase: (sec && sec.passphrase) || '',
      fingerprint: k.fingerprint || '',
      keyType: k.keyType || ''
    });
  }
  // 快捷命令一并同步（按板块名称 + 命令文本去重）
  const snippetBoards = (d.snippetBoards || []).map((b) => ({
    name: b.name,
    items: (b.items || []).map((it) => ({ name: it.name || '', command: it.command || '', autoRun: it.autoRun !== false }))
  }));
  const favoriteGroups = ((d.settings && d.settings.favoriteGroups) || []).map((g) => ({
    id: g.id,
    name: g.name,
    order: Number(g.order) || 0
  }));
  const favGroupIds = new Set(favoriteGroups.map((g) => g.id));
  const favorites = ((d.settings && d.settings.favorites) || []).map((f) => ({
    id: f.id,
    server: f.server,
    host: f.host,
    port: f.port,
    user: f.user || '',
    name: f.name,
    path: f.path,
    groupId: favGroupIds.has(f.groupId) ? f.groupId : '',
    createdAt: f.createdAt
  }));
  return {
    groups: d.groups.map((g) => ({ name: g.name, path: groupPath(d.groups, g.id) })),
    connections: conns,
    keys,
    proxies,
    snippetBoards,
    favorites,
    favoriteGroups
  };
}

/** 按名称路径查找/创建分组（最多三级），返回最末级分组 id */
function ensureGroupPath(d, names) {
  let parentId = '';
  let level = 0;
  for (const rawName of names || []) {
    const name = String(rawName || '').trim();
    if (!name) continue;
    if (level >= MAX_GROUP_LEVEL) break;
    let group = d.groups.find((g) => (g.parentId || '') === parentId && g.name === name);
    if (!group) {
      group = { id: newGroupId(), name, parentId };
      d.groups.push(group);
    }
    parentId = group.id;
    level++;
  }
  return parentId;
}

/** 合并导入：分组按层级/名称复用，连接按 host+port+user 去重 */
async function importBundle(bundle) {
  const d = load();
  const groupsIn = (bundle && bundle.groups) || [];
  groupsIn.forEach((g) => {
    const pathNames = Array.isArray(g && g.path) && g.path.length
      ? g.path.map((n) => String(n || '').trim()).filter(Boolean)
      : [String((g && g.name) || '').trim()].filter(Boolean);
    if (pathNames.length) ensureGroupPath(d, pathNames);
  });

  // 先导入密钥库：按名称复用，重名则跳过
  const keyNameToId = new Map(d.keys.map((k) => [k.name, k.id]));
  for (const k of (bundle && bundle.keys) || []) {
    const name = String((k && k.name) || '').trim();
    if (!name || !k.privateKey) continue;
    if (keyNameToId.has(name)) continue;
    const rec = {
      id: 'k-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 6),
      createdAt: Date.now(),
      name,
      privateKey: await encrypt(String(k.privateKey)),
      fingerprint: k.fingerprint || fingerprintOf(k.privateKey),
      keyType: k.keyType || keyTypeOf(k.privateKey)
    };
    if (k.passphrase) rec.passphrase = await encrypt(String(k.passphrase));
    d.keys.push(rec);
    keyNameToId.set(name, rec.id);
  }

  // 再导入代理：按名称复用，重名则跳过；连接按代理名称关联
  d.settings.proxies = Array.isArray(d.settings.proxies) ? d.settings.proxies : [];
  d.settings.proxySecrets = d.settings.proxySecrets || {};
  const proxyNameToId = new Map(d.settings.proxies.map((p) => [p.name, p.id]));
  for (const p of (bundle && bundle.proxies) || []) {
    const name = String((p && p.name) || '').trim();
    if (!name || !p.host) continue;
    if (proxyNameToId.has(name)) continue;
    const id = 'p-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 6);
    d.settings.proxies.push({
      id,
      name,
      type: p.type === 'socks5' ? 'socks5' : 'http',
      host: String(p.host || '').trim(),
      port: Number(p.port) || 8080,
      user: String(p.user || '').trim()
    });
    if (p.password) d.settings.proxySecrets[id] = await encrypt(String(p.password));
    proxyNameToId.set(name, id);
  }

  let added = 0;
  let skipped = 0;
  for (const c of (bundle && bundle.connections) || []) {
    if (!c || !c.host || !c.user) {
      skipped++;
      continue;
    }
    const port = Number(c.port) || 22;
    if (d.connections.some((x) => x.host === c.host && Number(x.port) === port && x.user === c.user)) {
      skipped++;
      continue;
    }
    const pathNames = Array.isArray(c.groupPath) && c.groupPath.length
      ? c.groupPath.map((n) => String(n || '').trim()).filter(Boolean)
      : [];
    const groupId = pathNames.length
      ? ensureGroupPath(d, pathNames)
      : (d.groups.find((g) => !g.parentId && g.name === (c.group || '默认分组')) || d.groups[0]).id;
    const boundKeyId = c.keyName ? keyNameToId.get(c.keyName) || '' : '';
    const boundProxyId = c.proxyName ? proxyNameToId.get(c.proxyName) || '' : '';
    d.connections.push({
      id: 'c-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 6),
      createdAt: Date.now(),
      name: c.name || c.host,
      group: groupId,
      host: c.host,
      port,
      user: c.user,
      authType: c.authType === 'key' ? 'key' : 'password',
      keyPath: c.keyPath || '',
      keyId: boundKeyId,
      password: c.password ? await encrypt(c.password) : '',
      privateKey: c.privateKey ? await encrypt(c.privateKey) : '',
      passphrase: c.passphrase ? await encrypt(c.passphrase) : '',
      clearMotd: c.clearMotd !== false,
      proxyEnabled: !!c.proxyEnabled,
      proxyId: boundProxyId
    });
    added++;
  }

  // 收藏分组（仅一级）与收藏文件夹：按名称 / 服务器+路径合并
  d.settings.favoriteGroups = Array.isArray(d.settings.favoriteGroups) ? d.settings.favoriteGroups : [];
  d.settings.favorites = Array.isArray(d.settings.favorites) ? d.settings.favorites : [];
  const favGroupMap = new Map();
  let favoriteGroupsAdded = 0;
  for (const g of (bundle && bundle.favoriteGroups) || []) {
    const name = String((g && g.name) || '').trim();
    if (!name) continue;
    let local = d.settings.favoriteGroups.find((x) => x.name === name);
    if (!local) {
      local = { id: newFavoriteGroupId(), name, order: Number(g.order) || 0 };
      d.settings.favoriteGroups.push(local);
      favoriteGroupsAdded++;
    }
    if (g.id) favGroupMap.set(String(g.id), local.id);
  }
  const favoriteKeys = new Set(
    d.settings.favorites.map((f) => `${String(f.server || '')}\n${String(f.path || '')}`)
  );
  let favoritesAdded = 0;
  for (const f of (bundle && bundle.favorites) || []) {
    if (!f || !f.path || !f.server) continue;
    const key = `${String(f.server)}\n${String(f.path)}`;
    if (favoriteKeys.has(key)) continue;
    favoriteKeys.add(key);
    const remoteGroupId = f.groupId ? String(f.groupId) : '';
    d.settings.favorites.push({
      id: 'f-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 6),
      server: String(f.server),
      host: String(f.host || ''),
      port: Number(f.port) || 22,
      user: String(f.user || ''),
      name: String(f.name || f.path).trim() || String(f.path),
      path: String(f.path),
      groupId: remoteGroupId && favGroupMap.has(remoteGroupId) ? favGroupMap.get(remoteGroupId) : '',
      createdAt: Number(f.createdAt) || Date.now()
    });
    favoritesAdded++;
  }

  // 快捷命令：板块按名称复用，命令文本去重
  let snippetsAdded = 0;
  for (const b of (bundle && bundle.snippetBoards) || []) {
    const bname = String((b && b.name) || '').trim() || '云端导入';
    let board = (d.snippetBoards || []).find((x) => x.name === bname);
    if (!board) {
      board = { id: 'b-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 5), name: bname, items: [] };
      d.snippetBoards = d.snippetBoards || [];
      d.snippetBoards.push(board);
    }
    board.items = board.items || [];
    for (const it of (b && b.items) || []) {
      const command = String((it && it.command) || '').trim();
      if (!command) continue;
      if (board.items.some((x) => String(x.command || '').trim() === command)) continue;
      board.items.push({
        id: 's-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 5),
        name: String((it && it.name) || command.split(/\s+/)[0] || '命令'),
        command,
        autoRun: it.autoRun !== false
      });
      snippetsAdded++;
    }
  }
  save();
  return { added, skipped, snippetsAdded, favoritesAdded, favoriteGroupsAdded, state: publicState() };
}

/* ---------------- 云同步：基线三路合并（支持删除同步） ---------------- */

/**
 * 每条数据的稳定标识（不包含任何凭据，可以安全地存在本地设置里）：
 * - 连接：主机 + 端口 + 用户名
 * - 分组：层级名称路径（如「生产环境/华东」）
 * - 密钥：名称
 * - 快捷命令：板块名 + 命令文本
 * - 收藏：服务器标识 + 路径
 */
function identityOfConnection(c) {
  return `${String((c && c.host) || '')}|${Number((c && c.port) || 22)}|${String((c && c.user) || '')}`;
}
function identityOfGroupPath(names) {
  return (names || []).map((n) => String(n || '').trim()).filter(Boolean).join('/');
}
function identityOfGroup(g) {
  return Array.isArray(g && g.path) && g.path.length
    ? identityOfGroupPath(g.path)
    : identityOfGroupPath([(g && g.name) || '']);
}
function identityOfSnippet(board, command) {
  return `${String(board || '').trim()}\u0000${String(command || '').trim()}`;
}
function identityOfFavorite(f) {
  return `${String((f && f.server) || '')}\u0000${String((f && f.path) || '')}`;
}

/** 把一份导出包压成「标识清单」，用于对比增删 */
function indexOfBundle(bundle) {
  const b = bundle || {};
  const out = {
    at: 0,
    connections: [],
    groups: [],
    keys: [],
    snippets: [],
    snippetBoards: [],
    favorites: [],
    favoriteGroups: []
  };
  for (const c of b.connections || []) if (c && c.host && c.user) out.connections.push(identityOfConnection(c));
  for (const g of b.groups || []) {
    const p = identityOfGroup(g);
    if (p) out.groups.push(p);
  }
  for (const k of b.keys || []) if (k && k.name) out.keys.push(String(k.name));
  for (const board of b.snippetBoards || []) {
    const name = String((board && board.name) || '').trim();
    if (name) out.snippetBoards.push(name);
    for (const it of (board && board.items) || []) {
      if (it && it.command) out.snippets.push(identityOfSnippet(name, it.command));
    }
  }
  for (const f of b.favorites || []) if (f && f.server && f.path) out.favorites.push(identityOfFavorite(f));
  for (const g of b.favoriteGroups || []) if (g && g.name) out.favoriteGroups.push(String(g.name));
  return out;
}

function toSet(list) {
  return new Set(Array.isArray(list) ? list : []);
}

function queryIndex(idx) {
  const i = idx || {};
  return {
    connections: toSet(i.connections),
    groups: toSet(i.groups),
    keys: toSet(i.keys),
    snippets: toSet(i.snippets),
    snippetBoards: toSet(i.snippetBoards),
    favorites: toSet(i.favorites),
    favoriteGroups: toSet(i.favoriteGroups)
  };
}

const EMPTY_SYNC_STATS = () => ({
  baselineAt: 0,
  firstSync: false,
  removedLocal: { connections: 0, groups: 0, snippets: 0, favorites: 0, keys: 0, favoriteGroups: 0 },
  removedRemote: { connections: 0, groups: 0, snippets: 0, favorites: 0, keys: 0, favoriteGroups: 0 }
});

function removeLocalConnection(d, identity) {
  const i = d.connections.findIndex((c) => identityOfConnection(c) === identity);
  if (i < 0) return false;
  d.connections.splice(i, 1);
  return true;
}

function findLocalGroupPath(d, p) {
  return (d.groups || []).find((g) => identityOfGroupPath(groupPath(d.groups, g.id)) === p) || null;
}

function removeLocalSnippet(d, boardName, command) {
  const board = (d.snippetBoards || []).find((b) => String(b.name || '').trim() === boardName);
  if (!board) return false;
  const before = (board.items || []).length;
  board.items = (board.items || []).filter((it) => String(it.command || '').trim() !== command);
  return board.items.length !== before;
}

function removeLocalKeyByName(d, name) {
  const k = (d.keys || []).find((x) => String(x.name || '') === name);
  if (!k) return false;
  d.keys = d.keys.filter((x) => x.id !== k.id);
  d.connections.forEach((c) => {
    if (c.keyId === k.id) {
      c.keyId = '';
      delete c.keyId;
    }
  });
  return true;
}

function removeLocalFavorite(d, identity) {
  const list = d.settings.favorites || [];
  const i = list.findIndex((f) => identityOfFavorite(f) === identity);
  if (i < 0) return false;
  list.splice(i, 1);
  return true;
}

function removeLocalFavoriteGroup(d, name) {
  const groups = d.settings.favoriteGroups || [];
  const g = groups.find((x) => String(x.name || '') === name);
  if (!g) return false;
  d.settings.favoriteGroups = groups.filter((x) => x !== g);
  d.settings.favorites = (d.settings.favorites || []).map((f) =>
    f.groupId === g.id ? Object.assign({}, f, { groupId: '' }) : f
  );
  return true;
}

/**
 * 以「上次同步成功时的清单」为基线，做三路合并：
 *   基线有 → 本机没有 → 云端有  = 本机删除了，把云端也删掉
 *   基线有 → 云端没有 → 本机有  = 别处删除了，本机同步删除
 *   基线没有 → 某一侧有         = 新增，合并进另一侧
 * 结果写回本地数据，并刷新基线；返回本次同步明细。
 */
async function syncMerge(remoteInput) {
  const d = load();
  const stats = EMPTY_SYNC_STATS();
  const remote =
    remoteInput && typeof remoteInput === 'object' && Object.keys(remoteInput).length
      ? JSON.parse(JSON.stringify(remoteInput))
      : null;

  // 基线只在「合并结果成功上传到云端之后」才落库（见 commitSyncBaseline），
  // 否则上传失败时基线会领先于云端，下次同步会把本地删除又当成"云端新增"合并回来。
  const pendingIndex = async () => {
    const idx = indexOfBundle(await exportBundle());
    idx.at = Date.now();
    return idx;
  };

  // 云端还没有配置：不判断删除，直接记录基线（稍后由调用方全量上传）
  if (!remote) {
    return Object.assign({ added: 0, skipped: 0, snippetsAdded: 0, favoritesAdded: 0, favoriteGroupsAdded: 0 }, stats, {
      pendingBaseline: await pendingIndex(),
      state: publicState()
    });
  }

  const base = d.settings.syncBaseline && Number(d.settings.syncBaseline.at) ? d.settings.syncBaseline : null;
  // 没有历史基线（升级后第一次同步 / 换设备）时无法判断哪一侧"删除"过，只能合并
  stats.firstSync = !base;
  const localBundle = await exportBundle();
  const L = queryIndex(indexOfBundle(localBundle));
  const R = queryIndex(indexOfBundle(remote));

  if (base) {
    const B = queryIndex(base);

    /* ---- 1. 云端删除 → 本机同步删除 ---- */
    for (const id of B.connections) {
      if (L.connections.has(id) && !R.connections.has(id) && removeLocalConnection(d, id)) {
        stats.removedLocal.connections++;
      }
    }
    for (const p of B.groups) {
      if (!L.groups.has(p) || R.groups.has(p)) continue;
      const g = findLocalGroupPath(d, p);
      if (g && dropGroupTree(d, g.id)) stats.removedLocal.groups++;
    }
    for (const name of B.snippetBoards) {
      if (L.snippetBoards.has(name) || !R.snippetBoards.has(name)) continue;
      const before = (d.snippetBoards || []).length;
      d.snippetBoards = (d.snippetBoards || []).filter((b) => String(b.name || '').trim() !== name);
      if (d.snippetBoards.length !== before) stats.removedLocal.snippets++;
    }
    for (const id of B.snippets) {
      if (L.snippets.has(id) || !R.snippets.has(id)) continue;
      const [board, cmd] = String(id).split('\u0000');
      if (removeLocalSnippet(d, board, cmd)) stats.removedLocal.snippets++;
    }
    for (const id of B.favorites) {
      if (L.favorites.has(id) && !R.favorites.has(id) && removeLocalFavorite(d, id)) stats.removedLocal.favorites++;
    }
    for (const name of B.favoriteGroups) {
      if (L.favoriteGroups.has(name) && !R.favoriteGroups.has(name) && removeLocalFavoriteGroup(d, name)) {
        stats.removedLocal.favoriteGroups++;
      }
    }
    for (const name of B.keys) {
      if (L.keys.has(name) && !R.keys.has(name) && removeLocalKeyByName(d, name)) stats.removedLocal.keys++;
    }

    /* ---- 2. 本机删除 → 从云端清单里剔除，避免同步时被写回 ---- */
    remote.connections = (remote.connections || []).filter((c) => {
      const id = identityOfConnection(c);
      if (B.connections.has(id) && !L.connections.has(id)) {
        stats.removedRemote.connections++;
        return false;
      }
      return true;
    });

    const goneGroups = new Set();
    for (const p of B.groups) {
      if (!L.groups.has(p) && R.groups.has(p)) {
        goneGroups.add(p);
        stats.removedRemote.groups++;
      }
    }
    if (goneGroups.size) {
      remote.groups = (remote.groups || []).filter((g) => !goneGroups.has(identityOfGroup(g)));
      // 云端仍挂在这些分组下的连接改挂「待回收」，否则导入时会按路径把分组建回来
      for (const c of remote.connections || []) {
        const p = identityOfGroupPath(Array.isArray(c.groupPath) && c.groupPath.length ? c.groupPath : [c.group]);
        if (!p) continue;
        for (const gp of goneGroups) {
          if (p === gp || p.startsWith(gp + '/')) {
            c.groupPath = [RECYCLE_GROUP];
            break;
          }
        }
      }
    }

    remote.snippetBoards = (remote.snippetBoards || []).filter((b) => {
      const name = String((b && b.name) || '').trim();
      if (B.snippetBoards.has(name) && !L.snippetBoards.has(name)) {
        stats.removedRemote.snippets += (b.items || []).length;
        return false;
      }
      return true;
    });
    for (const b of remote.snippetBoards) {
      b.items = (b.items || []).filter((it) => {
        const id = identityOfSnippet(b.name, it && it.command);
        if (B.snippets.has(id) && !L.snippets.has(id)) {
          stats.removedRemote.snippets++;
          return false;
        }
        return true;
      });
    }

    remote.keys = (remote.keys || []).filter((k) => {
      const name = String((k && k.name) || '');
      if (B.keys.has(name) && !L.keys.has(name)) {
        stats.removedRemote.keys++;
        return false;
      }
      return true;
    });

    remote.favorites = (remote.favorites || []).filter((f) => {
      const id = identityOfFavorite(f);
      if (B.favorites.has(id) && !L.favorites.has(id)) {
        stats.removedRemote.favorites++;
        return false;
      }
      return true;
    });
    const goneFavGroups = new Set();
    remote.favoriteGroups = (remote.favoriteGroups || []).filter((g) => {
      const name = String((g && g.name) || '');
      if (B.favoriteGroups.has(name) && !L.favoriteGroups.has(name)) {
        goneFavGroups.add(g.id);
        stats.removedRemote.favoriteGroups++;
        return false;
      }
      return true;
    });
    if (goneFavGroups.size) {
      for (const f of remote.favorites || []) if (goneFavGroups.has(f.groupId)) f.groupId = '';
    }
  }

  /* ---- 3. 合并（新增项按标识去重，不覆盖本机已有内容） ---- */
  const merged = await importBundle(remote);
  const pendingBaseline = await pendingIndex();
  return Object.assign({}, merged, stats, {
    pendingBaseline,
    baselineAt: Number(pendingBaseline.at) || 0,
    state: publicState()
  });
}

/** 云端上传成功后提交基线（下次同步据此判断增删） */
function commitSyncBaseline(index) {
  if (!index || !Array.isArray(index.connections)) return 0;
  const d = load();
  d.settings.syncBaseline = index;
  save();
  return Number(index.at) || Date.now();
}

module.exports = {
  load,
  save,
  saveNow,
  publicState,
  getConnection,
  secretsOf,
  upsertConnection,
  deleteConnection,
  touchConnection,
  upsertGroup,
  deleteGroup,
  groupLevel,
  saveSnippetBoards,
  patchSettings,
  clearAllData,
  upsertKey,
  deleteKey,
  saveProxy,
  deleteProxy,
  setDefaultProxy,
  proxyFor,
  proxyByDefault,
  listHistory,
  addHistory,
  deleteHistory,
  clearHistory,
  getKey,
  keySecret,
  encrypt,
  decrypt,
  exportBundle,
  importBundle,
  syncMerge,
  commitSyncBaseline,
  saveWebdav,
  markWebdavSync,
  webdavConfig,
  webdavRemotePath
};
