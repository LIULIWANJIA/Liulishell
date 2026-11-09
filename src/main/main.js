'use strict';
const { app, BrowserWindow, ipcMain, dialog, Menu, shell, nativeImage, screen } = require('electron');
const path = require('path');
const fs = require('fs');

/* ---------- 数据目录 ----------
 * 1. 显式指定（测试 / 多配置）优先：LIULI_USER_DATA
 * 2. 便携版（electron-builder portable 会注入 PORTABLE_EXECUTABLE_DIR）：
 *    若 exe 同级存在 data 目录，则把配置放在那里，做到真正随包携带；
 *    没有 data 目录时仍用 %APPDATA%\LIULI Shell，与安装版共用一份配置。
 * 3. 安装版：%APPDATA%\LIULI Shell
 * 注意：便携版不要放在安装目录里，升级时安装目录会被整体替换。
 */
if (process.env.LIULI_USER_DATA) {
  try { app.setPath('userData', process.env.LIULI_USER_DATA); } catch (_) {}
} else if (process.env.PORTABLE_EXECUTABLE_DIR) {
  try {
    const portableData = path.join(process.env.PORTABLE_EXECUTABLE_DIR, 'data');
    if (fs.statSync(portableData).isDirectory()) app.setPath('userData', portableData);
  } catch (_) {}
}

const crypto = require('crypto');
const store = require('./store');
const ssh = require('./ssh');
const finalShell = require('./finalshell');
const dirCache = require('./dircache');

let win = null;
let editorWin = null;
let downloadWin = null;
let importWin = null;
let webdavSyncing = false;

/* ---------- 配置文件加解密（AES-256-GCM + scrypt，高强度参数防暴力破解） ---------- */
const CONFIG_SCRYPT = { N: 1 << 16, r: 8, p: 1, maxmem: 128 * 1024 * 1024 };
// 云同步文件使用更高内存与 CPU 成本的 scrypt 参数，提升离线暴力破解难度
const SYNC_SCRYPT = { N: 1 << 18, r: 8, p: 2, maxmem: 768 * 1024 * 1024 };

function configKey(passphrase, salt, params) {
  return crypto.scryptSync(String(passphrase || ''), salt, 32, params || CONFIG_SCRYPT);
}

function scryptKeyAsync(passphrase, salt, params) {
  return new Promise((resolve, reject) => {
    crypto.scrypt(String(passphrase || ''), salt, 32, params || CONFIG_SCRYPT, (err, key) => {
      if (err) reject(err);
      else resolve(key);
    });
  });
}

/** 从文件头解析并校验 scrypt 参数，避免恶意超大参数导致内存耗尽 */
function kdfParamsFromBox(box) {
  let params = CONFIG_SCRYPT;
  if (box && box.kdfParams && box.kdfParams.N) {
    const N = Math.max(2, Math.min(1 << 20, Number(box.kdfParams.N) || 0));
    const r = Math.max(1, Math.min(32, Number(box.kdfParams.r) || 8));
    const p = Math.max(1, Math.min(16, Number(box.kdfParams.p) || 1));
    const mem = 128 * N * r;
    if (mem > 1024 * 1024 * 1024) throw new Error('KDF 参数过大');
    params = { N, r, p, maxmem: Math.min(1536 * 1024 * 1024, mem * 2 + 64 * 1024 * 1024) };
  }
  return params;
}

function encryptConfigFile(obj, passphrase, scryptParams) {
  const params = scryptParams || CONFIG_SCRYPT;
  const salt = crypto.randomBytes(32);
  const key = configKey(passphrase, salt, params);
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const enc = Buffer.concat([cipher.update(JSON.stringify(obj), 'utf8'), cipher.final()]);
  return JSON.stringify(
    {
      format: 'liuli-shell-config',
      version: 2,
      alg: 'aes-256-gcm',
      kdf: 'scrypt',
      kdfParams: { N: params.N, r: params.r, p: params.p },
      salt: salt.toString('base64'),
      iv: iv.toString('base64'),
      tag: cipher.getAuthTag().toString('base64'),
      data: enc.toString('base64')
    },
    null,
    2
  );
}

function decryptConfigFile(text, passphrase) {
  let box;
  try {
    box = JSON.parse(text);
  } catch (_) {
    throw new Error('配置文件格式不正确');
  }
  if (!box || box.format !== 'liuli-shell-config') throw new Error('不是有效的 LIULI Shell 配置文件');
  try {
    const params = kdfParamsFromBox(box);
    const key = crypto.scryptSync(String(passphrase || ''), Buffer.from(box.salt, 'base64'), 32, params);
    const decipher = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(box.iv, 'base64'));
    decipher.setAuthTag(Buffer.from(box.tag, 'base64'));
    return JSON.parse(Buffer.concat([decipher.update(Buffer.from(box.data, 'base64')), decipher.final()]).toString('utf8'));
  } catch (_) {
    throw new Error('解密失败：导出密码不正确或文件已损坏');
  }
}

/** 云同步使用异步 KDF，避免强化后的 scrypt 阻塞主进程事件循环 */
async function encryptConfigFileAsync(obj, passphrase, scryptParams) {
  const params = scryptParams || CONFIG_SCRYPT;
  const salt = crypto.randomBytes(32);
  const key = await scryptKeyAsync(passphrase, salt, params);
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const enc = Buffer.concat([cipher.update(JSON.stringify(obj), 'utf8'), cipher.final()]);
  return JSON.stringify(
    {
      format: 'liuli-shell-config',
      version: 2,
      alg: 'aes-256-gcm',
      kdf: 'scrypt',
      kdfParams: { N: params.N, r: params.r, p: params.p },
      salt: salt.toString('base64'),
      iv: iv.toString('base64'),
      tag: cipher.getAuthTag().toString('base64'),
      data: enc.toString('base64')
    },
    null,
    2
  );
}

async function decryptConfigFileAsync(text, passphrase) {
  let box;
  try {
    box = JSON.parse(text);
  } catch (_) {
    throw new Error('配置文件格式不正确');
  }
  if (!box || box.format !== 'liuli-shell-config') throw new Error('不是有效的 LIULI Shell 配置文件');
  try {
    const params = kdfParamsFromBox(box);
    const key = await scryptKeyAsync(passphrase, Buffer.from(box.salt, 'base64'), params);
    const decipher = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(box.iv, 'base64'));
    decipher.setAuthTag(Buffer.from(box.tag, 'base64'));
    return JSON.parse(Buffer.concat([decipher.update(Buffer.from(box.data, 'base64')), decipher.final()]).toString('utf8'));
  } catch (_) {
    throw new Error('解密失败：导出密码不正确或文件已损坏');
  }
}

