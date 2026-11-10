'use strict';
/* 自绘顶栏：菜单、窗口按钮、快捷键 */
window.TitleBar = (function () {
  const $ = U.qs;
  const SITE_URL = 'https://shell.minecft.cn';

  function openSite() {
    window.api.openExternal(SITE_URL).catch((err) => U.toast(err.message || '无法打开官网', 'error'));
  }

  function actions() {
    return {
      file: [
        { label: '新增 SSH 配置…', key: 'Ctrl+N', onClick: () => Connections.openEditor(null) },
        { label: '密钥库…', onClick: () => Connections.openKeyManager() },
        { label: '管理收藏文件夹…', onClick: () => window.Files && Files.openFavorites() },
        { sep: true },
        { label: '导出配置（加密）…', onClick: () => window.AppActions && AppActions.exportConfig() },
        { label: '导入配置…', onClick: () => window.AppActions && AppActions.importConfig() },
        { label: '导入 FinalShell 配置…', onClick: () => window.AppActions && AppActions.importFinalShell() },
        { sep: true },
        { label: '下载管理器…', onClick: () => window.api.downloadsOpen() },
        { label: '软件设置…', key: 'Ctrl+,', onClick: () => Settings.open() },
        { label: 'WebDAV 同步设置…', onClick: () => Settings.open('webdav') },
        { sep: true },
        { label: '退出', onClick: () => window.api.appQuit() }
      ],
      edit: [
        { label: '复制', key: 'Ctrl+C', onClick: () => Term.menuCopy() },
        { label: '粘贴', key: 'Ctrl+V', onClick: () => Term.menuPaste() },
        { label: '全选', onClick: () => document.execCommand('selectAll') },
        { sep: true },
        { label: '命令历史…', key: 'Ctrl+Shift+H', onClick: () => window.History && History.openDialog() }
      ],
      view: [
        { label: '显示 / 隐藏服务器信息', onClick: () => $('#btn-toggle-right').click() },
        { label: '收起 / 展开下方面板', onClick: () => $('#btn-collapse-bottom').click() },
        { label: '清屏', onClick: () => Term.clearActive() },
        { sep: true },
        { label: '重新加载', onClick: () => window.api.viewReload() }
      ],
      help: [
        { label: '官方网站', onClick: () => openSite() },
        { label: U.versionText() + (U.isPortable ? '（便携版）' : ''), onClick: () => openSite() },
        { label: '作者：LIULIWANJIA', onClick: () => openSite() }
      ]
    };
  }

  function syncMax() {
    window.api.winIsMaximized().then((max) => {
      const btn = $('#tb-max');
      if (btn) {
        btn.textContent = max ? '❐' : '□';
        btn.title = max ? '还原' : '最大化';
      }
    }).catch(() => {});
  }

  function init() {
    document.querySelectorAll('.tb-menu').forEach((btn) => {
      btn.addEventListener('click', () => {
        const r = btn.getBoundingClientRect();
        U.ctxMenu(actions()[btn.dataset.menu] || [], r.left, r.bottom + 2);
      });
    });

    $('#tb-settings').addEventListener('click', () => Settings.open());
    $('#tb-downloads').addEventListener('click', () => window.api.downloadsOpen());
    $('#tb-min').addEventListener('click', () => window.api.winMinimize());
    $('#tb-max').addEventListener('click', async () => {
      await window.api.winMaximize();
      syncMax();
    });
    $('#tb-close').addEventListener('click', () => window.api.winClose());

    window.api.on('win:maximized', syncMax);
    syncMax();

    const bar = $('#titlebar');
    bar.addEventListener('dblclick', (e) => {
      if (e.target.closest('button')) return;
      window.api.winMaximize().then(syncMax);
    });

    document.addEventListener('keydown', (e) => {
      const mod = e.ctrlKey || e.metaKey;
      if (!mod) return;
      if (e.key.toLowerCase() === 'n') {
        e.preventDefault();
        Connections.openEditor(null);
      } else if (e.key === ',') {
        e.preventDefault();
        Settings.open();
      }
    });

    // 顶栏中间显示当前会话
    const updateDoc = () => {
      const s = App.active;
      $('#tb-doc').textContent = s ? `${s.config.user}@${s.config.host} — LIULI Shell` : 'SSH 工作台';
    };
    App.on('active:change', updateDoc);
    App.on('sessions:change', updateDoc);
    updateDoc();
  }

  document.addEventListener('DOMContentLoaded', init);
  return { init };
})();
