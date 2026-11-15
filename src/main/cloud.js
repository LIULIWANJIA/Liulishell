'use strict';
/* 云账号与云同步：登录 / 注册 / 邮箱验证码 / 多设备自动同步 */

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { app, net, session } = require('electron');
const store = require('./store');

/** 主地址 + 备用地址，请求失败时自动切换 */
const API_BASES = (process.env.LIULI_API_BASE
  ? [process.env.LIULI_API_BASE]
  : ['https://shellcloud.minecft.cn', 'https://shellcloudbac.minecft.cn']
).map((s) => String(s).trim().replace(/\/+$/, '')).filter(Boolean);
const API_BASE = API_BASES[0];
let activeBase = API_BASE;
const AUTO_INTERVAL = 5 * 60 * 1000; // 定时自动同步
const CHANGE_DEBOUNCE = 6000; // 本机改动后延迟合并同步
const MAX_CONFLICT_RETRY = 3;

function syncKey(email) {
  return crypto.createHash('sha256').update('liuli-cloud-sync|' + String(email || '').trim().toLowerCase()).digest();
}

function encryptSyncBundle(text, email) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', syncKey(email), iv);
  const data = Buffer.concat([cipher.update(String(text), 'utf8'), cipher.final()]);
  return { t: 's', v: 1, d: Buffer.concat([iv, cipher.getAuthTag(), data]).toString('base64') };
}

function decryptSyncBundle(payload, email) {
  const buf = Buffer.from(String((payload && payload.d) || ''), 'base64');
  const iv = buf.subarray(0, 12);
  const tag = buf.subarray(12, 28);
  const data = buf.subarray(28);
  const decipher = crypto.createDecipheriv('aes-256-gcm', syncKey(email), iv);
  decipher.setAuthTag(tag);
  return JSON.parse(Buffer.concat([decipher.update(data), decipher.final()]).toString('utf8'));
}

let account = null;
let accountLoaded = false;
let syncing = false;
/** 清空数据期间禁止启动新的同步（包括启动后延迟的首次同步） */
let clearing = false;
let autoTimer = null;
let changeTimer = null;
let startupTimer = null;
let listeners = [];
let lastError = '';
/** 站点信息（名称 / 最新版本），登录框与账号面板使用 */
let siteInfo = { siteName: '', latestVersion: '', versionNote: '' };

/* ---------------- 本地凭据 ---------------- */

function accountFile() {
  return path.join(app.getPath('userData'), 'liulishell-account.json');
}

function deviceFile() {
  return path.join(app.getPath('userData'), 'liulishell-device.json');
}

let deviceCache = '';

/** 安装标识：与账号解绑，退出登录也不会变，用于统计安装数与启动次数 */
function installId() {
  if (deviceCache) return deviceCache;
  try {
    const raw = JSON.parse(fs.readFileSync(deviceFile(), 'utf8'));
    if (raw && /^[A-Za-z0-9_-]{8,64}$/.test(raw.installId || '')) {
      deviceCache = raw.installId;
      return deviceCache;
    }
  } catch (_) {}
  deviceCache = crypto.randomBytes(16).toString('hex');
  try {
    fs.writeFileSync(deviceFile(), JSON.stringify({ installId: deviceCache, createdAt: Date.now() }, null, 2), 'utf8');
  } catch (_) {}
  return deviceCache;
}

function sealToken(token) {
  // 兼容旧文件格式的读取；新写入统一走 store.encrypt（异步）
  return String(token || '');
}

async function loadAccount() {
  if (accountLoaded) return account;
  accountLoaded = true;
  try {
    const raw = JSON.parse(fs.readFileSync(accountFile(), 'utf8'));
    let token = '';
    try {
      token = raw.token ? await store.decrypt(String(raw.token)) : '';
    } catch (_) {
      token = '';
    }
    account = token
      ? {
        token,
        email: String(raw.email || ''),
        userId: Number(raw.userId) || 0,
        createdAt: Number(raw.createdAt) || 0,
        expiresAt: Number(raw.expiresAt) || 0,
        serviceExpiresAt: Number(raw.serviceExpiresAt) || 0,
        usedPercent: Number(raw.usedPercent) || 0,
        syncRev: Number(raw.syncRev) || 0,
        isAdmin: !!raw.isAdmin
      }
      : null;
  } catch (_) {
    account = null;
  }
  if (account && account.expiresAt && account.expiresAt < Date.now()) account = null;
  return account;
}

