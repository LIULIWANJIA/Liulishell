'use strict';
/* 快捷命令：板块 + 命令项 */
window.Snippets = (function () {
  const $ = U.qs;
  let activeBoard = null;

  function boards() {
    return App.state.data.snippetBoards || [];
  }

  function currentBoard() {
    const list = boards();
    if (!list.length) return null;
    return list.find((b) => b.id === activeBoard) || list[0];
  }

  function defaultAutoRun() {
    const v = App.settings.snippetAutoRunDefault;
    return v === undefined ? true : !!v;
  }

  function init() {
    $('#btn-add-board').addEventListener('click', addBoard);
    $('#btn-add-snippet').addEventListener('click', () => openEditor(null));

    // 「新命令直接执行」开关已移到每条命令的编辑弹窗内，头部不再显示
    const chk = $('#snip-default-autorun');
    if (chk) {
      chk.checked = defaultAutoRun();
      chk.addEventListener('change', () => {
        window.api.saveSettings({ snippetAutoRunDefault: chk.checked });
        App.state.data.settings.snippetAutoRunDefault = chk.checked;
      });
    }

    // 发送目标（快捷命令 / 编辑器 / 命令栏共用，切换后全局保存）
    const snipTarget = $('#snip-target');
    const editorTarget = $('#editor-target');
    const syncTargets = () => {
      const v = App.state.sendTarget || 'current';
      if (snipTarget) snipTarget.value = v;
      if (editorTarget) editorTarget.value = v;
    };
    [snipTarget, editorTarget].forEach((sel) => {
      if (sel) sel.addEventListener('change', () => App.setSendTarget(sel.value));
    });
    App.on('target:change', syncTargets);
    App.on('data:change', syncTargets);
    syncTargets();

    const editor = $('#editor-text');
    $('#editor-send').addEventListener('click', sendEditor);
    editor.addEventListener('keydown', (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
        e.preventDefault();
        sendEditor();
      }
    });

    App.on('data:change', () => {
      if (!currentBoard() && boards().length) activeBoard = boards()[0].id;
      render();
    });

    window.addEventListener('resize', U.debounce(layoutBoardRows, 100));
    const head = $('#snip-head');
    if (head) {
      let width = head.clientWidth;
      const ro = new ResizeObserver(
        U.debounce(() => {
          const w = head.clientWidth;
          if (Math.abs(w - width) > 1) {
            width = w;
            layoutBoardRows();
          }
        }, 80)
      );
      ro.observe(head);
    }
  }

  /**
   * 板块自动分行：第一行给右上角控制区留出宽度，后续行占满整行。
   * 控制区是绝对定位的，不会随板块换行而移动。
   */
  function layoutBoardRows() {
    const box = $('#board-tabs');
    const controls = $('#snip-controls');
    if (!box || !controls) return;
    const all = Array.from(box.querySelectorAll('.board-tab'));
    const widths = all.map((el) => el.getBoundingClientRect().width);
    box.innerHTML = '';
    if (!all.length) return;
    const full = box.clientWidth;
    if (full <= 0) {
      const row = document.createElement('div');
      row.className = 'board-row';
      all.forEach((tab) => row.appendChild(tab));
      box.appendChild(row);
      return;
    }
    const firstMax = Math.max(120, full - controls.offsetWidth - 8);
    let row = document.createElement('div');
    row.className = 'board-row';
    box.appendChild(row);
    let used = 0;
    let max = firstMax;
    for (let i = 0; i < all.length; i++) {
      const w = widths[i] || 80;
      if (used > 0 && used + w > max + 0.5) {
        row = document.createElement('div');
        row.className = 'board-row';
        box.appendChild(row);
        used = 0;
        max = full;
      }
      row.appendChild(all[i]);
      used += w + 4;
    }
  }

  let dragId = null;

  function render() {
    const list = boards();
    if (!activeBoard && list.length) activeBoard = list[0].id;
    const board = currentBoard();

    const tabs = $('#board-tabs');
    tabs.innerHTML =
      '<div class="board-row">' +
      list
        .map(
          (b) =>
            `<button class="board-tab${board && b.id === board.id ? ' active' : ''}" data-bid="${b.id}" title="${U.esc(
              b.name
            )}（${(b.items || []).length} 条）">${U.esc(b.name)}</button>`
        )
        .join('') +
      '</div>';

    tabs.querySelectorAll('.board-tab').forEach((tab) => {
      tab.addEventListener('click', () => {
        activeBoard = tab.dataset.bid;
        render();
      });
      tab.addEventListener('contextmenu', (e) => {
        e.preventDefault();
        const b = boards().find((x) => x.id === tab.dataset.bid);
        if (!b) return;
        U.ctxMenu(
          [
            { label: '重命名板块', onClick: () => renameBoard(b) },
            {
              label: '新增命令到该板块',
              onClick: () => {
                activeBoard = b.id;
                render();
                openEditor(null);
              }
            },
            { sep: true },
            { label: '删除板块', danger: true, onClick: () => deleteBoard(b) }
          ],
          e.clientX,
          e.clientY
        );
      });
    });

    layoutBoardRows();

    const wrap = $('#snip-list');
    if (!board) {
      wrap.innerHTML = '<div class="snip-empty">还没有板块，点击「＋ 板块」创建</div>';
      return;
    }
    if (!board.items || !board.items.length) {
      wrap.innerHTML = '<div class="snip-empty">该板块还没有命令，点击「＋ 快捷命令」添加</div>';
      return;
    }
    // 按钮固定宽度，只显示名称；完整命令放在 title 里，拖动可排序
    wrap.innerHTML = board.items
      .map(
        (it) => `<div class="snip-item${it.autoRun ? '' : ' manual'}" data-id="${it.id}" draggable="true" title="${U.esc(
          it.command
        )}">
          <span class="s-name">${U.esc(it.name)}</span>
        </div>`
      )
      .join('');

    wrap.querySelectorAll('.snip-item').forEach((item) => {
      item.addEventListener('click', () => {
        if (dragId) return; // 拖动结束后的这次 click 不触发执行
        const data = board.items.find((x) => x.id === item.dataset.id);
        if (!data) return;
        // 全局开关「允许单击命令直接运行」关闭时，单击一律只填入编辑器，不直接执行
        const allowRun = App.settings.snippetClickRun !== false;
        if (data.autoRun && allowRun) {
          Term.runSnippet(data.command, true);
        } else if (!data.autoRun) {
          Term.runSnippet(data.command, false); // 该命令本身是「仅填入」模式
        } else {
          fillEditor(data.command); // 原本会直接运行，但被全局开关禁用 → 填编辑器
        }
      });
      item.addEventListener('contextmenu', (e) => {
        e.preventDefault();
        const data = board.items.find((x) => x.id === item.dataset.id);
        if (!data) return;
        U.ctxMenu(
          [
            { label: '立即执行', onClick: () => Term.runSnippet(data.command, true) },
            { label: '填入命令编辑器', onClick: () => fillEditor(data.command) },
            { sep: true },
            { label: '编辑', onClick: () => openEditor(data) },
            {
              label: '复制命令',
              onClick: () => navigator.clipboard.writeText(data.command).then(() => U.toast('命令已复制', 'ok'))
            },
            { label: '删除', danger: true, onClick: () => deleteSnippet(board, data) }
          ],
          e.clientX,
          e.clientY
        );
      });

      /* ---- 拖动排序 ---- */
      item.addEventListener('dragstart', (e) => {
        dragId = item.dataset.id;
        e.dataTransfer.effectAllowed = 'move';
        try {
          e.dataTransfer.setData('text/plain', dragId);
        } catch (_) {}
        setTimeout(() => item.classList.add('dragging'), 0);
      });
      item.addEventListener('dragend', () => {
        dragId = null;
        wrap.querySelectorAll('.snip-item').forEach((n) => n.classList.remove('dragging', 'drop-before', 'drop-after'));
      });
      item.addEventListener('dragover', (e) => {
        if (!dragId || dragId === item.dataset.id) return;
        e.preventDefault();
        e.dataTransfer.dropEffect = 'move';
        const r = item.getBoundingClientRect();
        const after = e.clientX > r.left + r.width / 2;
        item.classList.toggle('drop-after', after);
        item.classList.toggle('drop-before', !after);
      });
      item.addEventListener('dragleave', () => item.classList.remove('drop-before', 'drop-after'));
      item.addEventListener('drop', async (e) => {
        e.preventDefault();
        const targetId = item.dataset.id;
        item.classList.remove('drop-before', 'drop-after');
        if (!dragId || dragId === targetId) return;
        const r = item.getBoundingClientRect();
        const after = e.clientX > r.left + r.width / 2;
        const items = board.items.slice();
        const from = items.findIndex((x) => x.id === dragId);
        if (from < 0) return;
        const [moved] = items.splice(from, 1);
        let to = items.findIndex((x) => x.id === targetId);
        if (to < 0) to = items.length;
        if (after) to += 1;
        items.splice(to, 0, moved);
        board.items = items;
        dragId = null;
        await persist();
        render();
      });
    });
  }

  /** 把命令填进右下角命令编辑器（已有内容则另起一行，不覆盖手写内容） */
  function fillEditor(command) {
    const ta = $('#editor-text');
    if (!ta) return U.toast('找不到命令编辑器，请先在设置里显示它', 'error');
    const text = String(command || '');
    const cur = String(ta.value || '');
    if (!cur.trim()) ta.value = text;
    else if (cur.endsWith('\n')) ta.value = cur + text;
    else ta.value = cur + '\n' + text;
    ta.focus();
    try {
      ta.setSelectionRange(ta.value.length, ta.value.length);
    } catch (_) {}
    U.toast('已填入命令编辑器', 'ok', 1400);
  }

  function sendEditor() {
    const ta = $('#editor-text');
    const text = String(ta.value || '').replace(/\s+$/, '');
    if (!text.trim()) return U.toast('请先输入命令', 'error');
    const count = Term.sendRaw(text.replace(/\r?\n/g, '\r'));
    if (count) U.toast(`已发送到 ${count} 个会话`, 'ok', 1600);
  }

  async function persist() {
    try {
      const data = await window.api.saveSnippets(App.state.data.snippetBoards);
      App.setData(data);
    } catch (err) {
      U.toast(err.message, 'error');
    }
  }

  async function addBoard() {
    const name = await U.promptDialog('新增板块', '板块名称', '', '例如：数据库');
    if (!name) return;
    const id = 'b-' + Date.now().toString(36);
    App.state.data.snippetBoards.push({ id, name, items: [] });
    activeBoard = id;
    await persist();
    render();
  }

  async function renameBoard(board) {
    const name = await U.promptDialog('重命名板块', '板块名称', board.name);
    if (!name) return;
    board.name = name;
    await persist();
    render();
  }

  async function deleteBoard(board) {
    const ok = await U.confirmDialog('删除板块', `确定删除板块「${board.name}」及其中的 ${board.items.length} 条命令吗？`, '删除');
    if (!ok) return;
    App.state.data.snippetBoards = boards().filter((b) => b.id !== board.id);
    activeBoard = null;
    await persist();
    render();
  }

  function editorBody(item) {
    const list = boards();
    return `
      <div class="form-row">
        <div class="field" style="flex:1.2"><label>名称 <span class="req">*</span></label>
          <input id="s-name" type="text" value="${U.esc(item ? item.name : '')}" placeholder="例如：查看磁盘"></div>
        <div class="field"><label>所属板块</label>
          <select id="s-board">${list
            .map(
              (b) =>
                `<option value="${b.id}"${(item && item.boardId === b.id) || (!item && currentBoard() && currentBoard().id === b.id) ? ' selected' : ''}>${U.esc(
                  b.name
                )}</option>`
            )
            .join('')}</select></div>
      </div>
      <div class="form-row">
        <div class="field"><label>命令 <span class="req">*</span></label>
          <textarea id="s-cmd" rows="4" spellcheck="false" placeholder="df -h">${U.esc(item ? item.command : '')}</textarea>
        </div>
      </div>
      <div class="form-row" style="margin-bottom:0">
        <label class="check-inline"><input type="checkbox" id="s-run" ${
          item ? (item.autoRun ? 'checked' : '') : defaultAutoRun() ? 'checked' : ''
        }> 点击后直接执行（自动追加回车）</label>
      </div>`;
  }

  function openEditor(item) {
    const board = currentBoard();
    if (!boards().length) return U.toast('请先创建板块', 'error');
    const editItem = item ? Object.assign({ boardId: board.id }, item) : null;
    let targetBoardId = board.id;

    U.openModal({
      title: item ? '编辑快捷命令' : '新增快捷命令',
      width: '540px',
      body: editorBody(editItem),
      onOk: async () => {
        const name = $('#s-name').value.trim();
        const command = $('#s-cmd').value.trim();
        const autoRun = $('#s-run').checked;
        targetBoardId = $('#s-board').value;
        if (!name) throw new Error('请填写名称');
        if (!command) throw new Error('请填写命令');

        if (item) {
          for (const b of boards()) b.items = (b.items || []).filter((x) => x.id !== item.id);
          const dest = boards().find((b) => b.id === targetBoardId) || boards()[0];
          dest.items.push({ id: item.id, name, command, autoRun });
        } else {
          const dest = boards().find((b) => b.id === targetBoardId) || boards()[0];
          dest.items.push({ id: 's-' + Date.now().toString(36), name, command, autoRun });
        }
        activeBoard = targetBoardId;
        await persist();
        render();
        U.toast(item ? '命令已更新' : '命令已添加', 'ok');
      }
    });
  }

  async function deleteSnippet(board, item) {
    const ok = await U.confirmDialog('删除命令', `确定删除「${item.name}」吗？`, '删除');
    if (!ok) return;
    board.items = board.items.filter((x) => x.id !== item.id);
    await persist();
    render();
  }

  return { init, render };
})();
