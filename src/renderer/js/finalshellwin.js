'use strict';
(function () {
  const $ = (s) => document.querySelector(s);
  const esc = (s) => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  let paths = [];
  let pathKeys = new Set();
  let scan = null;
  let plan = null;
  let planSeq = 0;
  let groups = [];
  let dragDepth = 0;
  const isWin = window.api.platform === 'win32';

  function toast(msg) {
    const el = document.createElement('div');
    el.className = 'toast';
    el.textContent = msg;
    $('#toasts').appendChild(el);
    setTimeout(() => el.remove(), 2400);
  }

  function setStatus(text, kind) {
    const el = $('#status');
    el.textContent = text || '';
    el.className = 'status' + (kind ? ' ' + kind : '');
  }

  function pathKey(p) {
    return isWin ? String(p).toLowerCase() : String(p);
  }

  function addPaths(list) {
    let changed = false;
    for (const p of list || []) {
      if (!p) continue;
      const k = pathKey(p);
      if (pathKeys.has(k)) continue;
      pathKeys.add(k);
      paths.push(p);
      changed = true;
    }
    if (changed) refreshScan();
  }

  function removePath(p) {
    const k = pathKey(p);
    pathKeys.delete(k);
    paths = paths.filter((x) => pathKey(x) !== k);
    refreshScan();
  }

  async function refreshScan() {
    if (!paths.length) {
      scan = null;
      plan = null;
      renderSources();
      refreshPlan();
      return;
    }
    try {
      scan = await window.api.finalshellScan(paths);
    } catch (err) {
      scan = null;
      setStatus('扫描失败：' + (err && err.message ? err.message : err), 'error');
    }
    renderSources();
    refreshPlan();
  }

  function kindOf(p) {
    if (!scan) return { kind: '', name: p, path: p };
    const f = (scan.files || []).find((x) => pathKey(x.path) === pathKey(p));
    if (f) return { kind: 'JSON', name: f.name, path: f.path };
    const folder = findFolder(scan.folders || [], p);
    if (folder) return { kind: '文件夹', name: folder.name, path: folder.path, folder: true };
    return { kind: '', name: p, path: p };
  }

  function findFolder(list, p) {
    for (const n of list) {
      if (pathKey(n.path) === pathKey(p)) return n;
      const hit = findFolder(n.children || [], p);
      if (hit) return hit;
    }
    return null;
  }

  function renderSources() {
    const box = $('#sources');
    if (!paths.length) {
      box.innerHTML = '';
      return;
    }
    box.innerHTML = paths
      .map((p) => {
        const info = kindOf(p);
        return `<div class="source-row">
          <span class="source-kind${info.folder ? ' folder' : ''}">${esc(info.kind || '路径')}</span>
          <span class="source-name" title="${esc(p)}">${esc(info.name)}</span>
          <span class="source-path" title="${esc(p)}">${esc(p)}</span>
          <button class="source-del" data-remove="${esc(p)}" title="移除">✕</button>
        </div>`;
      })
      .join('');
    box.querySelectorAll('[data-remove]').forEach((btn) => {
      btn.addEventListener('click', () => removePath(btn.dataset.remove));
    });
  }

  async function refreshPlan() {
    const textEl = $('#plan-text');
    const btn = $('#do-import');
    const token = ++planSeq;
    if (!paths.length) {
      plan = null;
      textEl.classList.add('pending');
      textEl.textContent = '尚未选择文件';
      btn.disabled = true;
      return;
    }
    textEl.classList.remove('pending');
    textEl.textContent = '正在统计导入计划…';
    btn.disabled = true;
    try {
      const r = await window.api.finalshellPlan({
        paths,
        targetGroupId: $('#target-group').value || ''
      });
      if (token !== planSeq) return;
      plan = r;
      const c = r.counts || {};
      textEl.textContent = `预计：创建 ${c.l1 || 0} 个新一级分组　${c.l2 || 0} 个新二级分组　${c.l3 || 0} 个新三级分组　共 ${
        c.configs || 0
      } 个服务器配置`;
      btn.disabled = !(c.configs > 0);
    } catch (err) {
      if (token !== planSeq) return;
      plan = null;
      textEl.classList.add('pending');
      textEl.textContent = '统计失败：' + (err && err.message ? err.message : err);
      btn.disabled = true;
    }
  }

  function groupOptions() {
    const byParent = new Map();
    for (const g of groups) {
      const parentId = g.parentId && groups.some((x) => x.id === g.parentId) ? g.parentId : '';
      if (!byParent.has(parentId)) byParent.set(parentId, []);
      byParent.get(parentId).push(g);
    }
    byParent.forEach((arr) =>
      arr.sort((a, b) => {
        if (a.name === '待回收' || b.name === '待回收') return a.name === '待回收' ? 1 : -1;
        return String(a.name).localeCompare(String(b.name), 'zh-CN', { numeric: true });
      })
    );
    let html = '';
    const walk = (parentId, depth) => {
      for (const g of byParent.get(parentId) || []) {
        html += `<option value="${esc(g.id)}">${'　'.repeat(depth)}${depth ? '└ ' : ''}${esc(g.name)}</option>`;
        walk(g.id, depth + 1);
      }
    };
    walk('', 0);
    return html;
  }

  function fillGroups(state, keepValue) {
    groups = (state && state.groups) || [];
    const select = $('#target-group');
    const prev = keepValue !== undefined ? keepValue : select.value;
    select.innerHTML = '<option value="">自动：FinalShell 导入（直接 JSON）</option>' + groupOptions();
    if (prev && groups.some((g) => g.id === prev)) select.value = prev;
  }

  async function doImport() {
    if (!paths.length) return;
    const btn = $('#do-import');
    btn.disabled = true;
    setStatus('正在导入…');
    try {
      const r = await window.api.finalshellImport({
        paths,
        targetGroupId: $('#target-group').value || ''
      });
      const parts = [`新增 ${r.added}`];
      if (r.skipped) parts.push(`跳过 ${r.skipped}`);
      if (r.failed) parts.push(`失败 ${r.failed}`);
      if (r.noPassword) parts.push(`${r.noPassword} 个密码无法解密，已留空`);
      const c = r.created || {};
      const groupsText = ` · 新建分组：一级 ${c.l1 || 0} / 二级 ${c.l2 || 0} / 三级 ${c.l3 || 0}`;
      setStatus(`导入完成：${parts.join('，')}${groupsText}`, 'ok');
      toast('FinalShell 配置导入完成');
      fillGroups(r.state, $('#target-group').value);
      refreshPlan();
    } catch (err) {
      setStatus('导入失败：' + (err && err.message ? err.message : err), 'error');
    } finally {
      btn.disabled = false;
    }
  }

  function init() {
    window.api.getState().then((d) => fillGroups(d, '')).catch(() => {});
    $('#pick-files').addEventListener('click', async () => {
      const list = await window.api.finalshellPickFiles();
      addPaths(list);
    });
    $('#pick-folder').addEventListener('click', async () => {
      const p = await window.api.finalshellPickFolder();
      if (p) addPaths([p]);
    });
    $('#clear-sources').addEventListener('click', () => {
      paths = [];
      pathKeys.clear();
      scan = null;
      plan = null;
      setStatus('');
      renderSources();
      refreshPlan();
    });
    $('#target-group').addEventListener('change', refreshPlan);
    $('#do-import').addEventListener('click', doImport);
    $('#cancel').addEventListener('click', () => window.api.finalshellClose());
    $('#fclose').addEventListener('click', () => window.api.finalshellClose());
    $('#fmin').addEventListener('click', () => window.api.finalshellMinimize());
    $('#fmax').addEventListener('click', () => window.api.finalshellMaximize());
    $('#ftitle').addEventListener('dblclick', () => window.api.finalshellMaximize());

    const dz = $('#dropzone');
    window.addEventListener('dragover', (e) => e.preventDefault());
    window.addEventListener('drop', (e) => e.preventDefault());
    dz.addEventListener('dragenter', (e) => {
      e.preventDefault();
      dragDepth++;
      dz.classList.add('over');
    });
    dz.addEventListener('dragleave', (e) => {
      e.preventDefault();
      dragDepth = Math.max(0, dragDepth - 1);
      if (!dragDepth) dz.classList.remove('over');
    });
    dz.addEventListener('dragover', (e) => {
      e.preventDefault();
      if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy';
      dz.classList.add('over');
    });
    dz.addEventListener('drop', (e) => {
      e.preventDefault();
      dragDepth = 0;
      dz.classList.remove('over');
      const files = Array.from((e.dataTransfer && e.dataTransfer.files) || []);
      const list = files.map((f) => window.api.getPathForFile(f)).filter(Boolean);
      if (list.length) addPaths(list);
      else toast('没有读取到拖入的路径');
    });

    renderSources();
    refreshPlan();
  }

  document.addEventListener('DOMContentLoaded', init);
})();
