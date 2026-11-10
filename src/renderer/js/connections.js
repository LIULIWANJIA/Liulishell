'use strict';
/* 连接管理：分组、新增/编辑、筛选、连接 */
window.Connections = (function () {
  const $ = U.qs;
  const listEl = $('#conn-list');
  const RECYCLE_NAME = '待回收';
  let filter = '';
  let collapsedGroups = null;
  let knownGroups = new Set();
  /** 多选状态：Ctrl / Cmd + 左键逐个加选，Shift + 左键按可见顺序连选 */
  let pickedIds = new Set();
  let lastPickId = '';

  /** 名称排序：数字自然序、字母序、大小写同字时大写在前，待回收置底 */
  function compareText(a, b) {
    const A = String(a || '');
    const B = String(b || '');
    const chunks = (s) => s.match(/\d+|\D+/g) || [];
    const ca = chunks(A);
    const cb = chunks(B);
    const n = Math.max(ca.length, cb.length);
    for (let i = 0; i < n; i++) {
      const x = ca[i];
      const y = cb[i];
      if (x === undefined) return -1;
      if (y === undefined) return 1;
      const nx = /^\d+$/.test(x);
      const ny = /^\d+$/.test(y);
      if (nx && ny) {
        const dx = Number(x);
        const dy = Number(y);
        if (dx !== dy) return dx - dy;
        if (x.length !== y.length) return x.length - y.length;
      } else if (nx !== ny) {
        return nx ? -1 : 1;
      } else {
        const len = Math.min(x.length, y.length);
        for (let j = 0; j < len; j++) {
          const a1 = x[j];
          const b1 = y[j];
          const la = a1.toLowerCase();
          const lb = b1.toLowerCase();
          if (la !== lb) {
            const r = la.localeCompare(lb, 'zh-CN');
            if (r) return r;
            return la < lb ? -1 : 1;
          }
          if (a1 !== b1) {
            const ua = a1 === a1.toUpperCase();
            const ub = b1 === b1.toUpperCase();
            if (ua !== ub) return ua ? -1 : 1;
            return a1 < b1 ? -1 : 1;
          }
        }
        if (x.length !== y.length) return x.length - y.length;
      }
    }
    return 0;
  }

  function compareGroupName(a, b) {
    if (a === RECYCLE_NAME || b === RECYCLE_NAME) {
      if (a === b) return 0;
      return a === RECYCLE_NAME ? 1 : -1;
    }
    return compareText(a, b);
  }

  function groupTree(groups) {
    const list = Array.isArray(groups) ? groups : [];
    const byId = new Map(list.map((g) => [g.id, g]));
    const children = new Map();
    for (const g of list) {
      const parentId = g.parentId && byId.has(g.parentId) && g.parentId !== g.id ? g.parentId : '';
      if (!children.has(parentId)) children.set(parentId, []);
      children.get(parentId).push(g);
    }
    children.forEach((arr) => arr.sort((a, b) => compareGroupName(a.name, b.name)));
    return { byId, children, roots: children.get('') || [] };
  }

  function levelsOf(tree, roots, depth, out) {
    for (const g of roots || tree.roots) {
      out.set(g.id, (depth || 0) + 1);
      const kids = tree.children.get(g.id) || [];
      if (kids.length) levelsOf(tree, kids, (depth || 0) + 1, out);
    }
    return out;
  }

  function descendantIds(tree, id) {
    const out = new Set([id]);
    const walk = (gid) => {
      for (const child of tree.children.get(gid) || []) {
        out.add(child.id);
        walk(child.id);
      }
    };
    walk(id);
    return out;
  }

  function groupSelectHtml(groups, selectedId) {
    const tree = groupTree(groups);
    let html = '';
    const walk = (nodes, depth) => {
      for (const g of nodes) {
        const prefix = depth ? '　'.repeat(depth) + '└ ' : '';
        html += `<option value="${g.id}"${selectedId === g.id ? ' selected' : ''}>${prefix}${U.esc(g.name)}</option>`;
        walk(tree.children.get(g.id) || [], depth + 1);
      }
    };
    walk(tree.roots, 0);
    return html;
  }

  function init() {
    $('#btn-add-conn').addEventListener('click', () => openEditor(null));
    $('#btn-add-group').addEventListener('click', addGroup);
    const input = $('#conn-filter');
    input.addEventListener(
      'input',
      U.debounce(() => {
        filter = input.value.trim().toLowerCase();
        render();
      }, 120)
    );

    App.on('data:change', render);
    App.on('sessions:change', render);
    App.on('active:change', render);
  }

  /** 分组默认全部折叠；用户手动展开/折叠后记忆到 settings */
  function collapsedSet() {
    if (collapsedGroups) return collapsedGroups;
    const saved = App.settings.collapsedGroups;
    collapsedGroups = Array.isArray(saved)
      ? new Set(saved)
      : new Set((App.state.data.groups || []).map((g) => g.id));
    return collapsedGroups;
  }

  function saveCollapsed(set) {
    collapsedGroups = set;
    const arr = Array.from(set);
    App.state.data.settings.collapsedGroups = arr;
    window.api.saveSettings({ collapsedGroups: arr });
  }

  function render() {
    const groups = App.state.data.groups || [];
    const conns = App.state.data.connections || [];
    // 删除配置后清掉残留的多选状态
    const validIds = new Set(conns.map((c) => c.id));
    if (Array.from(pickedIds).some((id) => !validIds.has(id))) {
      pickedIds = new Set(Array.from(pickedIds).filter((id) => validIds.has(id)));
      if (!pickedIds.has(lastPickId)) lastPickId = '';
    }
    const collapsed = collapsedSet();
    const groupIds = groups.map((g) => g.id);
    let changed = false;
    groupIds.forEach((id) => {
      if (!knownGroups.has(id)) {
        collapsed.add(id);
        knownGroups.add(id);
        changed = true;
      }
    });
    Array.from(collapsed).forEach((id) => {
      if (!groupIds.includes(id)) {
        collapsed.delete(id);
        knownGroups.delete(id);
        changed = true;
      }
    });
    if (changed) saveCollapsed(collapsed);

    const tree = groupTree(groups);
    const levels = levelsOf(tree, tree.roots, 0, new Map());
    const onlineIds = new Set(
      Array.from(App.state.sessions.values())
        .filter((s) => s.status === 'online')
        .map((s) => s.config.id)
    );
    const activeConf = App.active ? App.active.config.id : null;

    const match = (c) => {
      if (!filter) return true;
      return (
        (c.name || '').toLowerCase().includes(filter) ||
        (c.host || '').toLowerCase().includes(filter) ||
        (c.user || '').toLowerCase().includes(filter)
      );
    };

    const matches = new Map();
    for (const c of conns) {
      if (!match(c)) continue;
      if (!matches.has(c.group)) matches.set(c.group, []);
      matches.get(c.group).push(c);
    }
    const totals = new Map();
    const countFor = (g) => {
      let n = (matches.get(g.id) || []).length;
      for (const child of tree.children.get(g.id) || []) n += countFor(child);
      totals.set(g.id, n);
      return n;
    };
    tree.roots.forEach(countFor);

    const cardHtml = (c) => {
      const online = onlineIds.has(c.id);
      const active = activeConf === c.id;
      const label = String(c.name || c.host || '?').trim();
      const initial = label.slice(0, 1).toUpperCase();
      const isKey = c.authType === 'key';
      return `<div class="conn-item${online ? ' online' : ''}${active ? ' active' : ''}${
        pickedIds.has(c.id) ? ' picked' : ''
      }" data-id="${c.id}">
        <span class="ci-avatar">${U.esc(initial)}</span>
        <span class="ci-body">
          <span class="ci-name">${U.esc(label)}</span>
          <span class="ci-addr"><span class="ci-host">${U.esc(c.user)}@${U.esc(c.host)}</span><span class="ci-port">:${c.port}</span>${
            isKey ? '<i class="ci-tag">密钥</i>' : ''
          }</span>
        </span>
        <span class="ci-state"></span>
      </div>`;
    };

    const groupHtml = (g, depth) => {
      const total = totals.get(g.id) || 0;
      if (filter && !total) return '';
      let body = '';
      // 同一分组内：子分组在上，服务器配置在下
      for (const child of tree.children.get(g.id) || []) body += groupHtml(child, (depth || 0) + 1);
      for (const c of matches.get(g.id) || []) body += cardHtml(c);
      if (!body) body = '<div class="group-empty">暂无配置</div>';
      const isCollapsed = collapsed.has(g.id) && !filter;
      const top = !depth;
      return `<div class="group${top ? ' lv1' : ''}${isCollapsed ? ' collapsed' : ' open'}" data-gid="${g.id}">
        <div class="group-head" data-depth="${depth || 0}">
          <span class="gh-caret"></span>
          <span class="gh-name">${U.esc(g.name)}</span>
          <span class="gh-count">${total}</span>
        </div>
        <div class="group-items">${body}</div>
      </div>`;
    };

    let html = tree.roots.map((g) => groupHtml(g, 0)).join('');
    if (!html.trim()) {
      html = `<div class="conn-empty">${
        filter ? '没有匹配的连接' : '还没有保存的连接<br>点击「＋ 新增配置」添加'
      }</div>`;
    }
    listEl.innerHTML = html;

    const cards = Array.from(listEl.querySelectorAll('.conn-item'));
    const orderIds = cards.map((el) => el.dataset.id);
    cards.forEach((card) => {
      const id = card.dataset.id;
      // 单击只选中，不再直接连接；Ctrl / Cmd 多选、Shift 连选，连接统一走右键菜单
      card.addEventListener('click', (e) => {
        const idx = orderIds.indexOf(id);
        if (e.ctrlKey || e.metaKey) {
          if (pickedIds.has(id)) pickedIds.delete(id);
          else pickedIds.add(id);
          lastPickId = id;
        } else if (e.shiftKey && lastPickId) {
          const from = orderIds.indexOf(lastPickId);
          if (from < 0) {
            pickedIds = new Set([id]);
            lastPickId = id;
          } else {
            const [a, b] = [Math.min(from, idx), Math.max(from, idx)];
            pickedIds = new Set(orderIds.slice(a, b + 1));
          }
        } else {
          pickedIds = new Set([id]);
          lastPickId = id;
        }
        syncPicked();
      });
      card.addEventListener('contextmenu', (e) => {
        e.preventDefault();
        const c = App.findConnection(id);
        if (!c) return;
        // 右键未选中的服务器时，切换到只选它；右键已选中的则保留整批选择
        if (!pickedIds.has(id)) {
          pickedIds = new Set([id]);
          lastPickId = id;
          syncPicked();
        }
        const ids = Array.from(pickedIds).filter((x) => App.findConnection(x));
        const multi = ids.length > 1;
        const proxies = App.state.data.settings.proxies || [];
        U.ctxMenu(
          [
            multi
              ? { label: `连接所选服务器（${ids.length} 台）`, onClick: () => connectMany(ids) }
              : null,
            { label: multi ? '仅连接此台' : '连接', onClick: () => Term.connect(c.id) },
            proxies.length
              ? {
                  label: multi ? '通过默认代理连接所选' : '通过默认代理连接',
                  onClick: () => connectMany(multi ? ids : [c.id], { proxyMode: 'default' })
                }
              : null,
            { sep: true },
            { label: '编辑配置', onClick: () => openEditor(c) },
            { label: '复制主机地址', onClick: () => navigator.clipboard.writeText(c.host).then(() => U.toast('已复制', 'ok')) },
            multi ? { label: '取消多选', onClick: () => { pickedIds = new Set([c.id]); lastPickId = c.id; syncPicked(); } } : null,
            { sep: true },
            { label: '删除配置', danger: true, onClick: () => removeConnection(c.id) }
          ].filter(Boolean),
          e.clientX,
          e.clientY
        );
      });
    });

    listEl.querySelectorAll('.group-head').forEach((head) => {
      const gid = head.parentElement.dataset.gid;
      const group = groups.find((g) => g.id === gid);
      if (!group) return;
      const level = levels.get(gid) || 1;
      const isRecycle = !group.parentId && group.name === RECYCLE_NAME;
      const toggle = () => {
        const set = collapsedSet();
        if (set.has(gid)) set.delete(gid);
        else set.add(gid);
        saveCollapsed(set);
        render();
      };
      head.addEventListener('click', toggle);
      head.addEventListener('contextmenu', (e) => {
        e.preventDefault();
        // 只连接「本分组」下的配置，不包含子分组里的服务器
        const items = conns.filter((c) => c.group === gid);
        U.ctxMenu(
          [
            {
              label: `连接本组服务器（${items.length}）`,
              onClick: () => {
                if (!items.length) return U.toast('该分组下没有服务器配置', 'info');
                connectMany(items.map((c) => c.id));
              }
            },
            { label: collapsedSet().has(gid) ? '展开分组' : '折叠分组', onClick: toggle },
            { sep: true },
            { label: '在此分组新增 SSH 配置', onClick: () => openEditor(null, gid) },
            level < 3 && !isRecycle ? { label: '在此分组新建子分组…', onClick: () => addSubGroup(group) } : null,
            isRecycle ? null : { label: '重命名分组…', onClick: () => renameGroup(group) },
            isRecycle ? null : { sep: true },
            isRecycle ? null : { label: '删除分组', danger: true, onClick: () => deleteGroup(group) }
          ].filter(Boolean),
          e.clientX,
          e.clientY
        );
      });
    });
  }

  /** 只切换选中样式，不重建列表（保留滚动位置与展开状态） */
  function syncPicked() {
    listEl.querySelectorAll('.conn-item').forEach((el) => {
      el.classList.toggle('picked', pickedIds.has(el.dataset.id));
    });
  }

  /** 依次连接多台服务器：错开几十毫秒建立会话，避免同时握手把界面顶住 */
  function connectMany(ids, opts) {
    const list = (ids || []).filter((id) => App.findConnection(id));
    if (!list.length) return;
    if (list.length === 1) return Term.connect(list[0], opts);
    U.toast(`正在连接 ${list.length} 台服务器…`, 'info', 2200);
    list.forEach((id, i) => {
      setTimeout(() => Term.connect(id, opts), i * 90);
    });
  }

  /* ---------------- 分组 ---------------- */

  async function addGroup() {
    const name = await U.promptDialog('新增一级分组', '分组名称', '', '例如：生产环境');
    if (!name) return;
    try {
      const data = await window.api.saveGroup({ name });
      App.setData(data);
      U.toast('分组已创建', 'ok');
    } catch (err) {
      U.toast(err.message, 'error');
    }
  }

  /** 在指定分组下新建子分组（最多三级） */
  async function addSubGroup(group) {
    const name = await U.promptDialog('新建子分组', `在「${group.name}」下新建子分组`, '', '例如：华东节点');
    if (!name) return;
    try {
      const data = await window.api.saveGroup({ name, parentId: group.id });
      App.setData(data);
      const set = collapsedSet();
      set.delete(group.id);
      saveCollapsed(set);
      render();
      U.toast('子分组已创建', 'ok');
    } catch (err) {
      U.toast(err.message, 'error');
    }
  }

  async function renameGroup(group) {
    const name = await U.promptDialog('重命名分组', '分组名称', group.name);
    if (!name) return;
    try {
      const data = await window.api.saveGroup({ id: group.id, name });
      App.setData(data);
    } catch (err) {
      U.toast(err.message, 'error');
    }
  }

  async function deleteGroup(group) {
    const ok = await U.confirmDialog(
      '删除分组',
      `确定删除分组「${group.name}」及其所有子分组吗？\n组内服务器配置会移动到「${RECYCLE_NAME}」分组，不会丢失。`,
      '继续'
    );
    if (!ok) return;
    const sure = await U.confirmDialog(
      '再次确认删除',
      `即将删除「${group.name}」。\n此操作不可撤销，确定继续吗？`,
      '确认删除'
    );
    if (!sure) return;
    try {
      const data = await window.api.deleteGroup(group.id);
      App.setData(data);
      U.toast('分组已删除，配置已移入「待回收」', 'ok');
    } catch (err) {
      U.toast(err.message, 'error');
    }
  }

  /* ---------------- 连接配置 ---------------- */

  function authBody(conn, defaultGroupId) {
    const isKey = conn && conn.authType === 'key';
    const pickedGroup = conn ? conn.group : defaultGroupId || (App.state.data.groups || [])[0].id;
    const proxies = App.state.data.settings.proxies || [];
    const defProxy = App.state.data.settings.defaultProxyId || (proxies.length === 1 ? proxies[0].id : '');
    const curProxy = conn ? conn.proxyId || defProxy : defProxy;
    const proxyRow = proxies.length
      ? `<label class="check-inline"><input type="checkbox" id="f-proxy-enabled"${conn && conn.proxyEnabled ? ' checked' : ''} /> 启用代理</label>
         <select id="f-proxy-id" style="flex:1;min-width:150px">${proxies
           .map((p) => `<option value="${p.id}"${curProxy === p.id ? ' selected' : ''}>${U.esc(p.name)} · ${U.esc(p.type)}://${U.esc(p.host)}:${p.port}</option>`)
           .join('')}</select>`
      : '<span class="key-hint">尚未配置代理，可在「设置 → 传输 / 代理」添加</span>';
    return `
      <div class="form-row">
        <div class="field" style="flex:2"><label>名称</label><input id="f-name" type="text" value="${U.esc(
          conn ? conn.name : ''
        )}" placeholder="例如：生产 Web-01"></div>
        <div class="field"><label>分组</label><select id="f-group">${groupSelectHtml(
          App.state.data.groups || [],
          pickedGroup
        )}</select></div>
      </div>
      <div class="form-row">
        <div class="field" style="flex:2"><label>主机 <span class="req">*</span></label><input id="f-host" type="text" value="${U.esc(
          conn ? conn.host : ''
        )}" placeholder="IP 或域名"></div>
        <div class="field" style="flex:0 0 86px"><label>端口</label><input id="f-port" type="number" value="${
          conn ? conn.port : 22
        }" min="1" max="65535"></div>
      </div>
      <div class="form-row">
        <div class="field"><label>用户名 <span class="req">*</span></label><input id="f-user" type="text" value="${U.esc(
          conn ? conn.user : 'root'
        )}"></div>
      </div>
      <div class="form-row">
        <div class="field"><label>认证方式</label>
          <div class="radio-row">
            <label><input type="radio" name="f-auth" value="password"${isKey ? '' : ' checked'}> 密码</label>
            <label><input type="radio" name="f-auth" value="key"${isKey ? ' checked' : ''}> 密钥</label>
          </div>
        </div>
      </div>
      <div id="auth-password" class="${isKey ? 'hidden' : ''}">
        <div class="form-row"><div class="field"><label>密码</label>
          <input id="f-password" type="password" autocomplete="new-password" placeholder="${
            conn && conn.hasPassword ? '已保存，留空表示不修改' : '可留空，连接时再输入'
          }">
          <div class="field-hint">允许留空保存：连接时会弹出凭据浮窗，输入后可直接选择是否写回配置。</div>
        </div></div>
      </div>
      <div id="auth-key" class="${isKey ? '' : 'hidden'}">
        <div class="form-row"><div class="field"><label>密钥来源</label>
          <div class="key-src">
            <select id="f-key-sel">${keyOptions(conn && conn.keyId)}</select>
            <button class="btn sm" id="btn-import-key" type="button" title="把私钥命名后保存到密钥库">＋ 导入密钥</button>
          </div>
          <div class="key-hint" id="key-hint"></div>
        </div></div>
        <div id="key-manual">
          <div class="form-row"><div class="field"><label>私钥</label>
            <div class="key-box">
              <div class="kb-head">
                <span class="kb-path" id="kb-path">${U.esc(conn && conn.keyPath ? conn.keyPath : '未选择文件')}</span>
                <button class="btn sm" id="btn-pick-key" type="button">选择文件…</button>
              </div>
              <textarea id="f-key" spellcheck="false" placeholder="${
                conn && conn.hasPrivateKey ? '已保存私钥，留空表示不修改' : '粘贴私钥内容（OpenSSH / PEM）'
              }"></textarea>
            </div>
          </div></div>
          <div class="form-row"><div class="field"><label>私钥口令（可选）</label><input id="f-passphrase" type="password" placeholder="${
            conn && conn.hasPassphrase ? '已保存，留空表示不修改' : '私钥未加密则留空'
          }"></div></div>
        </div>
      </div>
      <div class="form-row">
        <div class="field"><label>代理</label>
          <div class="radio-row" style="gap:10px">${proxyRow}</div>
        </div>
      </div>
      <div class="form-row" style="margin-bottom:0">
        <div style="display:flex;align-items:center;gap:18px;flex-wrap:wrap">
          <label class="check-inline"><input type="checkbox" id="f-connect"> 保存后立即连接</label>
          <label class="check-inline"><input type="checkbox" id="f-clear-motd"${conn && conn.clearMotd === false ? '' : ' checked'}> 清除 MOTD 信息（连接后清屏）</label>
        </div>
      </div>`;
  }

  function openEditor(conn, defaultGroupId) {
    const isEdit = !!conn;
    let pickedKeyPath = conn ? conn.keyPath || '' : '';

    const promise = U.openModal({
      title: isEdit ? '编辑 SSH 配置' : '新增 SSH 配置',
      width: '560px',
      body: authBody(conn, defaultGroupId),
      okText: '保存',
      onOk: async () => {
        const name = $('#f-name').value.trim();
        const host = $('#f-host').value.trim();
        const port = Number($('#f-port').value) || 22;
        const user = $('#f-user').value.trim();
        const authType = document.querySelector('input[name="f-auth"]:checked').value;
        if (!host) throw new Error('请填写主机地址');
        if (!user) throw new Error('请填写用户名');

        const payload = {
          id: conn ? conn.id : undefined,
          name: name || host,
          group: $('#f-group').value,
          host,
          port,
          user,
          authType,
          proxyEnabled: $('#f-proxy-enabled') ? $('#f-proxy-enabled').checked : false,
          proxyId: $('#f-proxy-id') ? $('#f-proxy-id').value : '',
          clearMotd: $('#f-clear-motd') ? $('#f-clear-motd').checked : true
        };

        if (authType === 'password') {
          const pwd = $('#f-password').value;
          // 允许空密码保存：留空即表示“还没有凭据”，连接时会弹浮窗补输入
          if (pwd) payload.password = pwd;
        } else {
          const keyId = $('#f-key-sel').value;
          const keyText = $('#f-key').value.trim();
          const passphrase = $('#f-passphrase').value;
          if (keyId) {
            payload.keyId = keyId;
          } else {
            payload.keyId = '';
            if (pickedKeyPath) payload.keyPath = pickedKeyPath;
            if (keyText) payload.privateKey = keyText;
            if (passphrase) payload.passphrase = passphrase;
          }
        }

        const res = await window.api.saveConnection(payload);
        App.setData(res.state);
        const savedId = res.id;
        const shouldConnect = $('#f-connect').checked;
        setTimeout(() => {
          if (shouldConnect && savedId) Term.connect(savedId);
        }, 60);
        U.toast(isEdit ? '配置已保存' : '配置已创建', 'ok');
      }
    });

    // 认证方式切换 / 选择私钥（弹窗打开后再绑定）
    setTimeout(() => {
      document.querySelectorAll('input[name="f-auth"]').forEach((radio) => {
        radio.addEventListener('change', () => {
          const isKey = document.querySelector('input[name="f-auth"]:checked').value === 'key';
          $('#auth-password').classList.toggle('hidden', isKey);
          $('#auth-key').classList.toggle('hidden', !isKey);
        });
      });
      const keySel = $('#f-key-sel');
      const syncKeyMode = () => {
        const id = keySel.value;
        const k = (App.state.data.keys || []).find((x) => x.id === id);
        $('#key-manual').classList.toggle('hidden', !!k);
        const hint = $('#key-hint');
        if (k) {
          hint.innerHTML = `已选用密钥库：<b>${U.esc(k.name)}</b>${k.keyType ? ' · ' + U.esc(k.keyType) : ''}${
            k.hasPassphrase ? ' · 含口令' : ''
          }${k.fingerprint ? ' · ' + U.esc(k.fingerprint.slice(0, 11)) : ''}`;
        } else {
          hint.textContent = '建议先「＋ 导入密钥」命名保存，之后所有服务器都能直接选用，无需重复粘贴。';
        }
      };
      if (keySel) {
        syncKeyMode();
        keySel.addEventListener('change', syncKeyMode);
      }
      const importBtn = $('#btn-import-key');
      if (importBtn) {
        importBtn.addEventListener('click', () => {
          importKeyDialog((newId) => {
            const sel = $('#f-key-sel');
            if (sel) {
              sel.innerHTML = keyOptions(newId);
              syncKeyMode();
            }
          });
        });
      }
      const proxyChk = $('#f-proxy-enabled');
      const proxySel = $('#f-proxy-id');
      const syncProxy = () => { if (proxySel) proxySel.disabled = !proxyChk || !proxyChk.checked; };
      if (proxyChk) {
        syncProxy();
        proxyChk.addEventListener('change', syncProxy);
      }

      const pickBtn = $('#btn-pick-key');
      if (pickBtn) {
        pickBtn.addEventListener('click', async () => {
          const r = await window.api.pickKeyFile();
          if (!r) return;
          pickedKeyPath = r.path;
          $('#kb-path').textContent = r.path;
          if (!$('#f-key').value.trim()) $('#f-key').value = r.content.trim();
        });
      }
    }, 20);

    return promise;
  }

  async function removeConnection(id) {
    const c = App.findConnection(id);
    if (!c) return;
    const ok = await U.confirmDialog('删除配置', `确定删除「${c.name || c.host}」的 SSH 配置吗？`, '删除');
    if (!ok) return;
    const data = await window.api.deleteConnection(id);
    App.setData(data);
    U.toast('配置已删除', 'ok');
  }

  /* ---------------- 密钥库 ---------------- */

  function keyOptions(selectedId) {
    const keys = App.state.data.keys || [];
    const list = keys
      .map(
        (k) =>
          `<option value="${k.id}"${selectedId === k.id ? ' selected' : ''}>${U.esc(k.name)}${
            k.keyType ? ' · ' + U.esc(k.keyType) : ''
          }</option>`
      )
      .join('');
    return `<option value=""${selectedId ? '' : ' selected'}>手动粘贴 / 选择私钥文件</option>${list}`;
  }

  /** 导入密钥到密钥库（需命名） */
  function importKeyDialog(onSaved) {
    let pickedPath = '';
    const p = U.openSubModal({
      title: '导入 SSH 私钥',
      width: '560px',
      okText: '保存到密钥库',
      body: `
        <div class="form-row"><div class="field"><label>密钥名称 <span class="req">*</span></label>
          <input id="ik-name" type="text" placeholder="例如：生产环境-运维密钥" />
        </div></div>
        <div class="form-row"><div class="field"><label>私钥内容 <span class="req">*</span></label>
          <div class="key-box">
            <div class="kb-head">
              <span class="kb-path" id="ik-path">未选择文件</span>
              <button class="btn sm" id="ik-pick" type="button">选择文件…</button>
            </div>
            <textarea id="ik-key" spellcheck="false" placeholder="-----BEGIN OPENSSH PRIVATE KEY-----"></textarea>
          </div>
        </div></div>
        <div class="form-row" style="margin-bottom:0"><div class="field"><label>私钥口令（可选）</label>
          <input id="ik-pass" type="password" placeholder="私钥未加密则留空" autocomplete="new-password" /></div></div>
        <div class="key-hint">私钥使用系统安全存储加密后保存在本地，不会明文落盘。</div>`,
      onOk: async () => {
        const name = $('#ik-name').value.trim();
        const key = $('#ik-key').value.trim();
        if (!name) throw new Error('请填写密钥名称');
        if (!key) throw new Error('请粘贴私钥内容或选择文件');
        const res = await window.api.keySave({ name, privateKey: key, passphrase: $('#ik-pass').value });
        App.setData(res.state);
        U.toast('密钥已保存到密钥库', 'ok');
        if (onSaved) onSaved(res.id);
        return true;
      }
    });
    setTimeout(() => {
      const pick = $('#ik-pick');
      if (pick) {
        pick.addEventListener('click', async () => {
          const r = await window.api.pickKeyFile();
          if (!r) return;
          pickedPath = r.path;
          $('#ik-path').textContent = r.path;
          $('#ik-key').value = r.content.trim();
          if (!$('#ik-name').value.trim()) {
            const base = r.path.replace(/\\/g, '/').split('/').pop() || 'ssh-key';
            $('#ik-name').value = base;
          }
        });
      }
    }, 20);
    return p;
  }

  /** 密钥库管理：查看 / 删除 / 追加导入 */
  async function openKeyManager() {
    const rows = () =>
      (App.state.data.keys || [])
        .map(
          (k) => `<div class="key-row" data-kid="${k.id}">
            <div class="key-ico">K</div>
            <div class="key-main">
              <div class="key-name">${U.esc(k.name)}
                ${k.keyType ? `<span class="key-badge">${U.esc(k.keyType)}</span>` : ''}
                ${k.hasPassphrase ? '<span class="key-badge lock">含口令</span>' : ''}
              </div>
              <div class="key-sub">${U.esc(k.fingerprint || '无指纹')}${k.usedBy ? ` · ${k.usedBy} 个配置在用` : ''}</div>
            </div>
            <button class="btn sm danger" data-kdel="${k.id}">删除</button>
          </div>`
        )
        .join('') || '<div class="key-empty">密钥库还是空的，点击右上角「导入新密钥」添加</div>';

    U.openModal({
      title: '密钥库',
      width: '580px',
      okText: '关闭',
      hideCancel: true,
      body: `<div class="key-manager-head">
          <span class="key-hint" style="margin:0">私钥使用系统安全存储加密，仅在连接时解密使用</span>
          <span class="pane-grow"></span>
          <button class="btn sm primary" id="km-import">＋ 导入新密钥</button>
        </div>
        <div class="key-list" id="key-list">${rows()}</div>`,
      onOk: () => true
    });

    setTimeout(() => {
      const listEl2 = $('#key-list');
      if (listEl2) {
        listEl2.addEventListener('click', async (e) => {
          const btn = e.target.closest('[data-kdel]');
          if (!btn) return;
          const id = btn.dataset.kdel;
          const k = (App.state.data.keys || []).find((x) => x.id === id);
          const ok = await U.confirmSub('删除密钥', `确定从密钥库删除「${k ? k.name : ''}」吗？\n引用该密钥的配置将需要重新选择密钥。`, '删除');
          if (!ok) return;
          const state = await window.api.keyDelete(id);
          App.setData(state);
          listEl2.innerHTML = rows();
        });
      }
      const imp = $('#km-import');
      if (imp) {
        imp.addEventListener('click', () => {
          importKeyDialog(() => {
            const l = $('#key-list');
            if (l) l.innerHTML = rows();
          });
        });
      }
    }, 20);
  }

  return { init, render, openEditor, importKeyDialog, openKeyManager };
})();
