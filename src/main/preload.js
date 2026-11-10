'use strict';
const { contextBridge, ipcRenderer, webUtils } = require('electron');

const EVENTS = [
  'term:data',
  'session:closed',
  'session:error',
  'session:unstable',
  'session:stable',
  'session:sysinfo',
  'store:state',
  'monitor:stats',
  'monitor:procs',
  'fs:progress',
  'fs:dir',
  'ui:new-connection',
  'ui:export-config',
  'ui:import-config',
  'win:maximized',
  'editor:open-file',
  'transfer:list',
  'settings:changed',
  'ui:zoom'
];

const api = {
  /* 数据 */
  getState: () => ipcRenderer.invoke('store:get'),
  saveConnection: (conn) => ipcRenderer.invoke('conn:save', conn),
  deleteConnection: (id) => ipcRenderer.invoke('conn:delete', id),
  saveGroup: (group) => ipcRenderer.invoke('group:save', group),
  deleteGroup: (id) => ipcRenderer.invoke('group:delete', id),
  saveSnippets: (boards) => ipcRenderer.invoke('snippets:save', boards),
  saveSettings: (patch) => ipcRenderer.invoke('settings:save', patch),
  pickWallpaper: () => ipcRenderer.invoke('settings:pickWallpaper'),
  resetWindowPos: () => ipcRenderer.invoke('settings:resetWindowPos'),
  pickKeyFile: () => ipcRenderer.invoke('dialog:pickKey'),
  keySave: (payload) => ipcRenderer.invoke('key:save', payload),
  keyDelete: (id) => ipcRenderer.invoke('key:delete', id),
  historyList: () => ipcRenderer.invoke('history:list'),
  historyAdd: (cmd) => ipcRenderer.invoke('history:add', cmd),
  historyDelete: (id) => ipcRenderer.invoke('history:delete', id),
  historyClear: () => ipcRenderer.invoke('history:clear'),

  /* 连接与终端 */
  connect: (id, opts) => ipcRenderer.invoke('ssh:connect', Object.assign({ id }, opts || {})),
  disconnect: (sessionId) => ipcRenderer.invoke('ssh:disconnect', sessionId),
  termOpen: (payload) => ipcRenderer.invoke('term:open', payload),
  termWrite: (payload) => ipcRenderer.invoke('term:write', payload),
  termResize: (payload) => ipcRenderer.invoke('term:resize', payload),
  setProcSort: (payload) => ipcRenderer.invoke('proc:sort', payload),
  procList: (payload) => ipcRenderer.invoke('proc:list', payload),
  killProc: (payload) => ipcRenderer.invoke('proc:kill', payload),
  netList: (payload) => ipcRenderer.invoke('net:list', payload),

  /* 配置导入导出 */
  exportConfig: (payload) => ipcRenderer.invoke('config:export', payload),
  importConfig: (payload) => ipcRenderer.invoke('config:import', payload),
  finalshellOpen: () => ipcRenderer.invoke('finalshell:open'),
  finalshellPickFiles: () => ipcRenderer.invoke('finalshell:pickFiles'),
  finalshellPickFolder: () => ipcRenderer.invoke('finalshell:pickFolder'),
  finalshellScan: (paths) => ipcRenderer.invoke('finalshell:scan', { paths: paths || [] }),
  finalshellPlan: (payload) => ipcRenderer.invoke('finalshell:plan', payload || {}),
  finalshellImport: (payload) => ipcRenderer.invoke('finalshell:import', payload || {}),
  finalshellClose: () => ipcRenderer.invoke('finalshell:close'),
  finalshellMinimize: () => ipcRenderer.invoke('finalshell:minimize'),
  finalshellMaximize: () => ipcRenderer.invoke('finalshell:maximize'),

  /* 文件 */
  fsHome: (payload) => ipcRenderer.invoke('fs:home', payload),
  fsList: (payload) => ipcRenderer.invoke('fs:list', payload),
  fsDelete: (payload) => ipcRenderer.invoke('fs:delete', payload),
  fsDeletePlain: (payload) => ipcRenderer.invoke('fs:deletePlain', payload),
  fsCopy: (payload) => ipcRenderer.invoke('fs:copy', payload),
  fsMkdir: (payload) => ipcRenderer.invoke('fs:mkdir', payload),
  fsRename: (payload) => ipcRenderer.invoke('fs:rename', payload),
  fsRead: (payload) => ipcRenderer.invoke('fs:read', payload),
  fsWrite: (payload) => ipcRenderer.invoke('fs:write', payload),
  fsDownload: (payload) => ipcRenderer.invoke('fs:download', payload),
  fsUpload: (payload) => ipcRenderer.invoke('fs:upload', payload),
  fsUploadPaths: (payload) => ipcRenderer.invoke('fs:uploadPaths', payload),

  /* 独立文件编辑器 */
  editorOpen: (payload) => ipcRenderer.invoke('editor:open', payload),
  editorCloseWindow: () => ipcRenderer.invoke('editor:closeWindow'),
  editorMinimize: () => ipcRenderer.invoke('editor:minimize'),
  editorMaximize: () => ipcRenderer.invoke('editor:maximize'),

  /* 代理 */
  proxySave: (payload) => ipcRenderer.invoke('proxy:save', payload),
  proxyDelete: (id) => ipcRenderer.invoke('proxy:delete', id),
  proxyDefault: (id) => ipcRenderer.invoke('proxy:default', id),

  /* 下载管理器 / 传输 */
  downloadsOpen: () => ipcRenderer.invoke('downloads:open'),
  downloadsMinimize: () => ipcRenderer.invoke('downloads:minimize'),
  downloadsMaximize: () => ipcRenderer.invoke('downloads:maximize'),
  downloadsClose: () => ipcRenderer.invoke('downloads:close'),
  transferList: () => ipcRenderer.invoke('transfer:list'),
  transferCancel: (id) => ipcRenderer.invoke('transfer:cancel', id),
  transferPause: (id) => ipcRenderer.invoke('transfer:pause', id),
  transferRemove: (id) => ipcRenderer.invoke('transfer:remove', id),
  transferDiscard: (id) => ipcRenderer.invoke('transfer:discard', id),
  transferClearFinished: () => ipcRenderer.invoke('transfer:clearFinished'),
  transferClearAll: () => ipcRenderer.invoke('transfer:clearAll'),
  transferPauseAll: () => ipcRenderer.invoke('transfer:pauseAll'),
  transferCancelAll: () => ipcRenderer.invoke('transfer:cancelAll'),
  transferOpenFolder: (id) => ipcRenderer.invoke('transfer:openFolder', id),
  openDownloadDir: () => ipcRenderer.invoke('transfer:openDownloadDir'),
  pickDownloadDir: () => ipcRenderer.invoke('settings:pickDownloadDir'),

  /* WebDAV 云同步 */
  webdavSave: (payload) => ipcRenderer.invoke('webdav:save', payload || {}),
  webdavTest: () => ipcRenderer.invoke('webdav:test'),
  webdavSync: () => ipcRenderer.invoke('webdav:sync'),

  /* 自绘顶栏 */
  winMinimize: () => ipcRenderer.invoke('win:minimize'),
  winMaximize: () => ipcRenderer.invoke('win:maximize'),
  winIsMaximized: () => ipcRenderer.invoke('win:isMaximized'),
  winClose: () => ipcRenderer.invoke('win:close'),
  viewReload: () => ipcRenderer.invoke('view:reload'),
  /* 界面缩放（独立存储，不写入配置文件） */
  zoomGet: () => ipcRenderer.invoke('zoom:get'),
  zoomPreview: (percent) => ipcRenderer.invoke('zoom:preview', percent),
  zoomSave: (percent) => ipcRenderer.invoke('zoom:save', percent),
  zoomReset: () => ipcRenderer.invoke('zoom:reset'),
  appQuit: () => ipcRenderer.invoke('app:quit'),
  clearData: (payload) => ipcRenderer.invoke('app:clearData', payload || {}),
  openExternal: (url) => ipcRenderer.invoke('app:openExternal', url),

  /* 工具 */
  getPathForFile: (file) => {
    try {
      return webUtils.getPathForFile(file);
    } catch (_) {
      return '';
    }
  },
  platform: process.platform,
  // 真实版本号与运行形态（便携版 / 安装版）
  appInfo: (() => {
    try {
      return ipcRenderer.sendSync('app:version') || { version: '', portable: false };
    } catch (_) {
      return { version: '', portable: false };
    }
  })(),
  on: (channel, handler) => {
    if (!EVENTS.includes(channel)) return () => {};
    const listener = (_event, payload) => handler(payload);
    ipcRenderer.on(channel, listener);
    return () => ipcRenderer.removeListener(channel, listener);
  }
};

contextBridge.exposeInMainWorld('api', api);
