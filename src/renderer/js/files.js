'use strict';
/* 文件管理器（SFTP + 目录树，与终端 cd 联动） */
window.Files = (function () {
  const $ = U.qs;
  const tbody = $('#file-body');
  const pathInput = $('#file-path');
  const statusEl = $('#file-status');
  const selEl = $('#file-sel');
  const dropEl = $('#file-drop');
  const treeEl = $('#file-tree');

  const ICONS = {
    dir: '<svg width="13" height="13" viewBox="0 0 16 16" aria-hidden="true"><path d="M1.6 4.3c0-.7.6-1.3 1.3-1.3h3.1l1.4 1.5h5.7c.7 0 1.3.6 1.3 1.3v6.1c0 .7-.6 1.3-1.3 1.3H2.9c-.7 0-1.3-.6-1.3-1.3V4.3z" fill="#f0b429"/></svg>',
    file: '<svg width="13" height="13" viewBox="0 0 16 16" aria-hidden="true"><path d="M3.8 1.6h5L13 5.9v8.1c0 .3-.2.5-.5.5H3.8c-.3 0-.5-.2-.5-.5V2.1c0-.3.2-.5.5-.5z" fill="#dce3ee"/><path d="M8.8 1.6 13 5.9H9.3c-.3 0-.5-.2-.5-.5V1.6z" fill="#b8c5d8"/></svg>',
    link: '<svg width="13" height="13" viewBox="0 0 16 16" aria-hidden="true"><path d="M6.6 9.4 9.4 6.6" stroke="#7b8cf0" stroke-width="1.6" stroke-linecap="round"/><rect x="2.4" y="6.6" width="5" height="3.2" rx="1.6" fill="#a9b6f5"/><rect x="8.6" y="6.2" width="5" height="3.2" rx="1.6" fill="#7b8cf0"/></svg>'
  };

  let entries = [];
  let selection = new Set();
  let lastIndex = -1;
  let seq = 0;
  let treeRoot = null;
  let treeSessionId = null;

  /* ---------------- 初始化 ---------------- */

  function init() {
    document.querySelectorAll('#page-files [data-act]').forEach((btn) => {
      btn.addEventListener('click', (e) => handleAction(btn.dataset.act, e));
    });

    pathInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        navigate(pathInput.value.trim() || '/');
      }
    });

    tbody.addEventListener('click', onRowClick);
    tbody.addEventListener('dblclick', onRowDblClick);
    tbody.addEventListener('contextmenu', onRowContext);

    treeEl.addEventListener('click', onTreeClick);
    treeEl.addEventListener('contextmenu', onTreeContext);
    $('#btn-toggle-tree').addEventListener('click', (e) => {
      treeEl.classList.toggle('hidden');
      e.currentTarget.classList.toggle('active', !treeEl.classList.contains('hidden'));
      Term.fitActive();
    });

    App.on('active:change', (sess) => {
      closeFavorites();
      selection.clear();
      entries = [];
      if (!sess) {
        treeRoot = null;
        treeSessionId = null;
        renderTree();
        render();
        setStatus('未连接');
        return;
      }
      openSession(sess);
    });

    // 后台刷新完成（缓存先出、SFTP 后到）
    window.api.on('fs:dir', applyFreshDir);

    // 下载管理器入口
    const dlBtn = $('#btn-dl-manager');
    if (dlBtn) dlBtn.addEventListener('click', () => window.api.downloadsOpen());

    // 收藏文件夹入口
    const favBtn = $('#btn-fav-folders');
    if (favBtn) favBtn.addEventListener('click', () => openFavorites());

    // 拖拽上传
    dropEl.addEventListener('dragover', (e) => {
      e.preventDefault();
      dropEl.classList.add('dragover');
    });
    dropEl.addEventListener('dragleave', () => dropEl.classList.remove('dragover'));
    dropEl.addEventListener('drop', async (e) => {
      e.preventDefault();
      dropEl.classList.remove('dragover');
      const sess = App.active;
      if (!sess) return U.toast('请先连接服务器', 'error');
      const files = Array.from(e.dataTransfer.files || []);
      const paths = files.map((f) => window.api.getPathForFile(f)).filter(Boolean);
      if (!paths.length) return;
      try {
        const r = await window.api.fsUploadPaths({ sessionId: sess.id, remoteDir: sess.remotePath, paths });
        U.toast(`已上传 ${r.count} 个文件`, 'ok');
        refresh();
      } catch (err) {
        U.toast('上传失败: ' + U.cleanError(err), 'error');
      }
    });

    renderTree();
  }

  /* ---------------- 会话与加载 ---------------- */

  async function openSession(sess) {
    if (!sess || sess.status !== 'online' || !sess.term) {
      treeRoot = null;
      treeSessionId = null;
      entries = [];
      selection.clear();
      renderTree();
      render();
      setStatus(!sess ? '未连接' : sess.status === 'connecting' ? '正在连接…' : '连接已断开');
      return;
    }
    if (treeSessionId !== sess.id) {
      treeSessionId = sess.id;
      treeRoot = null;
    }
    try {
      if (!sess.remotePath) {
        sess.remotePath = await window.api.fsHome({ sessionId: sess.id });
      }
      if (App.active !== sess) return;
      await load(sess.remotePath);
    } catch (err) {
      setStatus('无法读取目录: ' + U.cleanError(err));
    }
  }

  /** 终端上报 cwd 时同步文件管理器（不反向发 cd，避免死循环） */
  function syncFromTerminal(path) {
    const sess = App.active;
    if (!sess || !path) return;
    sess.remotePath = path;
    load(path, { fromTerminal: true });
  }

  async function load(path, opts = {}) {
    const sess = App.active;
    if (!sess) return;
    const mySeq = ++seq;
    setStatus('加载中…');
    try {
      const res = await window.api.fsList({ sessionId: sess.id, path, refresh: !!opts.force });
      if (mySeq !== seq || App.active !== sess) return;
      sess.remotePath = res.path;
      entries = res.entries || [];
      selection.clear();
      lastIndex = -1;
      pathInput.value = res.path;
      render();
      setStatus(
        res.cached
          ? `${res.path} · ${entries.length} 项 · 缓存（正在后台刷新…）`
          : `${res.path} · ${entries.length} 项`
      );
      const stale = findNode(res.path);
      if (stale) stale.children = null;
      await ensureTreePath(res.path);
      if (mySeq !== seq) return;
      renderTree();
      if (opts.userAction) Term.cdTo(sess.id, res.path);
    } catch (err) {
      if (mySeq !== seq) return;
      setStatus('读取失败: ' + U.cleanError(err).split('\n')[0]);
      U.toast('读取目录失败：' + U.cleanError(err), 'error');
    }
  }

  function navigate(path, opts = {}) {
    return load(path, opts);
  }

  function refresh() {
    const sess = App.active;
    if (!sess || !sess.remotePath) return;
    load(sess.remotePath, { force: true });
  }

  /** 后台刷新完成：只更新当前目录的列表与对应树节点，不打断选中状态 */
  function applyFreshDir(payload) {
    const sess = App.active;
    if (!sess || !payload || payload.sessionId !== sess.id) return;
    const node = findNode(payload.path);
    if (node) {
      // 复用已有节点，保留子目录的展开状态，避免后台刷新把目录树收起来
      const prev = new Map((node.children || []).map((c) => [c.name, c]));
      node.children = (payload.entries || []).map((e) => {
        const old = prev.get(e.name);
        if (old && old.isDir === e.isDir) return Object.assign(old, { path: U.posix.join(payload.path, e.name) });
        return {
          path: U.posix.join(payload.path, e.name),
          name: e.name,
          isDir: e.isDir,
          expanded: false,
          children: null
        };
      });
      renderTree();
    }
    if (payload.path !== sess.remotePath) return;
    const keep = new Set(selection);
    entries = payload.entries || [];
    selection = new Set(entries.filter((f) => keep.has(f.name)).map((f) => f.name));
    render();
    setStatus(`${payload.path} · ${entries.length} 项`);
  }

  function setStatus(text) {
    statusEl.textContent = text;
  }

  /* ---------------- 目录树 ---------------- */

  function makeRoot() {
    return { path: '/', name: '/', isDir: true, expanded: true, children: null };
  }

  function findNode(path) {
    if (!treeRoot) return null;
    if (path === '/') return treeRoot;
    let node = treeRoot;
    let cur = '';
    for (const part of String(path).split('/').filter(Boolean)) {
      cur += '/' + part;
      if (!node.children) return null;
      const next = node.children.find((c) => c.path === cur);
      if (!next) return null;
      node = next;
    }
    return node;
  }

  async function loadNode(node) {
    const sess = App.active;
    if (!sess || node.loading || node.children) return;
    node.loading = true;
    try {
      const res = await window.api.fsList({ sessionId: sess.id, path: node.path });
      node.children = (res.entries || []).map((e) => ({
        path: U.posix.join(node.path, e.name),
        name: e.name,
        isDir: e.isDir,
        expanded: false,
        children: null
      }));
    } catch (_) {
      node.children = [];
    } finally {
      node.loading = false;
    }
  }

  /** 展开到指定路径（用于与终端联动） */
  async function ensureTreePath(path) {
    if (!treeRoot) treeRoot = makeRoot();
    if (!treeRoot.children) await loadNode(treeRoot);
    let node = treeRoot;
    let cur = '';
    for (const part of String(path).split('/').filter(Boolean)) {
      if (!node.children) await loadNode(node);
      if (!node.children) break;
      cur += '/' + part;
      const next = node.children.find((c) => c.path === cur);
      if (!next) break;
      next.expanded = true;
      node = next;
      if (node.isDir && !node.children) await loadNode(node);
    }
  }

  function renderTree() {
    if (!treeRoot) {
      treeEl.innerHTML = '<div class="tree-empty">未连接</div>';
      return;
    }
    const activePath = App.active ? App.active.remotePath : '';
    const rows = [];
    const walk = (node, depth) => {
      const active = node.path === activePath;
      const twisty = node.isDir
        ? `<button class="twisty" data-tw="${U.esc(node.path)}">${node.expanded ? '▾' : '▸'}</button>`
        : '<span class="twisty leaf"></span>';
      const icon = node.isDir ? ICONS.dir : ICONS.file;
      rows.push(
        `<div class="tnode${active ? ' active' : ''}" data-path="${U.esc(node.path)}" data-dir="${node.isDir ? 1 : 0}" style="padding-left:${depth * 12 + 3}px">
          ${twisty}<span class="tico">${icon}</span><span class="tlabel" title="${U.esc(node.path)}">${U.esc(node.name)}</span>
        </div>`
      );
      if (node.isDir && node.expanded && node.children) {
        node.children.slice(0, 350).forEach((c) => walk(c, depth + 1));
        if (node.children.length > 350) {
          rows.push(`<div class="tree-empty" style="padding-left:${depth * 12 + 20}px">… 其余 ${node.children.length - 350} 项</div>`);
        }
      }
    };
    walk(treeRoot, 0);
    treeEl.innerHTML = rows.join('');
  }

  /** 目录树：单击文件夹即进入（只切换文件管理目录，不向终端发送 cd）；箭头仍负责展开 / 折叠 */
  async function onTreeClick(e) {
    const nodeEl = e.target.closest('.tnode');
    if (!nodeEl) return;
    const node = findNode(nodeEl.dataset.path);
    if (!node) return;
    if (e.target.closest('.twisty')) {
      if (!node.isDir) return;
      node.expanded = !node.expanded;
      if (node.expanded) await loadNode(node);
      renderTree();
      return;
    }
    if (!node.isDir) return;
    node.expanded = true;
    await loadNode(node);
    renderTree();
    await navigate(node.path); // 单击进入：不发 cd
  }

  /** 目录树右键：刷新 / 进入 / CD / 新建 / 复制路径 / 展开 */
  function onTreeContext(e) {
    e.preventDefault();
    const nodeEl = e.target.closest('.tnode');
    const sess = App.active;
    if (!sess) return;
    const path = nodeEl ? nodeEl.dataset.path : '/';
    const node = nodeEl ? findNode(path) : null;
    const isDir = node ? node.isDir : true;
    const target = isDir ? path : U.posix.dirname(path);
    const items = [
      { label: '刷新', onClick: refresh },
      { label: '进入目录', onClick: () => navigate(target) },
      { label: 'CD 目录', onClick: () => navigate(target, { userAction: true }) },
      { label: '收藏此目录', onClick: () => addFavorite(target) },
      { sep: true },
      { label: '新建文件…', onClick: () => createFile(target) },
      { label: '新建文件夹…', onClick: () => mkdir(target) },
      { sep: true },
      { label: '复制路径', onClick: () => U.copy(path) },
      node && isDir && {
        label: node.expanded ? '折叠文件夹' : '展开文件夹',
        onClick: async () => {
          node.expanded = !node.expanded;
          if (node.expanded) await loadNode(node);
          renderTree();
        }
      }
    ].filter(Boolean);
    U.ctxMenu(items, e.clientX, e.clientY);
  }

  /* ---------------- 列表 ---------------- */

  function render() {
    if (!entries.length) {
      tbody.innerHTML = '<tr class="placeholder"><td colspan="4">目录为空</td></tr>';
      selEl.textContent = '';
      return;
    }
    tbody.innerHTML = entries
      .map((f, i) => {
        const cls = f.isDir ? 'dir' : f.isLink ? 'link' : 'file';
        const icon = ICONS[cls];
        return `<tr data-i="${i}" class="${selection.has(f.name) ? 'selected' : ''}">
          <td><div class="fname"><span class="ficon ${cls}">${icon}</span><span>${U.esc(f.name)}</span></div></td>
          <td class="size">${f.isDir ? '—' : U.fmtSizeCell(f.size)}</td>
          <td class="time">${U.fmtTime(f.mtime)}</td>
          <td class="perm">${U.esc(f.perms)}</td>
        </tr>`;
      })
      .join('');
    updateSelInfo();
  }

  function updateSelInfo() {
    selEl.textContent = selection.size ? `已选 ${selection.size} 项` : '';
  }

  function onRowClick(e) {
    const tr = e.target.closest('tr[data-i]');
    if (!tr) return;
    const idx = Number(tr.dataset.i);
    const f = entries[idx];
    if (!f) return;
    if (e.ctrlKey || e.metaKey) {
      selection.has(f.name) ? selection.delete(f.name) : selection.add(f.name);
    } else if (e.shiftKey && lastIndex >= 0) {
      const [a, b] = [Math.min(lastIndex, idx), Math.max(lastIndex, idx)];
      selection.clear();
      for (let i = a; i <= b; i++) selection.add(entries[i].name);
    } else {
      selection.clear();
      selection.add(f.name);
    }
    lastIndex = idx;
    updateRowSelection();
  }

  function updateRowSelection() {
    tbody.querySelectorAll('tr[data-i]').forEach((tr) => {
      const f = entries[Number(tr.dataset.i)];
      tr.classList.toggle('selected', !!(f && selection.has(f.name)));
    });
    updateSelInfo();
  }

  function onRowDblClick(e) {
    const tr = e.target.closest('tr[data-i]');
    if (!tr) return;
    const f = entries[Number(tr.dataset.i)];
    if (!f) return;
    if (f.isDir) navigate(U.posix.join(App.active.remotePath, f.name));
    else openInEditor(f);
  }

  /** 双击文件：用内置编辑器打开（仅文本、< 10MB） */
  function openInEditor(f) {
    const sess = App.active;
    if (!sess || !f) return;
    const path = U.posix.join(sess.remotePath, f.name);
    if (Number(f.size || 0) > 10 * 1024 * 1024) {
      return U.toast(`文件 ${U.fmtBytes(f.size)} 超过 10 MB，无法在线编辑`, 'error', 4200);
    }
    window.api.editorOpen({ sessionId: sess.id, path, name: f.name });
  }

  function onRowContext(e) {
    e.preventDefault();
    const tr = e.target.closest('tr[data-i]');
    if (tr) {
      const idx = Number(tr.dataset.i);
      const f = entries[idx];
      if (!selection.has(f.name)) {
        selection = new Set([f.name]);
        lastIndex = idx;
        updateRowSelection();
      }
    }
    const sess = App.active;
    if (!sess) return;
    const target = tr ? entries[Number(tr.dataset.i)] : null;
    // 操作目录：右键文件夹 → 该文件夹；右键文件/空白 → 当前目录
    const targetDir = target && target.isDir ? U.posix.join(sess.remotePath, target.name) : sess.remotePath;
    const items = [
      { label: '刷新', onClick: refresh },
      { label: '进入目录', onClick: () => navigate(targetDir) },
      { label: 'CD 目录', onClick: () => navigate(targetDir, { userAction: true }) },
      { label: '收藏此目录', onClick: () => addFavorite(targetDir) },
      { sep: true },
      { label: '下载所选', onClick: () => downloadSelection(selectedEntries()) },
      { label: '上传文件…', onClick: () => upload(targetDir) },
      { sep: true },
      { label: '重命名', disabled: !target, onClick: () => target && renameEntry(target) },
      { label: '新建文件…', onClick: () => createFile(targetDir) },
      { label: '新建文件夹…', onClick: () => mkdir(targetDir) },
      { sep: true },
      { label: '复制', onClick: copySelection },
      { label: '粘贴到当前目录', onClick: pasteHere },
      { label: '粘贴到该目录', disabled: !target, onClick: () => pasteInto(targetDir) },
      { sep: true },
      { sep: true },
      { label: '删除所选（普通）', danger: true, onClick: () => deleteSelection('plain') },
      { label: '删除所选（rm -f）', danger: true, onClick: () => deleteSelection('rmf') }
    ];
    U.ctxMenu(items, e.clientX, e.clientY);
  }

  function selectedEntries() {
    return entries.filter((f) => selection.has(f.name));
  }

  function handleAction(act, evt) {
    const sess = App.active;
    if (!sess) return U.toast('请先连接服务器', 'error');
    switch (act) {
      case 'up':
        if (sess.remotePath !== '/') navigate(U.posix.dirname(sess.remotePath));
        break;
      case 'refresh':
        refresh();
        break;
      case 'mkdir':
        mkdir();
        break;
      case 'upload':
        upload();
        break;
      case 'download':
        downloadSelection(selectedEntries());
        break;
      case 'copy':
        copySelection();
        break;
      case 'paste':
        pasteHere();
        break;
      case 'delete': {
        const rect = evt && evt.currentTarget ? evt.currentTarget.getBoundingClientRect() : { left: 300, bottom: 200 };
        U.ctxMenu(
          [
            { label: '删除（普通）', onClick: () => deleteSelection('plain') },
            { label: '删除（rm -f）', onClick: () => deleteSelection('rmf') }
          ],
          rect.left,
          rect.bottom + 4
        );
        break;
      }
    }
  }

  async function mkdir(dir) {
    const sess = App.active;
    if (!sess) return;
    const targetDir = dir || sess.remotePath;
    const name = await U.promptDialog('新建文件夹', '文件夹名称', '', 'new-folder');
    if (!name) return;
    const full = U.posix.join(targetDir, name);
    try {
      await window.api.fsMkdir({ sessionId: sess.id, path: full });
      U.toast('已创建 ' + full, 'ok');
      await afterDirMutation(targetDir);
    } catch (err) {
      U.toast('创建失败: ' + U.cleanError(err), 'error');
    }
  }

  /** 在指定目录创建空文件（右键哪个文件夹就建在哪个文件夹） */
  async function createFile(dir) {
    const sess = App.active;
    if (!sess) return;
    const targetDir = dir || sess.remotePath;
    const name = await U.promptDialog('新建文件', '文件名', '', '例如：app.log');
    if (!name) return;
    if (/[\/\\]/.test(name) || name === '.' || name === '..') {
      return U.toast('文件名不能包含路径分隔符', 'error');
    }
    const full = U.posix.join(targetDir, name);
    try {
      const list = await window.api.fsList({ sessionId: sess.id, path: targetDir });
      if ((list.entries || []).some((e) => e.name === name)) {
        throw new Error('目标目录已存在同名文件或文件夹');
      }
      await window.api.fsWrite({ sessionId: sess.id, path: full, content: '' });
      U.toast('已创建 ' + full, 'ok');
      await afterDirMutation(targetDir);
    } catch (err) {
      U.toast('创建失败: ' + U.cleanError(err), 'error');
    }
  }

  /** 目录内容变化后刷新列表或对应树节点 */
  async function afterDirMutation(dir) {
    const sess = App.active;
    if (!sess) return;
    if (dir === sess.remotePath) {
      refresh();
      return;
    }
    const node = findNode(dir);
    if (node) {
      node.children = null;
      if (node.expanded) await loadNode(node);
      renderTree();
    }
  }

  async function upload(dir) {
    const sess = App.active;
    if (!sess) return;
    const targetDir = dir || sess.remotePath;
    try {
      const r = await window.api.fsUpload({ sessionId: sess.id, remoteDir: targetDir });
      if (r && r.ok) {
        U.toast(`已上传 ${r.count} 个文件` + (targetDir === sess.remotePath ? '' : ` 到 ${targetDir}`), 'ok');
        await afterDirMutation(targetDir);
      }
    } catch (err) {
      U.toast('上传失败: ' + U.cleanError(err), 'error');
    }
  }

  async function downloadSelection(list) {
    const sess = App.active;
    if (!sess) return;
    if (!list.length) return U.toast('请先选择要下载的文件', 'error');
    try {
      const r = await window.api.fsDownload({
        sessionId: sess.id,
        items: list.map((f) => ({ path: U.posix.join(sess.remotePath, f.name), name: f.name, isDir: f.isDir }))
      });
      if (r && r.ok) U.toast(`下载完成，共 ${r.count} 项 → ${r.target}`, 'ok', 3600);
    } catch (err) {
      U.toast('下载失败: ' + U.cleanError(err), 'error', 4200);
    }
  }

  function copySelection() {
    const sess = App.active;
    if (!sess) return;
    const list = selectedEntries();
    if (!list.length) return U.toast('请先选择要复制的文件', 'error');
    App.state.clipboard = {
      sessionId: sess.id,
      paths: list.map((f) => U.posix.join(sess.remotePath, f.name)),
      names: list.map((f) => f.name)
    };
    U.toast(`已复制 ${list.length} 项，请到目标目录粘贴`, 'ok');
  }

  async function pasteHere() {
    const sess = App.active;
    if (!sess) return;
    await doPaste(sess, sess.remotePath);
  }

  async function pasteInto(dir) {
    const sess = App.active;
    if (!sess) return;
    await doPaste(sess, dir);
  }

  async function doPaste(sess, dest) {
    const cb = App.state.clipboard;
    if (!cb) return U.toast('剪贴板为空，请先复制', 'error');
    if (cb.sessionId !== sess.id) return U.toast('暂不支持跨服务器粘贴', 'error');
    try {
      await window.api.fsCopy({ sessionId: sess.id, sources: cb.paths, dest, move: false });
      U.toast(`已粘贴 ${cb.paths.length} 项`, 'ok');
      refresh();
    } catch (err) {
      U.toast('粘贴失败: ' + U.cleanError(err), 'error');
    }
  }

  async function renameEntry(entry) {
    const sess = App.active;
    if (!sess) return;
    const name = await U.promptDialog('重命名', '新名称', entry.name);
    if (!name || name === entry.name) return;
    try {
      await window.api.fsRename({
        sessionId: sess.id,
        from: U.posix.join(sess.remotePath, entry.name),
        to: U.posix.join(sess.remotePath, name)
      });
      U.toast('已重命名', 'ok');
      refresh();
    } catch (err) {
      U.toast('重命名失败: ' + U.cleanError(err), 'error');
    }
  }

  async function deletePaths(paths, mode) {
    const sess = App.active;
    if (!sess || !paths || !paths.length) return;
    if (paths.some((p) => p === '/')) return U.toast('不能删除根目录', 'error');
    const isPlain = mode !== 'rmf';
    const ok = await U.confirmDialog(
      '删除确认',
      `将删除 ${paths.length} 项：\n${paths.slice(0, 6).map((p) => '· ' + p).join('\n')}${
        paths.length > 6 ? '\n…' : ''
      }\n\n方式：${isPlain ? '普通删除（SFTP unlink / rmdir）' : 'rm -rf -- 命令删除'}\n该操作无法撤销。`,
      '删除'
    );
    if (!ok) return;
    try {
      if (isPlain) await window.api.fsDeletePlain({ sessionId: sess.id, paths });
      else await window.api.fsDelete({ sessionId: sess.id, paths });
      U.toast('已删除', 'ok');
      selection.clear();
      treeRoot = null;
      refresh();
    } catch (err) {
      U.toast('删除失败: ' + U.cleanError(err), 'error');
    }
  }

  async function deleteSelection(mode) {
    const sess = App.active;
    if (!sess) return;
    const list = selectedEntries();
    if (!list.length) return U.toast('请先选择要删除的文件', 'error');
    return deletePaths(
      list.map((f) => U.posix.join(sess.remotePath, f.name)),
      mode
    );
  }

  /* ---------------- 收藏文件夹 ---------------- */

  function favoriteServerKey(sess) {
    const c = (sess && sess.config) || {};
    return `${c.host || ''}:${c.port || 22}:${c.user || ''}`;
  }

  function favoriteConnId(sess) {
    return String((sess && sess.config && sess.config.id) || '');
  }

  /** 收藏是否属于当前会话：优先按配置 ID，兼容老数据按 host:port:user 匹配 */
  function favoriteOwns(f, sess) {
    if (!f) return false;
    const id = favoriteConnId(sess);
    if (id && f.connId === id) return true;
    return f.server === favoriteServerKey(sess);
  }

  function allFavorites() {
    return Array.isArray(App.settings.favorites) ? App.settings.favorites : [];
  }

  function favoritesFor(sess) {
    return allFavorites().filter((f) => favoriteOwns(f, sess));
  }

  function favoriteGroups() {
    return Array.isArray(App.settings.favoriteGroups) ? App.settings.favoriteGroups : [];
  }

  function sortedFavoriteGroups() {
    return favoriteGroups()
      .slice()
      .sort((a, b) => {
        const ao = Number(a.order);
        const bo = Number(b.order);
        const an = Number.isFinite(ao) ? ao : 0;
        const bn = Number.isFinite(bo) ? bo : 0;
        if (an !== bn) return an - bn;
        return String(a.name).localeCompare(String(b.name), 'zh-CN', { numeric: true });
      });
  }

  async function saveFavoriteState(patch) {
    const next = Object.assign({}, patch || {});
    const settings = await window.api.saveSettings(next);
    App.state.data.settings = Object.assign({}, App.state.data.settings, settings || {}, next);
  }

  function saveFavorites(list) {
    return saveFavoriteState({ favorites: Array.isArray(list) ? list : [] });
  }

  function favoriteName(path) {
    const p = String(path || '').replace(/\/+$/, '');
    if (!p) return '根目录';
    return p.split('/').pop() || '/';
  }

  async function addFavorite(path, sess, groupId) {
    const s = sess || App.active;
    if (!s) return U.toast('请先连接服务器', 'error');
    const target = String(path || s.remotePath || '/').trim() || '/';
    const list = allFavorites();
    const server = favoriteServerKey(s);
    if (list.some((f) => favoriteOwns(f, s) && f.path === target)) {
      return U.toast('此目录已在收藏中', 'info');
    }
    const item = {
      id: 'f-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 6),
      connId: favoriteConnId(s),
      server,
      host: s.config.host,
      port: s.config.port,
      user: s.config.user || '',
      name: favoriteName(target),
      path: target,
      groupId: groupId && favoriteGroups().some((g) => g.id === groupId) ? groupId : '',
      createdAt: Date.now()
    };
    try {
      await saveFavorites(list.concat(item));
      U.toast(`已收藏 ${target}`, 'ok');
    } catch (err) {
      U.toast('收藏失败: ' + U.cleanError(err), 'error');
    }
  }

  /* ---- 收藏面板：覆盖在文件管理区中央的弹窗 ---- */
  let favEl = null;
  let favSess = null;
  let favQuery = '';
  let favEdit = null;   // { kind: 'group' | 'fav', id } 行内编辑状态

  /** 打开前确保下方面板在「文件」页且未收起，这样弹窗才有正确的居中区域 */
  function ensureFileArea() {
    const page = document.getElementById('page-files');
    const tab = document.querySelector('.pane-tab[data-page="files"]');
    if (tab && page && !page.classList.contains('active')) tab.click();
    const pane = document.getElementById('bottom-pane');
    if (pane && pane.classList.contains('collapsed')) {
      const btn = document.getElementById('btn-collapse-bottom');
      if (btn) btn.click();
    }
  }

  function favRowHtml(f, groups) {
    if (favEdit && favEdit.kind === 'fav' && favEdit.id === f.id) {
      return `<div class="fav-row editing">
        <span class="fav-ico">★</span>
        <span class="fav-main fav-edit-main">
          <input class="fav-iname" data-fav-e-name="${f.id}" value="${U.esc(f.name)}" placeholder="显示名称" spellcheck="false" />
          <input class="fav-ipath" data-fav-e-path="${f.id}" value="${U.esc(f.path)}" placeholder="/绝对路径" spellcheck="false" />
        </span>
        <button class="btn sm primary" data-fav-save="${f.id}">保存</button>
        <button class="btn sm" data-fav-edit-cancel="1">取消</button>
      </div>`;
    }
    const options =
      '<option value="">未分组</option>' +
      groups
        .map((g) => `<option value="${g.id}"${f.groupId === g.id ? ' selected' : ''}>${U.esc(g.name)}</option>`)
        .join('');
    return `<div class="fav-row" data-fav-go="${f.id}" title="进入 ${U.esc(f.path)}">
      <span class="fav-ico">★</span>
      <span class="fav-main">
        <span class="fav-name">${U.esc(f.name)}</span>
        <span class="fav-path">${U.esc(f.path)}</span>
      </span>
      <select class="mini-select" data-fav-group-sel="${f.id}" title="移动到分组">${options}</select>
      <button class="icon-btn fav-x" data-fav-del="${f.id}" title="取消收藏">✕</button>
    </div>`;
  }

  function favoritePanelHtml() {
    if (!favSess) return '';
    const groups = sortedFavoriteGroups();
    const list = favoritesFor(favSess);
    const q = favQuery.trim().toLowerCase();
    const hit = (f) => !q || `${f.name || ''} ${f.path || ''}`.toLowerCase().includes(q);
    const byName = (a, b) => String(a.name).localeCompare(String(b.name), 'zh-CN', { numeric: true });

    const section = (title, gid, rows) => {
      const visible = rows.filter(hit).sort(byName);
      if (q && !visible.length) return '';
      const renaming = gid && favEdit && favEdit.kind === 'group' && favEdit.id === gid;
      const head = renaming
        ? `<div class="fav-gh editing">
            <span class="fav-gdot"></span>
            <input class="fav-ginput" id="fav-ginput" value="${U.esc(title)}" spellcheck="false" />
            <button class="btn sm primary" data-fg-rename-save="${gid}">保存</button>
            <button class="btn sm" data-fg-rename-cancel="1">取消</button>
          </div>`
        : `<div class="fav-gh" data-fg-head="${gid || ''}">
            <span class="fav-gdot"></span>
            <span class="fav-gname">${U.esc(title)}</span>
            <span class="fav-gcount">${visible.length}</span>
            <span class="pane-grow"></span>
            ${
              gid
                ? `<button class="icon-btn fav-gact" data-fg-add="${gid}" title="收藏当前文件夹到此分组">＋</button>
                   <button class="icon-btn fav-gact" data-fg-menu="${gid}" title="分组操作（排序 / 重命名 / 删除）">⋯</button>`
                : ''
            }
          </div>`;
      return `<div class="fav-group" data-fg="${gid || ''}">${head}
        <div class="fav-rows">${
          visible.length
            ? visible.map((f) => favRowHtml(f, groups)).join('')
            : '<div class="fav-empty" style="padding:12px 0">暂无收藏</div>'
        }</div>
      </div>`;
    };

    let html = '';
    if (list.length || groups.length) {
      html = groups.map((g) => section(g.name, g.id, list.filter((f) => f.groupId === g.id))).join('');
      const ungrouped = list.filter((f) => !groups.some((g) => g.id === f.groupId));
      if (ungrouped.length || !groups.length) html += section('未分组', '', ungrouped);
    }
    if (!list.length) {
      html = `<div class="fav-empty">还没有收藏文件夹<br/><span>在目录树或文件列表右键「收藏此目录」，也可以点上方「＋ 收藏当前」</span></div>`;
    } else if (q && !html.trim()) {
      html = `<div class="fav-empty">没有匹配「${U.esc(favQuery.trim())}」的收藏</div>`;
    }

    return html;
  }

  function positionFavDialog() {
    if (!favEl || !favEl.classList.contains('show')) return;
    const page = document.getElementById('page-files');
    const dlg = favEl.querySelector('.fav-dialog');
    if (!page || !dlg) return;
    const r = page.getBoundingClientRect();
    // 水平居中于文件管理区；高度按窗口给足，避免下面的文件区太矮时内容只剩一行
    const width = Math.max(380, Math.min(760, r.width - 48));
    const height = Math.max(300, Math.min(560, window.innerHeight - 120));
    // 以文件管理区中心为目标，但保证整个弹窗始终落在窗口内（下方文件区较矮时不会顶出屏幕）
    const cx = r.left + r.width / 2;
    const cy = r.top + r.height / 2;
    const left = Math.min(Math.max(cx, width / 2 + 12), window.innerWidth - width / 2 - 12);
    const top = Math.min(Math.max(cy, height / 2 + 12), window.innerHeight - height / 2 - 12);
    dlg.style.width = width + 'px';
    dlg.style.maxHeight = height + 'px';
    dlg.style.left = Math.round(left) + 'px';
    dlg.style.top = Math.round(top) + 'px';
  }

  function renderFavPanel() {
    if (!favEl || !favSess) return;
    const box = favEl.querySelector('#fav-list');
    if (box) box.innerHTML = favoritePanelHtml();
    const sub = favEl.querySelector('#fav-sub');
    if (sub) {
      const c = favSess.config || {};
      sub.textContent = `${c.user || ''}@${c.host || ''}:${c.port || 22} · 共 ${favoritesFor(favSess).length} 个收藏`;
    }
    positionFavDialog();
  }

  function closeFavorites() {
    if (!favEl) return;
    favEl.classList.remove('show');
    favSess = null;
    favQuery = '';
    favEdit = null;
  }

  function openFavorites() {
    const sess = App.active;
    if (!sess) return U.toast('请先连接服务器', 'error');
    ensureFileArea();
    ensureFavPanel();
    favSess = sess;
    favQuery = '';
    favEdit = null;
    const search = favEl.querySelector('#fav-search');
    if (search) search.value = '';
    renderFavPanel();
    favEl.classList.add('show');
    positionFavDialog();
    setTimeout(() => {
      const s = favEl.querySelector('#fav-search');
      if (s) s.focus();
    }, 30);
  }

  async function createFavGroup() {
    const input = favEl.querySelector('#fav-group-input');
    const name = input ? input.value.trim() : '';
    if (!name) return U.toast('请输入分组名称', 'error');
    if (favoriteGroups().some((g) => g.name === name)) return U.toast('分组名称已存在', 'error');
    try {
      await saveFavoriteState({
        favoriteGroups: favoriteGroups().concat({
          id: 'fg-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 6),
          name,
          order: favoriteGroups().length
        })
      });
      renderFavPanel();
      if (input) input.value = '';
      U.toast(`已创建分组「${name}」`, 'ok');
    } catch (err) {
      U.toast('创建分组失败: ' + U.cleanError(err), 'error');
    }
  }

  function normalizeGroupOrder(list) {
    return list.map((g, i) => Object.assign({}, g, { order: i }));
  }

  function startFavEdit(kind, id) {
    favEdit = { kind, id };
    renderFavPanel();
    setTimeout(() => {
      const box = favEl && favEl.querySelector(kind === 'group' ? '.fav-ginput' : '[data-fav-e-name]');
      if (box) {
        box.focus();
        if (box.select) box.select();
      }
    }, 30);
  }

  function cancelFavEdit() {
    favEdit = null;
    renderFavPanel();
  }

  async function moveFavGroup(gid, dir) {
    const list = sortedFavoriteGroups();
    const i = list.findIndex((g) => g.id === gid);
    const j = i + dir;
    if (i < 0 || j < 0 || j >= list.length) return;
    const arr = list.slice();
    const [item] = arr.splice(i, 1);
    arr.splice(j, 0, item);
    try {
      await saveFavoriteState({ favoriteGroups: normalizeGroupOrder(arr) });
      renderFavPanel();
    } catch (err) {
      U.toast('排序失败: ' + U.cleanError(err), 'error');
    }
  }

  async function saveGroupRename(gid) {
    const input = favEl.querySelector('.fav-ginput');
    const name = input ? input.value.trim() : '';
    if (!name) return U.toast('请输入分组名称', 'error');
    if (favoriteGroups().some((g) => g.id !== gid && g.name === name)) {
      return U.toast('分组名称已存在', 'error');
    }
    try {
      await saveFavoriteState({
        favoriteGroups: favoriteGroups().map((g) => (g.id === gid ? Object.assign({}, g, { name }) : g))
      });
      favEdit = null;
      renderFavPanel();
    } catch (err) {
      U.toast('重命名失败: ' + U.cleanError(err), 'error');
    }
  }

  async function deleteFavGroup(gid) {
    const g = favoriteGroups().find((x) => x.id === gid);
    if (!g) return;
    const ok = await U.confirmSub('删除收藏分组', `确定删除分组「${g.name}」吗？\n组内收藏会变为未分组。`, '删除');
    if (!ok) return;
    try {
      await saveFavoriteState({
        favoriteGroups: favoriteGroups().filter((x) => x.id !== g.id),
        favorites: allFavorites().map((f) => (f.groupId === g.id ? Object.assign({}, f, { groupId: '' }) : f))
      });
      renderFavPanel();
    } catch (err) {
      U.toast('删除失败: ' + U.cleanError(err), 'error');
    }
  }

  async function deleteFavorite(f) {
    const ok = await U.confirmSub('取消收藏', `确定取消收藏「${f.name}」吗？`, '取消收藏');
    if (!ok) return;
    try {
      await saveFavorites(allFavorites().filter((x) => x.id !== f.id));
      renderFavPanel();
    } catch (err) {
      U.toast('操作失败: ' + U.cleanError(err), 'error');
    }
  }

  async function saveFavEdit(id) {
    const nameInput = favEl.querySelector('[data-fav-e-name]');
    const pathInput = favEl.querySelector('[data-fav-e-path]');
    let path = (pathInput ? pathInput.value : '').trim();
    let name = (nameInput ? nameInput.value : '').trim();
    if (!path) return U.toast('请输入文件夹路径', 'error');
    if (!path.startsWith('/')) path = '/' + path;
    path = path.replace(/\/+$/, '') || '/';
    if (!name) name = favoriteName(path);
    const cur = allFavorites().find((x) => x.id === id);
    if (!cur) return;
    if (allFavorites().some((x) => x.id !== id && x.server === cur.server && x.path === path)) {
      return U.toast('该目录已在收藏中', 'info');
    }
    try {
      await saveFavorites(allFavorites().map((x) => (x.id === id ? Object.assign({}, x, { name, path }) : x)));
      favEdit = null;
      renderFavPanel();
    } catch (err) {
      U.toast('保存失败: ' + U.cleanError(err), 'error');
    }
  }

  function goFavorite(f) {
    closeFavorites();
    // 仅文件管理跳转，不向终端注入 cd
    navigate(f.path);
  }

  function copyFavPath(f) {
    const text = String(f.path || '');
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(() => U.toast('已复制路径', 'ok')).catch(() => U.toast('复制失败', 'error'));
    } else {
      U.copy(text);
    }
  }

  function openFavGroupMenu(gid, x, y) {
    const list = sortedFavoriteGroups();
    const idx = list.findIndex((g) => g.id === gid);
    if (idx < 0) return;
    U.ctxMenu(
      [
        { label: '上移分组', disabled: idx <= 0, onClick: () => moveFavGroup(gid, -1) },
        { label: '下移分组', disabled: idx >= list.length - 1, onClick: () => moveFavGroup(gid, 1) },
        { label: '重命名分组…', onClick: () => startFavEdit('group', gid) },
        { sep: true },
        { label: '收藏当前文件夹到此分组', onClick: () => addFavorite(favSess && favSess.remotePath, favSess, gid).then(renderFavPanel) },
        { sep: true },
        { label: '删除分组', danger: true, onClick: () => deleteFavGroup(gid) }
      ],
      x,
      y
    );
  }

  function openFavRowMenu(f, x, y) {
    U.ctxMenu(
      [
        { label: '进入此文件夹', onClick: () => goFavorite(f) },
        { label: '复制路径', onClick: () => copyFavPath(f) },
        { label: '修改名称 / 路径…', onClick: () => startFavEdit('fav', f.id) },
        { sep: true },
        { label: '取消收藏', danger: true, onClick: () => deleteFavorite(f) }
      ],
      x,
      y
    );
  }

  async function onFavClick(e) {
    if (e.target.closest('#fav-close') || e.target.closest('#fav-done')) return closeFavorites();

    if (e.target.closest('#fav-add-current')) {
      await addFavorite(favSess && favSess.remotePath, favSess);
      renderFavPanel();
      return;
    }
    if (e.target.closest('#fav-group-create')) {
      await createFavGroup();
      return;
    }
    if (e.target.closest('[data-fav-edit-cancel]') || e.target.closest('[data-fg-rename-cancel]')) {
      cancelFavEdit();
      return;
    }
    const saveGroup = e.target.closest('[data-fg-rename-save]');
    if (saveGroup) {
      await saveGroupRename(saveGroup.dataset.fgRenameSave);
      return;
    }
    const saveFav = e.target.closest('[data-fav-save]');
    if (saveFav) {
      await saveFavEdit(saveFav.dataset.favSave);
      return;
    }
    const groupMenu = e.target.closest('[data-fg-menu]');
    if (groupMenu) {
      const r = groupMenu.getBoundingClientRect();
      openFavGroupMenu(groupMenu.dataset.fgMenu, r.left, r.bottom + 4);
      return;
    }

    const del = e.target.closest('[data-fav-del]');
    if (del) {
      const f = allFavorites().find((x) => x.id === del.dataset.favDel);
      if (f) await deleteFavorite(f);
      return;
    }

    const addTo = e.target.closest('[data-fg-add]');
    if (addTo) {
      await addFavorite(favSess && favSess.remotePath, favSess, addTo.dataset.fgAdd);
      renderFavPanel();
      return;
    }

    const delGroup = e.target.closest('[data-fg-del]');
    if (delGroup) {
      await deleteFavGroup(delGroup.dataset.fgDel);
      return;
    }

    const row = e.target.closest('[data-fav-go]');
    if (!row) return;
    if (e.target.closest('button, select, input')) return;
    const f = allFavorites().find((x) => x.id === row.dataset.favGo);
    if (f) goFavorite(f);
  }

  async function onFavChange(e) {
    const sel = e.target.closest('[data-fav-group-sel]');
    if (!sel) return;
    const gid = sel.value;
    try {
      await saveFavorites(
        allFavorites().map((f) => (f.id === sel.dataset.favGroupSel ? Object.assign({}, f, { groupId: gid }) : f))
      );
      renderFavPanel();
    } catch (err) {
      U.toast('移动分组失败: ' + U.cleanError(err), 'error');
    }
  }

  function ensureFavPanel() {
    if (favEl) return favEl;
    favEl = document.createElement('div');
    favEl.className = 'fav-overlay';
    favEl.id = 'fav-overlay';
    favEl.innerHTML = `
      <div class="fav-dialog" role="dialog" aria-modal="true" aria-label="收藏文件夹">
        <div class="fav-head">
          <span class="fav-head-ico">★</span>
          <div class="fav-head-main">
            <div class="fav-title">收藏文件夹</div>
            <div class="fav-sub" id="fav-sub"></div>
          </div>
          <button class="icon-btn" id="fav-close" title="关闭（Esc）">✕</button>
        </div>
        <div class="fav-tools">
          <input class="fav-search" id="fav-search" type="text" spellcheck="false" placeholder="搜索名称或路径…" />
          <button class="btn sm" id="fav-add-current">＋ 收藏当前</button>
          <button class="btn sm" id="fav-new-group">＋ 新建分组</button>
        </div>
        <div class="fav-content" id="fav-list"></div>
        <div class="fav-newbar" id="fav-newbar">
          <input id="fav-group-input" type="text" spellcheck="false" placeholder="新建收藏分组（仅一级，会随云同步）" />
          <button class="btn sm primary" id="fav-group-create">创建分组</button>
        </div>
        <div class="fav-foot">
          <span id="fav-hint">收藏只对当前服务器生效；分组最多一级，并会随云同步合并</span>
          <span class="pane-grow"></span>
          <button class="btn sm" id="fav-done">完成</button>
        </div>
      </div>`;
    document.body.appendChild(favEl);

    favEl.addEventListener('click', onFavClick);
    favEl.addEventListener('change', onFavChange);
    // 右键菜单：分组头 → 排序 / 重命名 / 删除；收藏行 → 进入 / 复制路径 / 修改 / 删除
    favEl.addEventListener('contextmenu', (e) => {
      const row = e.target.closest('.fav-row[data-fav-go]');
      if (row) {
        const f = allFavorites().find((x) => x.id === row.dataset.favGo);
        if (!f) return;
        e.preventDefault();
        openFavRowMenu(f, e.clientX, e.clientY);
        return;
      }
      const head = e.target.closest('.fav-gh[data-fg-head]');
      const gid = head && head.dataset.fgHead;
      if (gid) {
        e.preventDefault();
        openFavGroupMenu(gid, e.clientX, e.clientY);
      }
    });
    // 行内编辑：回车保存
    favEl.addEventListener('keydown', (e) => {
      if (e.key !== 'Enter' || !favEdit) return;
      if (e.target.closest('.fav-ginput')) {
        e.preventDefault();
        saveGroupRename(favEdit.id);
        return;
      }
      if (e.target.closest('[data-fav-e-name], [data-fav-e-path]')) {
        e.preventDefault();
        saveFavEdit(favEdit.id);
      }
    });
    favEl.addEventListener('input', (e) => {
      if (e.target.id !== 'fav-search') return;
      favQuery = e.target.value;
      renderFavPanel();
    });
    favEl.addEventListener('click', (e) => {
      if (!e.target.closest('#fav-new-group')) return;
      const input = favEl.querySelector('#fav-group-input');
      if (input) {
        input.focus();
        if (input.scrollIntoView) input.scrollIntoView({ block: 'nearest' });
      }
    });
    document.addEventListener(
      'keydown',
      (e) => {
        if (e.key === 'Escape' && favEl.classList.contains('show')) {
          e.preventDefault();
          if (favEdit) cancelFavEdit();
          else closeFavorites();
        }
      },
      true
    );
    window.addEventListener('resize', positionFavDialog);
    return favEl;
  }

  return { init, refresh, load, navigate, syncFromTerminal, openFavorites };
})();