function createWindow() {
  const data = store.load();
  const w = data.settings.window || {};
  let area = { x: 0, y: 0, width: 1920, height: 1080 };
  try {
    area = screen.getPrimaryDisplay().workArea;
  } catch (_) {}
  // 默认尺寸：约 60% 屏宽、86% 屏高，贴靠屏幕右侧（不要占满桌面）
  const defaultW = Math.max(1000, Math.round(area.width * 0.6));
  const defaultH = Math.max(620, Math.round(area.height * 0.86));
  const width = U_clamp(w.width || defaultW, 1000, area.width);
  const height = U_clamp(w.height || defaultH, 620, area.height);

  // 首次启动（还没记住窗口位置）默认贴靠主屏幕右侧
  let x = typeof w.x === 'number' ? w.x : undefined;
  let y = typeof w.y === 'number' ? w.y : undefined;
  if (x === undefined || y === undefined) {
    if (data.settings.startDockedRight !== false) {
      x = Math.max(area.x, area.x + area.width - width);
      y = area.y + Math.round((area.height - height) * 0.45);
    }
  }

  win = new BrowserWindow({
    width,
    height,
    x,
    y,
    minWidth: 1000,
    minHeight: 620,
    title: 'LIULI Shell',
    backgroundColor: '#f7f6f2',
    frame: process.platform === 'darwin',
    thickFrame: process.platform === 'win32' ? false : undefined,
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : undefined,
    resizable: true,
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      spellcheck: false
    }
  });

  win.once('ready-to-show', () => win.show());
  win.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'));

  // 调试钩子（截图 / 注入脚本 / 渲染日志）只在未打包时生效，正式包忽略这些环境变量
  const DEBUG_HOOKS = !app.isPackaged;

  if (DEBUG_HOOKS && process.env.LIULI_DEBUG) {
    try {
      const area = screen.getPrimaryDisplay().workArea;
      const info = `[bounds] ${JSON.stringify(win.getBounds())} workArea=${JSON.stringify(area)}`;
      console.log(info);
      fs.writeFileSync(path.join(app.getAppPath(), 'test', '_bounds.log'), info, 'utf8');
    } catch (_) {}
  }

  /* ---- 调试辅助：输出渲染进程日志 / 截图 / 注入脚本（仅开发期通过环境变量开启） ---- */
  if (DEBUG_HOOKS && (process.env.LIULI_DEBUG || process.env.LIULI_SHOT || process.env.LIULI_EVAL)) {
    win.webContents.on('console-message', (...args) => {
      const first = args[0];
      if (first && typeof first === 'object' && 'message' in first) {
        console.log(`[renderer:${first.level}] ${first.message}`);
      } else {
        console.log('[renderer]', args.slice(1, 3).join(' '));
      }
    });
    win.webContents.on('render-process-gone', (_e, d) => console.log('[renderer-gone]', JSON.stringify(d)));
  }

  win.webContents.once('did-finish-load', () => {
    if (!DEBUG_HOOKS) return;
    setTimeout(async () => {
      if (process.env.LIULI_EVAL) {
        try {
          const code = fs.readFileSync(process.env.LIULI_EVAL, 'utf8');
          const r = await win.webContents.executeJavaScript(code, true);
          console.log('[eval]', typeof r === 'object' ? JSON.stringify(r) : r);
        } catch (err) {
          console.log('[eval-error]', err.message);
        }
      }
      if (process.env.LIULI_SHOT) {
        try {
          await new Promise((r) => setTimeout(r, Number(process.env.LIULI_SHOT_DELAY) || 1200));
          const img = await win.webContents.capturePage();
          fs.writeFileSync(process.env.LIULI_SHOT, img.toPNG());
          console.log('[shot] saved -> ' + process.env.LIULI_SHOT);
        } catch (err) {
          console.log('[shot-error]', err.message);
        }
      }
    }, 900);
  });

  const persistBounds = () => {
    if (!win) return;
    const b = win.getNormalBounds ? win.getNormalBounds() : win.getBounds();
    store.patchSettings({ window: { width: b.width, height: b.height, x: b.x, y: b.y } });
  };
  win.on('resized', persistBounds);
  win.on('moved', persistBounds);
  win.on('maximize', () => broadcast('win:maximized', true));
  win.on('unmaximize', () => broadcast('win:maximized', false));
  win.on('closed', () => {
    win = null;
    if (editorWin && !editorWin.isDestroyed()) editorWin.close();
    if (downloadWin && !downloadWin.isDestroyed()) downloadWin.close();
    if (importWin && !importWin.isDestroyed()) importWin.close();
  });

  // 外链走系统浏览器
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/i.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
}

/** 下载管理器独立窗口 */
function ensureDownloadWindow() {
  if (downloadWin && !downloadWin.isDestroyed()) {
    downloadWin.focus();
    return downloadWin;
  }
  downloadWin = new BrowserWindow({
    width: 820, height: 520, minWidth: 620, minHeight: 360,
    title: '下载管理器 - LIULI Shell',
    backgroundColor: '#f7f6f2',
    frame: process.platform === 'darwin',
    thickFrame: process.platform === 'win32' ? false : undefined,
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : undefined,
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true, nodeIntegration: false, sandbox: false, spellcheck: false
    }
  });
  downloadWin.loadFile(path.join(__dirname, '..', 'renderer', 'downloads.html'));
  if (process.env.LIULI_DOWNLOADS_EVAL) {
    downloadWin.webContents.once('did-finish-load', () => {
      setTimeout(async () => {
        let text = '';
        try {
          const code = fs.readFileSync(process.env.LIULI_DOWNLOADS_EVAL, 'utf8');
          const r = await downloadWin.webContents.executeJavaScript(code, true);
          text = typeof r === 'object' ? JSON.stringify(r) : String(r);
        } catch (err) { text = 'ERR ' + err.message; }
        try { fs.writeFileSync(path.join(app.getAppPath(), 'test', '_downloads_eval.log'), text, 'utf8'); } catch (_) {}
      }, 1200);
    });
  }
  downloadWin.once('ready-to-show', () => {
    downloadWin.show();
    downloadWin.webContents.send('transfer:list', transferList());
  });
  downloadWin.on('closed', () => { downloadWin = null; });
  return downloadWin;
}

/** FinalShell 配置导入独立窗口 */
function ensureFinalShellImportWindow() {
  if (importWin && !importWin.isDestroyed()) {
    importWin.focus();
    return importWin;
  }
  importWin = new BrowserWindow({
    width: 880, height: 720, minWidth: 700, minHeight: 560,
    title: '导入 FinalShell 配置 - LIULI Shell',
    backgroundColor: '#f7f6f2',
    frame: process.platform === 'darwin',
    thickFrame: process.platform === 'win32' ? false : undefined,
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : undefined,
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true, nodeIntegration: false, sandbox: false, spellcheck: false
    }
  });
  importWin.loadFile(path.join(__dirname, '..', 'renderer', 'finalshell.html'));
  importWin.once('ready-to-show', () => importWin.show());
  importWin.on('closed', () => { importWin = null; });
  return importWin;
}

/** 独立文件编辑器窗口（可同时打开多个文件标签） */
function ensureEditorWindow() {
  if (editorWin && !editorWin.isDestroyed()) {
    editorWin.focus();
    return editorWin;
  }
  editorWin = new BrowserWindow({
    width: 1060,
    height: 720,
    minWidth: 700,
    minHeight: 460,
    title: '文件编辑器 - LIULI Shell',
    backgroundColor: '#f7f6f2',
    frame: process.platform === 'darwin',
    thickFrame: process.platform === 'win32' ? false : undefined,
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : undefined,
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      spellcheck: false
    }
  });
  editorWin.loadFile(path.join(__dirname, '..', 'renderer', 'editor.html'));
  if (process.env.LIULI_EDITOR_EVAL) {
    editorWin.webContents.once('did-finish-load', () => {
      setTimeout(async () => {
        let text = '';
        try {
          const code = fs.readFileSync(process.env.LIULI_EDITOR_EVAL, 'utf8');
          const r = await editorWin.webContents.executeJavaScript(code, true);
          text = typeof r === 'object' ? JSON.stringify(r) : String(r);
        } catch (err) {
          text = 'ERR ' + err.message;
        }
        try {
          fs.writeFileSync(path.join(app.getAppPath(), 'test', '_editor_eval.log'), text, 'utf8');
        } catch (_) {}
      }, 500);
    });
  }
  editorWin.once('ready-to-show', () => editorWin.show());
  editorWin.on('closed', () => {
    editorWin = null;
  });
  return editorWin;
}