/** 已登录账号（同步读取：仅在 loadAccount 之后可用） */
function accountNow() {
  return account;
}

async function saveAccount(acc) {
  account = acc;
  accountLoaded = true;
  if (!acc) {
    try { fs.unlinkSync(accountFile()); } catch (_) {}
    return;
  }
  let sealed = '';
  try { sealed = await store.encrypt(acc.token); } catch (_) { sealed = sealToken(acc.token); }
  const payload = {
    token: sealed,
    email: acc.email,
    userId: acc.userId,
    createdAt: acc.createdAt,
    expiresAt: acc.expiresAt,
    serviceExpiresAt: acc.serviceExpiresAt || 0,
    usedPercent: Number(acc.usedPercent) || 0,
    syncRev: Number(acc.syncRev) || 0,
    isAdmin: !!acc.isAdmin,
    savedAt: Date.now()
  };
  try {
    fs.mkdirSync(path.dirname(accountFile()), { recursive: true });
    fs.writeFileSync(accountFile(), JSON.stringify(payload, null, 2), 'utf8');
  } catch (_) {}
}

/* ---------------- 事件广播 ---------------- */

function onChange(fn) {
  if (typeof fn === 'function') listeners.push(fn);
}

function notify(meta) {
  listeners.forEach((fn) => {
    try { fn(meta || {}); } catch (_) {}
  });
}

/* ---------------- HTTP ---------------- */

function netError(err) {
  const msg = String((err && err.message) || err || '');
  if (/ECONNREFUSED|ECONNRESET|ENOTFOUND|EAI_AGAIN|fetch failed|network|timeout|ETIMEDOUT|aborted|ERR_[A-Z_]+|net::/i.test(msg)) {
    return '无法连接云服务，请检查网络或稍候片刻';
  }
  return msg || '云服务请求失败';
}

const cloudSessions = new Map();
let proxyLoginBound = false;
let proxyCred = null;

function bindProxyLogin() {
  if (proxyLoginBound) return;
  proxyLoginBound = true;
  app.on('login', (event, webContents, details, authInfo, callback) => {
    if (!authInfo || !authInfo.isProxy || !proxyCred) return;
    event.preventDefault();
    callback(proxyCred.user, proxyCred.password);
  });
}

function cloudSession(mode, proxy) {
  const key = mode + (proxy ? ':' + proxy.type + ':' + proxy.host + ':' + proxy.port : '');
  const cached = cloudSessions.get(key);
  if (cached) return cached;
  const task = (async () => {
    const sess = session.fromPartition('liuli-cloud-' + key.replace(/[^A-Za-z0-9]+/g, '-'));
    if (mode === 'direct') await sess.setProxy({ mode: 'direct' });
    else if (mode === 'system') await sess.setProxy({ mode: 'system' });
    else {
      const rules = proxy.type === 'socks5'
        ? `socks5://${proxy.host}:${proxy.port}`
        : `http://${proxy.host}:${proxy.port}`;
      await sess.setProxy({ mode: 'fixed_servers', proxyRules: rules });
      if (proxy.user) {
        proxyCred = { user: proxy.user, password: proxy.password || '' };
        bindProxyLogin();
      }
    }
    return sess;
  })().catch((err) => {
    cloudSessions.delete(key);
    throw err;
  });
  cloudSessions.set(key, task);
  return task;
}

function netRequest(urlStr, o, sess, timeoutMs) {
  return new Promise((resolve, reject) => {
    let done = false;
    let timer = null;
    const finish = (fn, val) => {
      if (done) return;
      done = true;
      if (timer) clearTimeout(timer);
      fn(val);
    };
    let req;
    try {
      req = net.request({ url: urlStr, method: o.method || 'GET', session: sess, useSessionCookies: false });
    } catch (err) {
      finish(reject, err);
      return;
    }
    Object.keys(o.headers || {}).forEach((k) => {
      try { req.setHeader(k, String(o.headers[k])); } catch (_) {}
    });
    timer = setTimeout(() => {
      try { req.abort(); } catch (_) {}
      finish(reject, new Error('timeout'));
    }, Math.max(1000, Number(timeoutMs) || 20000));
    req.on('response', (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(Buffer.from(c)));
      res.on('end', () => finish(resolve, {
        status: res.statusCode,
        text: Buffer.concat(chunks).toString('utf8')
      }));
      res.on('error', (err) => finish(reject, err));
    });
    req.on('error', (err) => finish(reject, err));
    req.on('abort', () => finish(reject, new Error('aborted')));
    if (o.body) req.write(o.body);
    req.end();
  });
}

