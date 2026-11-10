'use strict';
/* 软件设置中心：主题 / 背景 / 字体 / 鼠标 / 快捷键 / 板块 / 启动 */
window.Settings = (function () {
  const $ = U.qs;
  const app = $('#app');
  const mask = $('#settings-mask');
  const content = $('#settings-content');

  /* ---------------- 主题预设 ---------------- */
  const THEMES = [
    {
      id: 'warm', name: '暖白 · 墨绿', note: '默认 · 低对比护眼',
      vars: {
        bg: '#f7f6f2', panel: '#ffffff', 'panel-2': '#fbfaf7', 'panel-3': '#f3f1eb',
        line: '#e7e5df', 'line-strong': '#d9d6ce', text: '#15191d', 'text-2': '#5d666f',
        muted: '#8b939b', primary: '#15191d', 'primary-hover': '#000000',
        accent: '#16665a', 'accent-2': '#2f8b7c', 'accent-soft': '#e6efec', 'accent-rgb': '22, 102, 90',
        danger: '#e5484d', 'danger-soft': '#fdecec', ok: '#1ea97c', warn: '#e9a11a', 'warn-soft': '#fff2df', 'term-bg': '#12161d'
      },
      term: { bg: '#fbfaf7', fg: '#15191d', cursor: '#16665a', selection: '#dfeae6', empty1: '#ffffff', muted: '#8b939b', accent: '#16665a', dark: false }
    },
    {
      id: 'mist', name: '雾蓝 · 靛青', note: '清爽冷色',
      vars: {
        bg: '#f3f7fc', panel: '#ffffff', 'panel-2': '#f7fafd', 'panel-3': '#eef3fa',
        line: '#e0e8f2', 'line-strong': '#cbd8e8', text: '#1c2431', 'text-2': '#55606f',
        muted: '#8b95a5', primary: '#233a56', 'primary-hover': '#0f233c',
        accent: '#2f7cf6', 'accent-2': '#6aa7ff', 'accent-soft': '#eaf2ff', 'accent-rgb': '47, 124, 246',
        danger: '#e5484d', 'danger-soft': '#fdecec', ok: '#1ea97c', warn: '#e9a11a', 'warn-soft': '#fff2df', 'term-bg': '#12161d'
      },
      term: { bg: '#f7fafd', fg: '#1c2431', cursor: '#2f7cf6', selection: '#dbe8fb', empty1: '#ffffff', muted: '#8b95a5', accent: '#2f7cf6', dark: false }
    },
    {
      id: 'sand', name: '米杏 · 陶土', note: '温暖纸感',
      vars: {
        bg: '#faf5ee', panel: '#fffdf9', 'panel-2': '#fbf6ef', 'panel-3': '#f5ede2',
        line: '#eadfd1', 'line-strong': '#dccabb', text: '#2d2620', 'text-2': '#6b5f53',
        muted: '#9a8d80', primary: '#3b3129', 'primary-hover': '#1d1610',
        accent: '#b4552f', 'accent-2': '#d57a4d', 'accent-soft': '#f8e9df', 'accent-rgb': '180, 85, 47',
        danger: '#c8433f', 'danger-soft': '#fbe9e7', ok: '#3f8f6d', warn: '#c98a22', 'warn-soft': '#fdf1d9', 'term-bg': '#191510'
      },
      term: { bg: '#fbf6ef', fg: '#2d2620', cursor: '#b4552f', selection: '#f3e2d5', empty1: '#fffdf9', muted: '#9a8d80', accent: '#b4552f', dark: false }
    },
    {
      id: 'graphite', name: '石墨 · 冷灰', note: '中性高对比',
      vars: {
        bg: '#eef0f2', panel: '#ffffff', 'panel-2': '#f7f8fa', 'panel-3': '#eaecef',
        line: '#dfe3e8', 'line-strong': '#c9cfd7', text: '#20262e', 'text-2': '#59636e',
        muted: '#8c96a2', primary: '#2b323b', 'primary-hover': '#11161c',
        accent: '#3b6ea5', 'accent-2': '#6e9bd0', 'accent-soft': '#e7eff8', 'accent-rgb': '59, 110, 165',
        danger: '#d0454a', 'danger-soft': '#fbecec', ok: '#238f76', warn: '#d39420', 'warn-soft': '#fff3dc', 'term-bg': '#161a1f'
      },
      term: { bg: '#f7f8fa', fg: '#20262e', cursor: '#3b6ea5', selection: '#dde7f3', empty1: '#ffffff', muted: '#8c96a2', accent: '#3b6ea5', dark: false }
    },
    {
      id: 'night', name: '夜间 · 深墨', note: '暗色界面', dark: true,
      vars: {
        bg: '#14181d', panel: '#1d232b', 'panel-2': '#222a33', 'panel-3': '#182029',
        line: '#2c3540', 'line-strong': '#3a4552', text: '#e2e8f0', 'text-2': '#aab6c4',
        muted: '#758394', primary: '#4a5b70', 'primary-hover': '#5d7289',
        accent: '#5fc2b0', 'accent-2': '#8ad9cb', 'accent-soft': '#233b38', 'accent-rgb': '95, 194, 176',
        danger: '#f07171', 'danger-soft': '#3a2427', ok: '#4fc79d', warn: '#e3b45a', 'warn-soft': '#3a3020', 'term-bg': '#0d1116'
      },
      term: { bg: '#0d1116', fg: '#e2e8f0', cursor: '#5fc2b0', selection: '#2b3a3a', empty1: '#1d232b', muted: '#758394', accent: '#5fc2b0', dark: true }
    }
  ];

  const MOUSE_ACTIONS = [
    ['term-copy', '终端 - 复制'],
    ['term-paste', '终端 - 粘贴'],
    ['term-menu', '终端 - 弹出菜单'],
    ['menu-copy', '菜单功能 - 复制'],
    ['menu-paste', '菜单功能 - 粘贴']
  ];

  const SHORTCUTS = [
    { k: 'copy', label: '终端 - 复制', def: 'Ctrl+C' },
    { k: 'paste', label: '终端 - 粘贴', def: 'Ctrl+V' },
    { k: 'find', label: '终端 - 查找', def: 'Ctrl+F' },
    { k: 'reconnect', label: '终端 - 重连', def: 'Ctrl+Enter' }
  ];

  const PANELS = [
    { k: 'leftList', label: '左侧 · 服务器列表' },
    { k: 'leftMonitors', label: '左侧 · CPU / 内存 / 磁盘' },
    { k: 'leftFoot', label: '左侧 · 底部状态栏' },
    { k: 'tabs', label: '中间 · 终端标签栏' },
    { k: 'cmdBar', label: '中间 · 命令输入栏' },
    { k: 'files', label: '下方面板 · 文件管理' },
    { k: 'snippets', label: '下方面板 · 快捷命令' },
    { k: 'rightInfo', label: '右侧 · 服务器信息' },
    { k: 'cmdEditor', label: '右下 · 命令编辑器' }
  ];

  const FONT_EN = ['Consolas, "Cascadia Mono", monospace', 'JetBrains Mono, monospace', 'Fira Code, monospace', 'Source Code Pro, monospace', 'Menlo, monospace', 'DejaVu Sans Mono, monospace', 'Courier New, monospace'];
  const FONT_ZH = ['"Microsoft YaHei", "PingFang SC", sans-serif', '"PingFang SC", "Microsoft YaHei", sans-serif', '"Noto Sans CJK SC", sans-serif', 'SimSun, serif', 'SimHei, sans-serif', '"Segoe UI", sans-serif'];

  const DEFAULTS = {
    theme: 'warm', netUnit: 'mbps', wallpaper: '', downloadDir: '', proxies: [], defaultProxyId: '',
    units: { global: 'mbps', chart: 'global', netDetail: 'global', downloads: 'global' },
    fonts: { size: 13, en: FONT_EN[0], zh: FONT_ZH[0] },
    mouse: { middle: 'term-paste', right: 'term-menu' },
    shortcuts: { copy: 'Ctrl+C', paste: 'Ctrl+V', find: 'Ctrl+F', reconnect: 'Ctrl+Enter' },
    panels: {
      leftList: true, leftMonitors: true, leftFoot: true, tabs: true, cmdBar: true,
      rightInfo: true, cmdEditor: true, files: true, snippets: true
    },
    startDockedRight: true,
    dirSync: true,
    snippetClickRun: true
  };

  let cfg = null;
  /* 界面缩放百分比：独立存储（不在 settings 里），启动时由主进程下发 */
  let zoomPercent = 100;
  const ZOOM_LEVELS = [100, 125, 150, 200];

  function readCfg() {
    const s = App.settings || {};
    const merge = (base, raw) => Object.assign({}, base, raw || {});
    cfg = {
      theme: s.theme || DEFAULTS.theme,
      netUnit: s.netUnit === 'bytes' ? 'bytes' : 'mbps',
      wallpaper: typeof s.wallpaper === 'string' ? s.wallpaper : '',
      downloadDir: typeof s.downloadDir === 'string' ? s.downloadDir : '',
      units: merge(DEFAULTS.units, s.units),
      fonts: merge(DEFAULTS.fonts, s.fonts),
      mouse: merge(DEFAULTS.mouse, s.mouse),
      shortcuts: merge(DEFAULTS.shortcuts, s.shortcuts),
      panels: merge(DEFAULTS.panels, s.panels),
      startDockedRight: s.startDockedRight !== false,
      dirSync: s.dirSync !== false,
      snippetClickRun: s.snippetClickRun !== false
    };
    return cfg;
  }

  async function persist(patch) {
    Object.assign(cfg, patch);
    cfg.fonts = Object.assign({}, cfg.fonts, patch.fonts || {});
    cfg.mouse = Object.assign({}, cfg.mouse, patch.mouse || {});
    cfg.shortcuts = Object.assign({}, cfg.shortcuts, patch.shortcuts || {});
    cfg.panels = Object.assign({}, cfg.panels, patch.panels || {});
    cfg.units = Object.assign({}, cfg.units, patch.units || {});
    const next = await window.api.saveSettings(patch);
    App.state.data.settings = Object.assign({}, App.state.data.settings, next, patch);
    apply();
  }

  /* ---------------- 应用设置 ---------------- */

  function rgba(hex, a) {
    const h = String(hex || '').replace('#', '');
    if (h.length !== 6) return hex;
    const n = parseInt(h, 16);
    return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
  }

  function activatePane(page) {
    document.querySelectorAll('.pane-tab').forEach((t) => t.classList.toggle('active', t.dataset.page === page));
    document.querySelectorAll('.page').forEach((p) => p.classList.toggle('active', p.id === 'page-' + page));
    if (page === 'files' && window.Files) Files.refresh();
    if (page === 'snippets' && window.Snippets) Snippets.render();
  }

  function apply() {
    if (!cfg) readCfg();
    const root = document.documentElement;
    const theme = THEMES.find((t) => t.id === cfg.theme) || THEMES[0];
    Object.keys(theme.vars).forEach((k) => root.style.setProperty('--' + k, theme.vars[k]));
    const t = theme.term || {};
    root.style.setProperty('--term-bg', t.bg || theme.vars['term-bg']);
    root.style.setProperty('--term-fg', t.fg || '#d3dbe6');
    root.style.setProperty('--term-muted', t.muted || '#6b7686');
    root.style.setProperty('--term-accent', t.accent || theme.vars.accent);
    root.style.setProperty('--term-empty-1', t.empty1 || t.bg || '#1d2533');
    document.body.classList.toggle('theme-dark', !!theme.dark);
    if (window.Term) Term.applyTheme(t);

    // 背景图：有图时让面板略微透光，没图时使用主题纯色
    if (cfg.wallpaper) {
      root.style.setProperty('--wallpaper', 'url("' + cfg.wallpaper + '")');
      app.classList.add('has-wallpaper');
      root.style.setProperty('--panel', rgba(theme.vars.panel, 0.88));
      root.style.setProperty('--panel-2', rgba(theme.vars['panel-2'], 0.82));
      root.style.setProperty('--panel-3', rgba(theme.vars['panel-3'], 0.78));
    } else {
      root.style.removeProperty('--wallpaper');
      app.classList.remove('has-wallpaper');
    }

    // 字体
    const f = cfg.fonts;
    root.style.setProperty('--font-ui', `${f.zh}, "Segoe UI", sans-serif`);
    root.style.setProperty('--font-mono', `${f.en}, ${f.zh}, monospace`);
    root.style.setProperty('--ui-font-size', U.clamp(12.5 + (Number(f.size) - 13) * 0.3, 11, 16).toFixed(1) + 'px');
    if (window.Term) Term.applyFonts(`${f.en}, ${f.zh}, monospace`, Number(f.size) || 13);

    // 板块显示 / 隐藏
    const p = cfg.panels;
    const cls = {
      leftList: 'hide-left-list', leftMonitors: 'hide-left-monitors', leftFoot: 'hide-left-foot',
      tabs: 'hide-tabs', cmdBar: 'hide-cmd-bar', cmdEditor: 'hide-cmd-editor',
      files: 'hide-page-files', snippets: 'hide-page-snippets', rightInfo: 'info-hidden'
    };
    Object.keys(cls).forEach((k) => app.classList.toggle(cls[k], !p[k]));
    app.classList.toggle('hide-left-all', !p.leftList && !p.leftMonitors && !p.leftFoot);
    app.classList.toggle('hide-bottom', !p.files && !p.snippets);
    if (!p.files && p.snippets) activatePane('snippets');
    else if (p.files && !p.snippets) activatePane('files');

    // 网络单位 / 详情表刷新
    if (window.Sidebar && App.active) {
      Sidebar.drawChart(App.active);
      Sidebar.renderNetLegend(App.active);
    }
    if (window.Details && Details.refreshAll) Details.refreshAll();
    if (window.Term) Term.fitActive();
  }

  function setPanel(key, value) {
    if (!cfg) readCfg();
    const panels = Object.assign({}, cfg.panels, { [key]: !!value });
    return persist({ panels });
  }

  /* ---------------- 快捷键格式化 ---------------- */

  function comboOf(e) {
    const parts = [];
    if (e.ctrlKey) parts.push('Ctrl');
    if (e.metaKey) parts.push('Meta');
    if (e.altKey) parts.push('Alt');
    if (e.shiftKey) parts.push('Shift');
    let k = e.key;
    if (k === ' ') k = 'Space';
    else if (k === 'Control' || k === 'Shift' || k === 'Alt' || k === 'Meta') return '';
    else if (k.length === 1) k = k.toUpperCase();
    else if (/^Arrow/.test(k)) k = k.replace('Arrow', '');
    parts.push(k);
    return parts.join('+');
  }

  /* ---------------- 设置弹窗 ---------------- */

  function themeCards() {
    return THEMES.map((t) => {
      const v = t.vars;
      const sw = [v.bg, v.panel, v.line, v.text, v.primary, v.accent]
        .map((c) => `<i style="background:${c}"></i>`)
        .join('');
      return `<div class="theme-card${cfg.theme === t.id ? ' active' : ''}" data-theme="${t.id}">
        <div class="theme-name">${U.esc(t.name)}</div>
        <div class="theme-swatch">${sw}</div>
        <div class="theme-note">${U.esc(t.note)}</div>
      </div>`;
    }).join('');
  }

  function optionList(list, current) {
    return list.map(([v, label]) => `<option value="${v}"${current === v ? ' selected' : ''}>${U.esc(label)}</option>`).join('');
  }

  function fontOptions(list, current) {
    const items = list.slice();
    if (items.indexOf(current) < 0 && current) items.unshift(current);
    return items.map((v) => `<option value="${U.esc(v)}"${v === current ? ' selected' : ''}>${U.esc(v.split(',')[0].replace(/"/g, ''))}</option>`).join('');
  }

  function render(activeTab) {
    const f = cfg.fonts;
    const wd = ((App.state.data.settings || {}).webdav) || {};
    content.innerHTML = `
      <section class="stab active" data-tab="appearance">
        <div class="set-group">
          <h4>主题配色</h4>
          <p class="set-desc">默认「暖白 · 墨绿」：页面 #f7f6f2 / 卡片 #fff / 边框 #e7e5df / 主文字 #15191d / 主按钮 #15191d / 点缀 #16665a。</p>
          <div class="theme-grid" id="theme-grid">${themeCards()}</div>
        </div>
        <div class="set-group">
          <h4>背景图</h4>
          <p class="set-desc">默认使用主题纯色；可选择本机图片作为窗口背景，图片会压缩后加密保存在本地配置中。</p>
          <div class="wall-preview" id="wall-preview" style="${cfg.wallpaper ? 'background-image:url(' + cfg.wallpaper + ')' : ''}"></div>
          <div class="wall-actions">
            <button class="btn sm primary" id="wall-pick">选择本机图片…</button>
            <button class="btn sm" id="wall-clear">恢复主题纯色</button>
            <span class="wall-name" id="wall-name">${cfg.wallpaper ? '已设置背景图' : '当前：主题纯色'}</span>
          </div>
        </div>
        <div class="set-group">
          <h4>界面缩放</h4>
          <p class="set-desc">整个窗口按比例放大，适合高分屏或离屏幕较远时使用。默认 100%。</p>
          <div class="set-row">
            <label>缩放比例</label>
            <select id="set-zoom">
              ${(ZOOM_LEVELS.includes(zoomPercent) ? ZOOM_LEVELS : ZOOM_LEVELS.concat([zoomPercent]).sort((a, b) => a - b))
                .map((v) => `<option value="${v}"${zoomPercent === v ? ' selected' : ''}>${v}%${v === 100 ? '（默认）' : ''}</option>`)
                .join('')}
            </select>
            <button class="btn sm" id="set-zoom-reset">恢复 100%</button>
          </div>
          <p class="set-note" id="set-zoom-note">切换后会先预览效果，3 秒内无法点击，确认显示正常再保存；不保存则自动回到原比例。该项<b>不写入配置文件</b>，也不参与云同步与导出，卸载或重装软件后自动恢复 100%。若界面已经大到看不清，按 <b>Ctrl + Shift + 0</b> 可随时复位。</p>
        </div>
      </section>

      <section class="stab" data-tab="font">
        <div class="set-group">
          <h4>字体</h4>
          <div class="set-row"><label>字号</label><input id="set-fontsize" type="number" min="10" max="24" value="${U.clamp(Number(f.size) || 13, 10, 24)}" /><span class="set-note">同时作用于终端与界面文字</span></div>
          <div class="set-row"><label>英文字体</label><select id="set-fonten">${fontOptions(FONT_EN, f.en)}</select></div>
          <div class="set-row"><label>中文字体</label><select id="set-fontzh">${fontOptions(FONT_ZH, f.zh)}</select></div>
          <div class="set-row"><label>自定义字体</label><input id="set-fontcustom" type="text" placeholder="可直接输入字体名，回车应用" style="flex:1" /></div>
          <div class="set-preview" id="font-preview"><span class="mono">ls -la /var/log  # English 123</span><br>中文示例：服务器监控与文件管理</div>
        </div>
      </section>

      <section class="stab" data-tab="mouse">
        <div class="set-group">
          <h4>鼠标按键</h4>
          <p class="set-desc">在终端区域按下对应鼠标键时执行的操作。默认：中键粘贴、右键弹出菜单。</p>
          <div class="set-row"><label>中键</label><select id="set-middle">${optionList(MOUSE_ACTIONS, cfg.mouse.middle)}</select></div>
          <div class="set-row"><label>右键</label><select id="set-right">${optionList(MOUSE_ACTIONS, cfg.mouse.right)}</select></div>
          <div class="set-row"><label></label><span class="set-note">「菜单功能 - 复制 / 粘贴」作用于当前选中的文本或输入框；「终端 - …」始终作用于终端。</span></div>
        </div>
        <div class="set-group">
          <h4>右键菜单包含</h4>
          <div class="set-preview">复制 · 粘贴 · 查找 · 全选 · 清屏 · 重连 · 关闭会话</div>
        </div>
      </section>

      <section class="stab" data-tab="shortcuts">
        <div class="set-group">
          <h4>快捷键</h4>
          <p class="set-desc">点击右侧框后直接按下组合键即可录制；按 Esc 取消。Ctrl+C 在有选中文本时复制，无选中时发送中断信号（SIGINT）。</p>
          <div class="key-grid">
            ${SHORTCUTS.map(
              (s) => `<div class="key-row2">
                <span class="key-label">${U.esc(s.label)}</span>
                <input class="key-capture" data-sc="${s.k}" value="${U.esc(cfg.shortcuts[s.k] || s.def)}" readonly />
                <button class="btn sm" data-reset="${s.k}" title="恢复默认">默认</button>
              </div>`
            ).join('')}
          </div>
        </div>
      </section>

      <section class="stab" data-tab="transfer">
        <div class="set-group">
          <h4>下载文件夹</h4>
          <p class="set-desc">下载与目录下载默认保存到桌面「ShellFiles」文件夹；导出的配置备份也默认保存在这里。</p>
          <div class="set-row">
            <label>保存位置</label>
            <input id="set-dldir" type="text" placeholder="桌面 / ShellFiles（默认）" value="${U.esc(cfg.downloadDir)}" style="flex:1" />
            <button class="btn sm" id="set-dlpick">选择…</button>
            <button class="btn sm" id="set-dlopen">打开</button>
          </div>
        </div>
        <div class="set-group">
          <h4>代理（HTTP / SOCKS5）</h4>
          <p class="set-desc">可配置多个代理并指定默认代理；只有一个代理时它自动成为默认。SSH 配置里可单独选择是否启用及使用哪个代理。</p>
          <div class="proxy-list" id="proxy-list"></div>
          <div class="set-row" style="margin-top:10px"><label></label><button class="btn sm primary" id="proxy-add">＋ 添加代理</button></div>
        </div>
      </section>

      <section class="stab" data-tab="webdav">
        <div class="set-group">
          <h4>WebDAV 云同步</h4>
          <p class="set-desc">把服务器配置、密钥和快捷命令加密后同步到 WebDAV。同步为双向合并：本地新增会上传，本地删除会同步到云端，云端删除也会同步回本机（以「上次同步」为基线判断增删），任何一步失败都不会清空本地数据。</p>
          <div class="set-row"><label>服务器地址</label><input id="wd-url" type="text" placeholder="https://dav.example.com/dav/" value="${U.esc(wd.url || '')}" style="flex:1" /></div>
          <div class="set-row"><label>用户名</label><input id="wd-user" type="text" placeholder="WebDAV 认证用户名，可留空" value="${U.esc(wd.username || '')}" style="flex:1" /></div>
          <div class="set-row"><label>密码</label><input id="wd-pass" type="password" placeholder="${wd.hasPassword ? '已保存，留空表示不修改' : 'WebDAV 密码（可留空）'}" autocomplete="new-password" style="flex:1" /></div>
          <div class="set-row"><label>同步用户名</label><input id="wd-syncuser" type="text" placeholder="例如：useradminaaa" value="${U.esc(wd.syncUser || '')}" style="flex:1" /></div>
          <div class="set-row"><label>配置加密密码</label><input id="wd-syncpass" type="password" placeholder="${wd.hasSyncPass ? '已保存，留空表示不修改' : '至少 6 位，用于加密云端配置'}" autocomplete="new-password" style="flex:1" /></div>
          <div class="set-row"><label>确认加密密码</label><input id="wd-syncpass2" type="password" placeholder="首次设置时再输入一次" autocomplete="new-password" style="flex:1" /></div>
          <div class="set-note sync-warn">Tips：请注意，同步用户名和密码忘记后，将再也找不回原来的同步配置。</div>
          <div class="set-row" style="margin-bottom:0">
            <label></label>
            <button class="btn sm" id="wd-save">保存配置</button>
            <button class="btn sm" id="wd-test">测试连接</button>
            <button class="btn sm primary" id="wd-sync">立即同步</button>
          </div>
          <div class="sync-result idle" id="wd-status" aria-live="polite">
            <div class="sr-head"><i class="sr-dot"></i><span class="sr-title">${
              wd.lastSyncAt ? '上次同步成功：' + U.fmtTime(wd.lastSyncAt) : '尚未同步'
            }</span></div>
            <ul class="sr-list"><li>点击「立即同步」开始：先读取云端配置并合并，再把合并结果加密上传。</li></ul>
          </div>
        </div>
        <div class="set-group">
          <h4>同步规则</h4>
          <div class="set-preview">连接按主机 + 端口 + 用户名识别，服务器分组按层级路径（最多三级）识别，收藏文件夹、收藏分组、密钥（按名称）、快捷命令（按板块 + 命令）同样参与同步。<br>
          每次同步成功后会把「本次同步到的内容清单」记为基线，下次同步据此判断哪一侧新增、哪一侧删除，因此删除操作也会被正确同步，而不是被云端旧配置重新写回。<br>
          同步失败（网络、认证、密码错误）只提示错误，不会改动或清空当前服务器列表。</div>
        </div>
      </section>

      <section class="stab" data-tab="startup">
        <div class="set-group">
          <h4>目录联动</h4>
          <div class="set-row">
            <label>终端与文件管理器</label>
            <label class="check-inline"><input type="checkbox" id="set-dirsync"${cfg.dirSync ? ' checked' : ''} /> 启用目录联动</label>
          </div>
          <p class="set-desc">开启后连接时会向 shell 注入轻量钩子，终端里执行 cd 后文件管理器自动跟随；注入命令不会写入 shell 历史。关闭后不注入任何命令，文件管理器仍可手动「CD 目录」。</p>
        </div>
        <div class="set-group">
          <h4>启动行为</h4>
          <div class="set-row">
            <label>窗口位置</label>
            <label class="check-inline"><input type="checkbox" id="set-dock"${cfg.startDockedRight ? ' checked' : ''} /> 启动时贴靠屏幕右侧</label>
          </div>
          <p class="set-desc">仅在首次启动或尚未记住窗口位置时生效；之后会以你上次调整的位置为准。点击「重置窗口位置」可让下次启动重新贴边。</p>
          <div class="set-row"><label></label><button class="btn sm" id="set-resetpos">重置窗口位置</button></div>
        </div>
        <div class="set-group">
          <h4>快捷命令</h4>
          <div class="set-row">
            <label>单击运行</label>
            <label class="check-inline"><input type="checkbox" id="set-clickrun"${cfg.snippetClickRun ? ' checked' : ''} /> 允许单击命令直接运行</label>
          </div>
          <p class="set-desc">开启后，标记为「点击直接执行」的命令单击即运行（默认）。关闭后，单击任何命令都只填入命令编辑器，需手动确认再发送，避免误触。</p>
        </div>
        <div class="set-group">
          <h4>设置存储</h4>
          <div class="set-preview">配置文件：<code class="set-path">${U.esc(U.dataFile || '（未知路径）')}</code><br>作者：LIULIWANJIA · ${U.versionText()}${U.isPortable ? '（便携版）' : ''}</div>
        </div>
      </section>

      <section class="stab" data-tab="units">
        <div class="set-group">
          <h4>全局速率单位</h4>
          <p class="set-desc">修改后影响整个软件的速率显示；下面的具体项可单独覆盖。默认 Mbps。</p>
          <div class="set-row">
            <label>全局单位</label>
            <select id="set-unit-global">
              <option value="mbps"${cfg.units.global === 'mbps' ? ' selected' : ''}>Mbps（兆比特 / 秒）</option>
              <option value="mbytes"${cfg.units.global === 'mbytes' ? ' selected' : ''}>MB/s（兆字节 / 秒）</option>
            </select>
          </div>
        </div>
        <div class="set-group">
          <h4>具体项</h4>
          <p class="set-desc">未单独设置时跟随全局单位。</p>
          ${[
            ['chart', '服务器监控图表'],
            ['netDetail', '网络连接详情'],
            ['downloads', '下载管理器']
          ]
            .map(
              ([k, label]) => `<div class="set-row"><label>${label}</label><select data-unit="${k}">
                ${optionList([['global', '跟随全局'], ['mbps', 'Mbps'], ['mbytes', 'MB/s']], cfg.units[k] || 'global')}
              </select></div>`
            )
            .join('')}
        </div>
      </section>

      <section class="stab" data-tab="panels">
        <div class="set-group">
          <h4>板块显示 / 隐藏</h4>
          <p class="set-desc">取消勾选即隐藏对应板块。隐藏右侧服务器信息时，终端向右扩展，右下角命令编辑器保持独立显示。</p>
          <div class="panel-grid">
            ${PANELS.map(
              (p) => `<label><input type="checkbox" data-panel="${p.k}"${cfg.panels[p.k] ? ' checked' : ''} />${U.esc(p.label)}</label>`
            ).join('')}
          </div>
        </div>
      </section>

      <section class="stab" data-tab="data">
        <div class="set-group">
          <h4>清空软件数据</h4>
          <p class="set-desc">清空服务器配置、分组、密钥库、收藏文件夹、快捷命令、命令历史与全部设置，恢复为首次启动状态。</p>
          <p class="set-desc set-warn-soft">此操作不可恢复。</p>
          <p class="set-desc">清空前会先关闭 WebDAV 云同步并清除 WebDAV 配置，不会导致空服务器列表被上传到云端。</p>
          <p class="set-desc">若已配置云同步，需要输入同步用户名与配置加密密码验证身份。</p>
          <div class="set-row">
            <label></label>
            <button class="btn danger" id="data-clear">清空软件数据…</button>
          </div>
        </div>
      </section>`;

    // 模板默认高亮「外观与主题」，这里按调用方指定的分类重新对齐左右两侧
    activateTab(activeTab || 'appearance');
  }

  /** 切换左侧设置分类：菜单项与右侧板块必须同步切换 */
  function activateTab(tab) {
    if (!tab) return;
    const navs = Array.from(document.querySelectorAll('.snav'));
    const stabs = Array.from(document.querySelectorAll('.stab'));
    const hit = navs.some((b) => b.dataset.tab === tab) || stabs.some((s) => s.dataset.tab === tab);
    if (!hit) return;
    navs.forEach((b) => b.classList.toggle('active', b.dataset.tab === tab));
    stabs.forEach((s) => s.classList.toggle('active', s.dataset.tab === tab));
  }

  async function open(tab) {
    readCfg();
    // 缩放值来自主进程（独立存储），渲染时就要是真实值，避免下拉显示 100% 与实际不符
    try {
      const z = await window.api.zoomGet();
      if (z && z.percent) zoomPercent = Number(z.percent);
    } catch (_) {}
    // 渲染时就把目标分类标记为激活，避免「菜单高亮」与「右侧板块」不一致
    render(tab || 'appearance');
    bindContent();
    mask.classList.add('show');
    activateTab(tab || 'appearance');
  }

  function close() {
    mask.classList.remove('show');
  }

  /* ---------------- 界面缩放 ----------------
   * 流程：选择比例 → 立即预览（不落盘）→ 3 秒倒计时确认窗 → 保存 / 还原
   * 缩放值由主进程存在安装目录，不进 liulishell-data.json。
   */
  function refit() {
    setTimeout(() => {
      window.dispatchEvent(new Event('resize'));
      if (window.Term) {
        try { Term.fitAll(); } catch (_) {}
      }
    }, 60);
  }

  function syncZoomUi() {
    const sel = $('#set-zoom');
    if (sel) sel.value = String(zoomPercent);
  }

  function askZoomSave(prev, target) {
    return new Promise((resolve) => {
      let left = 3;
      U.openSubModal({
        title: '保存新的缩放比例？',
        width: '440px',
        body: `<div class="zoom-ask">
            <p class="zoom-ask-line">界面已切换到 <b>${target}%</b>，原比例 ${prev}%。</p>
            <p class="zoom-ask-tip">请确认显示是否正常。<b id="zoom-count">${left}</b> 秒后可点击；
            点「恢复」或关闭窗口会自动回到 ${prev}%。</p>
          </div>`,
        okText: `保存 ${target}%`,
        cancelText: `恢复 ${prev}%`,
        okClass: 'primary'
      }).then((v) => {
        cleanup();
        resolve(v !== null && v !== false);
      });

      const okBtn = U.qs('#sub-ok');
      const cancelBtn = U.qs('#sub-cancel');
      const countEl = U.qs('#zoom-count');
      const bodyEl = U.qs('#sub-body');
      const subMask = U.qs('#sub-mask');
      const locked = (v) => {
        if (okBtn) okBtn.disabled = v;
        if (cancelBtn) cancelBtn.disabled = v;
      };

      locked(true);
      if (subMask) subMask.onmousedown = null; // 倒计时期间点遮罩不关闭，避免误触
      if (bodyEl) {
        bodyEl.onkeydown = (e) => {
          if (e.key !== 'Enter') return;
          e.preventDefault();
          if (left <= 0 && okBtn) okBtn.click();
        };
      }
      const onEsc = (e) => {
        if (e.key !== 'Escape') return;
        e.preventDefault();
        e.stopPropagation();
        if (left <= 0 && cancelBtn) cancelBtn.click();
      };
      document.addEventListener('keydown', onEsc, true);

      const timer = setInterval(() => {
        left -= 1;
        if (countEl) countEl.textContent = String(Math.max(0, left));
        if (left <= 0) {
          clearInterval(timer);
          locked(false);
        }
      }, 1000);

      function cleanup() {
        clearInterval(timer);
        document.removeEventListener('keydown', onEsc, true);
      }
    });
  }

  async function changeZoom(target) {
    const prev = zoomPercent;
    const next = Number(target) || 100;
    if (next === prev) {
      syncZoomUi();
      return;
    }
    try {
      await window.api.zoomPreview(next); // 先看一眼效果
      refit();
      const save = await askZoomSave(prev, next);
      if (save) {
        const r = await window.api.zoomSave(next);
        zoomPercent = (r && r.percent) || next;
        U.toast(`已保存界面缩放：${zoomPercent}%`, 'ok', 2600);
      } else {
        await window.api.zoomPreview(prev);
        zoomPercent = prev;
        U.toast(`已恢复界面缩放：${prev}%`, 'info', 2600);
      }
      refit();
    } catch (err) {
      U.toast(U.cleanError(err), 'error');
      await window.api.zoomPreview(prev).catch(() => {});
      zoomPercent = prev;
    }
    syncZoomUi();
  }

  /** 主进程用快捷键（Ctrl+Shift+0）复位后同步界面状态 */
  function onZoomChanged(payload) {
    const p = payload && Number(payload.percent);
    if (!p) return;
    zoomPercent = p;
    syncZoomUi();
    refit();
    if (payload.reset) U.toast('界面缩放已复位为 100%', 'ok', 2600);
  }

  function bindContent() {
    document.querySelectorAll('.snav').forEach((btn) => {
      btn.onclick = () => activateTab(btn.dataset.tab);
    });

    // 主题
    const grid = $('#theme-grid');
    grid.addEventListener('click', (e) => {
      const card = e.target.closest('[data-theme]');
      if (!card) return;
      persist({ theme: card.dataset.theme });
      grid.querySelectorAll('.theme-card').forEach((c) => c.classList.toggle('active', c === card));
    });

    // 速率单位
    const persistUnit = (key, value) => {
      persist({ units: Object.assign({}, cfg.units, { [key]: value }) });
    };
    $('#set-unit-global').addEventListener('change', (e) => persistUnit('global', e.target.value));
    document.querySelectorAll('[data-unit]').forEach((sel) => {
      sel.addEventListener('change', () => persistUnit(sel.dataset.unit, sel.value));
    });

    // 背景图
    $('#wall-pick').addEventListener('click', async () => {
      try {
        const r = await window.api.pickWallpaper();
        if (!r || !r.dataUrl) return;
        await persist({ wallpaper: r.dataUrl });
        $('#wall-preview').style.backgroundImage = 'url(' + r.dataUrl + ')';
        $('#wall-name').textContent = r.name || '已设置背景图';
        U.toast('背景图已应用', 'ok');
      } catch (err) {
        U.toast(U.cleanError(err), 'error');
      }
    });
    $('#wall-clear').addEventListener('click', async () => {
      await persist({ wallpaper: '' });
      $('#wall-preview').style.backgroundImage = '';
      $('#wall-name').textContent = '当前：主题纯色';
    });

    // 界面缩放（独立存储，不进配置文件）
    const zoomSel = $('#set-zoom');
    if (zoomSel) {
      zoomSel.addEventListener('change', () => changeZoom(Number(zoomSel.value) || 100));
    }
    const zoomReset = $('#set-zoom-reset');
    if (zoomReset) {
      zoomReset.addEventListener('click', () => changeZoom(100));
    }

    // 字体
    const fontPatch = () => ({
      fonts: {
        size: U.clamp(Number($('#set-fontsize').value) || 13, 10, 24),
        en: $('#set-fonten').value,
        zh: $('#set-fontzh').value
      }
    });
    $('#set-fontsize').addEventListener('change', () => persist(fontPatch()));
    $('#set-fonten').addEventListener('change', () => persist(fontPatch()));
    $('#set-fontzh').addEventListener('change', () => persist(fontPatch()));
    $('#set-fontcustom').addEventListener('keydown', (e) => {
      if (e.key !== 'Enter') return;
      const v = e.target.value.trim();
      if (!v) return;
      const p = fontPatch();
      p.fonts.en = `${v}, ${p.fonts.en}`;
      persist(p);
      $('#set-fonten').innerHTML = fontOptions(FONT_EN, p.fonts.en);
      e.target.value = '';
    });

    // 鼠标
    const mousePatch = () => ({ mouse: { middle: $('#set-middle').value, right: $('#set-right').value } });
    $('#set-middle').addEventListener('change', () => persist(mousePatch()));
    $('#set-right').addEventListener('change', () => persist(mousePatch()));

    // 快捷键录制
    document.querySelectorAll('.key-capture').forEach((input) => {
      input.addEventListener('focus', () => input.classList.add('recording'));
      input.addEventListener('blur', () => input.classList.remove('recording'));
      input.addEventListener('keydown', (e) => {
        e.preventDefault();
        e.stopPropagation();
        if (e.key === 'Escape') {
          input.blur();
          return;
        }
        const combo = comboOf(e);
        if (!combo) return;
        const sc = Object.assign({}, cfg.shortcuts, { [input.dataset.sc]: combo });
        input.value = combo;
        persist({ shortcuts: sc });
        input.blur();
      });
    });
    document.querySelectorAll('[data-reset]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const def = (SHORTCUTS.find((s) => s.k === btn.dataset.reset) || {}).def;
        const input = document.querySelector(`.key-capture[data-sc="${btn.dataset.reset}"]`);
        if (input) input.value = def;
        persist({ shortcuts: Object.assign({}, cfg.shortcuts, { [btn.dataset.reset]: def }) });
      });
    });

    // 下载文件夹
    const dlInput = $('#set-dldir');
    dlInput.addEventListener('change', () => persist({ downloadDir: dlInput.value.trim() }));
    $('#set-dlpick').addEventListener('click', async () => {
      const dir = await window.api.pickDownloadDir();
      if (!dir) return;
      dlInput.value = dir;
      await persist({ downloadDir: dir });
    });
    $('#set-dlopen').addEventListener('click', () => window.api.openDownloadDir());

    // 代理
    const renderProxies = () => {
      const box = $('#proxy-list');
      if (!box) return;
      const list = (App.state.data.settings.proxies) || [];
      const def = App.state.data.settings.defaultProxyId || (list.length === 1 ? list[0].id : '');
      box.innerHTML = list.length
        ? list.map((p) => `<div class="proxy-row" data-pid="${U.esc(p.id)}">
            <div class="proxy-main">
              <div class="proxy-name">${U.esc(p.name)}${p.id === def ? '<span class="proxy-badge">默认</span>' : ''}</div>
              <div class="proxy-sub">${U.esc(p.type)}://${U.esc(p.host)}:${p.port}${p.user ? ' · 用户 ' + U.esc(p.user) : ''}${p.hasAuth ? ' · 含密码' : ''}</div>
            </div>
            <button class="btn sm" data-pdefault="${U.esc(p.id)}"${p.id === def ? ' disabled' : ''}>设为默认</button>
            <button class="btn sm" data-pedit="${U.esc(p.id)}">编辑</button>
            <button class="btn sm danger" data-pdel="${U.esc(p.id)}">删除</button>
          </div>`).join('')
        : '<div class="key-empty">还没有代理，点击下方「添加代理」</div>';
    };
    const openProxyEditor = (proxy) => {
      const type = proxy ? proxy.type : 'socks5'; // 新建默认 SOCKS5
      U.openSubModal({
        title: proxy ? '编辑代理' : '添加代理',
        width: '480px',
        okText: '保存',
        body: `<div class="form-row"><div class="field" style="flex:2"><label>名称</label><input id="px-name" type="text" value="${U.esc(proxy ? proxy.name : '')}" placeholder="例如：办公代理" /></div>
          <div class="field"><label>类型</label><select id="px-type"><option value="http"${type === 'http' ? ' selected' : ''}>HTTP</option><option value="socks5"${type === 'socks5' ? ' selected' : ''}>SOCKS5</option></select></div></div>
          <div class="form-row"><div class="field" style="flex:2"><label>主机</label><input id="px-host" type="text" value="${U.esc(proxy ? proxy.host : '')}" placeholder="127.0.0.1" /></div>
          <div class="field" style="flex:0 0 100px"><label>端口</label><input id="px-port" type="number" value="${proxy ? proxy.port : type === 'socks5' ? 1080 : 8080}" /></div></div>
          <div class="form-row"><div class="field"><label>用户名（可选）</label><input id="px-user" type="text" value="${U.esc(proxy ? proxy.user : '')}" /></div></div>
          <div class="form-row" style="margin-bottom:0"><div class="field"><label>密码（可选）</label><input id="px-pass" type="password" placeholder="${proxy && proxy.hasAuth ? '已保存，留空表示不修改' : '代理认证密码'}" autocomplete="new-password" /></div></div>`,
        onOk: async () => {
          const typeNow = $('#px-type').value;
          const payload = {
            id: proxy ? proxy.id : undefined,
            name: $('#px-name').value.trim(),
            type: typeNow,
            host: $('#px-host').value.trim(),
            port: Number($('#px-port').value) || (typeNow === 'socks5' ? 1080 : 8080),
            user: $('#px-user').value.trim()
          };
          if (!payload.host) throw new Error('请填写代理主机');
          const pwd = $('#px-pass').value;
          if (pwd) payload.password = pwd;
          const res = await window.api.proxySave(payload);
          App.setData(res.state);
          renderProxies();
          return true;
        }
      });
      // 切换类型时，端口还是默认值就跟着改（1080 / 8080），免去手改
      const typeSel = $('#px-type');
      const portInput = $('#px-port');
      if (typeSel && portInput) {
        typeSel.addEventListener('change', () => {
          const next = typeSel.value === 'socks5' ? 1080 : 8080;
          const cur = String(portInput.value || '').trim();
          if (!cur || cur === '1080' || cur === '8080') portInput.value = next;
        });
      }
    };
    renderProxies();
    $('#proxy-add').addEventListener('click', () => openProxyEditor(null));
    $('#proxy-list').addEventListener('click', async (e) => {
      const list = (App.state.data.settings.proxies) || [];
      const ed = e.target.closest('[data-pedit]');
      if (ed) return openProxyEditor(list.find((p) => p.id === ed.dataset.pedit));
      const del = e.target.closest('[data-pdel]');
      if (del) {
        const ok = await U.confirmSub('删除代理', '确定删除该代理吗？引用它的连接会退回不使用代理。', '删除');
        if (!ok) return;
        const state = await window.api.proxyDelete(del.dataset.pdel);
        App.setData(state);
        renderProxies();
        return;
      }
      const df = e.target.closest('[data-pdefault]');
      if (df) {
        const state = await window.api.proxyDefault(df.dataset.pdefault);
        App.setData(state);
        renderProxies();
      }
    });

    // WebDAV 云同步
    const setWdStatus = (state, title, lines) => {
      const el = $('#wd-status');
      if (!el) return;
      el.className = 'sync-result ' + (state || 'idle');
      const items = (lines || []).filter(Boolean);
      el.innerHTML =
        `<div class="sr-head"><i class="sr-dot"></i><span class="sr-title">${U.esc(title || '')}</span></div>` +
        (items.length ? `<ul class="sr-list">${items.map((t) => `<li>${t}</li>`).join('')}</ul>` : '');
    };
    const saveWebdavForm = async () => {
      const syncPass = $('#wd-syncpass').value;
      const syncPass2 = $('#wd-syncpass2').value;
      if (syncPass || syncPass2) {
        if (syncPass !== syncPass2) throw new Error('两次输入的配置加密密码不一致');
        if (syncPass.length < 6) throw new Error('配置加密密码至少 6 位');
      }
      const payload = {
        url: $('#wd-url').value.trim(),
        username: $('#wd-user').value.trim(),
        syncUser: $('#wd-syncuser').value.trim()
      };
      const password = $('#wd-pass').value;
      if (password) payload.password = password;
      if (syncPass) payload.syncPass = syncPass;
      const res = await window.api.webdavSave(payload);
      App.setData(res);
      const w = res.settings.webdav || {};
      $('#wd-pass').value = '';
      $('#wd-syncpass').value = '';
      $('#wd-syncpass2').value = '';
      $('#wd-syncuser').value = w.syncUser || '';
      $('#wd-pass').placeholder = w.hasPassword ? '已保存，留空表示不修改' : 'WebDAV 密码（可留空）';
      $('#wd-syncpass').placeholder = w.hasSyncPass ? '已保存，留空表示不修改' : '至少 6 位，用于加密云端配置';
      return res;
    };
    $('#wd-save').addEventListener('click', async () => {
      try {
        await saveWebdavForm();
        setWdStatus('ok', '配置已保存', [
          '已写入本机的 WebDAV 地址、认证信息与同步用户名。',
          '云端文件路径：' + U.esc(((App.state.data.settings.webdav || {}).remotePath) || '（填写同步用户名后自动生成）'),
          '下一步可点击「测试连接」检查是否可访问，或直接「立即同步」。'
        ]);
        U.toast('WebDAV 配置已保存', 'ok');
      } catch (err) {
        setWdStatus('error', '保存失败', [U.esc(U.cleanError(err))]);
        U.toast(U.cleanError(err), 'error', 4000);
      }
    });
    $('#wd-test').addEventListener('click', async () => {
      const btn = $('#wd-test');
      btn.disabled = true;
      setWdStatus('running', '正在测试连接…', ['正在请求 WebDAV 服务器，请稍候。']);
      try {
        await saveWebdavForm();
        const r = await window.api.webdavTest();
        setWdStatus('ok', r.exists ? '连接成功，已找到云端配置' : '连接成功', [
          r.message ? U.esc(r.message) : '',
          '云端文件：' + U.esc((App.state.data.settings.webdav || {}).remotePath || '—'),
          r.exists ? '可以直接点击「立即同步」做双向合并。' : '云端还没有配置，首次同步会把本机配置完整上传。'
        ]);
        U.toast(r.message || '连接成功', 'ok');
      } catch (err) {
        const msg = U.cleanError(err);
        setWdStatus('error', '连接测试失败', [U.esc(msg), '请检查服务器地址、用户名与密码，或确认网络是否可达。']);
        U.toast(msg, 'error', 4500);
      } finally {
        btn.disabled = false;
      }
    });
    $('#wd-sync').addEventListener('click', async () => {
      const btn = $('#wd-sync');
      btn.disabled = true;
      setWdStatus('running', '正在同步…', [
        '1/3 读取并解密云端配置',
        '2/3 按「上次同步基线」双向合并新增与删除',
        '3/3 重新加密并上传合并结果'
      ]);
      try {
        await saveWebdavForm();
        const r = await window.api.webdavSync();
        App.setData(r.state);
        const up = r.uploaded || {};
        const rl = r.removedLocal || {};
        const rr = r.removedRemote || {};
        const sum = (o) => Object.keys(o || {}).reduce((n, k) => n + (Number(o[k]) || 0), 0);
        const lines = [];
        lines.push(
          `本机 → 云端：已上传 <b>${up.connections || 0}</b> 台服务器 / <b>${up.groups || 0}</b> 个分组（含密钥与快捷命令）`
        );
        if (r.added) lines.push(`云端 → 本机：合并新增 <b>${r.added}</b> 台服务器`);
        if (r.snippetsAdded) lines.push(`云端 → 本机：新增 <b>${r.snippetsAdded}</b> 条快捷命令`);
        if (r.favoritesAdded) lines.push(`云端 → 本机：新增 <b>${r.favoritesAdded}</b> 个收藏文件夹`);
        if (sum(rl)) {
          const parts = [];
          if (rl.connections) parts.push(`${rl.connections} 台服务器`);
          if (rl.groups) parts.push(`${rl.groups} 个分组`);
          if (rl.snippets) parts.push(`${rl.snippets} 条快捷命令`);
          if (rl.favorites) parts.push(`${rl.favorites} 个收藏`);
          if (rl.keys) parts.push(`${rl.keys} 个密钥`);
          lines.push(`云端已删除 → 本机同步删除：${parts.join('、')}`);
        }
        if (sum(rr)) {
          const parts = [];
          if (rr.connections) parts.push(`${rr.connections} 台服务器`);
          if (rr.groups) parts.push(`${rr.groups} 个分组`);
          if (rr.snippets) parts.push(`${rr.snippets} 条快捷命令`);
          if (rr.favorites) parts.push(`${rr.favorites} 个收藏`);
          if (rr.keys) parts.push(`${rr.keys} 个密钥`);
          lines.push(`本机已删除 → 云端同步删除：${parts.join('、')}`);
        }
        if (r.skipped) lines.push(`跳过重复项：<b>${r.skipped}</b> 项（主机 + 端口 + 用户名相同）`);
        if (r.firstSync) {
          lines.push(
            '本次为首次同步（还没有历史基线），只做了合并；如需把本机删除同步到云端，请再点一次「立即同步」。'
          );
        }
        lines.push(`云端文件：${U.esc(r.remote || '')}`);
        lines.push(`完成时间：${U.esc(U.fmtTime(r.lastSyncAt || Date.now()))}`);
        setWdStatus('ok', '同步成功', lines);
        U.toast(
          `同步完成 · 新增 ${r.added || 0} 台，本机删除 ${sum(rr)} 项已推送到云端`,
          'ok',
          4800
        );
      } catch (err) {
        const msg = U.cleanError(err);
        setWdStatus('error', '同步失败（本地数据未改动）', [
          U.esc(msg),
          '常见原因：WebDAV 地址或密码错误、配置加密密码不正确、云端文件损坏、网络不可达。',
          '修正后可重新点击「立即同步」。'
        ]);
        U.toast(msg, 'error', 5200);
      } finally {
        btn.disabled = false;
      }
    });

    // 板块
    document.querySelectorAll('[data-panel]').forEach((chk) => {
      chk.addEventListener('change', () => setPanel(chk.dataset.panel, chk.checked));
    });

    // 启动
    $('#set-dirsync').addEventListener('change', (e) => persist({ dirSync: e.target.checked }));
    $('#set-dock').addEventListener('change', (e) => persist({ startDockedRight: e.target.checked }));
    $('#set-clickrun').addEventListener('change', (e) => persist({ snippetClickRun: e.target.checked }));
    $('#set-resetpos').addEventListener('click', async () => {
      await window.api.resetWindowPos();
      U.toast('已重置，下次启动将重新贴靠屏幕右侧', 'ok');
    });

    const clearBtn = $('#data-clear');
    if (clearBtn) {
      clearBtn.addEventListener('click', async () => {
        // 第一次确认：说明后果
        const ok = await U.confirmSub(
          '清空软件数据',
          '将清空服务器配置、分组、密钥库、收藏文件夹、快捷命令、命令历史与全部设置。\n\n清空前会先关闭并清除 WebDAV 云同步配置，不会把空服务器列表同步到云端。\n\n确定继续吗？',
          '继续'
        );
        if (!ok) return;

        // 第二次确认：3 秒倒计时，倒计时结束才能点「确认清空」
        const sure = await confirmClearWithCountdown();
        if (!sure) return;

        try {
          const res = await window.api.clearData({});
          App.setData(res.state);
          readCfg();
          apply();
          close();
          U.toast('软件数据已清空，WebDAV 同步已关闭', 'ok', 4800);
        } catch (err) {
          U.toast(U.cleanError(err), 'error', 5200);
        }
      });
    }
  }

  /** 清空数据二次确认：3 秒倒计时，期间按钮禁用、不可关闭，倒计时结束才可点「确认清空」 */
  function confirmClearWithCountdown() {
    return new Promise((resolve) => {
      let left = 3;
      U.openSubModal({
        title: '再次确认清空',
        width: '460px',
        okText: '确认清空',
        cancelText: '取消',
        okClass: 'btn danger',
        body: `<div class="zoom-ask">
            <p class="zoom-ask-line">此操作<b>不可恢复</b>，将清空全部软件数据。</p>
            <p class="zoom-ask-tip"><b id="clear-count">${left}</b> 秒后可点击「确认清空」；期间无法关闭本窗口。</p>
          </div>`
      }).then((v) => {
        cleanup();
        resolve(v !== null && v !== false);
      });

      const okBtn = U.qs('#sub-ok');
      const cancelBtn = U.qs('#sub-cancel');
      const countEl = U.qs('#clear-count');
      const subMask = U.qs('#sub-mask');
      const closeBtn = U.qs('#sub-close');
      const bodyEl = U.qs('#sub-body');

      const locked = (v) => {
        if (okBtn) okBtn.disabled = v;
        if (cancelBtn) cancelBtn.disabled = v;
      };
      locked(true);
      if (subMask) subMask.onmousedown = null; // 倒计时期间点遮罩不关闭
      if (closeBtn) closeBtn.onclick = null;
      if (bodyEl) bodyEl.onkeydown = null;

      const onEsc = (e) => {
        if (e.key !== 'Escape') return;
        e.preventDefault();
        e.stopPropagation();
      };
      document.addEventListener('keydown', onEsc, true);

      const timer = setInterval(() => {
        left -= 1;
        if (countEl) countEl.textContent = String(Math.max(0, left));
        if (left <= 0) {
          clearInterval(timer);
          locked(false);
        }
      }, 1000);

      function cleanup() {
        clearInterval(timer);
        document.removeEventListener('keydown', onEsc, true);
      }
    });
  }

  function init() {
    readCfg();
    apply();
    const btn = $('#btn-settings');
    if (btn) btn.addEventListener('click', open);
    $('#settings-close').addEventListener('click', close);
    $('#settings-done').addEventListener('click', close);
    $('#settings-reset').addEventListener('click', async () => {
      const ok = await U.confirmSub('恢复默认设置', '将重置主题、背景、字体、鼠标、快捷键、板块与启动设置（不影响已保存的服务器配置）。', '恢复默认');
      if (!ok) return;
      await persist({
        theme: DEFAULTS.theme, netUnit: DEFAULTS.netUnit, wallpaper: '',
        units: Object.assign({}, DEFAULTS.units),
        fonts: Object.assign({}, DEFAULTS.fonts),
        mouse: Object.assign({}, DEFAULTS.mouse),
        shortcuts: Object.assign({}, DEFAULTS.shortcuts),
        panels: Object.assign({}, DEFAULTS.panels),
        startDockedRight: true,
        dirSync: true
      });
      render();
      bindContent();
      U.toast('已恢复默认设置', 'ok');
    });
    mask.addEventListener('mousedown', (e) => {
      if (e.target === mask) close();
    });
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && mask.classList.contains('show')) close();
    });
  }

  document.addEventListener('DOMContentLoaded', init);

  return { init, open, close, apply, persist, setPanel, comboOf, THEMES, DEFAULTS, readCfg, activateTab, onZoomChanged };
})();