function broadcast(channel, payload) {
  if (win && !win.isDestroyed()) win.webContents.send(channel, payload);
}

/** 设置变化广播到主窗口与下载管理器 / 编辑器等独立窗口 */
function broadcastSettings() {
  const settings = store.publicState().settings;
  for (const w of BrowserWindow.getAllWindows()) {
    if (!w.isDestroyed()) w.webContents.send('settings:changed', settings);
  }
}

/* ---------------- 传输（下载 / 上传）注册表 ---------------- */
const transfers = new Map();

function transferList() {
  return Array.from(transfers.values()).sort((a, b) => b.startedAt - a.startedAt);
}

function emitTransfers() {
  const list = transferList();
  broadcast('transfer:list', list);
  if (downloadWin && !downloadWin.isDestroyed()) downloadWin.webContents.send('transfer:list', list);
}

function patchTransfer(id, patch) {
  const t = transfers.get(id);
  if (!t) return;
  Object.assign(t, patch);
  emitTransfers();
}

function newTransfer(info) {
  transfers.set(info.id, Object.assign({
    transferred: 0, total: 0, status: 'running', startedAt: Date.now(), finishedAt: null
  }, info));
  emitTransfers();
  // 开始下载时自动打开下载管理器窗口
  if (info && info.direction === 'download') ensureDownloadWindow();
}

/** 传输中断原因 -> 任务状态（暂停与取消分开记录） */
function transferStatusFromError(msg) {
  if (/已暂停/.test(msg)) return 'paused';
  if (/取消/.test(msg)) return 'cancelled';
  return 'error';
}

/** 默认下载目录：系统桌面的 ShellFiles 文件夹（设置里可改；旧默认目录自动迁移） */
function defaultDownloadDir() {
  const settings = store.load().settings;
  let dir = String(settings.downloadDir || '').trim();
  try {
    const desktop = app.getPath('desktop');
    const target = path.join(desktop, 'ShellFiles');
    const legacy = [app.getPath('downloads'), path.join(desktop, 'LiuliShell')];
    const isLegacy = !dir || legacy.some((p) => path.resolve(dir) === path.resolve(p));
    if (isLegacy) {
      dir = target;
      if (settings.downloadDir !== dir) store.patchSettings({ downloadDir: dir });
    }
  } catch (_) {
    if (!dir) dir = path.join(app.getPath('desktop'), 'ShellFiles');
  }
  try {
    fs.mkdirSync(dir, { recursive: true });
  } catch (_) {}
  return dir;
}

/** 会话事件统一出口：同时推送主窗口与下载管理器 */
function sendAll(channel, payload) {
  if (channel === 'fs:progress' && payload) {
    const t = transfers.get(payload.id);
    if (t) {
      t.transferred = payload.transferred || t.transferred;
      t.total = payload.total || t.total;
      if (payload.name) t.name = payload.name;
      t.direction = payload.direction || t.direction;
      emitTransfers();
    }
  }
  broadcast(channel, payload);
  if (downloadWin && !downloadWin.isDestroyed()) downloadWin.webContents.send(channel, payload);
}