/** 直连 → 系统代理 → 软件默认代理，全部失败才视为异常 */
async function rawRequest(urlStr, o) {
  if (!app.isReady()) await app.whenReady();
  const timeout = Number(o.timeout) || 20000;
  const steps = [
    async () => netRequest(urlStr, o, await cloudSession('direct'), timeout),
    async () => netRequest(urlStr, o, await cloudSession('system'), Math.min(10000, timeout))
  ];
  let proxy = null;
  try { proxy = await store.proxyByDefault(); } catch (_) { proxy = null; }
  if (proxy && proxy.host) {
    steps.push(async () => netRequest(urlStr, o, await cloudSession('custom', proxy), Math.min(10000, timeout)));
  }
  let last = null;
  for (const step of steps) {
    try {
      return await step();
    } catch (err) {
      last = err;
    }
  }
  throw last || new Error('fetch failed');
}

async function request(pathname, opts) {
  const o = opts || {};
  const headers = Object.assign({ Accept: 'application/json' }, o.headers || {});
  if (o.token) headers.Authorization = 'Bearer ' + o.token;
  headers['X-Liuli-Device'] = installId();
  let body = null;
  if (o.body !== undefined) {
    headers['Content-Type'] = 'application/json';
    body = JSON.stringify(o.body);
  }
  // 优先当前可用地址，失败时轮换到其余地址（主 → 备用）
  const order = API_BASES.slice();
  const idx = order.indexOf(activeBase);
  if (idx > 0) order.splice(0, 0, ...order.splice(idx, 1));
  let res = null;
  let lastErr = null;
  for (const base of order) {
    try {
      res = await rawRequest(base + pathname, {
        method: o.method || 'GET',
        headers,
        body,
        timeout: o.timeout || 20000
      });
      activeBase = base;
      break;
    } catch (err) {
      lastErr = err;
    }
  }
  if (!res) throw new Error(netError(lastErr));
  let data = {};
  try { data = res.text ? JSON.parse(res.text) : {}; } catch (_) { data = {}; }
  if (res.status < 200 || res.status >= 300) {
    const err = new Error((data && data.error) || `云服务返回 HTTP ${res.status}`);
    err.status = res.status;
    err.data = data;
    throw err;
  }
  return data;
}

async function tokenOrThrow() {
  const acc = await loadAccount();
  if (!acc || !acc.token) throw new Error('请先登录云服务账号');
  return acc;
}

/* ---------------- 账号 ---------------- */

function accountView() {
  const acc = accountNow();
  const cloud = (store.load().settings.cloud || {});
  return {
    loggedIn: !!acc,
    email: acc ? acc.email : '',
    userId: acc ? acc.userId : 0,
    createdAt: acc ? acc.createdAt : 0,
    expiresAt: acc ? acc.expiresAt : 0,
    serviceExpiresAt: acc ? (acc.serviceExpiresAt || 0) : 0,
    usedPercent: acc ? (Number(acc.usedPercent) || 0) : 0,
    syncRev: acc ? (Number(acc.syncRev) || 0) : 0,
    isAdmin: acc ? !!acc.isAdmin : false,
    inviteCode: acc ? (acc.inviteCode || '') : '',
    invitedCount: acc ? (Number(acc.invitedCount) || 0) : 0,
    inviteRewards: acc ? (Number(acc.inviteRewards) || 0) : 0,
    inviteRewardDays: acc ? (Number(acc.inviteRewardDays) || 0) : 0,
    inviteRewardMax: acc ? (Number(acc.inviteRewardMax) || 0) : 0,
    apiBase: activeBase,
    installId: installId(),
    site: {
      siteName: siteInfo.siteName,
      latestVersion: siteInfo.latestVersion,
      versionNote: siteInfo.versionNote
    },
    cloud: {
      enabled: !!cloud.enabled,
      email: cloud.email || (acc ? acc.email : ''),
      syncStatus: cloud.syncStatus || 'idle',
      lastSyncAt: Number(cloud.lastSyncAt) || 0,
      lastError: cloud.lastError || ''
    }
  };
}

