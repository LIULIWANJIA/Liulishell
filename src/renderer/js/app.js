'use strict';
/* 应用入口：初始化、布局、面板切换、全局事件 */
(function () {
  const $ = U.qs;
  let syncActive = false;

  async function main() {
    let data;
    try {
      data = await window.api.getState();
    } catch (err) {
      U.toast('读取本地配置失败: ' + err.message, 'error');
      data = {
        groups: [{ id: 'g-default', name: '默认分组' }],
        connections: [],
        snippetBoards: [],
        settings: {}
      };
    }
    App.setData(data);
    if (window.Settings) {
      Settings.readCfg();
      Settings.apply();
    }
    updateSyncStatus();

    Sidebar.init();
    Connections.init();
    Files.init();
    Snippets.init();
    Term.init();

    Sidebar.reset();
    Connections.render();
    Snippets.render();
    Term.updateEmpty();

    setupSplitters();
    setupPaneTabs();
    setupToggles();
    restoreLayout();
    updateFoot();

    App.on('sessions:change', updateFoot);
    App.on('data:change', updateFoot);
    App.on('data:change', updateSyncStatus);
    window.api.on('settings:changed', (settings) => {
      App.state.data.settings = Object.assign({}, App.state.data.settings, settings || {});
      const st = settings && settings.webdav && settings.webdav.syncStatus;
      if (st === 'syncing') syncActive = true;
      else if (st === 'success' || st === 'error' || st === 'pending') syncActive = false;
      updateSyncStatus();
    });
    window.api.on('store:state', (state) => {
      if (state) App.setData(state);
    });

    window.api.on('ui:new-connection', () => Connections.openEditor(null));
    window.api.on('ui:export-config', exportConfig);
    window.api.on('ui:import-config', importConfig);

    // 缩放变化（含 Ctrl+Shift+0 快捷键复位）：刷新设置项显示并重排终端
    window.api.on('ui:zoom', (payload) => {
      if (window.Settings && Settings.onZoomChanged) Settings.onZoomChanged(payload || {});
      else {
        window.dispatchEvent(new Event('resize'));
        if (window.Term) { try { Term.fitAll(); } catch (_) {} }
      }
    });

    $('#btn-more').addEventListener('click', (e) => {
      const rect = e.currentTarget.getBoundingClientRect();
      U.ctxMenu(
        [
          { label: '软件设置…', onClick: () => Settings.open() },
          { label: 'WebDAV 同步设置…', onClick: () => Settings.open('webdav') },
          { label: '密钥库（导入 / 管理私钥）', onClick: () => Connections.openKeyManager() },
          { sep: true },
          { label: '导出配置（加密）', onClick: exportConfig },
          { label: '导入配置', onClick: importConfig },
          { label: '导入 FinalShell 配置', onClick: importFinalShell },
          { sep: true },
          { label: U.versionText() + (U.isPortable ? '（便携版）' : ''), onClick: () => {} }
        ],
        rect.left - 40,
        rect.bottom + 4
      );
    });

    // 点击左下「云同步状态 / 上次同步时间」直接打开 WebDAV 设置
    const syncJump = (e) => {
      e.stopPropagation();
      Settings.open('webdav');
    };
    const syncRow = U.qs('.sync-status-row');
    if (syncRow) {
      syncRow.style.cursor = 'pointer';
      syncRow.title = '点击打开 WebDAV 云同步设置';
      syncRow.addEventListener('click', (e) => {
        if (e.target.closest('#btn-more')) return;
        syncJump(e);
      });
    }
    const lastRow = U.qs('#sync-last');
    if (lastRow) lastRow.addEventListener('click', syncJump);

    if (!(data.connections || []).length) {
      setTimeout(() => U.centerNotice('欢迎使用 LIULI Shell\n点击左侧「＋ 新增配置」添加第一台服务器', 4200), 500);
    }
  }

  function updateFoot() {
    $('#foot-sessions').textContent = `${App.state.sessions.size} 个会话`;
    $('#foot-conns').textContent = `${(App.state.data.connections || []).length} 个配置`;
  }

  /** 布局变化后重排右侧栏：网络心跳按固定尺寸重绘，进程预览按新的可用高度重算行数 */
  function relayoutSidebar() {
    if (!window.Sidebar || !Sidebar.relayout) return;
    try {
      Sidebar.relayout();
    } catch (_) {}
  }

  /** 搜索框上方的云同步状态：灰=未配置 / 黄=待同步 / 红=失败 / 绿=成功 / 蓝=同步中 */
  function updateSyncStatus() {
    const dot = U.qs('#sync-dot');
    const textEl = U.qs('#sync-status-text');
    if (!dot) return;
    const wd = ((App.state.data.settings || {}).webdav) || {};
    const configured = !!String(wd.url || '').trim();
    let cls = 'gray';
    let text = '未配置云同步';
    let tip = '未配置 WebDAV 云同步';
    if (configured) {
      if (!String(wd.syncUser || '').trim()) {
        cls = 'yellow';
        text = '缺少同步用户名';
        tip = '请填写同步用户名，用于确定云端文件名';
      } else if (!wd.hasSyncPass) {
        cls = 'yellow';
        text = '缺少配置加密密码';
        tip = '请填写配置加密密码后再同步';
      } else if (wd.syncStatus === 'syncing') {
        if (syncActive) {
          cls = 'syncing';
          text = '正在云同步…';
          tip = '正在与 WebDAV 同步配置';
        } else {
          cls = 'yellow';
          text = '上次同步未完成';
          tip = '上次同步未完成，请重新同步';
        }
      } else if (wd.syncStatus === 'error') {
        cls = 'red';
        text = '云同步失败';
        tip = '云同步失败：' + (wd.lastError || '未知错误');
      } else if (wd.syncStatus === 'success') {
        cls = 'green';
        text = '云同步成功';
        const age = Date.now() - (Number(wd.lastSyncAt) || 0);
        if (!wd.lastSyncAt || age < 60000) tip = '云同步刚刚完成';
        else if (age < 3600000) tip = `云同步成功 · ${Math.floor(age / 60000)} 分钟前`;
        else if (age < 86400000) tip = `云同步成功 · ${Math.floor(age / 3600000)} 小时前`;
        else tip = `云同步成功 · ${new Date(wd.lastSyncAt).toLocaleDateString()}`;
      } else {
        cls = 'yellow';
        text = '已配置，未同步';
        tip = '已配置 WebDAV，等待同步';
      }
    }
    dot.className = 'sync-dot ' + cls;
    dot.title = tip;
    if (textEl) {
      textEl.className = 'sync-status-text ' + cls;
      textEl.textContent = text;
      textEl.title = tip;
    }
    const btn = U.qs('#btn-more');
    if (btn) btn.title = '更多（导入 / 导出配置） · ' + text;

    // 上次同步成功时间（放在云同步状态文字下方）
    const lastRow = U.qs('#sync-last');
    const lastTime = U.qs('#sync-last-time');
    if (lastTime) {
      const at = Number(wd.lastSyncAt) || 0;
      lastTime.textContent = at ? U.fmtTime(at) : '—';
      lastTime.title = at ? '上次同步成功：' + U.fmtTime(at) : '尚未成功同步过';
      if (lastRow) {
        lastRow.classList.toggle('dim', !at);
        lastRow.classList.toggle('hidden', !configured);
      }
    }
  }

  /* ---------------- 配置导入导出 ---------------- */
  async function exportConfig() {
    await U.openModal({
      title: '导出配置（加密）',
      width: '440px',
      okText: '选择保存位置',
      body: `
        <div class="field"><label>设置导出密码 <span class="req">*</span></label>
          <input id="exp-pwd" type="password" placeholder="至少 6 位，导入到其他机器时需要" autocomplete="new-password" />
        </div>
        <div class="field" style="margin-top:8px"><label>确认密码</label>
          <input id="exp-pwd2" type="password" placeholder="再次输入" autocomplete="new-password" />
        </div>
        <div class="hint" style="margin-top:10px;color:#8b95a5;line-height:1.6">
          导出内容包含连接地址、账号、密码与私钥，使用 AES-256-GCM + scrypt 加密，
          可安全拷贝到其他电脑后用「导入配置」恢复。
        </div>`,
      onOk: async () => {
        const p1 = $('#exp-pwd').value;
        const p2 = $('#exp-pwd2').value;
        if (!p1 || p1.length < 6) throw new Error('导出密码至少 6 位');
        if (p1 !== p2) throw new Error('两次输入的密码不一致');
        const r = await window.api.exportConfig({ passphrase: p1 });
        if (!r || !r.ok) {
          U.toast('已取消导出', 'info', 1600);
          return true;
        }
        U.toast(`已导出 ${r.count} 个配置 → ${r.path}`, 'ok', 4200);
        return true;
      }
    });
  }

  async function importConfig() {
    await U.openModal({
      title: '导入配置',
      width: '440px',
      okText: '选择文件并导入',
      body: `
        <div class="field"><label>配置文件密码 <span class="req">*</span></label>
          <input id="imp-pwd" type="password" placeholder="导出时设置的密码" autocomplete="new-password" />
        </div>
        <div class="hint" style="margin-top:10px;color:#8b95a5;line-height:1.6">
          导入时会自动创建缺失的分组；已存在（主机 + 端口 + 用户名相同）的连接会被跳过。
        </div>`,
      onOk: async () => {
        const p = $('#imp-pwd').value;
        if (!p) throw new Error('请输入配置文件密码');
        const r = await window.api.importConfig({ passphrase: p });
        if (!r || !r.ok) {
          U.toast('已取消导入', 'info', 1600);
          return true;
        }
        App.setData(r.state);
        U.toast(`导入完成：新增 ${r.added} 个，跳过 ${r.skipped} 个`, 'ok', 3600);
        return true;
      }
    });
  }

  /* ---------------- 导入 FinalShell 配置 ---------------- */
  function importFinalShell() {
    window.api.finalshellOpen();
  }

  /* ---------------- 布局拖拽 ---------------- */
  function setupSplitters() {
    const root = document.documentElement;
    let mode = null;

    const onMove = (e) => {
      if (!mode) return;
      if (mode === 'left') {
        root.style.setProperty('--left-w', U.clamp(e.clientX, 190, 320) + 'px');
      } else if (mode === 'right') {
        const w = U.clamp(window.innerWidth - e.clientX, 226, Math.min(380, window.innerWidth * 0.5));
        root.style.setProperty('--right-w', w + 'px');
      } else if (mode === 'bottom') {
        const h = U.clamp(window.innerHeight - e.clientY, 120, window.innerHeight - 150);
        root.style.setProperty('--bottom-h', h + 'px');
        $('#bottom-pane').classList.remove('collapsed');
        $('#btn-collapse-bottom').textContent = '▾';
      }
      Term.fitActive();
    };

    const onUp = () => {
      if (!mode) return;
      document.querySelectorAll('.splitter').forEach((s) => s.classList.remove('dragging'));
      mode = null;
      document.body.classList.remove('resizing');
      saveLayout();
      Term.fitActive();
      relayoutSidebar();
    };

    const bind = (el, m) => {
      if (!el) return;
      el.addEventListener('mousedown', (e) => {
        e.preventDefault();
        mode = m;
        el.classList.add('dragging');
        document.body.classList.add('resizing');
      });
    };
    bind($('#split-left'), 'left');
    bind($('#split-right'), 'right');
    bind($('#split-h'), 'bottom');
    // 命令编辑器顶部把手：上下拖动调高度，写同一个 --bottom-h，与下方面板/左侧监控/右侧栏同步
    bind($('#ce-resize'), 'bottom');

    // 双击任一把手复位到默认高度
    ['#split-h', '#ce-resize'].forEach((sel) => {
      const el = $(sel);
      if (!el) return;
      el.addEventListener('dblclick', () => {
        root.style.setProperty('--bottom-h', defaultBottomHeight() + 'px');
        $('#bottom-pane').classList.remove('collapsed');
        $('#btn-collapse-bottom').textContent = '▾';
        saveLayout();
        Term.fitActive();
      });
    });

    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    window.addEventListener('resize', U.debounce(relayoutSidebar, 160));
  }

  const LAYOUT_VERSION = 5;

  // 下方面板/命令编辑器默认取窗口高度的 40%（最小 120px），所有分辨率一致
  function defaultBottomHeight() {
    return Math.max(120, Math.round(window.innerHeight * 0.4));
  }

  function saveLayout() {
    const root = getComputedStyle(document.documentElement);
    const layout = {
      v: LAYOUT_VERSION,
      leftW: parseInt(root.getPropertyValue('--left-w'), 10) || 214,
      rightW: parseInt(root.getPropertyValue('--right-w'), 10) || 252,
      bottomH: parseInt(root.getPropertyValue('--bottom-h'), 10) || defaultBottomHeight(),
      infoHidden: $('#app').classList.contains('info-hidden'),
      bottomCollapsed: $('#bottom-pane').classList.contains('collapsed')
    };
    App.state.data.settings.layout = layout;
    window.api.saveSettings({ layout });
  }

  function restoreLayout() {
    const l = App.settings.layout || {};
    const root = document.documentElement;
    // 布局结构变更后（版本不一致）重置为新的默认宽度，避免沿用旧版过宽的侧栏
    const fresh = l.v !== LAYOUT_VERSION;
    if (fresh) {
      // 新版本默认展开右侧服务器信息栏
      $('#app').classList.remove('info-hidden');
      if (window.Settings) Settings.setPanel('rightInfo', true);
    }
    if (l.leftW) root.style.setProperty('--left-w', U.clamp(l.leftW, 190, 320) + 'px');
    if (l.rightW) root.style.setProperty('--right-w', U.clamp(l.rightW, 226, 380) + 'px');
    // 版本变更时不再沿用旧高度，改用新的默认高度
    if (!fresh && l.bottomH) {
      root.style.setProperty('--bottom-h', U.clamp(l.bottomH, 120, window.innerHeight - 150) + 'px');
    } else {
      root.style.setProperty('--bottom-h', U.clamp(defaultBottomHeight(), 120, window.innerHeight - 150) + 'px');
    }
    if (l.bottomCollapsed) {
      $('#bottom-pane').classList.add('collapsed');
      $('#app').classList.add('bottom-collapsed');
      $('#btn-collapse-bottom').textContent = '▴';
    } else {
      $('#app').classList.remove('bottom-collapsed');
      $('#btn-collapse-bottom').textContent = '▾';
    }
    if (fresh) setTimeout(saveLayout, 300);
  }

  /* ---------------- 面板 ---------------- */
  function setupPaneTabs() {
    document.querySelectorAll('.pane-tab').forEach((tab) => {
      tab.addEventListener('click', () => {
        document.querySelectorAll('.pane-tab').forEach((t) => t.classList.toggle('active', t === tab));
        const page = tab.dataset.page;
        document.querySelectorAll('.page').forEach((p) => p.classList.toggle('active', p.id === 'page-' + page));
        if (page === 'files') Files.refresh();
        else if (page === 'snippets') Snippets.render();
        Term.fitActive();
      });
    });
  }

  function setupToggles() {
    const app = $('#app');

    $('#btn-collapse-bottom').addEventListener('click', () => {
      const pane = $('#bottom-pane');
      pane.classList.toggle('collapsed');
      const collapsed = pane.classList.contains('collapsed');
      app.classList.toggle('bottom-collapsed', collapsed);
      $('#btn-collapse-bottom').textContent = collapsed ? '▴' : '▾';
      saveLayout();
      Term.fitActive();
      relayoutSidebar();
    });

    // 只隐藏「服务器信息」面板，命令编辑器始终保留
    const toggleRight = (force) => {
      const hide = typeof force === 'boolean' ? force : !app.classList.contains('info-hidden');
      app.classList.toggle('info-hidden', hide);
      if (window.Settings) Settings.setPanel('rightInfo', !hide);
      const btn = $('#btn-toggle-right');
      btn.classList.toggle('active', hide);
      btn.title = hide ? '显示服务器信息面板' : '隐藏服务器信息面板';
      saveLayout();
      Term.fitActive();
      relayoutSidebar();
    };

    $('#btn-collapse-right').addEventListener('click', () => toggleRight(true));
    $('#btn-toggle-right').addEventListener('click', () => toggleRight());

    $('#btn-clear-term').addEventListener('click', () => Term.clearActive());
  }

  async function toggleLeftSidebar() {
    const app = $('#app');
    const show = app.classList.contains('hide-left-all');
    const base = App.settings.panels || {};
    const panels = Object.assign({}, base, {
      leftList: show,
      leftMonitors: show,
      leftFoot: show
    });
    if (window.Settings) await Settings.persist({ panels });
    Term.fitActive();
    relayoutSidebar();
    saveLayout();
    U.toast(show ? '已显示服务器列表' : '已隐藏服务器列表', 'ok', 1400);
  }

  async function resetLayout() {
    const root = document.documentElement;
    root.style.setProperty('--left-w', '214px');
    root.style.setProperty('--right-w', '252px');
    const panes = window.Settings && Settings.DEFAULTS
      ? Object.assign({}, Settings.DEFAULTS.panels)
      : {
          leftList: true, leftMonitors: true, leftFoot: true, tabs: true, cmdBar: true,
          rightInfo: true, cmdEditor: true, files: true, snippets: true
        };
    if (window.Settings) await Settings.persist({ panels: panes });
    try { await window.api.resetWindowLayout(); } catch (_) {}
    try { await window.api.zoomReset(); } catch (_) {}
    // 窗口尺寸与缩放恢复后再算底栏高度，否则会用到重置前的 innerHeight
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
    root.style.setProperty('--bottom-h', defaultBottomHeight() + 'px');
    $('#bottom-pane').classList.remove('collapsed');
    $('#app').classList.remove('bottom-collapsed');
    $('#btn-collapse-bottom').textContent = '▾';
    saveLayout();
    Term.fitActive();
    relayoutSidebar();
    U.toast('布局、窗口位置与缩放已重置', 'ok', 1800);
  }

  window.AppActions = { exportConfig, importConfig, importFinalShell, toggleLeftSidebar, resetLayout };
  document.addEventListener('DOMContentLoaded', main);
})();
