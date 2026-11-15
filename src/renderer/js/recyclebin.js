'use strict';
/* 文件 → 回收站：应用内浮层，展示已删除的服务器配置 */
window.RecycleBin = (function () {
  const $ = U.qs;
  const KEEP_DAYS = 30;
  let panel = null;
  let listEl = null;
  let countEl = null;
  let open = false;

  function ensure() {
    if (panel) return panel;
    panel = document.createElement('div');
    panel.className = 'srv-panel recycle-panel';
    panel.id = 'recycle-panel';
    panel.innerHTML = `
      <div class="srv-panel-head">
        <span class="srv-panel-title">回收站</span>
        <span class="srv-panel-count" id="recycle-count"></span>
        <span class="pane-grow"></span>
        <button class="icon-btn" id="recycle-close" title="关闭">✕</button>
      </div>
      <div class="recycle-list" id="recycle-list"></div>
      <div class="srv-panel-foot">删除的配置保留 ${KEEP_DAYS} 天 · 右键可还原 / 连接 / 永久删除</div>`;
    document.body.appendChild(panel);
    listEl = panel.querySelector('#recycle-list');
    countEl = panel.querySelector('#recycle-count');
    panel.querySelector('#recycle-close').addEventListener('click', close);
    return panel;
  }

  function daysLeft(item) {
    const deletedAt = Number(item && item.deletedAt) || 0;
    if (!deletedAt) return '';
    const left = Math.ceil((deletedAt + KEEP_DAYS * 86400000 - Date.now()) / 86400000);
    return left <= 0 ? '即将删除' : `剩余 ${left} 天`;
  }

  function openPanel() {
    ensure();
    open = true;
    panel.classList.add('show');
    render();
  }

  function close() {
    if (!panel) return;
    open = false;
    panel.classList.remove('show');
  }

  function toggle() {
    if (open) close();
    else openPanel();
  }

  function render() {
    if (!listEl || !open) return;
    const items = (App.state.data.recycleBin || []).slice().sort((a, b) => (b.deletedAt || 0) - (a.deletedAt || 0));
    if (countEl) countEl.textContent = `${items.length} 个配置`;
    if (!items.length) {
      listEl.innerHTML = '<div class="recycle-empty">回收站为空</div>';
      return;
    }
    listEl.innerHTML = items
      .map((c) => {
        const name = String(c.name || c.host || '?');
        const addr = `${c.user || ''}@${c.host || ''}:${c.port || 22}`;
        const remark = String(c.remark || '').trim();
        return `<div class="recycle-row" data-id="${c.id}" title="右键还原 / 连接 / 永久删除">
          <span class="rr-main">
            <span class="rr-name">${U.esc(name)}</span>
            <span class="rr-meta">${U.esc(addr)}${remark ? ' · ' + U.esc(remark) : ''}</span>
          </span>
          <span class="rr-days">${U.esc(daysLeft(c))}</span>
        </div>`;
      })
      .join('');

    listEl.querySelectorAll('.recycle-row').forEach((row) => {
      const c = items.find((x) => x.id === row.dataset.id);
      if (!c) return;
      row.addEventListener('contextmenu', (e) => {
        e.preventDefault();
        e.stopPropagation();
        const proxies = (App.state.data.settings && App.state.data.settings.proxies) || [];
        U.ctxMenu(
          [
            { label: '还原配置', onClick: () => restore(c) },
            { label: '连接', onClick: () => { close(); Term.connect(c.id); } },
            { label: '通过默认代理连接', disabled: !proxies.length, onClick: () => { close(); Term.connect(c.id, { proxyMode: 'default' }); } },
            { label: '直接连接', onClick: () => { close(); Term.connect(c.id, { proxyMode: 'none' }); } },
            { sep: true },
            { label: '永久删除', danger: true, onClick: () => purge(c) }
          ],
          e.clientX,
          e.clientY
        );
      });
    });
  }

  async function restore(c) {
    try {
      const state = await window.api.recycleRestore(c.id);
      App.setData(state);
      U.toast('已还原到「回收站还原」分组', 'ok');
      render();
    } catch (err) {
      U.toast('还原失败: ' + U.cleanError(err), 'error', 3600);
    }
  }

  async function purge(c) {
    const ok = await U.confirmDialog(
      '永久删除',
      `确定永久删除配置「${c.name || c.host}」吗？\n此操作不可恢复。`,
      '永久删除'
    );
    if (!ok) return;
    try {
      const state = await window.api.recyclePurge(c.id);
      if (App.state.connClipboard === c.id) App.state.connClipboard = null;
      App.setData(state);
      U.toast('已永久删除', 'ok');
      render();
    } catch (err) {
      U.toast('删除失败: ' + U.cleanError(err), 'error', 3600);
    }
  }

  App.on('data:change', () => {
    if (open) render();
  });

  document.addEventListener('mousedown', (e) => {
    if (!open) return;
    if (document.querySelector('#modal-mask.show, #sub-mask.show, #settings-mask.show, .fav-overlay.show')) return;
    if (panel && panel.contains(e.target)) return;
    if (e.target.closest && e.target.closest('#ctx-menu, #ctx-submenu')) return;
    close();
  }, true);

  document.addEventListener('keydown', (e) => {
    if (!open || e.key !== 'Escape') return;
    if (document.querySelector('#modal-mask.show, #sub-mask.show, #settings-mask.show, .fav-overlay.show')) return;
    e.preventDefault();
    close();
  }, true);

  return { open: openPanel, close, toggle };
})();