function applySite(site) {
  if (!site) return;
  siteInfo = {
    siteName: site.siteName || siteInfo.siteName,
    latestVersion: site.latestVersion !== undefined ? site.latestVersion : siteInfo.latestVersion,
    versionNote: site.versionNote !== undefined ? site.versionNote : siteInfo.versionNote
  };
}

async function applyUserInfo(user) {
  if (!user) return;
  applySite(user.site);
  const acc = await loadAccount();
  if (!acc) return;
  await saveAccount(Object.assign({}, acc, {
    email: user.email || acc.email,
    userId: user.id || acc.userId,
    createdAt: Number(user.createdAt) || acc.createdAt,
    serviceExpiresAt: Number(user.expiresAt) || 0,
    usedPercent: Number(user.usedPercent) || 0,
    syncRev: Number(user.syncRev) || 0,
    isAdmin: !!user.isAdmin,
    inviteCode: user.inviteCode || acc.inviteCode || '',
    invitedCount: Number(user.invitedCount) || 0,
    inviteRewards: Number(user.inviteRewards) || 0,
    inviteRewardDays: Number(user.inviteRewardDays) || 0,
    inviteRewardMax: Number(user.inviteRewardMax) || 0
  }));
}

async function afterLogin(data) {
  const user = data.user || {};
  clearing = false;
  applySite(user.site);
  await saveAccount({
    token: data.token,
    email: user.email || '',
    userId: Number(user.id) || 0,
    createdAt: Number(user.createdAt) || 0,
    expiresAt: Number(data.expiresAt) || 0,
    serviceExpiresAt: Number(user.expiresAt) || 0,
    usedPercent: Number(user.usedPercent) || 0,
    syncRev: Number(user.syncRev) || 0,
    isAdmin: !!user.isAdmin,
    inviteCode: user.inviteCode || '',
    invitedCount: Number(user.invitedCount) || 0,
    inviteRewards: Number(user.inviteRewards) || 0,
    inviteRewardDays: Number(user.inviteRewardDays) || 0,
    inviteRewardMax: Number(user.inviteRewardMax) || 0
  });
  // 登录后默认不开启云同步，仅记录邮箱；旧账号的同步基线作废
  store.clearSyncBaseline('cloudBaseline');
  store.saveCloud({
    enabled: false,
    email: user.email || '',
    syncStatus: 'idle',
    lastSyncAt: 0,
    lastError: ''
  });
  notify();
  return accountView();
}

async function bootstrap() {
  const r = await request('/api/auth/bootstrap');
  siteInfo = {
    siteName: r.siteName || '',
    latestVersion: r.latestVersion || '',
    versionNote: r.versionNote || ''
  };
  return r;
}

async function sendCode(email) {
  return request('/api/auth/send-code', { method: 'POST', body: { email: String(email || '').trim() } });
}

async function register(payload) {
  const data = await request('/api/auth/register', {
    method: 'POST',
    body: {
      email: String((payload && payload.email) || '').trim(),
      password: String((payload && payload.password) || ''),
      code: String((payload && payload.code) || '').trim(),
      inviteCode: String((payload && payload.inviteCode) || '').trim()
    }
  });
  const view = await afterLogin(data);
  bootstrap().then(() => notify()).catch(() => {});
  return view;
}

async function login(payload) {
  const data = await request('/api/auth/login', {
    method: 'POST',
    body: {
      email: String((payload && payload.email) || '').trim(),
      password: String((payload && payload.password) || '')
    }
  });
  const view = await afterLogin(data);
  refreshMe().catch(() => {});
  bootstrap().then(() => notify()).catch(() => {});
  return view;
}

async function refreshMe() {
  const acc = await loadAccount();
  if (!acc) return null;
  try {
    const data = await request('/api/me', { token: acc.token });
    await applyUserInfo(data.user);
    notify();
    return data.user;
  } catch (err) {
    if (err.status === 401) {
      await saveAccount(null);
      store.saveCloud({ enabled: false, email: '', syncStatus: 'idle', lastSyncAt: 0, lastError: '' });
      notify();
    }
    throw err;
  }
}

