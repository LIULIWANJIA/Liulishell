'use strict';
/* 文件编辑器：独立窗口，多文件标签 + 顶部菜单 + 行号（支持自动换行）
 * 由主窗口通过 editor:open-file 事件打开文件。 */
(function () {
  const $ = (s) => document.querySelector(s);
  const tabsEl = $('#etabs');
  const textEl = $('#etext');
  const gutterEl = $('#egutter');
  const statusEl = $('#estatus');
  const posEl = $('#epos');
  const findEl = $('#efind');
  const findQ = $('#efind-q');
  const findR = $('#efind-r');
  const findCount = $('#efind-count');
  const findCase = $('#efind-case');
  const dlgMask = $('#edialog-mask');
  const dlgInput = $('#edialog-input');

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
  let wrapOn = true;

  /* ---------------- 基础 ---------------- */

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

  /** 右上角保存提示气泡 */
  function toast(message, type) {
    const box = document.getElementById('etoasts');
    if (!box) return;
    const el = document.createElement('div');
    el.className = 'etoast' + (type === 'ok' ? ' ok' : type === 'err' ? ' err' : '');
    el.textContent = message;
    box.appendChild(el);
    while (box.children.length > 4) box.firstElementChild.remove();
    setTimeout(() => {
      el.classList.add('hide');
      setTimeout(() => el.remove(), 220);
    }, 2400);
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
      // 字体/字号变化会影响行高与换行位置，重新测量
      invalidateMetrics();
      paintGutter();
    }).catch(() => {});
  }

  /* ---------------- 行号 ---------------- */

  const mirror = document.createElement('div');
  mirror.className = 'emirror';
  let metrics = { key: '', lineH: 20, heights: [], tops: [], count: 0 };

  function lineHeight() {
    const lh = parseFloat(getComputedStyle(textEl).lineHeight);
    return Number.isFinite(lh) && lh > 0 ? lh : 20;
  }

  function invalidateMetrics() {
    metrics.key = '';
    gutterEl.dataset.key = '';
    lastCur = -1;
  }

  /** 计算每一逻辑行的视觉高度与顶部偏移（自动换行时一行可能占多行高度） */
  function computeMetrics() {
    const lines = textEl.value.split('\n');
    const count = lines.length;
    const lh = lineHeight();
    const key = [count, wrapOn ? 'w' : 'n', wrapOn ? textEl.clientWidth : 0, lh].join('|');
    if (metrics.key === key) return metrics;

    const heights = new Array(count);
    let measured = false;
    if (wrapOn && count <= 20000) {
      const cs = getComputedStyle(textEl);
      mirror.style.fontFamily = cs.fontFamily;
      mirror.style.fontSize = cs.fontSize;
      mirror.style.lineHeight = cs.lineHeight;
      mirror.style.letterSpacing = cs.letterSpacing;
      mirror.style.width = Math.max(20, textEl.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight)) + 'px';
      const frag = document.createDocumentFragment();
      for (let i = 0; i < count; i++) {
        const d = document.createElement('div');
        d.textContent = lines[i] === '' ? '\u00a0' : lines[i];
        frag.appendChild(d);
      }
      mirror.textContent = '';
      mirror.appendChild(frag);
      document.body.appendChild(mirror);
      const nodes = mirror.children;
      for (let i = 0; i < count; i++) {
        const h = nodes[i] ? nodes[i].getBoundingClientRect().height : 0;
        heights[i] = h > 0 ? h : lh;
      }
      mirror.remove();
      measured = true;
    }
    if (!measured) {
      // 不开自动换行（或文件过大）时每行等高
      for (let i = 0; i < count; i++) heights[i] = lh;
    }
    const tops = new Array(count);
    let acc = 0;
    for (let i = 0; i < count; i++) {
      tops[i] = acc;
      acc += heights[i];
    }
    metrics = { key, lineH: lh, heights, tops, count };
    return metrics;
  }

  function currentLineIndex() {
    const pos = textEl.selectionStart || 0;
    return textEl.value.slice(0, pos).split('\n').length - 1;
  }

  let lastCur = -1;

  /** 高亮当前行行号（只切 class，不重建 DOM） */
  function markCurrent() {
    const idx = currentLineIndex();
    if (idx === lastCur) return;
    lastCur = idx;
    const prev = gutterEl.querySelector('.elnum.cur');
    if (prev) prev.classList.remove('cur');
    const el = gutterEl.children[idx];
    if (el) el.classList.add('cur');
  }

  /* ---------- 查找结果在行号列上的标记 ---------- */

  let hitSig = '';

  /** 把「包含查找目标的行」标出来：命中行浅色，当前匹配行强调色 + 左侧竖条 */
  function applyHitMarks() {
    const sig = `${find.gen}:${find.curLine}:${gutterEl.children.length}:${find.hitLines.size}`;
    if (sig === hitSig) return;
    hitSig = sig;
    const kids = gutterEl.children;
    const has = find.hitLines.size > 0;
    for (let i = 0; i < kids.length; i++) {
      const el = kids[i];
      const hit = has && find.hitLines.has(i);
      if (hit !== el.classList.contains('hit')) el.classList.toggle('hit', hit);
      const cur = hit && i === find.curLine;
      if (cur !== el.classList.contains('curhit')) el.classList.toggle('curhit', cur);
    }
  }

  /** 把字符偏移换算成行号：matches 已按位置升序，单次扫描即可 */
  function computeHitLines() {
    find.lines = [];
    find.hitLines = new Set();
    find.curLine = -1;
    find.gen++;
    if (!find.matches.length) return;
    const text = textEl.value;
    let line = 0;
    let scan = 0;
    let curDone = false;
    for (let k = 0; k < find.matches.length; k++) {
      const m = find.matches[k];
      for (let i = scan; i < m.s; i++) if (text.charCodeAt(i) === 10) line++;
      scan = m.s;
      find.lines.push(line);
      find.hitLines.add(line);
      if (!curDone && k === find.idx) {
        find.curLine = line;
        curDone = true;
      }
    }
    if (!curDone) find.curLine = find.lines[Math.max(0, find.idx)] ?? -1;
  }

  function paintGutter() {
    const m = computeMetrics();
    // 只有「行数 / 换行宽度 / 行高」变化时才重建行号列，普通输入与光标移动只切高亮
    if (gutterEl.dataset.key !== m.key) {
      gutterEl.dataset.key = m.key;
      lastCur = -1;
      const html = [];
      for (let i = 0; i < m.count; i++) {
        html.push(`<div class="elnum" style="height:${m.heights[i].toFixed(2)}px;line-height:${m.lineH}px">${i + 1}</div>`);
      }
      gutterEl.innerHTML = html.join('');
    }
    markCurrent();
    applyHitMarks();
    paintHlRows();
    syncGutterScroll();
  }

  function syncGutterScroll() {
    gutterEl.scrollTop = textEl.scrollTop;
    syncHlScroll();
  }

  /* ---------- 查找命中行的底色（正文区域） ---------- */

  const hlTrack = $('#ehl-track');
  let hlSig = '';

  function syncHlScroll() {
    if (!hlTrack) return;
    hlTrack.style.transform = `translateY(${-(textEl.scrollTop || 0)}px)`;
  }

  function paintHlRows() {
    if (!hlTrack) return;
    const m = computeMetrics();
    const sig = `${find.gen}|${find.curLine}|${m.key}`;
    if (sig === hlSig) {
      syncHlScroll();
      return;
    }
    hlSig = sig;
    const padTop = parseFloat(getComputedStyle(textEl).paddingTop) || 0;
    const lines = Array.from(find.hitLines)
      .filter((n) => n >= 0 && n < m.count)
      .sort((a, b) => a - b)
      .slice(0, 800);
    hlTrack.innerHTML = lines
      .map(
        (ln) =>
          `<div class="ehl${ln === find.curLine ? ' cur' : ''}" style="top:${(padTop + m.tops[ln]).toFixed(2)}px;height:${m.heights[ln].toFixed(2)}px"></div>`
      )
      .join('');
    syncHlScroll();
  }

  /** 滚动到指定行（0 基），用于定位行 / 查找结果 */
  function scrollToLine(idx) {
    const m = computeMetrics();
    const i = Math.max(0, Math.min(idx, m.count - 1));
    const top = m.tops[i] || 0;
    textEl.scrollTop = Math.max(0, top - Math.round(textEl.clientHeight * 0.3));
    syncGutterScroll();
  }

  let gutterTimer = null;
  function scheduleGutter() {
    if (gutterTimer) clearTimeout(gutterTimer);
    gutterTimer = setTimeout(() => {
      gutterTimer = null;
      paintGutter();
    }, 90);
  }

  /* ---------------- 自动换行 ---------------- */

  function setWrap(on, persist) {
    wrapOn = !!on;
    textEl.wrap = wrapOn ? 'soft' : 'off';
    textEl.classList.toggle('wrap', wrapOn);
    textEl.classList.toggle('nowrap', !wrapOn);
    invalidateMetrics();
    paintGutter();
    updatePos();
    if (persist) {
      try { localStorage.setItem('editor.wrap', wrapOn ? '1' : '0'); } catch (_) {}
    }
  }

  /* ---------------- 标签 ---------------- */

  function renderTabs() {
    if (!tabs.length) {
      tabsEl.innerHTML = '<span class="etabs-empty">双击主窗口文件管理器中的文件即可在此编辑</span>';
      return;
    }
    tabsEl.innerHTML = tabs
      .map(
        (t) => {
          // 未保存的文件在文件名后面标一个 *
          const dirty = !t.loading && t.content !== t.saved;
          return `<span class="etab${t.id === activeId ? ' active' : ''}" data-id="${t.id}" title="${esc(t.path)}${dirty ? ' · 未保存' : ''}">
          <span class="ename">${esc(t.name)}${dirty ? '<i class="edirty">*</i>' : ''}</span>
          <button class="eclose" data-close="${t.id}" title="关闭">✕</button>
        </span>`;
        }
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
    if (t && !t.loading) {
      t.content = textEl.value;
      t.scrollTop = textEl.scrollTop;
    }
  }

  /** 给 textarea 赋值后把光标与滚动条放回指定位置
   * （直接写 value 会把光标推到末尾，紧接着 focus() 会把视图滚到底部） */
  function resetView(top) {
    try { textEl.setSelectionRange(0, 0); } catch (_) {}
    invalidateMetrics();
    paintGutter();
    textEl.scrollTop = Number.isFinite(top) && top > 0 ? top : 0;
    textEl.scrollLeft = 0;
    syncGutterScroll();
    updatePos();
  }

  function activate(id) {
    stash();
    activeId = id;
    const t = cur();
    textEl.disabled = !!(t && t.loading);
    textEl.value = t ? t.content : '';
    if (t && t.error) statusEl.textContent = t.error;
    else if (t) statusEl.textContent = `${t.path} · ${fmtBytes(t.size)}`;
    resetView(t ? t.scrollTop : 0);
    hideFind();
    renderTabs();
  }

  function paintInfo() {
    const t = cur();
    if (!t) return;
    const dirty = t.content !== t.saved;
    statusEl.textContent = `${t.path} · ${textEl.value.split('\n').length} 行 · ${fmtBytes(new Blob([textEl.value]).size)}${dirty ? ' · 未保存' : ''}`;
    renderTabs();
    updatePos();
  }

  function updatePos() {
    if (!posEl) return;
    const pos = textEl.selectionStart || 0;
    const before = textEl.value.slice(0, pos);
    const line = before.split('\n').length;
    const col = pos - (before.lastIndexOf('\n') + 1) + 1;
    posEl.textContent = textEl.disabled ? '' : `行 ${line}，列 ${col}`;
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
      scrollTop: 0,
      loading: true,
      error: ''
    };
    tabs.push(t);
    activeId = id;
    textEl.disabled = true;
    textEl.value = '';
    statusEl.textContent = '正在读取 ' + t.path + ' …';
    resetView(0);
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
        // 光标回文件开头：先落位再聚焦，focus 不会再把视图拉到末尾
        resetView(0);
        try { textEl.focus({ preventScroll: true }); } catch (_) { textEl.focus(); }
        resetView(0);
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
        toast('打开失败：' + t.error, 'err');
        resetView(0);
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
      toast('没有需要保存的修改');
      return;
    }
    try {
      const r = await window.api.fsWrite({ sessionId: t.sessionId, path: t.path, content: t.content });
      t.saved = t.content;
      t.size = r.bytes;
      paintInfo();
      statusEl.textContent = `已保存 ${t.name}（${fmtBytes(r.bytes)}）`;
      toast(`已保存 ${t.name}`, 'ok');
    } catch (err) {
      const msg = err && err.message ? err.message : String(err);
      statusEl.textContent = '保存失败：' + msg;
      toast('保存失败：' + msg, 'err');
    }
  }

  /** 保存所有有改动的标签 */
  async function saveAll() {
    stash();
    const targets = tabs.filter((t) => !t.loading && t.content !== t.saved);
    if (!targets.length) {
      statusEl.textContent = '所有文件都已保存';
      toast('所有文件都已保存');
      return;
    }
    let ok = 0;
    let failed = '';
    for (const t of targets) {
      try {
        const r = await window.api.fsWrite({ sessionId: t.sessionId, path: t.path, content: t.content });
        t.saved = t.content;
        t.size = r.bytes;
        ok++;
      } catch (err) {
        failed = `${t.name}：` + (err && err.message ? err.message : String(err));
      }
    }
    renderTabs();
    const t = cur();
    if (t) paintInfo();
    statusEl.textContent = failed ? `全部保存完成 ${ok} 个，失败：${failed}` : `已保存 ${ok} 个文件`;
    if (failed) toast(`保存完成 ${ok} 个，失败：${failed}`, 'err');
    else toast(`已保存 ${ok} 个文件`, 'ok');
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
      textEl.placeholder = nt ? '' : '双击主窗口中的文件即可编辑（仅支持 < 10MB 的 UTF-8 文本）';
      statusEl.textContent = nt ? `${nt.path} · ${fmtBytes(nt.size)}` : '';
      resetView(nt ? nt.scrollTop : 0);
      if (!nt) posEl.textContent = '';
    }
    renderTabs();
  }

  /** 关闭全部标签（有未保存改动时先确认） */
  function closeAll() {
    const dirty = tabs.filter((t) => !t.loading && t.content !== t.saved);
    if (dirty.length && !window.confirm(`有 ${dirty.length} 个文件未保存，确定全部关闭吗？`)) return;
    tabs = [];
    activeId = null;
    textEl.value = '';
    textEl.disabled = true;
    textEl.placeholder = '双击主窗口中的文件即可编辑（仅支持 < 10MB 的 UTF-8 文本）';
    statusEl.textContent = '';
    posEl.textContent = '';
    resetView(0);
    renderTabs();
  }

  /* ---------------- 菜单（点击展开） ---------------- */

  const menuDrop = $('#emenu-drop');
  let openMenuName = '';

  function menuDefs() {
    const hasTab = !!cur();
    const dirtyCount = tabs.filter((t) => !t.loading && t.content !== t.saved).length;
    return {
      file: [
        { label: '保存', key: 'Ctrl+S', onClick: save },
        { label: '全部保存', key: 'Ctrl+Shift+S', hint: dirtyCount ? `（${dirtyCount} 个未保存）` : '', onClick: saveAll },
        { sep: true },
        { label: '关闭当前标签', key: 'Ctrl+W', disabled: !hasTab, onClick: () => activeId && closeTab(activeId) },
        { label: '关闭全部标签', disabled: !tabs.length, onClick: closeAll }
      ],
      edit: [
        { label: '查找 / 替换…', key: 'Ctrl+F', disabled: !hasTab, onClick: () => openFind(true) },
        { label: '定位行…', key: 'Ctrl+G', disabled: !hasTab, onClick: openGoto }
      ],
      view: [{ label: '自动换行', checked: wrapOn, onClick: () => setWrap(!wrapOn, true) }]
    };
  }

  function openMenu(name, btn) {
    const defs = menuDefs()[name] || [];
    menuDrop.innerHTML = defs
      .map((it, i) => {
        if (it.sep) return '<div class="emi-sep"></div>';
        return `<div class="emi${it.disabled ? ' disabled' : ''}" data-i="${i}">
          <span class="tick">${it.checked ? '✓' : ''}</span>
          <span class="emi-label">${esc(it.label)}${it.hint ? `<span class="emi-hint">${esc(it.hint)}</span>` : ''}</span>
          ${it.key ? `<span class="k">${esc(it.key)}</span>` : ''}
        </div>`;
      })
      .join('');
    const bar = $('#emenu').getBoundingClientRect();
    const rect = btn.getBoundingClientRect();
    menuDrop.style.left = Math.round(rect.left - bar.left) + 'px';
    menuDrop.classList.add('show');
    openMenuName = name;
    document.querySelectorAll('.emenu-btn').forEach((b) => b.classList.toggle('active', b === btn));
  }

  function closeMenu() {
    menuDrop.classList.remove('show');
    openMenuName = '';
    document.querySelectorAll('.emenu-btn').forEach((b) => b.classList.remove('active'));
  }

  /* ---------------- 查找 / 替换 ---------------- */

  const find = { matches: [], lines: [], hitLines: new Set(), curLine: -1, gen: 0, idx: -1, q: '', caseSensitive: false };

  function refreshMatches(keepIdx) {
    const q = findQ.value;
    find.q = q;
    find.caseSensitive = !!findCase.checked;
    const prev = find.matches[find.idx] || null;
    find.matches = [];
    if (q) {
      const text = textEl.value;
      const hay = find.caseSensitive ? text : text.toLowerCase();
      const needle = find.caseSensitive ? q : q.toLowerCase();
      let i = 0;
      while (i <= hay.length - needle.length) {
        const at = hay.indexOf(needle, i);
        if (at < 0) break;
        find.matches.push({ s: at, e: at + q.length });
        if (find.matches.length >= 5000) break;
        i = at + Math.max(1, q.length);
      }
    }
    if (keepIdx && prev) {
      const at = find.matches.findIndex((m) => m.s >= prev.s);
      find.idx = at >= 0 ? at : find.matches.length - 1;
    } else {
      find.idx = find.matches.length ? 0 : -1;
    }
    computeHitLines();
    updateFindCount();
  }

  function updateFindCount() {
    findCount.textContent = `${find.matches.length ? find.idx + 1 : 0} / ${find.matches.length}`;
  }

  /**
   * 选中第 idx 个匹配。
   * opts.focus：是否把焦点交给编辑器。**在查找框里打字时必须传 false**——
   * 否则每敲一个字符都会把光标抢到正文，导致没法连续输入（例如输入 aaa 只输完 a）。
   */
  function selectMatch(idx, opts) {
    if (!find.matches.length) return;
    // 默认不抢焦点：查找框里连续输入 / 回车 / 点上下一个，光标都留在原处
    const o = Object.assign({ scroll: true, focus: false }, opts || {});
    const n = find.matches.length;
    find.idx = ((idx % n) + n) % n;
    const m = find.matches[find.idx];
    if (o.focus) {
      try { textEl.focus({ preventScroll: true }); } catch (_) { textEl.focus(); }
    }
    textEl.setSelectionRange(m.s, m.e);
    const lineIdx = find.lines[find.idx] ?? textEl.value.slice(0, m.s).split('\n').length - 1;
    find.curLine = lineIdx;
    if (o.scroll) scrollToLine(lineIdx);
    updateFindCount();
    paintGutter();
  }

  function findNext(dir) {
    if (!find.matches.length) {
      refreshMatches();
      if (!find.matches.length) return;
      return selectMatch(0);
    }
    selectMatch(find.idx + dir);
  }

  function openFind(prefill) {
    findEl.classList.add('show');
    const sel = textEl.value.slice(textEl.selectionStart, textEl.selectionEnd);
    if (prefill && sel && !sel.includes('\n')) findQ.value = sel;
    refreshMatches();
    findQ.focus();
    findQ.select();
  }

  function hideFind() {
    findEl.classList.remove('show');
    // 关闭查找后清掉行号与正文上的命中标记
    if (find.hitLines.size || find.curLine >= 0) {
      find.hitLines = new Set();
      find.curLine = -1;
      find.gen++;
      applyHitMarks();
      paintHlRows();
    }
  }

  function replaceCurrent() {
    if (!find.matches.length) refreshMatches();
    if (!find.matches.length) return;
    const m = find.matches[Math.max(0, find.idx)];
    const rep = findR.value;
    try {
      textEl.setRangeText(rep, m.s, m.e, 'end');
    } catch (_) {
      textEl.value = textEl.value.slice(0, m.s) + rep + textEl.value.slice(m.e);
      textEl.setSelectionRange(m.s + rep.length, m.s + rep.length);
    }
    stash();
    paintInfo();
    invalidateMetrics();
    paintGutter();
    refreshMatches(true);
    // 替换同样不抢焦点：用户可能正停在「替换」输入框里连续操作
    selectMatch(find.idx, { focus: false });
  }

  function replaceAll() {
    refreshMatches();
    if (!find.matches.length) return;
    const rep = findR.value;
    const list = find.matches.slice();
    for (let i = list.length - 1; i >= 0; i--) {
      const m = list[i];
      try {
        textEl.setRangeText(rep, m.s, m.e, 'preserve');
      } catch (_) {
        textEl.value = textEl.value.slice(0, m.s) + rep + textEl.value.slice(m.e);
      }
    }
    stash();
    paintInfo();
    invalidateMetrics();
    paintGutter();
    refreshMatches();
    statusEl.textContent = `已替换 ${list.length} 处`;
  }

  /* ---------------- 定位行 ---------------- */

  let dlgResolve = null;

  function showDialog(opts) {
    $('#edialog-title').textContent = opts.title || '';
    $('#edialog-hint').textContent = opts.hint || '';
    dlgInput.value = opts.value || '';
    dlgMask.classList.add('show');
    setTimeout(() => {
      dlgInput.focus();
      dlgInput.select();
    }, 20);
    return new Promise((resolve) => {
      dlgResolve = resolve;
    });
  }

  function closeDialog(value) {
    dlgMask.classList.remove('show');
    const r = dlgResolve;
    dlgResolve = null;
    if (r) r(value === undefined ? null : value);
  }

  async function openGoto() {
    if (!cur()) return;
    const total = textEl.value.split('\n').length;
    const v = await showDialog({
      title: '定位到行',
      hint: `文件共 ${total} 行，输入 1 - ${total}`,
      value: String(currentLineIndex() + 1)
    });
    if (v === null) return;
    const n = parseInt(String(v).trim(), 10);
    if (!Number.isFinite(n)) {
      statusEl.textContent = '请输入有效的行号';
      return;
    }
    const line = Math.max(1, Math.min(n, total));
    let offset = 0;
    const lines = textEl.value.split('\n');
    for (let i = 0; i < line - 1; i++) offset += lines[i].length + 1;
    try { textEl.focus({ preventScroll: true }); } catch (_) { textEl.focus(); }
    textEl.setSelectionRange(offset, offset);
    scrollToLine(line - 1);
    paintGutter();
    updatePos();
  }

  /* ---------------- 快捷键 ---------------- */

  function onKey(e) {
    const mod = e.ctrlKey || e.metaKey;
    const key = String(e.key || '').toLowerCase();
    if (dlgMask.classList.contains('show')) {
      if (e.key === 'Enter') { e.preventDefault(); closeDialog(dlgInput.value); }
      else if (e.key === 'Escape') { e.preventDefault(); closeDialog(null); }
      return;
    }
    if (mod && key === 's') {
      e.preventDefault();
      if (e.shiftKey) saveAll();
      else save();
      return;
    }
    if (mod && key === 'w') { e.preventDefault(); if (activeId) closeTab(activeId); return; }
    if (mod && key === 'f') { e.preventDefault(); openFind(true); return; }
    if (mod && key === 'h') { e.preventDefault(); openFind(true); return; }
    if (mod && key === 'g') { e.preventDefault(); openGoto(); return; }
    if (e.key === 'F3') { e.preventDefault(); if (findEl.classList.contains('show')) findNext(e.shiftKey ? -1 : 1); else openFind(true); return; }
    if (e.key === 'Escape') {
      if (openMenuName) { e.preventDefault(); closeMenu(); return; }
      if (findEl.classList.contains('show')) { e.preventDefault(); hideFind(); textEl.focus(); return; }
      if (activeId) { e.preventDefault(); closeTab(activeId); }
    }
  }

  /* ---------------- 初始化 ---------------- */

  function init() {
    try {
      const saved = localStorage.getItem('editor.wrap');
      wrapOn = saved === null ? true : saved === '1';
    } catch (_) {
      wrapOn = true;
    }
    applyTheme();
    setWrap(wrapOn, false);

    window.api.on('editor:open-file', (payload) => {
      applyTheme();
      openFile(payload);
    });

    textEl.addEventListener('input', () => {
      stash();
      scheduleGutter();
      paintInfo();
    });
    textEl.addEventListener('scroll', syncGutterScroll);
    ['click', 'keyup', 'select'].forEach((ev) => {
      textEl.addEventListener(ev, () => {
        updatePos();
        paintGutter();
      });
    });
    textEl.addEventListener('keydown', (e) => {
      if (e.key === 'Tab') {
        e.preventDefault();
        const s = textEl.selectionStart;
        const t = textEl.selectionEnd;
        textEl.value = textEl.value.slice(0, s) + '\t' + textEl.value.slice(t);
        textEl.selectionStart = textEl.selectionEnd = s + 1;
        stash();
        scheduleGutter();
        paintInfo();
      }
    });

    document.addEventListener('keydown', onKey);

    // 顶部菜单：点击展开，点外部 / Esc 收起
    document.querySelectorAll('.emenu-btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        if (openMenuName === btn.dataset.menu && menuDrop.classList.contains('show')) {
          closeMenu();
          return;
        }
        openMenu(btn.dataset.menu, btn);
      });
    });
    menuDrop.addEventListener('click', (e) => {
      const item = e.target.closest('.emi');
      if (!item || item.classList.contains('disabled')) return;
      const defs = menuDefs()[openMenuName] || [];
      const it = defs[Number(item.dataset.i)];
      closeMenu();
      if (it && it.onClick) it.onClick();
    });
    document.addEventListener('mousedown', (e) => {
      if (!menuDrop.classList.contains('show')) return;
      if (e.target.closest && e.target.closest('#emenu')) return;
      closeMenu();
    });

    // 查找面板：输入过程中只更新计数与视图，绝不把焦点抢到正文
    findQ.addEventListener('input', () => {
      refreshMatches();
      if (find.matches.length) selectMatch(find.idx, { focus: false, scroll: true });
    });
    findQ.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); findNext(e.shiftKey ? -1 : 1); }
      else if (e.key === 'Escape') { e.preventDefault(); hideFind(); textEl.focus(); }
    });
    findR.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); replaceCurrent(); }
      else if (e.key === 'Escape') { e.preventDefault(); hideFind(); textEl.focus(); }
    });
    findCase.addEventListener('change', () => {
      refreshMatches(true);
      if (find.matches.length) selectMatch(find.idx, { focus: false, scroll: true });
    });
    $('#efind-next').addEventListener('click', () => findNext(1));
    $('#efind-prev').addEventListener('click', () => findNext(-1));
    $('#efind-close').addEventListener('click', () => { hideFind(); textEl.focus(); });
    $('#efind-replace').addEventListener('click', replaceCurrent);
    $('#efind-replaceAll').addEventListener('click', replaceAll);

    // 定位行浮层
    $('#edialog-ok').addEventListener('click', () => closeDialog(dlgInput.value));
    $('#edialog-cancel').addEventListener('click', () => closeDialog(null));
    dlgMask.addEventListener('mousedown', (e) => {
      if (e.target === dlgMask) closeDialog(null);
    });

    // 窗口标题栏按钮
    $('#esave').addEventListener('click', save);
    $('#eclose').addEventListener('click', () => activeId && closeTab(activeId));
    $('#emin').addEventListener('click', () => window.api.editorMinimize());
    $('#emax').addEventListener('click', () => window.api.editorMaximize());
    $('#eclosewin').addEventListener('click', () => window.api.editorCloseWindow());
    $('#etitle').addEventListener('dblclick', (e) => {
      if (e.target.closest('.emenu') || e.target.closest('button')) return;
      window.api.editorMaximize();
    });

    // 窗口尺寸变化：换行位置与行号宽度都变了，重新测量
    let resizeTimer = null;
    window.addEventListener('resize', () => {
      if (resizeTimer) clearTimeout(resizeTimer);
      resizeTimer = setTimeout(() => {
        resizeTimer = null;
        invalidateMetrics();
        paintGutter();
      }, 140);
    });

    renderTabs();
  }

  document.addEventListener('DOMContentLoaded', init);
})();
