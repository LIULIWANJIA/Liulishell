'use strict';
/* 顶部「服务器列表」：应用内浮层，点击外部或执行操作后自动关闭 */
window.ServersPanel = (function () {
  const $ = U.qs;
  const RECYCLE_NAME = '待回收';
  let panel = null;
  let listEl = null;
  let filterEl = null;
  let countEl = null;
  let open = false;
  let query = '';
  let collapsed = new Set();
  let knownGroups = new Set();
  let pickedIds = new Set();
  let lastPickId = '';
  let lastPickIndex = -1;

  function ensure() {
    if (panel) return panel;
    panel = document.createElement('div');
    panel.className = 'srv-panel';
    panel.id = 'srv-panel';
    panel.innerHTML = `
      <div class="srv-panel-head">
        <span class="srv-panel-title">服务器列表</span>
        <span class="srv-panel-count" id="srv-panel-count"></span>
        <span class="pane-grow"></span>
        <button class="icon-btn" id="srv-panel-close" title="关闭">✕</button>
      </div>
      <div class="srv-panel-tools">
        <input id="srv-panel-filter" type="search" placeholder="筛选名称 / 主机 / 用户 / 备注" autocomplete="off" spellcheck="false" />
        <button class="btn sm primary" id="srv-panel-add">＋ 新增配置</button>
        <button class="btn sm" id="srv-panel-group">＋ 分组</button>
      </div>
      <div class="srv-panel-list" id="srv-panel-list"></div>
      <div class="srv-panel-foot">双击服务器连接 · 右键管理配置 / 分组</div>`;
    document.body.appendChild(panel);
    listEl = panel.querySelector('#srv-panel-list');
    filterEl = panel.querySelector('#srv-panel-filter');
    countEl = panel.querySelector('#srv-panel-count');

    panel.querySelector('#srv-panel-close').addEventListener('click', close);
    panel.querySelector('#srv-panel-add').addEventListener('click', () => act(() => Connections.openEditor(null)));
    panel.querySelector('#srv-panel-group').addEventListener('click', () => act(() => Connections.addGroup()));
    filterEl.addEventListener('input', () => {
      query = filterEl.value;
      render();
    });

    U.dragMove({
      root: listEl,
      itemSelector: '.sp-row',
      groupSelector: '.sp-group',
      dropClass: 'drop-target',
      idsFor(row) {
        const id = row.dataset.id;
        if (!pickedIds.has(id)) {
          pickedIds = new Set([id]);
          lastPickId = id;
          lastPickIndex = -1;
        }
        const ids = Array.from(pickedIds).filter((x) => App.findConnection(x));
        listEl.querySelectorAll('.sp-row').forEach((r) => r.classList.toggle('picked', pickedIds.has(r.dataset.id)));
        return ids;
      },
      ghostText: (ids) => (ids.length > 1 ? `移动 ${ids.length} 台服务器` : '移动服务器'),
      groupIdFor: (el) => el.dataset.gid || '',
      onDrop(ids, gid) {
        collapsed.delete(gid);
        Connections.moveConnections(ids, gid);
      }
    });
    return panel;
  }

  /** 执行操作前先收起浮层；连接 / 编辑 / 分组都会关闭列表 */
  function act(fn) {
    close();
    try {
      const r = fn();
      if (r && typeof r.catch === 'function') {
        r.catch((err) => U.toast((err && err.message) || String(err), 'error'));
      }
    } catch (err) {
      U.toast((err && err.message) || String(err), 'error');
    }
  }

  function openPanel() {
    ensure();
    open = true;
    query = '';
    pickedIds = new Set();
    lastPickId = '';
    lastPickIndex = -1;
    if (filterEl) filterEl.value = '';
    const groups = App.state.data.groups || [];
    collapsed = new Set(groups.map((g) => g.id));
    knownGroups = new Set(groups.map((g) => g.id));
    panel.classList.add('show');
    render();
    setTimeout(() => {
      try { filterEl.focus({ preventScroll: true }); } catch (_) {}
    }, 30);
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

  function proxyTag(c) {
    const proxies = (App.state.data.settings && App.state.data.settings.proxies) || [];
    if (!c.proxyEnabled || !proxies.length) return '<span class="sp-tag">本机直连</span>';
    const p = proxies.find((x) => x.id === c.proxyId) ||
      proxies.find((x) => x.id === App.state.data.settings.defaultProxyId) || proxies[0];
    return `<span class="sp-tag proxy" title="已启用代理${p && p.name ? '：' + U.esc(p.name) : ''}">已代理</span>`;
  }

  function groupHtml(g, depth, tree, totals, matches, q) {
    const total = totals.get(g.id) || 0;
    if (q && !total) return '';
    const isCollapsed = !q && collapsed.has(g.id);
    let body = '';
    for (const child of tree.children.get(g.id) || []) {
      body += groupHtml(child, depth + 1, tree, totals, matches, q);
    }
    const direct = matches.get(g.id) || [];
    if (direct.length) body += direct.map((c) => rowHtml(c, depth + 1)).join('');
    else if (!body && !q) body = '<div class="sp-empty">暂无配置</div>';
    return `<div class="sp-group${depth === 0 ? ' lv1' : ''}${isCollapsed ? ' collapsed' : ' open'}" data-gid="${g.id}">
      <div class="sp-group-head" data-gid="${g.id}" style="padding-left:${8 + depth * 16}px">
        <span class="sp-caret"></span>
        <span class="sp-group-name">${U.esc(g.name)}</span>
        <span class="sp-group-count">${total}</span>
      </div>
      <div class="sp-group-items">${body}</div>
    </div>`;
  }

  function rowHtml(c, depth) {
    const name = String(c.name || c.host || '?');
    const addr = `${c.host || ''}:${c.port || 22}`;
    const remark = String(c.remark || '').trim();
    return `<div class="sp-row" data-id="${c.id}" data-depth="${depth}" style="padding-left:${8 + depth * 16}px" title="双击连接">
      <span class="sp-name">${U.esc(name)}</span>
      <span class="sp-addr">${U.esc(addr)}</span>
      ${proxyTag(c)}
      ${remark ? `<span class="sp-remark" title="${U.esc(remark)}">${U.esc(remark)}</span>` : ''}
    </div>`;
  }

  function render() {
    if (!listEl || !open) return;
    const groups = App.state.data.groups || [];
    const conns = App.state.data.connections || [];
    const q = query.trim().toLowerCase();
    const groupIds = new Set(groups.map((g) => g.id));
    for (const id of Array.from(collapsed)) {
      if (!groupIds.has(id)) collapsed.delete(id);
    }
    for (const g of groups) {
      if (!knownGroups.has(g.id)) {
        knownGroups.add(g.id);
        collapsed.add(g.id);
      }
    }
    const match = (c) => {
      if (!q) return true;
      return [c.name, c.host, c.user, c.remark, c.port].some((v) =>
        String(v == null ? '' : v).toLowerCase().includes(q)
      );
    };
    const matches = new Map();
    for (const c of conns) {
      if (!match(c)) continue;
      const arr = matches.get(c.group) || [];
      arr.push(c);
      matches.set(c.group, arr);
    }
    const tree = Connections.groupTree(groups);
    const levels = Connections.levelsOf(tree, tree.roots, 0, new Map());
    const totals = new Map();
    const countGroup = (g) => {
      let n = (matches.get(g.id) || []).length;
      for (const child of tree.children.get(g.id) || []) n += countGroup(child);
      totals.set(g.id, n);
      return n;
    };
    tree.roots.forEach(countGroup);
    const matched = conns.filter(match).length;
    if (countEl) {
      countEl.textContent = q ? `匹配 ${matched} / ${conns.length}` : `${conns.length} 个配置 · ${groups.length} 个分组`;
    }
    listEl.innerHTML = tree.roots.map((g) => groupHtml(g, 0, tree, totals, matches, q)).join('') ||
      `<div class="sp-empty sp-empty-all">${q ? '没有匹配的服务器' : '还没有服务器配置'}</div>`;

    listEl.querySelectorAll('.sp-group-head').forEach((head) => {
      head.addEventListener('click', () => {
        if (query.trim()) return;
        const gid = head.dataset.gid;
        if (collapsed.has(gid)) collapsed.delete(gid);
        else collapsed.add(gid);
        render();
      });
      head.addEventListener('contextmenu', (e) => {
        e.preventDefault();
        e.stopPropagation();
        const gid = head.dataset.gid;
        const group = groups.find((g) => g.id === gid);
        if (!group) return;
        const level = levels.get(gid) || 1;
        const isRecycle = !group.parentId && group.name === RECYCLE_NAME;
        const items = conns.filter((c) => c.group === gid);
        const ids = items.map((c) => c.id);
        const proxies = (App.state.data.settings && App.state.data.settings.proxies) || [];
        U.ctxMenu(
          [
            {
              label: `连接本组服务器（${items.length}）`,
              onClick: () => {
                if (!ids.length) return U.toast('该分组下没有服务器配置');
                act(() => Connections.connectMany(ids, { proxyMode: 'config' }));
              }
            },
            proxies.length ? {
              label: `通过代理连接本组服务器（${items.length}）`,
              onClick: () => {
                if (!ids.length) return U.toast('该分组下没有服务器配置');
                act(() => Connections.connectMany(ids, { proxyMode: 'default' }));
              }
            } : null,
            {
              label: `直接连接本组服务器（${items.length}）`,
              onClick: () => {
                if (!ids.length) return U.toast('该分组下没有服务器配置');
                act(() => Connections.connectMany(ids, { proxyMode: 'none' }));
              }
            },
            { sep: true },
            { label: '在此分组新增配置', onClick: () => act(() => Connections.openEditor(null, gid)) },
            { label: '粘贴配置', disabled: !App.state.connClipboard, onClick: () => act(() => Connections.pasteConnection(gid)) },
            level < 3 && !isRecycle ? { label: '新建子分组…', onClick: () => act(() => Connections.addSubGroup(group)) } : null,
            isRecycle ? null : { label: '重命名分组…', onClick: () => act(() => Connections.renameGroup(group)) },
            { sep: true },
            { label: '删除分组', danger: true, onClick: () => act(() => Connections.deleteGroup(group)) }
          ].filter(Boolean),
          e.clientX,
          e.clientY
        );
      });
    });

    const rows = Array.from(listEl.querySelectorAll('.sp-row'));
    const orderIds = rows.map((row) => row.dataset.id);
    for (const id of Array.from(pickedIds)) {
      if (!orderIds.includes(id)) pickedIds.delete(id);
    }
    rows.forEach((row) => row.classList.toggle('picked', pickedIds.has(row.dataset.id)));

    rows.forEach((row) => {
      const id = row.dataset.id;
      const c = conns.find((x) => x.id === id);
      if (!c) return;
      const proxies = (App.state.data.settings && App.state.data.settings.proxies) || [];
      row.addEventListener('click', (e) => {
        const idx = orderIds.indexOf(id);
        if (e.ctrlKey || e.metaKey) {
          if (pickedIds.has(id)) pickedIds.delete(id);
          else pickedIds.add(id);
          lastPickIndex = idx;
        } else if (e.shiftKey && lastPickIndex >= 0) {
          const [a, b] = [Math.min(lastPickIndex, idx), Math.max(lastPickIndex, idx)];
          pickedIds = new Set(orderIds.slice(a, b + 1));
        } else {
          pickedIds = new Set([id]);
          lastPickIndex = idx;
        }
        lastPickId = id;
        rows.forEach((r) => r.classList.toggle('picked', pickedIds.has(r.dataset.id)));
      });
      row.addEventListener('dblclick', () => act(() => Term.connect(c.id)));
      row.addEventListener('contextmenu', (e) => {
        e.preventDefault();
        e.stopPropagation();
        if (!pickedIds.has(id)) {
          pickedIds = new Set([id]);
          lastPickId = id;
          lastPickIndex = orderIds.indexOf(id);
          rows.forEach((r) => r.classList.toggle('picked', pickedIds.has(r.dataset.id)));
        }
        const ids = Array.from(pickedIds).filter((x) => App.findConnection(x));
        const multi = ids.length > 1;
        U.ctxMenu(
          [
            multi ? { label: `连接所选服务器（${ids.length} 台）`, onClick: () => act(() => Connections.connectMany(ids)) } : null,
            { label: multi ? '仅连接此台' : '连接', onClick: () => act(() => Term.connect(c.id)) },
            proxies.length
              ? {
                  label: multi ? '通过默认代理连接所选' : '通过默认代理连接',
                  onClick: () => act(() => Connections.connectMany(multi ? ids : [c.id], { proxyMode: 'default' }))
                }
              : null,
            { label: multi ? '直接连接所选' : '直接连接', onClick: () => act(() => Connections.connectMany(multi ? ids : [c.id], { proxyMode: 'none' })) },
            { sep: true },
            { label: '编辑配置', onClick: () => act(() => Connections.openEditor(c)) },
            { label: '复制配置', onClick: () => Connections.copyConnection(c.id) },
            { label: '粘贴配置', disabled: !App.state.connClipboard, onClick: () => act(() => Connections.pasteConnection(c.group)) },
            { label: '复制主机地址', onClick: () => U.copy(c.host || '') },
            { label: '检查IP信息', onClick: () => act(() => Connections.checkIpInfo(c.host)) },
            multi ? { label: '取消多选', onClick: () => {
              pickedIds = new Set([c.id]);
              lastPickId = c.id;
              lastPickIndex = orderIds.indexOf(c.id);
              rows.forEach((r) => r.classList.toggle('picked', r.dataset.id === c.id));
            } } : null,
            { sep: true },
            { label: multi ? `删除所选（${ids.length}）` : '删除配置', danger: true, onClick: () => act(() => Connections.removeConnections(multi ? ids : [c.id])) }
          ].filter(Boolean),
          e.clientX,
          e.clientY
        );
      });
    });
  }

  App.on('data:change', () => {
    if (open) render();
  });

  document.addEventListener('mousedown', (e) => {
    if (!open) return;
    if (panel && panel.contains(e.target)) return;
    if (e.target.closest && e.target.closest('#tb-servers, #ctx-menu, #ctx-submenu')) return;
    close();
  }, true);

  document.addEventListener('keydown', (e) => {
    if (!open || e.key !== 'Escape') return;
    if (document.querySelector('#modal-mask.show, #sub-mask.show, #settings-mask.show, .fav-overlay.show')) return;
    e.preventDefault();
    close();
  }, true);

  return { open: openPanel, close, toggle, render };
})();