/** 清理流程最多等待网络多久，避免离线时清空数据被云服务请求长时间阻塞 */
function settleWithin(promise, ms) {
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, ms);
    const done = () => { clearTimeout(timer); resolve(); };
    promise.then(done, done);
  });
}

async function logout(opts) {
  const quick = !!(opts && opts.quick);
  if (quick) clearing = true;
  stopAutoSync();
  const acc = await loadAccount();
  if (acc && acc.token) {
    // 只退出当前会话，不关闭账号级云同步；其他设备仍可继续同步
    const done = (async () => {
      try {
        await request('/api/auth/logout', {
          method: 'POST', token: acc.token, timeout: quick ? 4000 : 20000
        });
      } catch (_) {}
    })();
    if (quick) await settleWithin(done, 8000);
    else await done;
  }
  await saveAccount(null);
  store.saveCloud({ enabled: false, email: '', syncStatus: 'idle', lastSyncAt: 0, lastError: '' });
  notify();
  return accountView();
}

/** 启动统计：每次启动上报一次，用于后台「安装数 / 启动次数」 */
async function hello(version, platform) {
  try {
    const acc = accountNow();
    await request('/api/client/hello', {
      method: 'POST',
      token: acc ? acc.token : undefined,
      body: { installId: installId(), version: String(version || ''), platform: String(platform || '') }
    });
  } catch (_) {}
}

/* ---------------- 云同步 ---------------- */

function stopAutoSync() {
  if (autoTimer) {
    clearInterval(autoTimer);
    autoTimer = null;
  }
  if (changeTimer) {
    clearTimeout(changeTimer);
    changeTimer = null;
  }
  if (startupTimer) {
    clearTimeout(startupTimer);
    startupTimer = null;
  }
}

function startAutoSync() {
  stopAutoSync();
  if (clearing) return;
  const cloud = store.load().settings.cloud || {};
  if (!cloud.enabled || !accountNow()) return;
  autoTimer = setInterval(() => {
    syncNow({ silent: true }).catch(() => {});
  }, AUTO_INTERVAL);
  if (autoTimer.unref) autoTimer.unref();
}

/** 本机数据改动后延迟合并同步，避免频繁上传 */
function scheduleSync() {
  if (clearing) return;
  const cloud = store.load().settings.cloud || {};
  if (!cloud.enabled || !accountNow()) return;
  if (changeTimer) clearTimeout(changeTimer);
  changeTimer = setTimeout(() => {
    changeTimer = null;
    syncNow({ silent: true }).catch(() => {});
  }, CHANGE_DEBOUNCE);
  if (changeTimer.unref) changeTimer.unref();
}

/**
 * 客户端开关只控制本机是否参与官方云同步，不调用任何账号级开关接口。
 * 账号是否允许云同步由服务端用户中心管理。
 */
async function setSyncEnabled(enabled) {
  const acc = await tokenOrThrow();
  if (enabled) {
    clearing = false;
    const exp = Number(acc.serviceExpiresAt) || 0;
    if (exp > 0 && exp <= Date.now()) throw new Error('云服务已到期，请先续费后再开启云同步');
    store.saveCloud({ enabled: true, email: acc.email, syncStatus: 'pending', lastError: '' });
    // 两种云同步互斥：官方云启用成功后关闭 WebDAV
    await store.saveWebdav({ enabled: false });
    notify();
    startAutoSync();
    scheduleSync();
    return accountView();
  }
  stopAutoSync();
  store.saveCloud({ enabled: false, email: acc.email, syncStatus: 'idle', lastError: '' });
  notify();
  return accountView();
}

/** 只关闭本机云同步，不请求服务端（WebDAV 开启时互斥调用） */
async function disableForWebdav() {
  const cloud = store.load().settings.cloud || {};
  if (!cloud.enabled) return false;
  stopAutoSync();
  store.saveCloud({ enabled: false, syncStatus: 'idle', lastError: '' });
  notify();
  return true;
}

