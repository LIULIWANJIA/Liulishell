'use strict';
/* 启动空白页：最近连接历史（快速连接 / 清空 / 右键置顶 / 删除单行） */
window.Recent = (function () {
  const $ = U.qs;
  const box = $('#recent-box');
  const listEl = $('#recent-list');

  function history() {
    const h = App.state.data.settings.connectHistory;
    return Array.isArray(h) ? h : [];
  }

  async function save(next) {
    const list = next.slice(0, 20);
    App.state.data.settings.connectHistory = list;
    await window.api.saveSettings({ connectHistory: list });
    render();
  }

  function record(cfg) {
    if (!cfg || !cfg.id) return;
    const list = history().filter((x) => x.id !== cfg.id);
    const prev = history().find((x) => x.id === cfg.id);
    list.unshift({
      id: cfg.id,
      name: cfg.name || cfg.host,
      host: cfg.host,
      port: cfg.port || 22,
      user: cfg.user,
      ts: Date.now(),
      pinned: !!(prev && prev.pinned)
    });
    // 置顶项始终排在前面；连接成功后保留原置顶状态
    list.sort((a, b) => (b.pinned ? 1 : 0) - (a.pinned ? 1 : 0));
    save(list);
  }

  function render() {
    if (!box || !listEl) return;
    const list = history();
    const conns = App.state.data.connections || [];
    box.style.display = 'flex';
    if (!list.length) {
      listEl.innerHTML = '<div class="recent-empty">暂无最近连接</div>';
      return;
    }
    listEl.innerHTML = list
      .map((r) => {
        const c = conns.find((x) => x.id === r.id);
        const name = c ? c.name || c.host : r.name;
        const addr = c ? `${c.user}@${c.host}:${c.port}` : `${r.user}@${r.host}:${r.port}`;
        const d = new Date(r.ts || Date.now());
        const time = `${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
        return `<div class="recent-row${c ? '' : ' missing'}" data-id="${U.esc(r.id)}" title="${U.esc(addr)}">
          <span class="recent-pin">${r.pinned ? '★' : ''}</span>
          <span class="recent-name">${U.esc(name)}</span>
          <span class="recent-addr">${U.esc(addr)}</span>
          <span class="recent-time">${time}</span>
        </div>`;
      })
      .join('');

    listEl.querySelectorAll('.recent-row').forEach((row) => {
      row.addEventListener('click', () => {
        const c = conns.find((x) => x.id === row.dataset.id);
        if (!c) return U.toast('该连接配置已被删除，请从最近连接中移除', 'error');
        Term.connect(c.id);
      });
      row.addEventListener('contextmenu', (e) => {
        e.preventDefault();
        const id = row.dataset.id;
        const r = history().find((x) => x.id === id);
        U.ctxMenu(
          [
            { label: '快速连接', onClick: () => row.click() },
            {
              label: r && r.pinned ? '取消置顶' : '置顶',
              onClick: () => save(history().map((x) => Object.assign({}, x, { pinned: x.id === id ? !r.pinned : x.pinned })).sort((a, b) => (b.pinned ? 1 : 0) - (a.pinned ? 1 : 0)))
            },
            { sep: true },
            { label: '删除此行', danger: true, onClick: () => save(history().filter((x) => x.id !== id)) },
            { label: '清空历史', danger: true, onClick: clearAll }
          ],
          e.clientX,
          e.clientY
        );
      });
    });
  }

  async function clearAll() {
    const ok = await U.confirmDialog('清空最近连接', '确定清空全部历史记录吗？', '清空');
    if (!ok) return;
    await save([]);
  }

  function init() {
    const btn = $('#recent-clear');
    if (btn) btn.addEventListener('click', clearAll);
    App.on('data:change', render);
    App.on('sessions:change', render);
    render();
  }

  document.addEventListener('DOMContentLoaded', init);
  return { init, render, record, clearAll };
})();
