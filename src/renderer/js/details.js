'use strict';
/* 终端区内的详情视图：全部进程 / 全部网络连接 */
window.Details = (function () {
  const host = U.qs('#term-host');
  const views = new Map();
  let activeKey = null;

  const META = {
    procs: { icon: '▤', title: '进程列表' },
    net: { icon: '◎', title: '网络连接' }
  };

  const COLUMNS = {
    procs: [
      { k: 'pid', label: 'PID', cls: 'num', w: 72 },
      { k: 'user', label: '用户', w: 92 },
      { k: 'cpu', label: 'CPU%', cls: 'num', w: 76, fmt: (r) => r.cpu.toFixed(1) },
      { k: 'rss', label: '内存', cls: 'num', w: 100, fmt: (r) => U.fmtBytes(r.rss) },
      {
        k: 'name', label: '名称 / 命令行', w: 0,
        fmt: (r) =>
          `<div class="pcell"><span class="pname">${U.esc(r.name)}</span>` +
          `<span class="psub" title="${U.esc(r.cmd || '')}">${U.esc(r.cmd || '')}</span></div>`
      },
      { k: 'cwd', label: '位置', cls: 'cmd', w: 230, fmt: (r) => U.esc(r.cwd || '-') }
    ],
    net: [
      { k: 'pid', label: 'PID', cls: 'num', w: 60 },
      { k: 'name', label: '名称', w: 110 },
      { k: 'localIp', label: '监听IP', cls: 'mono multi', w: 135, fmt: (r) => multi(r.localIp) },
      { k: 'port', label: '端口', cls: 'mono multi', w: 75, fmt: (r) => multi(r.port) },
      { k: 'peerIp', label: 'IP', cls: 'mono multi', w: 135, fmt: (r) => multi(r.peerIp) },
      { k: 'conns', label: '连接数', cls: 'num', w: 70 },
      { k: 'up', label: '上传', cls: 'num traffic', w: 105, fmt: (r) => trafficCell(r.upRate, r.up) },
      { k: 'down', label: '下载', cls: 'num traffic', w: 105, fmt: (r) => trafficCell(r.downRate, r.down) }
    ]
  };

  /** 实时速率 + 总流量（两行）：上行为当前速率，下行为累计流量 */
  function trafficCell(rateBytes, totalBytes) {
    if (!totalBytes) return '-';
    return `<div class="traffic-cell"><span class="traffic-rate">${U.rateFromBytes(rateBytes || 0, 'netDetail')}</span><span class="traffic-total">${U.trafficText(totalBytes)}</span></div>`;
  }

  function list() {
    return Array.from(views.values()).map((v) => ({
      key: v.key,
      type: v.type,
      title: v.title,
      short: META[v.type].title
    }));
  }

  function getActive() {
    return activeKey ? views.get(activeKey) : null;
  }

  function open(type, sessionId) {
    const sess = App.session(sessionId);
    if (!sess) return U.toast('请先连接服务器', 'error');
    if (!META[type]) return;
    const key = type + ':' + sessionId;
    if (views.has(key)) return activate(key);

    const view = {
      key,
      type,
      sessionId,
      title: `${sess.config.name || sess.config.host} · ${META[type].title}`,
      el: null,
      rows: [],
      filter: '',
      sortKey: type === 'procs' ? 'cpu' : 'conns',
      sortAsc: false,
      auto: true,
      interval: Number(App.settings.detailRefresh) || 3000,
      loading: false,
      timer: null
    };

    view.el = document.createElement('div');
    view.el.className = 'detail-pane';
    view.el.dataset.key = key;
    view.el.innerHTML = shellHtml(view);
    host.appendChild(view.el);
    views.set(key, view);
    bind(view);
    activate(key);
    refresh(view);
    const startTimer = () => {
      if (view.timer) clearInterval(view.timer);
      view.timer = setInterval(() => {
        if (view.auto && activeKey === key && view.el.classList.contains('active')) refresh(view);
      }, view.interval);
    };
    view.startTimer = startTimer;
    const sel0 = view.el.querySelector('[data-interval]');
    if (sel0) sel0.value = String(view.interval);
    startTimer();
    return view;
  }

  function shellHtml(view) {
    const cols = COLUMNS[view.type];
    return `<div class="detail-head">
      <div class="detail-title">${U.esc(META[view.type].title)}</div>
      <div class="detail-sub" data-sub>加载中…</div>
      <div class="detail-tools">
        <input type="search" data-filter placeholder="过滤关键字" autocomplete="off" />
        <label class="check-inline"><input type="checkbox" data-auto checked /><span>自动刷新</span></label>
        <select data-interval title="刷新频率">
          <option value="1000">1 秒</option>
          <option value="3000" selected>3 秒</option>
          <option value="5000">5 秒</option>
          <option value="10000">10 秒</option>
        </select>
        <button class="btn sm" data-refresh>刷新</button>
      </div>
    </div>
    <div class="detail-body">
      <table class="detail-table ${view.type}">
        <colgroup>${cols.map((c) => `<col style="width:${c.w ? c.w + 'px' : 'auto'}" />`).join('')}</colgroup>
        <thead><tr>${cols
          .map((c) => `<th data-k="${c.k}" class="${c.cls || ''}">${U.esc(c.label)}</th>`)
          .join('')}</tr></thead>
        <tbody data-body><tr class="placeholder"><td colspan="${cols.length}">加载中…</td></tr></tbody>
      </table>
    </div>
    <div class="detail-foot">
      <span data-count>0 项</span>
      <span>右键可复制信息 / 结束进程 · 双击复制整行</span>
    </div>`;
  }

  function bind(view) {
    const el = view.el;
    el.querySelector('[data-filter]').addEventListener(
      'input',
      U.debounce((e) => {
        view.filter = e.target.value.trim().toLowerCase();
        renderTable(view);
      }, 120)
    );
    el.querySelector('[data-refresh]').addEventListener('click', () => refresh(view));
    el.querySelector('[data-auto]').addEventListener('change', (e) => {
      view.auto = e.target.checked;
    });
    const intervalSel = el.querySelector('[data-interval]');
    if (intervalSel) {
      intervalSel.addEventListener('change', () => {
        view.interval = Number(intervalSel.value) || 3000;
        App.state.data.settings.detailRefresh = view.interval;
        window.api.saveSettings({ detailRefresh: view.interval });
        if (view.startTimer) view.startTimer();
      });
    }

    el.querySelector('thead').addEventListener('click', (e) => {
      const th = e.target.closest('th[data-k]');
      if (!th) return;
      const k = th.dataset.k;
      if (view.sortKey === k) view.sortAsc = !view.sortAsc;
      else {
        view.sortKey = k;
        view.sortAsc = false;
      }
      renderTable(view);
    });

    el.querySelector('tbody').addEventListener('contextmenu', (e) => {
      const tr = e.target.closest('tr[data-i]');
      if (!tr) return;
      e.preventDefault();
      const row = view.rows[Number(tr.dataset.i)];
      if (!row) return;
      el.querySelectorAll('tbody tr').forEach((x) => x.classList.remove('selected'));
      tr.classList.add('selected');
      showRowMenu(view, row, e.clientX, e.clientY);
    });

    el.querySelector('tbody').addEventListener('dblclick', (e) => {
      const tr = e.target.closest('tr[data-i]');
      if (!tr) return;
      const row = view.rows[Number(tr.dataset.i)];
      if (row) copyText(rowText(view.type, row));
    });
  }

  function rowText(type, r) {
    if (type === 'procs') {
      return `${r.pid}\t${r.user}\t${r.cpu.toFixed(1)}%\t${U.fmtBytes(r.rss)}\t${r.name}\t${r.cmd}\t${r.cwd || '-'}`;
    }
    return `${r.pid}\t${r.name}\t${r.localIp}:${r.port}\t${r.peerIp || '-'}\t连接数 ${r.conns}\t↑${r.up ? U.rateFromBytes(r.upRate || 0, 'netDetail') + ' / ' + U.trafficText(r.up) : '-'}\t↓${r.down ? U.rateFromBytes(r.downRate || 0, 'netDetail') + ' / ' + U.trafficText(r.down) : '-'}`;
  }

  function copyText(text) {
    navigator.clipboard.writeText(text).then(
      () => U.toast('已复制', 'ok', 1400),
      () => U.toast('复制失败', 'error')
    );
  }

  function showRowMenu(view, row, x, y) {
    const isProc = view.type === 'procs';
    const cp = (label, value) => ({ label, onClick: () => copyText(String(value == null ? '' : value)) });
    const items = isProc
      ? [
          cp('复制 PID', row.pid),
          cp('复制用户', row.user),
          cp('复制名称', row.name),
          cp('复制命令行', row.cmd),
          cp('复制名称 / 命令行', `${row.name} ${row.cmd || ''}`),
          cp('复制位置路径', row.cwd || '-'),
          { label: '复制整行', onClick: () => copyText(rowText(view.type, row)) },
          { sep: true },
          { label: '结束进程 (SIGTERM)', danger: true, onClick: () => killProc(view, row, 'TERM') },
          { label: '强制结束 (SIGKILL)', danger: true, onClick: () => killProc(view, row, 'KILL') }
        ]
      : [
          cp('复制 PID', row.pid),
          cp('复制名称', row.name),
          cp('复制监听IP', row.localIp),
          cp('复制端口', row.port),
          cp('复制监听端口', `${row.localIp}
${row.port}`),
          cp('复制对端 IP', row.peerIp || '-'),
          cp('复制地址', `${row.localIp}:${row.port} → ${row.peerIp || '-'}`),
          { label: '复制整行', onClick: () => copyText(rowText(view.type, row)) },
          { sep: true },
          { label: '结束进程 (SIGTERM)', danger: true, onClick: () => killProc(view, row, 'TERM') },
          { label: '强制结束 (SIGKILL)', danger: true, onClick: () => killProc(view, row, 'KILL') }
        ];
    U.ctxMenu(items, x, y);
  }

  async function killProc(view, row, signal) {
    if (!row.pid) return U.toast('该进程没有 PID（可能权限不足）', 'error');
    const ok = await U.confirmDialog(
      '结束进程',
      `确定向 ${row.name}（PID ${row.pid}）发送 SIG${signal} 吗？\n该操作会直接终止目标进程。`,
      '结束进程'
    );
    if (!ok) return;
    try {
      await window.api.killProc({ sessionId: view.sessionId, pid: row.pid, signal });
      U.toast(`已向 PID ${row.pid} 发送 SIG${signal}`, 'ok');
      refresh(view);
    } catch (err) {
      U.toast('结束进程失败：' + U.cleanError(err), 'error', 4200);
    }
  }

  /** 用两次 ss 字节统计的差值计算每个进程的实时上传/下载速率 */
  function computeNetRates(view, rows) {
    const now = Date.now();
    const prev = view.prevNet || { ts: now, map: new Map() };
    const elapsed = (now - prev.ts) / 1000;
    const map = new Map();
    rows.forEach((r) => {
      const key = (r.pid ? 'p' + r.pid : 'n' + r.name) + '|' + (r.localIp || '');
      const p = prev.map.get(key);
      r.upRate = p && elapsed > 0.05 ? Math.max(0, (Number(r.up) - p.up) / elapsed) : 0;
      r.downRate = p && elapsed > 0.05 ? Math.max(0, (Number(r.down) - p.down) / elapsed) : 0;
      map.set(key, { up: Number(r.up) || 0, down: Number(r.down) || 0 });
    });
    view.prevNet = { ts: now, map };
  }

  async function refresh(view) {
    if (view.loading || !App.session(view.sessionId)) return;
    view.loading = true;
    const btn = view.el.querySelector('[data-refresh]');
    if (btn) btn.disabled = true;
    try {
      const rows =
        view.type === 'procs'
          ? await window.api.procList({ sessionId: view.sessionId })
          : await window.api.netList({ sessionId: view.sessionId });
      if (!views.has(view.key)) return;
      view.rows = Array.isArray(rows) ? rows : [];
      if (view.type === 'net') computeNetRates(view, view.rows);
      renderTable(view);
    } catch (err) {
      U.toast((view.type === 'procs' ? '读取进程失败：' : '读取网络失败：') + U.cleanError(err), 'error', 4200);
    } finally {
      view.loading = false;
      if (btn) btn.disabled = false;
    }
  }

  /** 多个值逐行显示（而不是逗号挤在一行） */
  function multi(v) {
    return U.esc(v || '-').replace(/\n/g, '<br>');
  }

  /** 单元格完整文本（用于 title 悬浮查看，不影响缩略显示） */
  function rawOf(c, r) {
    if (c.k === 'name') return `${r.name || ''}${r.cmd ? '  ' + r.cmd : ''}`;
    if (c.k === 'up') return r.up ? `实时 ${U.rateFromBytes(r.upRate || 0, 'netDetail')} / 总计 ${U.trafficText(r.up)}` : '-';
    if (c.k === 'down') return r.down ? `实时 ${U.rateFromBytes(r.downRate || 0, 'netDetail')} / 总计 ${U.trafficText(r.down)}` : '-';
    if (c.k === 'rss') return r[c.k] ? U.fmtBytes(r[c.k]) : '-';
    if (c.k === 'cpu') return String(r.cpu);
    return String(r[c.k] == null ? '' : r[c.k]);
  }

  function renderTable(view) {
    const cols = COLUMNS[view.type];
    const tbody = view.el.querySelector('[data-body]');
    const sub = view.el.querySelector('[data-sub]');
    const countEl = view.el.querySelector('[data-count]');

    let rows = view.rows;
    if (view.filter) {
      const f = view.filter;
      rows = rows.filter((r) => {
        if (view.type === 'procs') {
          return (
            String(r.pid).includes(f) ||
            (r.name || '').toLowerCase().includes(f) ||
            (r.user || '').toLowerCase().includes(f) ||
            (r.cmd || '').toLowerCase().includes(f) ||
            (r.cwd || '').toLowerCase().includes(f)
          );
        }
        return (
          String(r.pid).includes(f) ||
          (r.name || '').toLowerCase().includes(f) ||
          (r.localIp || '').includes(f) ||
          String(r.port).includes(f) ||
          (r.peerIp || '').includes(f)
        );
      });
    }

    const key = view.sortKey;
    rows = rows.slice().sort((a, b) => {
      let va;
      let vb;
      if (view.type === 'net' && key === 'up') {
        va = a.upRate || 0;
        vb = b.upRate || 0;
      } else if (view.type === 'net' && key === 'down') {
        va = a.downRate || 0;
        vb = b.downRate || 0;
      } else {
        va = a[key];
        vb = b[key];
      }
      let cmp;
      if (typeof va === 'number' && typeof vb === 'number') cmp = va - vb;
      else cmp = String(va == null ? '' : va).localeCompare(String(vb == null ? '' : vb), 'zh-CN', { numeric: true });
      return view.sortAsc ? cmp : -cmp;
    });

    view.el.querySelectorAll('thead th').forEach((th) => {
      const on = th.dataset.k === key;
      th.classList.toggle('sorted', on);
      th.classList.toggle('asc', on && view.sortAsc);
    });

    if (!rows.length) {
      tbody.innerHTML = `<tr class="placeholder"><td colspan="${cols.length}">${
        view.rows.length ? '没有匹配的记录' : '暂无数据'
      }</td></tr>`;
    } else {
      tbody.innerHTML = rows
        .map((r, i) => {
          const idx = view.rows.indexOf(r);
          const tds = cols
            .map((c) => {
              const val = c.fmt ? c.fmt(r) : U.esc(String(r[c.k] == null ? '' : r[c.k]));
              const tip = U.esc(rawOf(c, r));
              return `<td class="${c.cls || ''}" title="${tip}">${val}</td>`;
            })
            .join('');
          return `<tr data-i="${idx}">${tds}</tr>`;
        })
        .join('');
    }

    const sess = App.session(view.sessionId);
    sub.textContent = sess ? `${sess.config.user}@${sess.config.host}` : '';
    countEl.textContent = `${rows.length} 项${view.filter ? '（已过滤）' : ''}`;
  }

  function activate(key) {
    const view = views.get(key);
    if (!view) return;
    activeKey = key;
    views.forEach((v) => v.el.classList.toggle('active', v.key === key));
    if (App.state.activeId !== view.sessionId) App.setActive(view.sessionId);
    if (window.Term) Term.refresh();
  }

  function deactivate() {
    if (!activeKey) return;
    activeKey = null;
    views.forEach((v) => v.el.classList.remove('active'));
    if (window.Term) {
      Term.refresh();
      setTimeout(() => Term.fitActive(), 30);
    }
  }

  function close(key) {
    const view = views.get(key);
    if (!view) return;
    if (view.timer) clearInterval(view.timer);
    if (view.el.parentNode) view.el.parentNode.removeChild(view.el);
    views.delete(key);
    if (activeKey === key) {
      activeKey = null;
      const next = views.keys().next();
      if (!next.done) activate(next.value);
      else if (window.Term) {
        Term.refresh();
        setTimeout(() => Term.fitActive(), 30);
      }
    }
  }

  function closeSession(sessionId) {
    Array.from(views.values())
      .filter((v) => v.sessionId === sessionId)
      .forEach((v) => close(v.key));
  }

  /** 设置里切换速率单位后立即刷新所有详情表 */
  function refreshAll() {
    views.forEach((v) => refresh(v));
  }

  return { open, close, closeSession, activate, deactivate, list, getActive, refresh, refreshAll };
})();