async function syncNow(opts) {
  if (clearing) throw new Error('正在清空数据，请稍后再试');
  const silent = !!(opts && opts.silent);
  const acc = await tokenOrThrow();
  const serviceExp = Number(acc.serviceExpiresAt) || 0;
  if (serviceExp > 0 && serviceExp <= Date.now()) {
    throw new Error('云服务已到期，请先续费后再同步');
  }
  const cloud = store.load().settings.cloud || {};
  if (!cloud.enabled) throw new Error('云同步未开启，请先在账号面板中打开');
  if (syncing) {
    if (silent) return { ok: false, busy: true };
    throw new Error('正在同步，请稍后再试');
  }
  syncing = true;
  lastError = '';
  store.markCloudSync('syncing');
  notify();

  let added = 0;
  let attempt = 0;
  let dataChanged = false;
  try {
    for (;;) {
      attempt++;
      // 1. 拉取云端最新版本
      const remote = await request('/api/sync', { token: acc.token, timeout: 30000, headers: { 'X-Liuli-Sync-Enc': '1' } });
      const remoteBundle = remote.bundleEnc ? decryptSyncBundle(remote.bundleEnc, acc.email) : remote.bundle;
      // 2. 与本机做三路合并（以 cloudBaseline 为基线）
      const merged = await store.syncMerge(remoteBundle, 'cloudBaseline');
      added = merged.added || 0;
      if (merged.dataChanged) dataChanged = true;
      // 3. 上传合并结果；若被其他设备抢先更新则重新拉取合并
      const bundle = await store.exportBundle();
      try {
        const put = await request('/api/sync', {
          method: 'PUT',
          token: acc.token,
          timeout: 45000,
          body: { baseRev: Number(remote.rev) || 0, device: installId(), bundleEnc: encryptSyncBundle(JSON.stringify(bundle), acc.email) }
        });
        // 4. 上传成功后才提交基线，保证基线与云端一致
        store.commitSyncBaseline(merged.pendingBaseline, 'cloudBaseline');
        store.markCloudSync('success');
        const state = store.load().settings.cloud || {};
        notify({ dataChanged });
        return {
          ok: true,
          rev: put.rev,
          size: put.size,
          lastSyncAt: state.lastSyncAt,
          added,
          removedLocal: merged.removedLocal,
          removedRemote: merged.removedRemote,
          snippetsAdded: merged.snippetsAdded || 0,
          favoritesAdded: merged.favoritesAdded || 0,
          firstSync: !!merged.firstSync,
          remoteWasEmpty: !remoteBundle,
          attempts: attempt
        };
      } catch (err) {
        if (err.status === 409 && attempt < MAX_CONFLICT_RETRY) continue;
        if (err.status === 409) throw new Error('多设备同步冲突次数过多，请稍后重试');
        throw err;
      }
    }
  } catch (err) {
    lastError = err && err.status === 403 && /未开启云同步/.test(err.message || '')
      ? '账号尚未在服务端开通云同步，请联系管理员'
      : (err.message || '同步失败');
    store.markCloudSync('error', lastError);
    // 合并已写回本地但上传失败时，界面也要同步刷新
    notify({ dataChanged });
    if (silent) return { ok: false, error: lastError };
    throw new Error(lastError);
  } finally {
    syncing = false;
  }
}

/** 应用启动：恢复自动同步，并上报一次启动统计 */
async function init({ version, platform }) {
  try {
    const acc = await loadAccount();
    if (acc) {
      const cloud = store.load().settings.cloud || {};
      if (cloud.enabled) {
        startAutoSync();
        startupTimer = setTimeout(() => {
          startupTimer = null;
          syncNow({ silent: true }).catch(() => {});
        }, 8000);
        if (startupTimer.unref) startupTimer.unref();
      }
      refreshMe().catch(() => {});
    }
    hello(version, platform).catch(() => {});
    bootstrap().then(() => notify()).catch(() => {});
    store.onSyncPending(() => scheduleSync());
    notify();
  } catch (_) {}
}

module.exports = {
  API_BASE,
  init,
  ready: () => loadAccount(),
  installId,
  accountView,
  bootstrap,
  sendCode,
  register,
  login,
  logout,
  refreshMe,
  hello,
  setSyncEnabled,
  disableForWebdav,
  syncNow,
  scheduleSync,
  startAutoSync,
  stopAutoSync,
  isSyncing: () => syncing,
  onChange,
  notify,
  getLastError: () => lastError
};
