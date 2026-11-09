'use strict';
/* 文件编辑器：独立窗口，多文件标签（由主窗口通过 editor:open 调用） */
(function () {
  const $ = (s) => document.querySelector(s);
  const tabsEl = $('#etabs');
  const textEl = $('#etext');
  const gutterEl = $('#egutter');
  const statusEl = $('#estatus');

  const THEMES = {
    warm: { bg: '#f7f6f2', panel: '#ffffff', p2: '#fbfaf7', p3: '#f3f1eb', line: '#e7e5df', ls: '#d9d6ce', text: '#15191d', t2: '#5d666f', muted: '#8b939b', accent: '#16665a', soft: '#e6efec', primary: '#15191d', hover: '#000000' },
    mist: { bg: '#f3f7fc', panel: '#ffffff', p2: '#f7fafd', p3: '#eef3fa', line: '#e0e8f2', ls: '#cbd8e8', text: '#1c2431', t2: '#55606f', muted: '#8b95a5', accent: '#2f7cf6', soft: '#eaf2ff', primary: '#233a56', hover: '#0f233c' },
    sand: { bg: '#faf5ee', panel: '#fffdf9', p2: '#fbf6ef', p3: '#f5ede2', line: '#eadfd1', ls: '#dccabb', text: '#2d2620', t2: '#6b5f53', muted: '#9a8d80', accent: '#b4552f', soft: '#f8e9df', primary: '#3b3129', hover: '#1d1610' },
    graphite: { bg: '#eef0f2', panel: '#ffffff', p2: '#f7f8fa', p3: '#eaecef', line: '#dfe3e8', ls: '#c9cfd7', text: '#20262e', t2: '#59636e', muted: '#8c96a2', accent: '#3b6ea5', soft: '#e7eff8', primary: '#2b323b', hover: '#11161c' },
    night: { bg: '#14181d', panel: '#1d232b', p2: '#222a33', p3: '#182029', line: '#2c3540', ls: '#3a4552', text: '#e2e8f0', t2: '#aab6c4', muted: '#758394', accent: '#5fc2b0', soft: '#233b38', primary: '#4a5b70', hover: '#5d7289' }
  };

  let tabs = [];
  let activeId = null;
  let seq = 0;

  function esc(s) {
    return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  function fmtBytes(n) {
    n = Number(n) || 0;
    if (n < 1024) return n + ' B';
    const u = ['KB', 'MB', 'GB'];
    let i = -1;
    do { n /= 1024; i++; } while (n >= 1024 && i < u.length - 1);
    return n.toFixed(1) + ' ' + u[i];
  }

  function cur() {
    return tabs.find((t) => t.id === activeId) || null;
  }

  function applyTheme() {
    window.api.getState().then((d) => {
      const s = (d && d.settings) || {};
      const t = THEMES[s.theme] || THEMES.warm;
      const r = document.documentElement.style;
      r.setProperty('--bg', t.bg);
      r.setProperty('--panel', t.panel);
      r.setProperty('--panel-2', t.p2);
      r.setProperty('--panel-3', t.p3);
      r.setProperty('--line', t.line);
      r.setProperty('--line-strong', t.ls);
      r.setProperty('--text', t.text);
      r.setProperty('--text-2', t.t2);
      r.setProperty('--muted', t.muted);
      r.setProperty('--accent', t.accent);
      r.setProperty('--accent-soft', t.soft);
      r.setProperty('--primary', t.primary);
      r.setProperty('--primary-hover', t.hover);
      const f = s.fonts || {};
      r.setProperty('--font-mono', `${f.en || 'Consolas, monospace'}, ${f.zh || '"Microsoft YaHei", sans-serif'}, monospace`);
      r.setProperty('--font-size', (Number(f.size) || 13) + 'px');
      document.body.classList.toggle('theme-dark', s.theme === 'night');
    }).catch(() => {});
  }

  function renderTabs() {
    if (!tabs.length) {
      tabsEl.innerHTML = '<span class="etabs-empty">双击主窗口文件管理器中的文件即可在此编辑</span>';
      return;
    }
    tabsEl.innerHTML = tabs
      .map(
        (t) => `<span class="etab${t.id === activeId ? ' active' : ''}" data-id="${t.id}" title="${esc(t.path)}">
          <span class="edot${t.content !== t.saved ? ' dirty' : ''}"></span>
          <span class="ename">${esc(t.name)}</span>
          <button class="eclose" data-close="${t.id}" title="关闭">✕</button>
        </span>`
      )
      .join('');
    tabsEl.querySelectorAll('.etab').forEach((el) => {
      el.addEventListener('click', (e) => {
        if (e.target.closest('[data-close]')) return;
        activate(el.dataset.id);
      });
    });
    tabsEl.querySelectorAll('[data-close]').forEach((b) => {
      b.addEventListener('click', (e) => {
        e.stopPropagation();
        closeTab(b.dataset.close);
      });
    });
  }

  function stash() {
    const t = cur();
    if (t && !t.loading) t.content = textEl.value;
  }

  function activate(id) {
    stash();
    activeId = id;
    const t = cur();
    textEl.disabled = !!(t && t.loading);
    textEl.value = t ? t.content : '';
    if (t && t.error) statusEl.textContent = t.error;
    else if (t) statusEl.textContent = `${t.path} · ${fmtBytes(t.size)}`;
    paintGutter();
    renderTabs();
  }

  function paintGutter() {
    const lines = textEl.value.split('\n').length;
    if (gutterEl.dataset.n === String(lines)) return;
    gutterEl.dataset.n = String(lines);
    let h = '';
    for (let i = 1; i <= lines; i++) h += i + '\n';
    gutterEl.textContent = h;
    gutterEl.scrollTop = textEl.scrollTop;
  }

  function paintInfo() {
    const t = cur();
    if (!t) return;
    const dirty = t.content !== t.saved;
    statusEl.textContent = `${t.path} · ${textEl.value.split('\n').length} 行 · ${fmtBytes(new Blob([textEl.value]).size)}${dirty ? ' · 未保存' : ''}`;
    renderTabs();
  }

  async function openFile(payload) {
    if (!payload || !payload.path) return;
    const found = tabs.find((t) => t.sessionId === payload.sessionId && t.path === payload.path);
    if (found) {
      activate(found.id);
      window.focus();
      return;
    }
    const id = 't' + ++seq;
    const t = {
      id,
      sessionId: payload.sessionId,
      path: payload.path,
      name: payload.name || payload.path.split('/').pop() || '文件',
      content: '',
      saved: '',
      size: 0,
      loading: true,
      error: ''
    };
    tabs.push(t);
    activeId = id;
    textEl.disabled = true;
    textEl.value = '';
    statusEl.textContent = '正在读取 ' + t.path + ' …';
    renderTabs();
    try {
      const res = await window.api.fsRead({ sessionId: t.sessionId, path: t.path });
      t.content = res.content;
      t.saved = res.content;
      t.size = res.size;
      t.loading = false;
      if (activeId === id) {
        textEl.value = t.content;
        textEl.disabled = false;
        textEl.focus();
        paintGutter();
        paintInfo();
      }
    } catch (err) {
      t.loading = false;
      t.error = (err && err.message ? err.message : String(err)).replace(/^Error invoking remote method '[^']*':\s*/i, '');
      if (activeId === id) {
        textEl.value = '';
        textEl.disabled = false;
        textEl.placeholder = t.error;
        statusEl.textContent = t.error;
      }
    }
    renderTabs();
  }

  async function save() {
    const t = cur();
    if (!t || t.loading) return;
    stash();
    if (t.content === t.saved) {
      statusEl.textContent = '没有需要保存的修改';
      return;
    }
    try {
      const r = await window.api.fsWrite({ sessionId: t.sessionId, path: t.path, content: t.content });
      t.saved = t.content;
      t.size = r.bytes;
      paintInfo();
      statusEl.textContent = `已保存 ${t.name}（${fmtBytes(r.bytes)}）`;
    } catch (err) {
      statusEl.textContent = '保存失败：' + (err && err.message ? err.message : String(err));
    }
  }

  function closeTab(id) {
    const t = tabs.find((x) => x.id === id);
    if (!t) return;
    if (t.content !== t.saved && !window.confirm(`${t.name} 有未保存的修改，确定关闭吗？`)) return;
    const wasActive = activeId === id;
    tabs = tabs.filter((x) => x.id !== id);
    if (wasActive) {
      activeId = tabs.length ? tabs[tabs.length - 1].id : null;
      const nt = cur();
      textEl.value = nt ? nt.content : '';
      textEl.disabled = nt ? !!nt.loading : true;
      textEl.placeholder = '';
      statusEl.textContent = nt ? `${nt.path} · ${fmtBytes(nt.size)}` : '';
      paintGutter();
    }
    renderTabs();
  }

  function init() {
    applyTheme();
    window.api.on('editor:open-file', (payload) => {
      applyTheme();
      openFile(payload);
    });

    textEl.addEventListener('input', () => {
      stash();
      paintGutter();
      paintInfo();
    });
    textEl.addEventListener('scroll', () => {
      gutterEl.scrollTop = textEl.scrollTop;
    });
    textEl.addEventListener('keydown', (e) => {
      if (e.key === 'Tab') {
        e.preventDefault();
        const s = textEl.selectionStart;
        const t = textEl.selectionEnd;
        textEl.value = textEl.value.slice(0, s) + '\t' + textEl.value.slice(t);
        textEl.selectionStart = textEl.selectionEnd = s + 1;
        stash();
        paintGutter();
        paintInfo();
      }
    });

    document.addEventListener('keydown', (e) => {
      const mod = e.ctrlKey || e.metaKey;
      if (mod && e.key.toLowerCase() === 's') {
        e.preventDefault();
        save();
      } else if (mod && e.key.toLowerCase() === 'w') {
        e.preventDefault();
        if (activeId) closeTab(activeId);
      } else if (e.key === 'Escape' && activeId) {
        closeTab(activeId);
      }
    });

    $('#esave').addEventListener('click', save);
    $('#eclose').addEventListener('click', () => activeId && closeTab(activeId));
    $('#emin').addEventListener('click', () => window.api.editorMinimize());
    $('#emax').addEventListener('click', () => window.api.editorMaximize());
    $('#eclosewin').addEventListener('click', () => window.api.editorCloseWindow());
    $('#etitle').addEventListener('dblclick', () => window.api.editorMaximize());
    renderTabs();
  }

  document.addEventListener('DOMContentLoaded', init);
})();