function buildMenu() {
  const isMac = process.platform === 'darwin';
  const template = [
    ...(isMac ? [{ role: 'appMenu' }] : []),
    {
      label: '文件',
      submenu: [
        {
          label: '新增 SSH 配置',
          accelerator: 'CmdOrCtrl+N',
          click: () => broadcast('ui:new-connection')
        },
        { type: 'separator' },
        { label: '导出配置（加密）…', click: () => broadcast('ui:export-config') },
        { label: '导入配置…', click: () => broadcast('ui:import-config') },
        { type: 'separator' },
        isMac ? { role: 'close' } : { role: 'quit', label: '退出' }
      ]
    },
    { label: '编辑', submenu: [{ role: 'copy', label: '复制' }, { role: 'paste', label: '粘贴' }, { role: 'selectAll', label: '全选' }] },
    {
      label: '视图',
      submenu: [
        { role: 'reload', label: '重新加载' },
        { role: 'toggleDevTools', label: '开发者工具' },
        { type: 'separator' },
        { role: 'resetZoom', label: '实际大小' },
        { role: 'zoomIn', label: '放大' },
        { role: 'zoomOut', label: '缩小' },
        { type: 'separator' },
        { role: 'togglefullscreen', label: '全屏' }
      ]
    }
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

app.whenReady().then(() => {
  // Windows / Linux 使用自绘顶栏，移除系统菜单栏
  if (process.platform === 'darwin') buildMenu();
  else Menu.setApplicationMenu(null);
  try { defaultDownloadDir(); } catch (_) {}
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

/* ---------- 主进程崩溃日志 ----------
 * 打包后没有控制台，崩溃会「闪退」且无任何提示；这里把异常写到 userData/liuli-crash.log，
 * 同时弹窗告知日志位置，方便定位打包版启动异常。
 */
function crashLog(kind, err) {
  const file = path.join(app.getPath('userData'), 'liuli-crash.log');
  const text = `[${new Date().toISOString()}] ${kind}\n${(err && (err.stack || err.message)) || String(err)}\n\n`;
  try {
    fs.appendFileSync(file, text, 'utf8');
  } catch (_) {}
  try {
    console.error(text);
  } catch (_) {}
  // 启动即崩溃时用户只会看到"闪退"，这里补一个提示窗，告知日志位置
  if (kind === 'uncaughtException' && app.isReady()) {
    try {
      dialog.showErrorBox('LIULI Shell 运行异常', `错误已记录到：\n${file}\n\n${(err && err.message) || String(err)}`);
    } catch (_) {}
  }
}
process.on('uncaughtException', (err) => crashLog('uncaughtException', err));
process.on('unhandledRejection', (err) => crashLog('unhandledRejection', err));

app.on('window-all-closed', () => {
  store.saveNow();
  ssh.closeAll();
  if (process.platform !== 'darwin') app.quit();
});

/* ---------- 应用信息 ----------
 * preload 用 sendSync 取版本号，界面里显示真实版本（随 package.json 自动变化）
 */
ipcMain.on('app:version', (e) => {
  e.returnValue = {
    version: app.getVersion(),
    portable: !!process.env.PORTABLE_EXECUTABLE_DIR,
    dataFile: path.join(app.getPath('userData'), 'liulishell-data.json')
  };
});

/* ---------- 下载管理器 ---------- */
ipcMain.handle('downloads:open', () => { ensureDownloadWindow(); return true; });
ipcMain.handle('transfer:list', () => transferList());
ipcMain.handle('transfer:cancel', (_e, id) => {
  const t = transfers.get(id);
  if (!t || t.status !== 'running') return false;
  try { ssh.getSession(t.sessionId).cancelTransfer(id); } catch (_) {}
  patchTransfer(id, { status: 'cancelled', finishedAt: Date.now() });
  return true;
});
ipcMain.handle('transfer:pause', (_e, id) => {
  const t = transfers.get(id);
  if (!t || t.status !== 'running') return false;
  try { ssh.getSession(t.sessionId).cancelTransfer(id, true); } catch (_) {}
  patchTransfer(id, { status: 'paused', finishedAt: Date.now() });
  return true;
});
ipcMain.handle('transfer:remove', (_e, id) => { transfers.delete(id); emitTransfers(); return true; });
ipcMain.handle('transfer:discard', (_e, id) => {
  const t = transfers.get(id);
  if (!t || t.status === 'running' || t.status === 'done') return false;
  t.status = 'cancelled';
  discardPartial(t);
  patchTransfer(id, { status: 'cancelled', finishedAt: Date.now() });
  return true;
});

/** 已结束/已暂停任务的目标路径：清空记录时删除残留文件（不递归删除目录） */
function discardPartial(t) {
  if (!t || t.status === 'done') return;
  if (t.direction === 'upload' && t.remote) {
    try { ssh.getSession(t.sessionId).getSftp().then((sftp) => sftp.unlink(t.remote, () => {})).catch(() => {}); } catch (_) {}
    return;
  }
  if (!t.target) return;
  try {
    if (fs.statSync(t.target).isFile()) fs.unlinkSync(t.target);
  } catch (_) {}
}

ipcMain.handle('transfer:clearFinished', () => {
  let n = 0;
  for (const [id, t] of transfers) {
    if (t.status === 'done' || t.status === 'error' || t.status === 'cancelled') { transfers.delete(id); n++; }
  }
  emitTransfers();
  return n;
});
ipcMain.handle('transfer:clearAll', () => {
  // 清空全部：先停止进行中的任务，再删除未完成的残留文件，最后移除所有记录
  for (const [id, t] of transfers) {
    if (t.status === 'running') {
      try { ssh.getSession(t.sessionId).cancelTransfer(id); } catch (_) {}
      t.status = 'cancelled';
    }
    discardPartial(t);
  }
  const n = transfers.size;
  transfers.clear();
  emitTransfers();
  return n;
});
ipcMain.handle('transfer:pauseAll', () => {
  // 暂停全部：停止所有进行中的任务并保留已下载分片
  let n = 0;
  for (const [id, t] of transfers) {
    if (t.status !== 'running') continue;
    try { ssh.getSession(t.sessionId).cancelTransfer(id, true); } catch (_) {}
    t.status = 'paused';
    t.finishedAt = Date.now();
    n++;
  }
  if (n) emitTransfers();
  return n;
});
ipcMain.handle('transfer:cancelAll', () => {
  // 取消全部：停止所有进行中的任务并删除未完成文件
  let n = 0;
  for (const [id, t] of transfers) {
    if (t.status !== 'running') continue;
    try { ssh.getSession(t.sessionId).cancelTransfer(id); } catch (_) {}
    t.status = 'cancelled';
    t.finishedAt = Date.now();
    n++;
  }
  if (n) emitTransfers();
  return n;
});
ipcMain.handle('transfer:openFolder', (_e, id) => {
  const t = transfers.get(id);
  if (!t) return false;
  try {
    if (t.target && fs.existsSync(t.target)) shell.showItemInFolder(t.target);
    else if (t.target) shell.openPath(path.dirname(t.target));
  } catch (_) {}
  return true;
});
ipcMain.handle('transfer:openDownloadDir', () => {
  const dir = defaultDownloadDir();
  shell.openPath(dir);
  return dir;
});
ipcMain.handle('downloads:minimize', () => downloadWin && downloadWin.minimize());
ipcMain.handle('downloads:maximize', () => {
  if (!downloadWin) return false;
  if (downloadWin.isMaximized()) downloadWin.unmaximize();
  else downloadWin.maximize();
  return downloadWin.isMaximized();
});
ipcMain.handle('downloads:close', () => {
  if (downloadWin && !downloadWin.isDestroyed()) downloadWin.close();
  return true;
});
ipcMain.handle('settings:pickDownloadDir', async () => {
  const r = await dialog.showOpenDialog(win, {
    title: '选择下载文件夹',
    properties: ['openDirectory', 'createDirectory'],
    defaultPath: defaultDownloadDir()
  });
  return r.canceled || !r.filePaths.length ? null : r.filePaths[0];
});

/* ---------- 独立文件编辑器窗口 ---------- */
ipcMain.handle('editor:open', async (_e, payload) => {
  const w = ensureEditorWindow();
  if (w.webContents.isLoading()) {
    await new Promise((resolve) => w.webContents.once('did-finish-load', resolve));
  }
  w.webContents.send('editor:open-file', payload || {});
  return true;
});
ipcMain.handle('editor:closeWindow', () => {
  if (editorWin && !editorWin.isDestroyed()) editorWin.close();
  return true;
});
ipcMain.handle('editor:minimize', () => editorWin && editorWin.minimize());
ipcMain.handle('editor:maximize', () => {
  if (!editorWin) return false;
  if (editorWin.isMaximized()) editorWin.unmaximize();
  else editorWin.maximize();
  return editorWin.isMaximized();
});

/* ---------- 自绘顶栏：窗口控制与视图 ---------- */
ipcMain.handle('win:minimize', () => win && win.minimize());
ipcMain.handle('win:maximize', () => {
  if (!win) return false;
  if (win.isMaximized()) win.unmaximize();
  else win.maximize();
  return win.isMaximized();
});
ipcMain.handle('win:isMaximized', () => !!(win && win.isMaximized()));
ipcMain.handle('win:close', () => win && win.close());
ipcMain.handle('view:reload', () => win && win.webContents.reload());
ipcMain.handle('view:devtools', () => win && win.webContents.toggleDevTools());
ipcMain.handle('view:fullscreen', () => {
  if (win) win.setFullScreen(!win.isFullScreen());
  return win ? win.isFullScreen() : false;
});
ipcMain.handle('view:zoom', (_e, delta) => {
  if (!win) return 0;
  const next = U_clamp(win.webContents.getZoomLevel() + Number(delta || 0), -2, 3);
  win.webContents.setZoomLevel(next);
  return next;
});
ipcMain.handle('app:quit', () => app.quit());

function U_clamp(v, min, max) { return Math.max(min, Math.min(max, v)); }

/* ============================ IPC ============================ */

/* ---------- 数据 ---------- */
ipcMain.handle('store:get', () => store.publicState());

ipcMain.handle('conn:save', async (_e, conn) => store.upsertConnection(conn || {})); // -> { id, state }
ipcMain.handle('conn:delete', (_e, id) => store.deleteConnection(id));
ipcMain.handle('group:save', (_e, group) => store.upsertGroup(group || {}));
ipcMain.handle('group:delete', (_e, id) => store.deleteGroup(id));
ipcMain.handle('snippets:save', (_e, boards) => store.saveSnippetBoards(boards));
ipcMain.handle('settings:save', (_e, patch) => {
  const next = store.patchSettings(patch || {});
  if (patch && patch.monitorInterval) {
    for (const s of ssh.sessions.values()) s.setMonitorInterval(patch.monitorInterval);
  }
  // 字体 / 速率单位等设置变更同步到下载管理器等独立窗口
  broadcastSettings();
  return next;
});
ipcMain.handle('dialog:pickKey', async () => {
  const r = await dialog.showOpenDialog(win, {
    title: '选择私钥文件',
    properties: ['openFile', 'showHiddenFiles'],
    filters: [{ name: '私钥', extensions: ['pem', 'key', 'ppk', 'txt', '*'] }]
  });
  if (r.canceled || !r.filePaths.length) return null;
  const p = r.filePaths[0];
  return { path: p, content: fs.readFileSync(p, 'utf8') };
});

ipcMain.handle('settings:resetWindowPos', () => {
  const w = store.load().settings.window || {};
  store.patchSettings({ window: Object.assign({}, w, { x: null, y: null }) });
  return true;
});

ipcMain.handle('settings:pickWallpaper', async () => {
  const r = await dialog.showOpenDialog(win, {
    title: '选择背景图片',
    properties: ['openFile'],
    filters: [{ name: '图片', extensions: ['png', 'jpg', 'jpeg', 'webp', 'bmp', 'gif'] }]
  });
  if (r.canceled || !r.filePaths.length) return null;
  const p = r.filePaths[0];
  try {
    let img = nativeImage.createFromPath(p);
    const size = img.getSize();
    if (!size.width || !size.height) throw new Error('图片无法读取');
    if (size.width > 1600) img = img.resize({ width: 1600 });
    const buf = img.toJPEG(82);
    return { dataUrl: 'data:image/jpeg;base64,' + buf.toString('base64'), name: path.basename(p) };
  } catch (err) {
    throw new Error('读取图片失败: ' + err.message);
  }
});

/* ---------- 命令历史 ---------- */
ipcMain.handle('history:list', () => store.listHistory());
ipcMain.handle('history:add', (_e, cmd) => store.addHistory(cmd));
ipcMain.handle('history:delete', (_e, id) => store.deleteHistory(id));
ipcMain.handle('history:clear', () => store.clearHistory());

/* ---------- 代理 ---------- */
ipcMain.handle('proxy:save', async (_e, payload) => store.saveProxy(payload || {}));
ipcMain.handle('proxy:delete', (_e, id) => store.deleteProxy(id));
ipcMain.handle('proxy:default', (_e, id) => store.setDefaultProxy(id));

/* ---------- 密钥库 ---------- */
ipcMain.handle('key:save', async (_e, payload) => store.upsertKey(payload || {}));
ipcMain.handle('key:delete', (_e, id) => store.deleteKey(id));

/* ---------- 连接 ---------- */
ipcMain.handle('ssh:connect', async (_e, payload) => {
  const base = store.getConnection(payload && payload.id);
  if (!base) throw new Error('连接配置不存在');
  // 凭据浮窗里可临时切换登录方式 / 密钥来源，只影响本次连接与后续保存，不改动缓存对象
  const override = {};
  if (payload && (payload.authType === 'key' || payload.authType === 'password')) override.authType = payload.authType;
  // 允许在凭据浮窗里直接改用户名（例如 root 改成 ubuntu）
  if (payload && typeof payload.user === 'string' && payload.user.trim()) override.user = payload.user.trim();
  if (payload && typeof payload.keyId === 'string') override.keyId = payload.keyId;
  const conn = Object.keys(override).length ? Object.assign({}, base, override) : base;
  const secrets = await store.secretsOf(conn);
  // 凭据输入浮窗：本次临时输入（未勾选保存）直接用于本次连接，不落盘
  if (payload) {
    if (typeof payload.password === 'string' && payload.password) secrets.password = payload.password;
    if (typeof payload.privateKey === 'string' && payload.privateKey) secrets.privateKey = payload.privateKey;
    if (typeof payload.passphrase === 'string' && payload.passphrase) secrets.passphrase = payload.passphrase;
  }
  const mode = (payload && payload.proxyMode) || 'config';
  let proxy = null;
  if (mode === 'default') proxy = await store.proxyByDefault();
  else if (mode === 'none') proxy = null;
  else proxy = await store.proxyFor(conn);
  const sess = ssh.createSession(Object.assign({}, conn, { proxy }), secrets, sendAll);
  sess.setMonitorInterval(store.load().settings.monitorInterval || 1500);
  try {
    const sysinfo = await sess.connect();
    store.touchConnection(conn.id);
    return {
      sessionId: sess.id,
      sysinfo,
      viaProxy: !!proxy,
      proxyName: proxy ? proxy.name : '',
      config: { id: conn.id, name: conn.name, host: conn.host, port: conn.port, user: conn.user }
    };
  } catch (err) {
    ssh.closeSession(sess.id);
    throw new Error(err.message || '连接失败');
  }
});

ipcMain.handle('ssh:disconnect', (_e, sessionId) => {
  ssh.closeSession(sessionId);
  return true;
});

/* ---------- 终端 ---------- */
ipcMain.handle('term:open', async (_e, { sessionId, cols, rows }) => {
  const sess = ssh.getSession(sessionId);
  await sess.openShell(cols, rows);
  return true;
});

ipcMain.handle('term:write', (_e, { sessionId, data }) => {
  try {
    return ssh.getSession(sessionId).write(data);
  } catch (_) {
    return false;
  }
});

ipcMain.handle('term:resize', (_e, { sessionId, cols, rows }) => {
  try {
    ssh.getSession(sessionId).resize(cols, rows);
  } catch (_) {}
  return true;
});

ipcMain.handle('proc:sort', (_e, { sessionId, sort }) => {
  try {
    ssh.getSession(sessionId).setProcSort(sort);
  } catch (_) {}
  return true;
});

/* ---------- 全量进程 / 网络 ---------- */
ipcMain.handle('proc:list', async (_e, { sessionId }) => ssh.getSession(sessionId).listProcesses());

ipcMain.handle('proc:kill', async (_e, { sessionId, pid, signal }) => {
  const sess = ssh.getSession(sessionId);
  const out = await sess.killProcess(pid, signal);
  return { ok: true, message: out };
});

ipcMain.handle('net:list', async (_e, { sessionId }) => ssh.getSession(sessionId).listNetwork());

/* ---------- 配置导入导出 ---------- */
ipcMain.handle('config:export', async (_e, { passphrase }) => {
  if (!passphrase || String(passphrase).length < 6) throw new Error('导出密码至少 6 位');
  const bundle = await store.exportBundle();
  if (!bundle.connections.length) throw new Error('当前没有可导出的连接配置');
  const d = new Date();
  const stamp = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`;
  const r = await dialog.showSaveDialog(win, {
    title: '导出配置',
    defaultPath: path.join(defaultDownloadDir(), `liuli-config-${stamp}.lscfg`),
    filters: [{ name: 'LIULI 加密配置', extensions: ['lscfg'] }]
  });
  if (r.canceled || !r.filePath) return { ok: false };
  fs.writeFileSync(r.filePath, encryptConfigFile({ exportedAt: Date.now(), ...bundle }, passphrase), 'utf8');
  return { ok: true, path: r.filePath, count: bundle.connections.length };
});

ipcMain.handle('config:import', async (_e, { passphrase }) => {
  if (!passphrase) throw new Error('请输入配置文件密码');
  const r = await dialog.showOpenDialog(win, {
    title: '导入配置',
    properties: ['openFile'],
    filters: [{ name: 'LIULI 加密配置', extensions: ['lscfg', 'json'] }]
  });
  if (r.canceled || !r.filePaths.length) return { ok: false };
  const bundle = decryptConfigFile(fs.readFileSync(r.filePaths[0], 'utf8'), passphrase);
  const res = await store.importBundle(bundle);
  return { ok: true, added: res.added, skipped: res.skipped, state: res.state };
});

/* ---------- 导入 FinalShell 配置（独立窗口） ---------- */

/**
 * 生成导入计划：最多创建三级分组。
 * - 直接选择的 JSON → 目标分组（未选择则自动建「FinalShell 导入」一级分组）
 * - 文件夹 → 一级；子文件夹 → 二级；孙文件夹 → 三级
 * - 三级以下文件夹内的 JSON 全部归入对应的一级分组
 */
function buildFinalShellPlan(paths, targetGroupId) {
  const scanned = finalShell.scanPaths(paths || [], true);
  const d = store.load();
  const groups = d.groups || [];
  const target = targetGroupId ? groups.find((g) => g.id === targetGroupId) : null;
  const existing = new Map(); // `${parentRoute}\0${name}` -> { route, id }
  const existingRouteIds = new Map();
  for (const g of groups) {
    const parentRoute = g.parentId ? 'e:' + g.parentId : '';
    const key = parentRoute + '\u0000' + g.name;
    if (!existing.has(key)) existing.set(key, { route: 'e:' + g.id, id: g.id });
    existingRouteIds.set('e:' + g.id, g.id);
  }

  const counts = { l1: 0, l2: 0, l3: 0, configs: 0 };
  const stats = { noPassword: 0, skipped: 0, failed: 0 };
  const virtual = new Map();
  const candidates = [];
  const seen = new Set(
    (d.connections || []).map((c) => `${String(c.host).toLowerCase()}\n${Number(c.port) || 22}\n${c.user}`)
  );
  let orderSeq = 0;

  const ensureRoute = (names) => {
    let parentRoute = '';
    let level = 0;
    let route = '';
    for (const rawName of names || []) {
      const name = String(rawName || '').trim();
      if (!name || level >= 3) break;
      const key = parentRoute + '\u0000' + name;
      const hit = existing.get(key);
      if (hit) {
        parentRoute = hit.route;
        route = hit.route;
        level++;
        continue;
      }
      let vg = virtual.get(key);
      if (!vg) {
        vg = { key, name, parentRoute, level: level + 1, route: 'n:' + key, order: orderSeq++ };
        virtual.set(key, vg);
        counts['l' + (level + 1)]++;
      }
      parentRoute = vg.route;
      route = vg.route;
      level++;
    }
    return route;
  };

  const addFile = (file, routeSpec) => {
    if (!file || !file.count) {
      if (file && file.error) stats.failed++;
      return;
    }
    for (const item of file.configs || []) {
      const cfg = finalShell.normalizeConfig(item, stats);
      if (!cfg) {
        stats.skipped++;
        continue;
      }
      const key = `${cfg.host.toLowerCase()}\n${cfg.port}\n${cfg.user}`;
      if (seen.has(key)) {
        stats.skipped++;
        continue;
      }
      seen.add(key);
      candidates.push({ cfg, routeSpec });
    }
  };

  const directRoute = target ? 'e:' + target.id : { auto: true };
  for (const file of scanned.files || []) addFile(file, directRoute);

  const walkFolder = (node, level, names, l1Names) => {
    if (level <= 3) {
      for (const file of node.direct || []) addFile(file, { path: names });
      for (const child of node.children || []) {
        const childNames = level < 3 ? names.concat(child.name) : names;
        walkFolder(child, level + 1, childNames, l1Names);
      }
    } else {
      for (const file of node.direct || []) addFile(file, { path: l1Names });
      for (const child of node.children || []) walkFolder(child, level + 1, names, l1Names);
    }
  };
  for (const folder of scanned.folders || []) {
    const l1Names = [folder.name];
    walkFolder(folder, 1, l1Names, l1Names);
  }

  for (const cand of candidates) {
    const spec = cand.routeSpec;
    if (spec.auto) cand.groupRoute = ensureRoute(['FinalShell 导入']);
    else if (typeof spec === 'string') cand.groupRoute = spec;
    else cand.groupRoute = ensureRoute((spec.path || []).slice(0, 3));
  }
  counts.configs = candidates.length;

  return {
    scanned,
    virtual: Array.from(virtual.values()).sort((a, b) => a.level - b.level || a.order - b.order),
    candidates,
    counts,
    stats,
    existingRouteIds
  };
}

function applyFinalShellPlan(plan) {
  const routeToId = new Map(plan.existingRouteIds);
  const created = [];
  for (const vg of plan.virtual) {
    const parentId = vg.parentRoute ? routeToId.get(vg.parentRoute) || '' : '';
    const groups = store.load().groups || [];
    let group = groups.find((g) => (g.parentId || '') === parentId && g.name === vg.name);
    if (!group) {
      store.upsertGroup({ name: vg.name, parentId });
      group = (store.load().groups || []).find((g) => (g.parentId || '') === parentId && g.name === vg.name);
      if (group) created.push(group.id);
    }
    if (group) routeToId.set(vg.route, group.id);
  }
  return { routeToId, created };
}

ipcMain.handle('finalshell:open', () => {
  ensureFinalShellImportWindow();
  return true;
});

ipcMain.handle('finalshell:pickFiles', async () => {
  const r = await dialog.showOpenDialog(importWin || win, {
    title: '选择 FinalShell JSON 配置',
    properties: ['openFile', 'multiSelections'],
    filters: [{ name: 'FinalShell 配置', extensions: ['json'] }]
  });
  return r.canceled ? [] : r.filePaths;
});

ipcMain.handle('finalshell:pickFolder', async () => {
  const r = await dialog.showOpenDialog(importWin || win, {
    title: '选择包含 FinalShell 配置的文件夹',
    properties: ['openDirectory']
  });
  return r.canceled || !r.filePaths.length ? null : r.filePaths[0];
});

ipcMain.handle('finalshell:scan', (_e, { paths }) => finalShell.scanPaths(paths || [], false));

ipcMain.handle('finalshell:plan', (_e, { paths, targetGroupId }) => {
  const plan = buildFinalShellPlan(paths || [], targetGroupId || '');
  return {
    ok: true,
    counts: plan.counts,
    totalFiles: plan.scanned.totalFiles,
    errorCount: plan.scanned.errors.length
  };
});

ipcMain.handle('finalshell:import', async (_e, { paths, targetGroupId }) => {
  const plan = buildFinalShellPlan(paths || [], targetGroupId || '');
  const { routeToId, created } = applyFinalShellPlan(plan);
  let added = 0;
  let failed = plan.stats.failed;

  for (const cand of plan.candidates) {
    const groupId = routeToId.get(cand.groupRoute);
    if (!groupId) {
      failed++;
      continue;
    }
    const cfg = cand.cfg;
    try {
      await store.upsertConnection({
        name: cfg.name,
        group: groupId,
        host: cfg.host,
        port: cfg.port,
        user: cfg.user,
        authType: 'password',
        password: cfg.password || undefined,
        clearMotd: true
      });
      added++;
    } catch (_) {
      failed++;
    }
  }

  // 新导入的分组默认折叠，避免服务器列表被大量展开
  if (created.length) {
    const d = store.load();
    const set = new Set(Array.isArray(d.settings && d.settings.collapsedGroups) ? d.settings.collapsedGroups : []);
    created.forEach((id) => set.add(id));
    store.patchSettings({ collapsedGroups: Array.from(set) });
  }

  const state = store.publicState();
  broadcast('store:state', state);
  return {
    ok: true,
    added,
    skipped: plan.stats.skipped,
    failed,
    noPassword: plan.stats.noPassword,
    created: { l1: plan.counts.l1, l2: plan.counts.l2, l3: plan.counts.l3 },
    groups: [],
    state
  };
});

ipcMain.handle('finalshell:close', () => {
  if (importWin && !importWin.isDestroyed()) importWin.close();
  return true;
});
ipcMain.handle('finalshell:minimize', () => importWin && importWin.minimize());
ipcMain.handle('finalshell:maximize', () => {
  if (!importWin) return false;
  if (importWin.isMaximized()) importWin.unmaximize();
  else importWin.maximize();
  return importWin.isMaximized();
});

/* ---------- WebDAV 云同步 ---------- */

function davAuthHeaders(cfg) {
  const h = {};
  if (cfg.username || cfg.password) {
    h.Authorization = 'Basic ' + Buffer.from(`${cfg.username || ''}:${cfg.password || ''}`, 'utf8').toString('base64');
  }
  return h;
}

function davUrl(base, rel) {
  const b = String(base || '').trim().replace(/\/*$/, '/');
  const p = String(rel || '')
    .replace(/^\/+/, '')
    .split('/')
    .filter(Boolean)
    .map((x) => encodeURIComponent(x))
    .join('/');
  return b + p;
}

async function davRequest(cfg, url, method, body, extraHeaders) {
  const headers = Object.assign(davAuthHeaders(cfg), extraHeaders || {});
  return fetch(url, {
    method,
    headers,
    body,
    signal: AbortSignal.timeout(30000)
  });
}

async function davEnsureDirs(cfg, remotePath) {
  const parts = String(remotePath || '')
    .replace(/^\/+/, '')
    .split('/')
    .filter(Boolean);
  parts.pop();
  let cur = String(cfg.url || '').trim().replace(/\/*$/, '/');
  for (const part of parts) {
    cur += encodeURIComponent(part);
    const res = await davRequest(cfg, cur, 'MKCOL');
    if (res.status === 401 || res.status === 403) throw new Error('WebDAV 认证失败，请检查用户名 / 密码');
    if (!res.ok && res.status !== 405) {
      throw new Error(`无法创建云端目录（HTTP ${res.status}）`);
    }
    cur += '/';
  }
}

async function webdavCheckConfig(needPass) {
  const cfg = await store.webdavConfig();
  if (!cfg.url) throw new Error('请先填写 WebDAV 地址');
  if (!/^https?:\/\//i.test(cfg.url)) throw new Error('WebDAV 地址必须以 http:// 或 https:// 开头');
  if (!cfg.syncUser) throw new Error('请填写同步用户名（用于确定云端文件名）');
  if (needPass && (!cfg.syncPass || cfg.syncPass.length < 6)) {
    throw new Error('请先在设置中填写配置加密密码（至少 6 位）');
  }
  return cfg;
}

ipcMain.handle('webdav:save', async (_e, input) => {
  const state = await store.saveWebdav(input || {});
  broadcastSettings();
  return state;
});

ipcMain.handle('webdav:test', async () => {
  const cfg = await webdavCheckConfig(false);
  const fileUrl = davUrl(cfg.url, cfg.remotePath);
  try {
    const res = await davRequest(cfg, fileUrl, 'GET');
    if (res.status === 401 || res.status === 403) throw new Error('认证失败，请检查用户名 / 密码');
    if (res.status === 404) return { ok: true, exists: false, message: '连接成功，云端文件尚未创建' };
    if (!res.ok) throw new Error(`连接失败（HTTP ${res.status}）`);
    return { ok: true, exists: true, message: '连接成功，已找到云端配置' };
  } catch (err) {
    if (/fetch failed|ENOTFOUND|ECONNREFUSED|timed out|TimeoutError/i.test(String(err.message))) {
      throw new Error('无法连接 WebDAV 服务器，请检查地址与网络');
    }
    throw err;
  }
});

async function verifyClearCredentials(payload) {
  const cfg = await store.webdavConfig();
  if (!cfg.url) return;
  if (!cfg.syncUser || !cfg.syncPass) {
    throw new Error('WebDAV 配置不完整（缺少同步用户名或配置加密密码），请先在云同步中关闭 WebDAV');
  }
  const syncUser = String((payload && payload.syncUser) || '').trim();
  const syncPass = String((payload && payload.syncPass) || '');
  if (syncUser !== cfg.syncUser) throw new Error('同步用户名不正确');
  if (syncPass !== cfg.syncPass) throw new Error('配置加密密码不正确');
}

ipcMain.handle('app:verifyClearData', async (_e, payload) => {
  await verifyClearCredentials(payload || {});
  return { ok: true };
});

ipcMain.handle('app:clearData', async (_e, payload) => {
  if (webdavSyncing) throw new Error('云同步正在进行，请等待同步结束后再清空');
  await verifyClearCredentials(payload || {});
  const state = store.clearAllData();
  dirCache.clear();
  homeMemo.clear();
  broadcast('store:state', state);
  broadcastSettings();
  return { ok: true, state };
});

ipcMain.handle('app:openExternal', async (_e, url) => {
  const target = String(url || '').trim();
  if (!/^https?:\/\//i.test(target)) throw new Error('链接格式不正确');
  await shell.openExternal(target);
  return true;
});

ipcMain.handle('webdav:sync', async () => {
  if (webdavSyncing) throw new Error('正在云同步，请稍后再试');
  webdavSyncing = true;
  try {
    const cfg = await webdavCheckConfig(true);
    const fileUrl = davUrl(cfg.url, cfg.remotePath);
    store.markWebdavSync('syncing', '');
    broadcastSettings();

    // 先下载并解密远端；任何一步失败都在合并本地数据之前中止
    let remoteBundle = null;
    const getRes = await davRequest(cfg, fileUrl, 'GET');
    if (getRes.status === 401 || getRes.status === 403) throw new Error('WebDAV 认证失败，请检查用户名 / 密码');
    if (getRes.status !== 404) {
      if (!getRes.ok) throw new Error(`读取云端配置失败（HTTP ${getRes.status}）`);
      const text = await getRes.text();
      if (text.trim()) {
        try {
          remoteBundle = await decryptConfigFileAsync(text, cfg.syncPass);
        } catch (_) {
          throw new Error('云端配置解密失败：配置加密密码不正确或文件已损坏（本地数据未改动）');
        }
      }
    }

    // 以「上次同步基线」做三路合并：新增两项都补上，删除两项都删掉
    const merged = await store.syncMerge(remoteBundle);

    const bundle = await store.exportBundle();
    const encrypted = await encryptConfigFileAsync({ exportedAt: Date.now(), ...bundle }, cfg.syncPass, SYNC_SCRYPT);
    await davEnsureDirs(cfg, cfg.remotePath);
    const putRes = await davRequest(cfg, fileUrl, 'PUT', encrypted, { 'Content-Type': 'application/octet-stream' });
    if (!putRes.ok) throw new Error(`上传云端配置失败（HTTP ${putRes.status}）`);

    // 上传成功后才提交基线，保证「基线 = 云端内容」
    store.commitSyncBaseline(merged.pendingBaseline);

    store.markWebdavSync('success', '');
    broadcastSettings();
    const state = store.publicState();
    return {
      ok: true,
      added: merged.added,
      skipped: merged.skipped,
      snippetsAdded: merged.snippetsAdded || 0,
      favoritesAdded: merged.favoritesAdded || 0,
      favoriteGroupsAdded: merged.favoriteGroupsAdded || 0,
      removedLocal: merged.removedLocal || {},
      removedRemote: merged.removedRemote || {},
      baselineAt: merged.baselineAt || 0,
      firstSync: !!merged.firstSync,
      uploaded: { connections: bundle.connections.length, groups: bundle.groups.length },
      remoteWasEmpty: !remoteBundle,
      lastSyncAt: (state.settings.webdav || {}).lastSyncAt || Date.now(),
      remote: fileUrl,
      state
    };
  } catch (err) {
    // 已填写地址与加密密码才视为「同步失败」；缺配置保持待配置状态
    try {
      const cur = await store.webdavConfig();
      if (cur.url && cur.syncUser && cur.syncPass) {
        store.markWebdavSync('error', (err && err.message) || String(err));
        broadcastSettings();
      }
    } catch (_) {}
    throw err;
  } finally {
    webdavSyncing = false;
  }
});

/* ---------- 文件（带目录缓存） ---------- */

/** 同一台服务器共用一个缓存命名空间：重连后仍可秒开目录 */
function sessionConnKey(sess) {
  const c = (sess && (sess.cfg || sess.config)) || {};
  return `${c.host || ''}:${c.port || 22}:${c.user || ''}`;
}

const homeMemo = new Map();
const dirRefreshing = new Map(); // connKey\0dir -> Promise，避免同一目录并发刷新

/** 后台刷新某个目录，成功后推送给渲染层（前端就地更新，不打断操作） */
function refreshDirInBackground(sess, dir) {
  const ck = sessionConnKey(sess);
  const key = ck + '\u0000' + dir;
  if (dirRefreshing.has(key)) return dirRefreshing.get(key);
  const task = (async () => {
    try {
      const entries = await sess.listDir(dir);
      dirCache.set(ck, dir, entries);
      broadcast('fs:dir', { sessionId: sess.id, path: dir, entries, at: Date.now() });
    } catch (_) {
      // 后台刷新失败时保留旧缓存，前端已经显示内容，无需打扰用户
    } finally {
      dirRefreshing.delete(key);
    }
  })();
  dirRefreshing.set(key, task);
  return task;
}

ipcMain.handle('fs:home', async (_e, { sessionId }) => {
  const sess = ssh.getSession(sessionId);
  const ck = sessionConnKey(sess);
  if (homeMemo.has(ck)) return homeMemo.get(ck);
  const home = await sess.resolveHome();
  homeMemo.set(ck, home);
  return home;
});

/**
 * 列目录：命中缓存立刻返回（cached=true），同时在后台刷新并推送 fs:dir。
 * refresh=true 用于「刷新」按钮，强制走 SFTP 并等待结果。
 */
ipcMain.handle('fs:list', async (_e, { sessionId, path: dir, refresh }) => {
  const sess = ssh.getSession(sessionId);
  const ck = sessionConnKey(sess);
  if (!refresh) {
    const hit = dirCache.get(ck, dir);
    if (hit) {
      refreshDirInBackground(sess, dir);
      return { path: dir, entries: hit.entries, cached: true, cachedAt: hit.at };
    }
  }
  try {
    const entries = await sess.listDir(dir);
    dirCache.set(ck, dir, entries);
    return { path: dir, entries, cached: false };
  } catch (err) {
    throw new Error('读取目录失败: ' + (err.message || err));
  }
});

ipcMain.handle('fs:delete', async (_e, { sessionId, paths }) => {
  const sess = ssh.getSession(sessionId);
  await sess.remove(paths || []);
  dirCache.invalidate(sessionConnKey(sess), paths || []);
  return true;
});

ipcMain.handle('fs:deletePlain', async (_e, { sessionId, paths }) => {
  const sess = ssh.getSession(sessionId);
  await sess.removePlain(paths || []);
  dirCache.invalidate(sessionConnKey(sess), paths || []);
  return true;
});

ipcMain.handle('fs:copy', async (_e, { sessionId, sources, dest, move }) => {
  const sess = ssh.getSession(sessionId);
  await sess.copy(sources || [], dest, !!move);
  dirCache.invalidate(sessionConnKey(sess), [dest].concat(sources || []));
  return true;
});

ipcMain.handle('fs:mkdir', async (_e, { sessionId, path: p }) => {
  const sess = ssh.getSession(sessionId);
  await sess.mkdir(p);
  dirCache.invalidate(sessionConnKey(sess), p);
  return true;
});

ipcMain.handle('fs:rename', async (_e, { sessionId, from, to }) => {
  const sess = ssh.getSession(sessionId);
  await sess.rename(from, to);
  dirCache.invalidate(sessionConnKey(sess), [from, to]);
  return true;
});

/* ---------- 在线编辑（<10MB 文本） ---------- */
ipcMain.handle('fs:read', async (_e, { sessionId, path: remotePath }) => {
  const sess = ssh.getSession(sessionId);
  return sess.readTextFile(remotePath, 10 * 1024 * 1024);
});

ipcMain.handle('fs:write', async (_e, { sessionId, path: remotePath, content }) => {
  const sess = ssh.getSession(sessionId);
  const bytes = await sess.writeTextFile(remotePath, content);
  dirCache.invalidate(sessionConnKey(sess), remotePath);
  return { ok: true, bytes };
});

ipcMain.handle('fs:download', async (_e, { sessionId, items }) => {
  const sess = ssh.getSession(sessionId);
  if (!items || !items.length) return { ok: false };
  const dir = defaultDownloadDir();
  let count = 0;
  const targets = [];
  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    const target = path.join(dir, item.name);
    const id = 'dl-' + Date.now() + '-' + i;
    newTransfer({
      id, name: item.name, direction: 'download', target,
      remote: item.path, sessionId, total: item.isDir ? 0 : Number(item.size || 0)
    });
    try {
      if (item.isDir) await sess.downloadDir(item.path, target, id);
      else await sess.downloadFile(item.path, target, id);
      const t = transfers.get(id);
      patchTransfer(id, { status: 'done', transferred: (t && (t.total || t.transferred)) || 0, finishedAt: Date.now() });
      count++;
    } catch (err) {
      const msg = (err && err.message) || String(err);
      patchTransfer(id, { status: transferStatusFromError(msg), error: msg, finishedAt: Date.now() });
    }
    targets.push(target);
  }
  return { ok: true, count, target: targets.length === 1 ? targets[0] : dir };
});

ipcMain.handle('fs:upload', async (_e, { sessionId, remoteDir, localPaths }) => {
  const sess = ssh.getSession(sessionId);
  let files = localPaths;
  if (!files || !files.length) {
    const r = await dialog.showOpenDialog(win, { title: '选择要上传的文件', properties: ['openFile', 'multiSelections'] });
    if (r.canceled || !r.filePaths.length) return { ok: false };
    files = r.filePaths;
  }
  let count = 0;
  for (let i = 0; i < files.length; i++) {
    const f = files[i];
    const st = fs.statSync(f);
    if (st.isDirectory()) continue;
    const id = 'ul-' + Date.now() + '-' + i;
    newTransfer({
      id, name: path.basename(f), direction: 'upload', target: f,
      remote: path.posix.join(remoteDir, path.basename(f)), sessionId, total: st.size
    });
    try {
      await sess.uploadFile(f, remoteDir, id);
      patchTransfer(id, { status: 'done', transferred: st.size, finishedAt: Date.now() });
      count++;
    } catch (err) {
      const msg = (err && err.message) || String(err);
      patchTransfer(id, { status: transferStatusFromError(msg), error: msg, finishedAt: Date.now() });
    }
  }
  dirCache.invalidate(sessionConnKey(sess), remoteDir);
  return { ok: true, count };
});

/* 只允许读取本机已存在的绝对路径（拖拽上传用） */
ipcMain.handle('fs:uploadPaths', async (_e, { sessionId, remoteDir, paths }) => {
  const valid = (paths || []).filter((p) => typeof p === 'string' && path.isAbsolute(p) && fs.existsSync(p));
  const sess = ssh.getSession(sessionId);
  let count = 0;
  for (let i = 0; i < valid.length; i++) {
    const f = valid[i];
    if (fs.statSync(f).isDirectory()) continue;
    const id = 'ul-' + Date.now() + '-d' + i;
    const st = fs.statSync(f);
    newTransfer({
      id, name: path.basename(f), direction: 'upload', target: f,
      remote: path.posix.join(remoteDir, path.basename(f)), sessionId, total: st.size
    });
    try {
      await sess.uploadFile(f, remoteDir, id);
      patchTransfer(id, { status: 'done', transferred: st.size, finishedAt: Date.now() });
      count++;
    } catch (err) {
      const msg = (err && err.message) || String(err);
      patchTransfer(id, { status: transferStatusFromError(msg), error: msg, finishedAt: Date.now() });
    }
  }
  dirCache.invalidate(sessionConnKey(sess), remoteDir);
  return { ok: true, count };
});
