'use strict';
/* 下载管理器：独立窗口，展示所有下载/上传任务，支持取消与打开文件夹 */
(function () {
  const $ = (s) => document.querySelector(s);
  const listEl = $('#dlist');
  const ctx = $('#ctx');
  let rows = [];
  let settings = {};
  const rateSamples = new Map();
  const rateCache = new Map();

  const THEMES = {
    warm: { bg: '#f7f6f2', panel: '#ffffff', p2: '#fbfaf7', p3: '#f3f1eb', line: '#e7e5df', ls: '#d9d6ce', text: '#15191d', t2: '#5d666f', muted: '#8b939b', accent: '#16665a', soft: '#e6efec', primary: '#15191d' },
    mist: { bg: '#f3f7fc', panel: '#ffffff', p2: '#f7fafd', p3: '#eef3fa', line: '#e0e8f2', ls: '#cbd8e8', text: '#1c2431', t2: '#55606f', muted: '#8b95a5', accent: '#2f7cf6', soft: '#eaf2ff', primary: '#233a56' },
    sand: { bg: '#faf5ee', panel: '#fffdf9', p2: '#fbf6ef', p3: '#f5ede2', line: '#eadfd1', ls: '#dccabb', text: '#2d2620', t2: '#6b5f53', muted: '#9a8d80', accent: '#b4552f', soft: '#f8e9df', primary: '#3b3129' },
    graphite: { bg: '#eef0f2', panel: '#ffffff', p2: '#f7f8fa', p3: '#eaecef', line: '#dfe3e8', ls: '#c9cfd7', text: '#20262e', t2: '#59636e', muted: '#8c96a2', accent: '#3b6ea5', soft: '#e7eff8', primary: '#2b323b' },
    night: { bg: '#14181d', panel: '#1d232b', p2: '#222a33', p3: '#182029', line: '#2c3540', ls: '#3a4552', text: '#e2e8f0', t2: '#aab6c4', muted: '#758394', accent: '#5fc2b0', soft: '#233b38', primary: '#4a5b70' }
  };

  function esc(s) {
    return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  function fmt(n) {
    n = Number(n) || 0;
    if (n < 1024) return n + ' B';
    const u = ['KB', 'MB', 'GB'];
    let i = -1;
    do { n /= 1024; i++; } while (n >= 1024 && i < u.length - 1);
    return n.toFixed(1) + ' ' + u[i];
  }

  function rate(t) {
    if (!t || t.status !== 'running') {
      if (t) { rateSamples.delete(t.id); rateCache.delete(t.id); }
      return '';
    }
    const now = Date.now();
    const bytes = Number(t.transferred) || 0;
    const prev = rateSamples.get(t.id);
    if (!prev) {
      rateSamples.set(t.id, { at: now, bytes });
      return '';
    }
    const dt = (now - prev.at) / 1000;
    if (dt < 0.5) return rateCache.get(t.id) || '';
    rateSamples.set(t.id, { at: now, bytes });
    const db = bytes - prev.bytes;
    if (db < 0) return rateCache.get(t.id) || '';
    const mbps = (db * 8) / 1e6 / dt;
    const text = U.rateFromMbps(mbps, 'downloads', settings);
    rateCache.set(t.id, text);
    return text;
  }

  function stateText(t) {
    return { running: '进行中', paused: '已暂停', done: '已完成', cancelled: '已取消', error: '失败' }[t.status] || t.status;
  }

  function applyTheme(next) {
    if (next) settings = next;
    const paint = (d) => {
      if (d) settings = d;
      const id = (settings && settings.theme) || 'warm';
      const t = THEMES[id] || THEMES.warm;
      const r = document.documentElement.style;
      r.setProperty('--bg', t.bg); r.setProperty('--panel', t.panel); r.setProperty('--panel-2', t.p2);
      r.setProperty('--panel-3', t.p3); r.setProperty('--line', t.line); r.setProperty('--line-strong', t.ls);
      r.setProperty('--text', t.text); r.setProperty('--text-2', t.t2); r.setProperty('--muted', t.muted);
      r.setProperty('--accent', t.accent); r.setProperty('--accent-soft', t.soft); r.setProperty('--primary', t.primary);
    };
    if (next) return paint(next);
    window.api.getState().then((d) => paint(d && d.settings)).catch(() => {});
  }

  function toast(msg) {
    const el = document.createElement('div');
    el.className = 'toast';
    el.textContent = msg;
    $('#toasts').appendChild(el);
    setTimeout(() => el.remove(), 2200);
  }

  function render() {
    const running = rows.filter((r) => r.status === 'running').length;
    const paused = rows.filter((r) => r.status === 'paused').length;
    $('#dsummary').textContent = `${rows.length} 个任务${running ? ` · ${running} 个进行中` : ''}${paused ? ` · ${paused} 个已暂停` : ''}`;
    if (!rows.length) {
      listEl.innerHTML = '<div class="dempty">暂无下载 / 上传任务</div>';
      return;
    }
    listEl.innerHTML = rows
      .map((t) => {
        const pct = t.total ? Math.min(100, Math.round((t.transferred / t.total) * 100)) : t.status === 'done' ? 100 : 0;
        const speed = rate(t);
        // 已取消的任务不再显示进度条，避免取消后仍残留进度
        const bar = t.status === 'cancelled'
          ? ''
          : `<div class="dbar ${esc(t.status)}"><i style="width:${pct}%"></i></div>`;
        return `<div class="drow" data-id="${esc(t.id)}" title="${esc(t.target || '')}">
          <div class="drow-top">
            <span class="dico">${t.direction === 'upload' ? '↑' : '↓'}</span>
            <span class="dname">${esc(t.name)}</span>
            <span class="dstate ${esc(t.status)}">${stateText(t)}</span>
          </div>
          <div class="dsub">${t.direction === 'upload' ? '上传' : '下载'} · ${fmt(t.transferred)}${t.total ? ' / ' + fmt(t.total) : ''}${speed ? ' · ' + speed : ''}${t.error && t.status === 'error' ? ' · ' + esc(t.error) : ''}</div>
          ${bar}
        </div>`;
      })
      .join('');
  }

  function menu(items, x, y) {
    ctx.innerHTML = items
      .map((it, i) => (it.sep ? '<div class="ctx-sep"></div>' : `<div class="ctx-item${it.danger ? ' danger' : ''}" data-i="${i}">${esc(it.label)}</div>`))
      .join('');
    ctx.classList.add('show');
    const w = ctx.offsetWidth;
    const h = ctx.offsetHeight;
    ctx.style.left = Math.min(x, window.innerWidth - w - 8) + 'px';
    ctx.style.top = Math.min(y, window.innerHeight - h - 8) + 'px';
    ctx.onclick = (e) => {
      const el = e.target.closest('.ctx-item');
      if (!el) return;
      const it = items[Number(el.dataset.i)];
      ctx.classList.remove('show');
      if (it && it.onClick) it.onClick();
    };
  }

  function openMenu(e, id) {
    const t = rows.find((r) => r.id === id);
    if (!t) return;
    const running = t.status === 'running';
    const items = [
      running && {
        label: t.direction === 'upload' ? '暂停上传' : '暂停下载',
        onClick: async () => {
          await window.api.transferPause(id);
          toast('已暂停，已下载分片已保留');
        }
      },
      running && {
        label: t.direction === 'upload' ? '取消上传' : '取消下载',
        danger: true,
        onClick: async () => {
          await window.api.transferCancel(id);
          toast('已取消，未完成文件已删除');
        }
      },
      !running && t.status !== 'done' && {
        label: '删除未完成文件',
        danger: true,
        onClick: async () => {
          await window.api.transferDiscard(id);
          toast('已删除未完成文件');
        }
      },
      { label: '打开文件所在文件夹', onClick: () => window.api.transferOpenFolder(id) },
      { label: '打开下载文件夹', onClick: () => window.api.openDownloadDir() },
      { sep: true },
      { label: '复制本地路径', onClick: () => navigator.clipboard.writeText(t.target || '').then(() => toast('已复制路径')) },
      { label: '复制远端路径', onClick: () => navigator.clipboard.writeText(t.remote || '').then(() => toast('已复制路径')) },
      { sep: true },
      { label: '移除此记录', onClick: () => window.api.transferRemove(id) },
      { sep: true },
      { label: '清除已完成', onClick: async () => {
        const n = await window.api.transferClearFinished();
        toast(n ? `已清除 ${n} 个已完成记录` : '没有可清除的记录');
      } },
      { label: '清空全部', danger: true, onClick: async () => {
        if (!window.confirm('清空全部任务？进行中的任务会被取消，未完成的文件会被删除。')) return;
        const n = await window.api.transferClearAll();
        toast(n ? `已清空 ${n} 个任务` : '列表已是空的');
      } }
    ].filter(Boolean);
    menu(items, e.clientX, e.clientY);
  }

  function init() {
    applyTheme();
    window.api.on('settings:changed', (s) => {
      applyTheme(s);
      rateCache.clear();
      rateSamples.clear();
      render();
    });
    window.api.on('transfer:list', (list) => {
      rows = Array.isArray(list) ? list : [];
      render();
    });
    window.api.transferList().then((list) => {
      rows = Array.isArray(list) ? list : [];
      render();
    }).catch(() => {});

    listEl.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      const row = e.target.closest('.drow');
      if (row) openMenu(e, row.dataset.id);
    });
    $('#dclear').addEventListener('click', async () => {
      const n = await window.api.transferClearFinished();
      toast(n ? `已清除 ${n} 个已完成记录` : '没有可清除的记录');
    });
    $('#dpauseall').addEventListener('click', async () => {
      const n = await window.api.transferPauseAll();
      toast(n ? `已暂停 ${n} 个任务，分片已保留` : '没有进行中的任务');
    });
    $('#dcancelall').addEventListener('click', async () => {
      const running = rows.filter((r) => r.status === 'running').length;
      if (!running) return toast('没有进行中的任务');
      if (!window.confirm(`取消全部 ${running} 个进行中的任务？未完成的文件会被删除。`)) return;
      const n = await window.api.transferCancelAll();
      toast(n ? `已取消 ${n} 个任务` : '没有进行中的任务');
    });
    $('#dopenfolder').addEventListener('click', () => window.api.openDownloadDir());
    $('#dmin').addEventListener('click', () => window.api.downloadsMinimize());
    $('#dmax').addEventListener('click', () => window.api.downloadsMaximize());
    $('#dclosewin').addEventListener('click', () => window.api.downloadsClose());
    $('#dtitle').addEventListener('dblclick', () => window.api.downloadsMaximize());
    document.addEventListener('mousedown', (e) => {
      if (!ctx.contains(e.target)) ctx.classList.remove('show');
    });
    // 运行时刷新速率显示
    setInterval(render, 1000);
    render();
  }

  document.addEventListener('DOMContentLoaded', init);
})();
