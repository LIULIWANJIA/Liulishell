'use strict';
/* 终端：会话创建、xterm 实例、标签页、命令输入区 */
window.Term = (function () {
  const host = U.qs('#term-host');
  const emptyEl = U.qs('#empty-state');
  const tabsEl = U.qs('#tabs');
  const tabsBar = U.qs('#tabs-bar');
  const tabsSecond = U.qs('#tabs-second');
  const tabsSecondScroll = U.qs('#tabs-second-scroll');
  const cmdInput = U.qs('#cmd-input');
  let history = [];
  let hisIndex = -1;
  let fontSize = 13;

  // 让 shell 在每次提示符前用 OSC 7 上报当前目录，实现「终端 cd」与文件树联动
  // 行首空格 + history -d -1：尽量避免这条注入命令进入 bash 历史记录
  const OSC7_BASE =
    " __liuli_cwd(){ printf '\\033]7;file://%s%s\\033\\\\' \"${HOSTNAME:-localhost}\" \"$PWD\"; }; " +
    'PROMPT_COMMAND="__liuli_cwd${PROMPT_COMMAND:+; $PROMPT_COMMAND}"; history -d -1 2>/dev/null;';
  const OSC7_SETUP = OSC7_BASE + ' clear';

  let dragSid = null;
  let dropAfter = false;
  /* 空白标签页：软件启动时默认存在，+ 最多只保留一个；连接服务器时被占用 */
  let blankExists = true;
  let blankActive = true;
  let tabRowCount = 1;
  let lastScrollSig = '';

  let THEME = {
    background: '#fbfaf7',
    foreground: '#15191d',
    cursor: '#16665a',
    cursorAccent: '#fbfaf7',
    selectionBackground: '#dfeae6',
    black: '#3a424c',
    red: '#c0392b',
    green: '#1e7f5c',
    yellow: '#a8791a',
    blue: '#2b5fa8',
    magenta: '#8b4f9f',
    cyan: '#1c7a8a',
    white: '#5d666f',
    brightBlack: '#6b7686',
    brightRed: '#e05a4f',
    brightGreen: '#2aa376',
    brightYellow: '#d09b2c',
    brightBlue: '#4a81cf',
    brightMagenta: '#a86cb8',
    brightCyan: '#2a9bab',
    brightWhite: '#15191d'
  };

  const LIGHT_ANSI = {
    black: '#3a424c', red: '#c0392b', green: '#1e7f5c', yellow: '#a8791a',
    blue: '#2b5fa8', magenta: '#8b4f9f', cyan: '#1c7a8a', white: '#5d666f',
    brightBlack: '#6b7686', brightRed: '#e05a4f', brightGreen: '#2aa376', brightYellow: '#d09b2c',
    brightBlue: '#4a81cf', brightMagenta: '#a86cb8', brightCyan: '#2a9bab', brightWhite: '#15191d'
  };

  const DARK_ANSI = {
    black: '#2b333f', red: '#ef6b6b', green: '#5fd39a', yellow: '#e8c06a',
    blue: '#6aa7ff', magenta: '#c79bf0', cyan: '#59c9d6', white: '#d3dbe6',
    brightBlack: '#6b7686', brightRed: '#ff8787', brightGreen: '#84e3b4', brightYellow: '#f5d78e',
    brightBlue: '#8dbdff', brightMagenta: '#dcb8ff', brightCyan: '#87e0ea', brightWhite: '#ffffff'
  };

  /** 主题切换时同步终端配色（含配套文字颜色与 ANSI 色板） */
  function applyTheme(t) {
    if (!t || !t.bg) return;
    THEME = Object.assign(
      {
        background: t.bg,
        foreground: t.fg || '#15191d',
        cursor: t.cursor || '#16665a',
        cursorAccent: t.bg,
        selectionBackground: t.selection || 'rgba(22,102,90,.22)'
      },
      t.dark ? DARK_ANSI : LIGHT_ANSI
    );
    App.state.sessions.forEach((s) => {
      if (s.term) s.term.options.theme = THEME;
    });
  }

  function init() {
    fontSize = Number(App.settings.fontSize) || 13;

    // 命令历史持久化：启动时载入，之后由 History 模块广播变更
    if (window.History) {
      window.api
        .historyList()
        .then((l) => {
          history = ((l || []).map((x) => x.cmd) || []).reverse();
        })
        .catch(() => {});
      App.on('history:change', () => {
        history = History.commands();
        hisIndex = -1;
      });
    }

    U.qs('#btn-send').addEventListener('click', sendCommand);
    const prevBtn = U.qs('#tabs-prev');
    const nextBtn = U.qs('#tabs-next');
    if (prevBtn) prevBtn.addEventListener('click', () => moveTabRow(-1));
    if (nextBtn) nextBtn.addEventListener('click', () => moveTabRow(1));
    if (tabsSecondScroll) tabsSecondScroll.addEventListener('scroll', updateTabArrows);
    setupInteractions();
    cmdInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        sendCommand();
      } else if (e.key === 'ArrowUp') {
        if (!history.length) return;
        e.preventDefault();
        hisIndex = Math.min(history.length - 1, hisIndex + 1);
        cmdInput.value = history[history.length - 1 - hisIndex] || '';
        setTimeout(() => cmdInput.setSelectionRange(cmdInput.value.length, cmdInput.value.length), 0);
      } else if (e.key === 'ArrowDown') {
        if (!history.length) return;
        e.preventDefault();
        hisIndex = Math.max(-1, hisIndex - 1);
        cmdInput.value = hisIndex < 0 ? '' : history[history.length - 1 - hisIndex];
      }
    });
    U.qs('#cmd-target').addEventListener('change', (e) => {
      App.setSendTarget(e.target.value);
    });
    const syncTargetUI = () => {
      const sel = U.qs('#cmd-target');
      if (sel) sel.value = App.state.sendTarget || 'current';
    };
    App.on('target:change', syncTargetUI);
    App.on('data:change', syncTargetUI);
    syncTargetUI();

    App.on('active:change', () => {
      if (App.state.activeId) blankActive = false;
      renderTabs();
      syncPanes();
      fitActive();
      focusActive();
    });
    App.on('sessions:change', () => {
      renderTabs();
      syncPanes();
      updateEmpty();
    });

    // 主进程事件
    window.api.on('term:data', ({ sessionId, data }) => {
      const s = App.session(sessionId);
      if (s && s.term) s.term.write(data);
      else {
        const buf = App.state.pendingData.get(sessionId) || '';
        App.state.pendingData.set(sessionId, buf + data);
      }
      // 收到新输出说明连接已恢复，橙灯回到绿灯
      if (s && s.status === 'unstable') {
        s.status = 'online';
        renderTabs();
        if (window.Connections) Connections.render();
        if (App.state.activeId === s.id && window.Sidebar) Sidebar.renderAll(s);
      }
    });

    window.api.on('session:sysinfo', ({ sessionId, sysinfo }) => {
      const s = App.session(sessionId);
      // 系统信息可能在真实会话加入 App 之前返回，先缓存，等会话建好后补上
      if (!s) {
        App.state.pendingSysinfo.set(sessionId, sysinfo || {});
        return;
      }
      s.sysinfo = sysinfo || {};
      if (App.state.activeId === sessionId && window.Sidebar) Sidebar.renderAll(s);
    });

    window.api.on('session:closed', ({ sessionId, reason }) => {
      const s = App.session(sessionId);
      if (!s || s.closing) return;
      if (s.status === 'offline') return;
      s.status = 'offline';
      s.error = reason === 'shell-closed' ? '会话已结束' : '连接已断开';
      if (s.term) {
        try { s.term.options.cursorBlink = false; } catch (_) {}
        s.term.write(
          `\r\n\x1b[31m● ${s.error}，无法继续输入。右键标签选择「连接」重新连接，或点击标签上的 ✕ 关闭。\x1b[0m\r\n`
        );
      }
      renderTabs();
      if (window.Connections) Connections.render();
      // 让侧栏/文件管理器同步为断开状态
      if (App.state.activeId === sessionId) App.setActive(sessionId);
      U.toast(`${s.config.name || s.config.host} ${s.error}`, 'error', 3600);
    });

    window.api.on('session:error', ({ sessionId, message }) => {
      const s = App.session(sessionId);
      if (!s) return;
      // 连接仍在但报错：先标记为不稳定（橙灯），真正断开后转红
      if (s.status === 'online') {
        s.status = 'unstable';
        renderTabs();
        if (window.Connections) Connections.render();
        if (App.state.activeId === sessionId && window.Sidebar) Sidebar.renderAll(s);
      }
      if (s.status !== 'offline' && Date.now() - (s.errToastAt || 0) > 3500) {
        s.errToastAt = Date.now();
        U.toast(`${s.config.name || s.config.host} 出错：${U.cleanError(message)}`, 'error', 4000);
      }
    });

    window.api.on('session:unstable', ({ sessionId }) => {
      const s = App.session(sessionId);
      if (!s || s.status !== 'online') return;
      s.status = 'unstable';
      renderTabs();
      if (window.Connections) Connections.render();
      if (App.state.activeId === sessionId && window.Sidebar) Sidebar.renderAll(s);
    });

    window.api.on('session:stable', ({ sessionId }) => {
      const s = App.session(sessionId);
      if (!s || s.status !== 'unstable') return;
      s.status = 'online';
      renderTabs();
      if (window.Connections) Connections.render();
      if (App.state.activeId === sessionId && window.Sidebar) Sidebar.renderAll(s);
    });

    // 标签右键菜单：连接 / 连接全部 / 关闭当前 / 关闭其他 / 关闭全部
    tabsBar.addEventListener('contextmenu', (e) => {
      const tab = e.target.closest('.term-tab[data-sid]');
      if (!tab) return;
      e.preventDefault();
      const s = App.session(tab.dataset.sid);
      if (!s) return;
      const offline = Array.from(App.state.sessions.values()).filter((x) => x.status === 'offline' || x.status === 'unstable');
      U.ctxMenu(
        [
          s.status === 'online'
            ? { label: '已连接', disabled: true }
            : { label: s.status === 'connecting' ? '连接中…' : '连接', disabled: s.status === 'connecting', onClick: () => reconnectSession(s) },
          { label: `连接全部（重连 ${offline.length} 个断开项）`, disabled: !offline.length, onClick: reconnectAllOffline },
          { sep: true },
          { label: '关闭当前', onClick: () => closeSession(s.id) },
          { label: '关闭其他', onClick: () => closeOthers(s.id) },
          { label: '关闭全部', danger: true, onClick: closeAll }
        ],
        e.clientX,
        e.clientY
      );
    });

    const ro = new ResizeObserver(
      U.debounce(() => {
        fitActive();
      }, 120)
    );
    ro.observe(host);
    window.addEventListener('resize', U.debounce(() => fitActive(), 150));
    if (tabsBar) {
      let tabBarW = tabsBar.clientWidth;
      const tro = new ResizeObserver(
        U.debounce(() => {
          const w = tabsBar.clientWidth;
          if (Math.abs(w - tabBarW) > 1) {
            tabBarW = w;
            layoutTabRows();
            scrollActiveTab(true);
          }
        }, 80)
      );
      tro.observe(tabsBar);
      const toolsEl = U.qs('.tabs-tools');
      if (toolsEl) {
        let toolsW = toolsEl.offsetWidth;
        const toolRo = new ResizeObserver(
          U.debounce(() => {
            const w = toolsEl.offsetWidth;
            if (Math.abs(w - toolsW) > 1) {
              toolsW = w;
              layoutTabRows();
            }
          }, 80)
        );
        toolRo.observe(toolsEl);
      }
    }
    renderTabs();
    updateEmpty();
  }

  /* ---------------- 空白标签页 ---------------- */

  /** 标签名按当前可显示字数截断（最多 12 字，紧张时逐步缩到 3 字） */
  function labelFor(name, maxChars) {
    const chars = Array.from(String(name || '').trim() || '终端');
    return chars.length > maxChars ? chars.slice(0, maxChars).join('') + '…' : chars.join('');
  }

  /** 本次连接是否会走代理（直接连接 / 配置未启用 / 没有代理节点时都走本地网络） */
  function usesProxyFor(cfg, opts) {
    const mode = (opts && opts.proxyMode) || 'config';
    const proxies = App.settings.proxies || [];
    if (!proxies.length || mode === 'none') return false;
    if (mode === 'default') return true;
    return !!cfg.proxyEnabled;
  }

  function activateBlank() {
    blankExists = true;
    blankActive = true;
    if (window.Details) Details.deactivate();
    if (App.state.activeId !== null) App.setActive(null);
    renderTabs();
    syncPanes();
    updateEmpty();
  }

  function openBlankTab() {
    if (!blankExists) {
      blankExists = true;
      blankActive = true;
    }
    activateBlank();
  }

  function closeBlankTab() {
    if (!blankExists) return;
    blankExists = false;
    blankActive = false;
    if (!App.state.sessions.size) {
      // 没有连接时空白页是唯一的起点，关闭后立即恢复
      ensureBlankOnEmpty();
    } else if (App.state.activeId === null) {
      const first = App.state.sessions.keys().next().value;
      if (first) App.setActive(first);
    }
    renderTabs();
    syncPanes();
    updateEmpty();
  }

  /** 连接服务器时占用空白标签页，而不是保留空白页再新开一个 */
  function consumeBlankTab() {
    if (!blankExists) return;
    blankExists = false;
    blankActive = false;
  }

  function ensureBlankOnEmpty() {
    if (App.state.sessions.size) return;
    blankExists = true;
    blankActive = true;
    if (App.state.activeId !== null) App.setActive(null);
  }

  /* ---------------- 连接 ---------------- */

  function createPendingSession(cfg, insertAt, viaProxy, proxyMode) {
    const id = 'pending-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 6);
    const sess = {
      id,
      config: Object.assign({}, cfg),
      viaProxy: !!viaProxy,
      // 记住本次连接用的代理模式（右键「直接连接」为 none），重连时沿用
      proxyMode: proxyMode || '',
      promptSeq: 0,
      proxyName: '',
      sysinfo: {},
      stats: null,
      procs: [],
      procSort: 'cpu',
      nic: '',
      netHistory: [],
      remotePath: null,
      termCwd: null,
      status: 'connecting',
      error: '',
      term: null,
      fit: null,
      pane: null
    };
    App.addSession(sess, insertAt);
    createPendingPane(
      sess,
      `正在连接 ${cfg.user}@${cfg.host}:${cfg.port} …`,
      viaProxy ? '正在通过代理建立 SSH 会话…' : '正在用本地网络建立 SSH 会话…'
    );
    if (window.Details) Details.deactivate();
    App.setActive(id);
    return sess;
  }

  function createPendingPane(sess, text, hint) {
    const pane = document.createElement('div');
    pane.className = 'term-pane pending';
    pane.dataset.sid = sess.id;
    pane.innerHTML = pendingHtml(text, false, hint);
    host.appendChild(pane);
    sess.pane = pane;
    syncPanes();
  }

  function pendingHtml(text, isError, hint) {
    return `<div class="pending-box${isError ? ' error' : ''}">
      ${isError ? '<div class="pending-ico">!</div>' : '<div class="pending-spin"></div>'}
      <div class="pending-title">${U.esc(isError ? '连接失败' : text)}</div>
      ${isError ? `<div class="pending-sub err">${U.esc(text)}</div><div class="pending-hint">右键标签选择「连接」重试，或点击标签上的 ✕ 关闭</div>` : `<div class="pending-bar"><i></i></div><div class="pending-hint">${U.esc(hint || '正在建立 SSH 会话…')}</div>`}
    </div>`;
  }

  /**
   * 配置里缺少凭据时返回提示文案（用于连接前弹窗）
   * opts 里带 authType 时以本次选择的登录方式为准：
   * 例如配置存的是空密码，但在凭据浮窗里改用密钥重连，就不该再提示“没有保存密码”。
   */
  function missingCredential(cfg, opts) {
    if (!cfg) return '';
    const authType = (opts && opts.authType) || cfg.authType;
    if (authType === 'key') {
      const has =
        (opts && (opts.keyId || opts.privateKey || opts.passphrase || opts.keyPath)) ||
        cfg.keyId || cfg.hasPrivateKey || cfg.keyPath;
      return has ? '' : '该服务器还没有可用密钥';
    }
    const hasPass = (opts && opts.password) || cfg.hasPassword;
    return hasPass ? '' : '该服务器还没有保存登录密码';
  }

  async function connect(configId, opts, insertAt) {
    const cfg = App.findConnection(configId);
    if (!cfg) return U.toast('配置不存在', 'error');

    // 密码 / 私钥为空：直接弹凭据输入框，不去建一个必然失败的标签
    // 本次调用自带凭据（含从密钥库选中的 keyId）时不拦，直接尝试连接
    const hasCred = !!(opts && (opts.password || opts.privateKey || opts.passphrase || opts.keyId));
    const missing = missingCredential(cfg, opts);
    if (missing && !hasCred && window.AuthPrompt) {
      AuthPrompt.open({ configId: cfg.id, reason: missing + '，请先输入后再连接。' });
      return null;
    }

    // 先建一个「连接中」标签，连接进度显示在新标签内，不占用当前终端
    // 从服务器列表 / 最近连接发起的新连接会占用空白标签页；重连时传入原标签位置 insertAt
    const viaProxy = usesProxyFor(cfg, opts);
    const proxyMode = (opts && opts.proxyMode) || '';
    if (!(opts && opts.keepBlank)) consumeBlankTab();
    const pending = createPendingSession(cfg, insertAt, viaProxy, proxyMode);
    let real = null;
    try {
      const res = await window.api.connect(configId, opts);
      // 先打开 shell，成功后再把占位标签替换为真实终端
      await window.api.termOpen({ sessionId: res.sessionId, cols: 100, rows: 30 });

      real = {
        id: res.sessionId,
        config: Object.assign({}, cfg, res.config),
        viaProxy: !!res.viaProxy,
        proxyMode,
        promptSeq: 0,
        proxyName: res.proxyName || '',
        sysinfo: res.sysinfo || {},
        stats: null,
        procs: [],
        procSort: 'cpu',
        nic: '',
        netHistory: [],
        remotePath: null,
        termCwd: null,
        status: 'online',
        error: '',
        term: null,
        fit: null,
        pane: null
      };
      if (pending.pane && pending.pane.parentNode) pending.pane.parentNode.removeChild(pending.pane);
      const pendingInfo = App.state.pendingSysinfo.get(real.id);
      if (pendingInfo) {
        real.sysinfo = pendingInfo;
        App.state.pendingSysinfo.delete(real.id);
      }
      App.replaceSession(pending.id, real);
      createTerm(real);
      App.setActive(real.id);

      // 目录联动：开启时注入 OSC7 钩子（默认清屏）；关闭时不注入，仅在需要时清 MOTD
      if (App.settings.dirSync !== false) {
        const setup = cfg.clearMotd === false ? OSC7_BASE : OSC7_SETUP;
        window.api.termWrite({ sessionId: real.id, data: setup + '\r' });
      } else if (cfg.clearMotd !== false) {
        window.api.termWrite({ sessionId: real.id, data: ' clear; history -d -1 2>/dev/null\r' });
      }

      const buffered = App.state.pendingData.get(real.id);
      if (buffered) {
        real.term.write(buffered);
        App.state.pendingData.delete(real.id);
      }
      setTimeout(() => fitActive(), 30);
      real.term.focus();
      if (!cfg.deletedAt && window.Recent) Recent.record(cfg);
      U.toast('已连接 ' + (cfg.name || cfg.host) + (real.viaProxy ? '（经代理）' : ''), 'ok', 1800);
      return real;
    } catch (err) {
      if (real) {
        try { await window.api.disconnect(real.id); } catch (_) {}
        cleanup(real.id);
      }
      pending.status = 'offline';
      pending.error = U.cleanError(err);
      if (pending.pane) pending.pane.innerHTML = pendingHtml(pending.error, true);
      renderTabs();
      if (App.state.activeId === pending.id && window.Sidebar) Sidebar.renderAll(pending);
      U.toast(pending.error, 'error', 5200);
      // 认证类失败：额外弹出凭据输入（无遮罩，不影响主窗格操作）
      if (window.AuthPrompt && AuthPrompt.shouldPrompt(pending.error)) {
        AuthPrompt.open({ configId: cfg.id, session: pending, reason: pending.error });
      }
      return null;
    }
  }

  function createTerm(sess) {
    const pane = document.createElement('div');
    pane.className = 'term-pane';
    pane.dataset.sid = sess.id;
    host.appendChild(pane);

    const f = App.settings.fonts || {};
    const term = new Terminal({
      fontFamily: `${f.en || 'Consolas, "Cascadia Mono", monospace'}, ${f.zh || '"Microsoft YaHei", sans-serif'}, monospace`,
      fontSize: Number(f.size) || fontSize,
      lineHeight: 1.22,
      letterSpacing: 0,
      cursorBlink: true,
      cursorStyle: 'bar',
      scrollback: 8000,
      allowTransparency: false,
      theme: THEME,
      macOptionIsMeta: true
    });
    const fit = new FitAddon.FitAddon();
    term.loadAddon(fit);
    term.open(pane);
    try {
      fit.fit();
    } catch (_) {}

    term.onData((data) => {
      if (sess.status !== 'online') {
        if (Date.now() - (sess.blockedToastAt || 0) > 2500) {
          sess.blockedToastAt = Date.now();
          U.toast('连接已断开，无法输入。右键标签选择「连接」重新连接', 'error', 2600);
        }
        return;
      }
      window.api.termWrite({ sessionId: sess.id, data });
      // Ctrl+C 中断后停止剩余排队命令，并回到最底部
      if (data.indexOf('\x03') >= 0) {
        sess.sendQueue = [];
        term.scrollToBottom();
      }
    });
    term.onResize(({ cols, rows }) => {
      window.api.termResize({ sessionId: sess.id, cols, rows });
    });

    // OSC 7：shell 上报当前目录 → 同步文件管理器
    try {
      term.parser.registerOscHandler(7, (data) => {
        // 每次提示符都会上报 OSC7：多行命令用它判断上一条命令是否已经执行完
        sess.promptSeq = (Number(sess.promptSeq) || 0) + 1;
        const m = /^file:\/\/[^/]*(\/.*)$/.exec(data);
        if (m) {
          let p = m[1];
          try {
            p = decodeURIComponent(p);
          } catch (_) {}
          handleCwd(sess, p);
        }
        return true;
      });
    } catch (_) {}

    pane.addEventListener('mousedown', () => {
      if (App.state.activeId !== sess.id) App.setActive(sess.id);
    });

    sess.term = term;
    sess.fit = fit;
    sess.pane = pane;
    syncPanes();
  }

  /** 记录一条命令到本地历史（↑↓ 与历史弹窗共用） */
  function recordHistoryLine(cmd) {
    const text = String(cmd || '').trim();
    if (!text) return;
    history.push(text);
    if (history.length > 300) history.shift();
    hisIndex = -1;
    if (window.History) History.record(text);
  }

  function cleanup(sessionId, opts) {
    const s = App.session(sessionId);
    if (!s) return;
    s.closing = true;
    try {
      if (s.term) s.term.dispose();
    } catch (_) {}
    if (s.pane && s.pane.parentNode) s.pane.parentNode.removeChild(s.pane);
    App.state.pendingSysinfo.delete(sessionId);
    if (window.Details) Details.closeSession(sessionId);
    if (window.FileEditor) FileEditor.closeSession(sessionId);
    App.removeSession(sessionId);
    if (!(opts && opts.keepBlank)) ensureBlankOnEmpty();
    updateEmpty();
    renderTabs();
  }

  /* ---------------- 目录联动 ---------------- */

  function handleCwd(sess, path) {
    if (!path || path[0] !== '/') return;
    // 只响应终端 cwd 的真实变化，避免每条命令执行后都把文件管理器拉回终端目录
    if (sess.termCwd === path) return;
    sess.termCwd = path;
    if (sess.remotePath === path) return;
    sess.remotePath = path;
    if (App.state.activeId !== sess.id) return;
    if (window.Files) Files.syncFromTerminal(path);
  }

  /** 在文件管理器里进入目录时，把终端也 cd 过去 */
  function cdTo(sessionId, path) {
    const s = App.session(sessionId);
    if (!s || !path || s.lastCd === path) return;
    s.lastCd = path;
    const quoted = "'" + String(path).replace(/'/g, "'\\''") + "'";
    window.api.termWrite({ sessionId, data: 'cd ' + quoted + '\r' });
  }

  async function closeSession(sessionId) {
    const s = App.session(sessionId);
    if (!s) return;
    s.closing = true;
    try {
      await window.api.disconnect(sessionId);
    } catch (_) {}
    cleanup(sessionId);
  }

  /* ---------------- 标签 ---------------- */

  function renderTabs() {
    if (dragSid) return; // 拖动中不重绘，避免打断拖拽
    const list = Array.from(App.state.sessions.values());
    const details = window.Details ? Details.list() : [];
    const activeDetail = window.Details ? Details.getActive() : null;

    let html = list
      .map((s) => {
        const st = s.status || 'online';
        const dotCls = st === 'online' ? 'online' : st === 'connecting' ? 'connecting' : st === 'unstable' ? 'unstable' : 'failed';
        const stText = st === 'online' ? '已连接' : st === 'connecting' ? '连接中' : st === 'unstable' ? '连接不稳定' : '已断开';
        const name = s.config.name || s.config.host;
        const label = labelFor(name, 12);
        const title = `${s.config.user}@${s.config.host} · ${stText}${s.viaProxy ? ' · 代理' : ''}`;
        return `<div class="term-tab${
          !activeDetail && s.id === App.state.activeId ? ' active' : ''
        }" data-sid="${s.id}" data-name="${U.esc(name)}">
          <span class="dot ${dotCls}" title="${stText}"></span>
          <span class="t-name" title="${U.esc(title)}">
            <span class="t-label">${U.esc(label)}</span>
            ${s.viaProxy ? '<i class="t-proxy" title="代理">代</i>' : ''}
          </span>
          <button class="t-close" data-close="${s.id}" title="关闭">✕</button>
        </div>`;
      })
      .join('');

    html += details
      .map(
        (d) => `<div class="term-tab detail${activeDetail && activeDetail.key === d.key ? ' active' : ''}" data-dkey="${d.key}">
          <span class="t-icon">${d.type === 'procs' ? '▤' : '◎'}</span>
          <span class="t-name" title="${U.esc(d.title)}"><span class="t-label">${U.esc(d.short)}</span></span>
          <button class="t-close" data-dclose="${d.key}" title="关闭">✕</button>
        </div>`
      )
      .join('');

    if (blankExists) {
      const active = blankActive && !activeDetail && App.state.activeId === null;
      html += `<div class="term-tab blank${active ? ' active' : ''}" data-blank="1" title="最近连接">
        <span class="t-icon">❯_</span>
        <span class="t-name"><span class="t-label">最近连接</span></span>
        <button class="t-close" data-blankclose="1" title="关闭">✕</button>
      </div>`;
    }
    html += '<button class="tab-add" type="button" title="新建空白标签页">＋</button>';

    const prevSecondScroll = tabsSecondScroll ? tabsSecondScroll.scrollLeft : 0;
    tabsEl.innerHTML = html;
    if (tabsSecondScroll) tabsSecondScroll.innerHTML = '';

    tabsEl.querySelectorAll('.term-tab[data-sid]').forEach((tab) => {
      // 用 click 而非 mousedown：拖动排序时不会因重绘中断 dragstart
      tab.addEventListener('click', (e) => {
        if (e.target.closest('.t-close')) return;
        blankActive = false;
        if (window.Details) Details.deactivate();
        App.setActive(tab.dataset.sid);
      });

      // 拖动标签页排序
      tab.draggable = true;
      tab.addEventListener('dragstart', (e) => {
        dragSid = tab.dataset.sid;
        tab.classList.add('dragging');
        if (e.dataTransfer) {
          e.dataTransfer.effectAllowed = 'move';
          try { e.dataTransfer.setData('text/plain', dragSid); } catch (_) {}
        }
      });
      tab.addEventListener('dragover', (e) => {
        if (!dragSid || dragSid === tab.dataset.sid) return;
        e.preventDefault();
        if (e.dataTransfer) e.dataTransfer.dropEffect = 'move';
        const r = tab.getBoundingClientRect();
        dropAfter = e.clientX > r.left + r.width / 2;
      });
      tab.addEventListener('drop', (e) => {
        if (!dragSid || dragSid === tab.dataset.sid) return;
        e.preventDefault();
        App.moveSession(dragSid, tab.dataset.sid, dropAfter);
        dragSid = null;
        renderTabs();
        syncPanes();
      });
      tab.addEventListener('dragend', () => {
        tab.classList.remove('dragging');
        dragSid = null;
        renderTabs();
        syncPanes();
      });
    });
    tabsEl.querySelectorAll('.term-tab[data-dkey]').forEach((tab) => {
      tab.addEventListener('mousedown', (e) => {
        if (e.target.closest('.t-close')) return;
        blankActive = false;
        Details.activate(tab.dataset.dkey);
      });
    });
    const blankTab = tabsEl.querySelector('.term-tab[data-blank]');
    if (blankTab) {
      blankTab.addEventListener('click', (e) => {
        if (e.target.closest('.t-close')) return;
        activateBlank();
      });
    }
    tabsEl.querySelectorAll('[data-close]').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        closeSession(btn.dataset.close);
      });
    });
    tabsEl.querySelectorAll('[data-dclose]').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        Details.close(btn.dataset.dclose);
      });
    });
    const blankClose = tabsEl.querySelector('[data-blankclose]');
    if (blankClose) {
      blankClose.addEventListener('click', (e) => {
        e.stopPropagation();
        closeBlankTab();
      });
    }
    const addBtn = tabsEl.querySelector('.tab-add');
    if (addBtn) addBtn.addEventListener('click', openBlankTab);
    layoutTabRows();
    if (tabsSecondScroll) tabsSecondScroll.scrollLeft = prevSecondScroll;
    updateTabArrows();
    scrollActiveTab();
  }

  /** 标签名只有在一行放不下时才从 8 字逐级缩到 3 字 */
  function setLabelChars(maxChars) {
    tabsEl.querySelectorAll('.term-tab[data-sid]').forEach((tab) => {
      const label = tab.querySelector('.t-label');
      if (!label) return;
      label.textContent = labelFor(tab.dataset.name || '', maxChars);
    });
  }

  /** 首行固定排满，放不下的标签移到第二行；第二行可左右滚动，首行不参与滚动 */
  function layoutTabRows() {
    if (!tabsEl || !tabsSecond || !tabsSecondScroll) return;
    const tools = tabsBar ? tabsBar.querySelector('.tabs-tools') : null;
    if (tools) tabsBar.style.setProperty('--tabs-tools-w', tools.offsetWidth + 'px');
    const keepScroll = tabsSecondScroll.scrollLeft;
    const wasTwo = tabsSecond.classList.contains('show');
    while (tabsSecondScroll.firstChild) tabsEl.appendChild(tabsSecondScroll.firstChild);
    tabsSecond.classList.remove('show');
    const available = tabsEl.clientWidth;
    if (available <= 0) {
      setLabelChars(8);
      return;
    }
    // 空间足够就保持完整名称；挤不下才逐级缩短，最低 3 个字
    for (const n of [12, 10, 8, 6, 4, 3]) {
      setLabelChars(n);
      const total = Array.from(tabsEl.children).reduce((sum, el) => sum + el.getBoundingClientRect().width, 0);
      if (total <= available) break;
    }
    const items = Array.from(tabsEl.children);
    let split = items.length;
    let used = 0;
    for (let i = 0; i < items.length; i++) {
      const w = items[i].getBoundingClientRect().width;
      if (i > 0 && used + w > available + 0.5) {
        split = i;
        break;
      }
      used += w;
    }
    const overflow = split < items.length;
    if (overflow) {
      // 加号刚好放不下时，把最后一个标签一起移到第二行，避免第二行只剩一个加号
      if (items[split] && items[split].classList.contains('tab-add') && split > 1) split--;
      for (let i = split; i < items.length; i++) tabsSecondScroll.appendChild(items[i]);
      tabsSecond.classList.add('show');
    }
    tabsSecondScroll.scrollLeft = keepScroll;
    updateTabArrows();
    const two = overflow;
    if (tabRowCount !== (two ? 2 : 1)) {
      tabRowCount = two ? 2 : 1;
      setTimeout(() => {
        try { fitActive(); } catch (_) {}
      }, 30);
    } else if (wasTwo !== two) {
      setTimeout(() => {
        try { fitActive(); } catch (_) {}
      }, 30);
    }
  }

  function updateTabArrows() {
    if (!tabsSecondScroll) return;
    const prevBtn = U.qs('#tabs-prev');
    const nextBtn = U.qs('#tabs-next');
    if (!prevBtn || !nextBtn) return;
    const max = Math.max(0, tabsSecondScroll.scrollWidth - tabsSecondScroll.clientWidth);
    prevBtn.disabled = tabsSecondScroll.scrollLeft <= 1;
    nextBtn.disabled = tabsSecondScroll.scrollLeft >= max - 1;
  }

  /** 第二行按「一个标签」为步长左右移动，首行保持不动 */
  function moveTabRow(dir) {
    if (!tabsSecondScroll) return;
    const items = Array.from(tabsSecondScroll.children);
    if (!items.length) return;
    const firstVisible =
      items.find((el) => el.offsetLeft + el.offsetWidth > tabsSecondScroll.scrollLeft + 1) || items[0];
    const idx = items.indexOf(firstVisible);
    const step = dir > 0
      ? firstVisible.offsetWidth
      : (items[Math.max(0, idx - 1)] || firstVisible).offsetWidth;
    tabsSecondScroll.scrollBy({ left: dir * step, behavior: 'smooth' });
  }

  /** 激活标签在第二行时自动滚入视野；首行固定不移动 */
  function scrollActiveTab(force) {
    const active = tabsBar ? tabsBar.querySelector('.term-tab.active') : null;
    if (!active || !tabsSecondScroll || !tabsSecondScroll.contains(active)) return;
    const detail = window.Details ? Details.getActive() : null;
    const sig = `${detail ? 'd:' + detail.key : blankActive ? 'blank' : App.state.activeId}|${App.state.sessions.size}|${blankExists}`;
    if (!force && sig === lastScrollSig) return;
    lastScrollSig = sig;
    requestAnimationFrame(() => {
      if (active.isConnected) active.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    });
  }

  function refresh() {
    renderTabs();
    syncPanes();
  }

  function syncPanes() {
    const detail = window.Details ? Details.getActive() : null;
    host.querySelectorAll('.term-pane').forEach((p) => {
      p.classList.toggle('active', !detail && p.dataset.sid === App.state.activeId);
    });
    const showBlank = blankActive && !detail && App.state.activeId === null;
    emptyEl.style.display = showBlank ? 'flex' : 'none';
  }

  function updateEmpty() {
    const detail = window.Details ? Details.getActive() : null;
    const showBlank = blankActive && !detail && App.state.activeId === null;
    emptyEl.style.display = showBlank ? 'flex' : 'none';
  }

  /** 切换标签后把键盘焦点交给目标终端，切完即可直接敲命令，无需再点一下终端 */
  function focusActive() {
    if (window.Details && Details.getActive()) return; // 详情页在前台时焦点不归终端
    const s = App.active;
    if (!s || !s.term) return;
    setTimeout(() => {
      if (App.state.activeId !== s.id || (window.Details && Details.getActive())) return;
      try {
        s.term.focus();
      } catch (_) {}
    }, 0);
  }

  let fitTimer = null;
  function fitActive() {
    if (window.Details && Details.getActive()) return;
    const s = App.active;
    if (!s || !s.fit) return;
    if (fitTimer) clearTimeout(fitTimer);
    fitTimer = setTimeout(() => {
      try {
        s.fit.fit();
        s.term.scrollToBottom();
      } catch (_) {}
    }, 20);
  }

  function fitAll() {
    App.state.sessions.forEach((s) => {
      const active = s.pane && s.pane.classList.contains('active');
      if (!active) s.pane.classList.add('active');
      try {
        s.fit.fit();
      } catch (_) {}
      if (!active) s.pane.classList.remove('active');
    });
  }

  /* ---------------- 命令发送 ---------------- */

  function targets() {
    const all = App.state.sendTarget === 'all' ? Array.from(App.state.sessions.values()) : (App.active ? [App.active] : []);
    return all.filter((s) => s && s.status === 'online' && s.term);
  }

  function sendCommand() {
    const cmd = cmdInput.value;
    const list = targets();
    if (!list.length) {
      U.toast('当前没有已连接的终端', 'error');
      return;
    }
    // 空内容时直接发送回车，方便确认交互式提示或重复执行上一条命令
    if (!cmd.trim()) {
      list.forEach((s) => window.api.termWrite({ sessionId: s.id, data: '\r' }));
      cmdInput.value = '';
      const active = App.active;
      if (active && active.term) active.term.focus();
      return;
    }
    list.forEach((s) => window.api.termWrite({ sessionId: s.id, data: cmd + '\r' }));
    recordHistoryLine(cmd);
    cmdInput.value = '';
    const active = App.active;
    if (active && active.term) active.term.focus();
  }

  const SUDO_LINE = /(^|[\s;&|])sudo(?=\s|$)/;
  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

  /** 等当前命令回到 shell 提示符；OSC7 不可用时退化为固定间隔 */
  function waitForPrompt(sess, baseSeq) {
    return new Promise((resolve) => {
      const started = Date.now();
      const tick = () => {
        const s = App.session(sess.id);
        if (!s || s.status !== 'online') return resolve();
        if (Number(s.promptSeq) > baseSeq) return resolve();
        const elapsed = Date.now() - started;
        if (!s.promptSeq && elapsed >= 900) return resolve();
        if (elapsed >= 180000) {
          sess.sendQueue = [];
          U.toast('等待命令完成超时，已停止后续命令', 'error', 3200);
          return resolve();
        }
        setTimeout(tick, 50);
      };
      setTimeout(tick, 50);
    });
  }

  /**
   * 多行命令逐行发送。sudo 会清空终端里已经排队但尚未执行的输入，
   * 一次性写入整段命令时，后续行会丢失；因此 sudo 行要等提示符回来后再发下一行。
   */
  function enqueueSequential(sess, lines) {
    if (!sess.sendQueue) sess.sendQueue = [];
    sess.sendQueue.push(...lines);
    if (sess.sending) return;
    sess.sending = true;
    (async () => {
      try {
        while (sess.sendQueue && sess.sendQueue.length) {
          const s = App.session(sess.id);
          if (!s || s.status !== 'online') break;
          const line = sess.sendQueue.shift();
          const baseSeq = Number(s.promptSeq) || 0;
          window.api.termWrite({ sessionId: s.id, data: line + '\r' });
          if (SUDO_LINE.test(line)) await waitForPrompt(s, baseSeq);
          else await sleep(30);
        }
      } finally {
        sess.sendQueue = [];
        sess.sending = false;
      }
    })();
  }

  /** 向目标会话发送原始文本（自动追加回车） */
  function sendRaw(text, appendEnter = true) {
    const list = targets();
    if (!list.length) {
      U.toast('当前没有已连接的终端', 'error');
      return 0;
    }
    // 多行命令统一用回车分隔：直接发送裸 \n 时，部分 shell / 交互程序会吞掉后续行
    const body = String(text == null ? '' : text).replace(/\r\n?|\n/g, '\r');
    const lines = body.split('\r');
    const multi = lines.length > 1;
    list.forEach((s) => {
      if (multi && appendEnter) enqueueSequential(s, lines);
      else window.api.termWrite({ sessionId: s.id, data: appendEnter ? body + '\r' : body });
    });
    // 命令编辑器 / 快捷命令也写入历史（按行记录）
    String(text)
      .split(/\r\n?|\n/)
      .map((x) => x.trim())
      .filter(Boolean)
      .forEach(recordHistoryLine);
    const active = App.active;
    if (active && active.term) active.term.focus();
    return list.length;
  }

  /** 快捷命令点击：直接执行（自动回车）或填入命令框 */
  function runSnippet(command, autoRun) {
    if (autoRun) {
      sendRaw(command);
    } else {
      cmdInput.value = command;
      cmdInput.focus();
      cmdInput.setSelectionRange(command.length, command.length);
    }
  }

  function setFontSize(size) {
    fontSize = size;
    App.state.sessions.forEach((s) => {
      if (s.term) s.term.options.fontSize = size;
    });
    fitActive();
  }

  function clearActive() {
    const s = App.active;
    if (!s || !s.term) return U.toast('当前没有可用终端', 'error');
    s.term.clear();
    s.term.focus();
  }

  /* ---------------- 鼠标 / 快捷键 / 查找 / 重连 ---------------- */

  function activeTerm() {
    const s = App.active;
    return s && s.term ? s : null;
  }

  function copyText(text) {
    if (!text) return;
    navigator.clipboard.writeText(text).then(
      () => U.toast('已复制', 'ok', 1200),
      () => U.toast('复制失败', 'error')
    );
  }

  function termCopy() {
    const s = activeTerm();
    if (!s) return U.toast('当前没有可用终端', 'error');
    const sel = s.term.getSelection();
    if (sel) copyText(sel);
    else U.toast('终端中没有选中的文本', 'info', 1400);
  }

  function writeToActive(text) {
    const s = App.active;
    if (!s) return U.toast('当前没有可用终端', 'error');
    if (s.status !== 'online') return U.toast('连接已断开，无法输入', 'error', 2200);
    const raw = String(text);
    window.api.termWrite({ sessionId: s.id, data: raw.replace(/\r?\n/g, '\r') });
    // 粘贴到终端的命令按行写入历史（含最后一行，避免单条命令粘贴后没有记录）
    raw
      .replace(/\r\n?/g, '\n')
      .split('\n')
      .map((x) => x.trim())
      .filter(Boolean)
      .forEach(recordHistoryLine);
    if (s.term) s.term.focus();
  }

  function termPaste() {
    navigator.clipboard.readText().then(
      (t) => {
        if (!t) return;
        writeToActive(t);
      },
      () => U.toast('无法读取剪贴板', 'error')
    );
  }

  /** 菜单复制：优先复制当前选中文字 / 输入框选区，否则复制终端选区 */
  function menuCopy() {
    const sel = window.getSelection() && window.getSelection().toString();
    if (sel) return copyText(sel);
    const ae = document.activeElement;
    if (ae && (ae.tagName === 'INPUT' || ae.tagName === 'TEXTAREA') && ae.selectionStart !== ae.selectionEnd) {
      return copyText(ae.value.slice(ae.selectionStart, ae.selectionEnd));
    }
    termCopy();
  }

  /** 菜单粘贴：焦点在输入框时插入到光标处，否则发到终端 */
  function menuPaste() {
    const ae = document.activeElement;
    navigator.clipboard.readText().then(
      (t) => {
        if (!t) return;
        if (ae && (ae.tagName === 'INPUT' || ae.tagName === 'TEXTAREA')) {
          const a = ae.selectionStart == null ? ae.value.length : ae.selectionStart;
          const b = ae.selectionEnd == null ? a : ae.selectionEnd;
          ae.value = ae.value.slice(0, a) + t + ae.value.slice(b);
          ae.selectionStart = ae.selectionEnd = a + t.length;
          ae.dispatchEvent(new Event('input', { bubbles: true }));
        } else {
          writeToActive(t);
        }
      },
      () => U.toast('无法读取剪贴板', 'error')
    );
  }

  function shortcutLabel(key) {
    const sc = App.settings.shortcuts || {};
    return sc[key] || '';
  }

  function showTermMenu(x, y) {
    const s = App.active;
    if (!s) return U.toast('当前没有可用终端', 'error');
    U.ctxMenu(
      [
        { label: '复制', key: shortcutLabel('copy'), onClick: termCopy },
        { label: '粘贴', key: shortcutLabel('paste'), onClick: termPaste },
        { label: '查找…', key: shortcutLabel('find'), onClick: openFind },
        { sep: true },
        { label: '全选', onClick: () => activeTerm() && activeTerm().term.selectAll() },
        { label: '清屏', onClick: clearActive },
        { label: '重连', key: shortcutLabel('reconnect'), onClick: reconnectActive },
        { sep: true },
        { label: '关闭会话', danger: true, onClick: () => closeSession(s.id) }
      ],
      x,
      y
    );
  }

  function runMouseAction(action, e) {
    switch (action) {
      case 'term-copy': return termCopy();
      case 'term-paste': return termPaste();
      case 'menu-copy': return menuCopy();
      case 'menu-paste': return menuPaste();
      case 'term-menu':
      default: return showTermMenu(e.clientX, e.clientY);
    }
  }

  /* ---- 终端查找 ---- */
  let findMatches = [];
  let findIndex = -1;

  function openFind() {
    const bar = U.qs('#find-bar');
    bar.classList.add('show');
    const input = U.qs('#find-input');
    input.focus();
    input.select();
    refreshFind();
  }

  function closeFind() {
    U.qs('#find-bar').classList.remove('show');
    findMatches = [];
    findIndex = -1;
    const s = activeTerm();
    if (s) s.term.focus();
  }

  function refreshFind() {
    const s = activeTerm();
    const input = U.qs('#find-input');
    const q = input.value.trim().toLowerCase();
    U.qs('#find-count').textContent = '';
    findMatches = [];
    findIndex = -1;
    if (!s || !q) return;
    const buf = s.term.buffer.active;
    for (let y = 0; y < buf.length; y++) {
      const line = buf.getLine(y);
      if (!line) continue;
      const text = line.translateToString(true);
      let from = 0;
      let idx;
      while ((idx = text.toLowerCase().indexOf(q, from)) >= 0) {
        findMatches.push({ y, x: idx, len: q.length });
        from = idx + Math.max(1, q.length);
      }
    }
    if (findMatches.length) findNext(1);
    else U.qs('#find-count').textContent = '0/0';
  }

  function findNext(dir) {
    if (!findMatches.length) return;
    findIndex = (findIndex + dir + findMatches.length) % findMatches.length;
    const m = findMatches[findIndex];
    const s = activeTerm();
    if (!s) return;
    const row = m.y - s.term.buffer.active.viewportY;
    if (row < 0 || row >= s.term.rows) {
      s.term.scrollToLine(Math.max(0, m.y - Math.floor(s.term.rows / 2)));
    }
    const row2 = m.y - s.term.buffer.active.viewportY;
    try {
      s.term.select(m.x, row2, m.len);
    } catch (_) {}
    U.qs('#find-count').textContent = `${findIndex + 1}/${findMatches.length}`;
  }

  async function reconnectSession(s, opts) {
    if (s && s.status === 'connecting') return;
    if (!s) return null;
    // 首次重连在 await 断开前就置 closing，后续并发触发在这里同步拦截
    if (s.closing) return null;
    // 会话已不在列表中（重复触发的重连 / 已被关闭）：直接忽略，避免多开一个重复标签
    if (!App.session(s.id)) return null;
    const configId = s.config.id;
    // 记住原标签位置，重连成功后回到同一位置，而不是追加到末尾
    const index = Array.from(App.state.sessions.keys()).indexOf(s.id);
    const name = s.config.name || s.config.host;
    s.closing = true;
    try {
      await window.api.disconnect(s.id);
    } catch (_) {}
    cleanup(s.id, { keepBlank: true });
    // 沿用这个标签最初建立连接时的代理模式：
    // 右键「直接连接」失败后点「连接」重连，仍是直连，不会改走配置里的代理
    const recOpts = Object.assign({}, opts);
    if (!recOpts.proxyMode && s.proxyMode) recOpts.proxyMode = s.proxyMode;
    U.toast('正在重连 ' + name + ' …', 'info', 1600);
    return connect(configId, Object.assign(recOpts, { keepBlank: true }), index >= 0 ? index : undefined);
  }

  async function reconnectAllOffline() {
    const list = Array.from(App.state.sessions.values()).filter((s) => s.status === 'offline' || s.status === 'unstable');
    if (!list.length) return U.toast('没有断开的连接需要重连', 'info', 1600);
    for (const s of list) await reconnectSession(s);
  }

  async function closeOthers(keepId) {
    const ids = Array.from(App.state.sessions.keys()).filter((id) => id !== keepId);
    for (const id of ids) await closeSession(id);
  }

  async function closeAll() {
    const ids = Array.from(App.state.sessions.keys());
    for (const id of ids) await closeSession(id);
  }

  async function reconnectActive() {
    const s = App.active;
    if (!s) return U.toast('当前没有可用终端', 'error');
    await reconnectSession(s);
  }

  function isTextField(e) {
    const t = e.target;
    if (!t) return false;
    if (t.closest && t.closest('.xterm')) return false; // xterm 内部输入区视为终端
    return /INPUT|TEXTAREA|SELECT/.test(t.tagName) || t.isContentEditable;
  }

  function onShortcut(e) {
    if (!window.Settings) return;
    if (
      U.qs('#settings-mask').classList.contains('show') ||
      U.qs('#modal-mask').classList.contains('show') ||
      U.qs('#sub-mask').classList.contains('show')
    ) return;
    const combo = Settings.comboOf(e);
    if (!combo) return;
    if (isTextField(e)) return; // 输入框保留系统复制 / 粘贴
    const sc = App.settings.shortcuts || {};
    let action = '';
    if (combo === sc.copy) action = 'copy';
    else if (combo === sc.paste) action = 'paste';
    else if (combo === sc.find) action = 'find';
    else if (combo === sc.reconnect) action = 'reconnect';
    if (!action) return;
    e.preventDefault();
    e.stopPropagation();
    if (action === 'copy') {
      const s = activeTerm();
      if (!s) return;
      if (s.term.getSelection()) termCopy();
      else {
        window.api.termWrite({ sessionId: s.id, data: '\x03' }); // 无选中时保持 SIGINT
        s.term.scrollToBottom();
      }
    } else if (action === 'paste') termPaste();
    else if (action === 'find') openFind();
    else if (action === 'reconnect') reconnectActive();
  }

  function setupInteractions() {
    const m = () => App.settings.mouse || {};

    // 中键：默认粘贴
    host.addEventListener(
      'mousedown',
      (e) => {
        if (e.button !== 1) return;
        e.preventDefault();
        e.stopPropagation();
        runMouseAction(m().middle || 'term-paste', e);
      },
      true
    );
    host.addEventListener('auxclick', (e) => {
      if (e.button === 1) e.preventDefault();
    }, true);

    // 右键：默认弹出菜单
    host.addEventListener(
      'contextmenu',
      (e) => {
        if (!e.target.closest('.term-pane')) return;
        e.preventDefault();
        e.stopPropagation();
        runMouseAction(m().right || 'term-menu', e);
      },
      true
    );

    document.addEventListener('keydown', onShortcut, true);

    const fi = U.qs('#find-input');
    fi.addEventListener('input', U.debounce(refreshFind, 130));
    fi.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        findNext(e.shiftKey ? -1 : 1);
      } else if (e.key === 'Escape') {
        e.preventDefault();
        closeFind();
      }
    });
    U.qs('#find-prev').addEventListener('click', () => findNext(-1));
    U.qs('#find-next').addEventListener('click', () => findNext(1));
    U.qs('#find-close').addEventListener('click', closeFind);
  }

  /** 设置中心调用：即时更新所有终端字体 */
  function applyFonts(family, size) {
    fontSize = size;
    App.state.sessions.forEach((s) => {
      if (!s.term) return;
      s.term.options.fontFamily = family;
      s.term.options.fontSize = size;
      try {
        s.fit.fit();
      } catch (_) {}
    });
    fitActive();
  }

  return {
    init,
    connect,
    closeSession,
    cleanup,
    sendCommand,
    runSnippet,
    sendRaw,
    cdTo,
    fitActive,
    fitAll,
    setFontSize,
    applyFonts,
    applyTheme,
    termCopy,
    termPaste,
    menuCopy,
    menuPaste,
    openFind,
    closeFind,
    reconnectActive,
    reconnectSession,
    clearActive,
    renderTabs,
    refresh,
    updateEmpty
  };
})();
