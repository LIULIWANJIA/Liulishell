'use strict';
/* 命令历史：持久化、历史弹窗（点选复制 / 删除 / 清空 / 筛选） */
window.History = (function () {
  const $ = U.qs;
  let list = []; // 最新在前

  async function init() {
    try {
      list = (await window.api.historyList()) || [];
    } catch (_) {
      list = [];
    }
    const btn = $('#btn-history');
    if (btn) btn.addEventListener('click', openDialog);
    document.addEventListener('keydown', (e) => {
      if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key.toLowerCase() === 'h') {
        e.preventDefault();
        openDialog();
      }
    });
  }

  /** ↑↓ 需要的顺序：最旧 → 最新 */
  function commands() {
    return list.map((x) => x.cmd).reverse();
  }

  async function record(cmd) {
    try {
      list = (await window.api.historyAdd(cmd)) || list;
      App.emit('history:change', list);
    } catch (_) {}
  }

  async function remove(id) {
    try {
      list = (await window.api.historyDelete(id)) || [];
      App.emit('history:change', list);
      return list;
    } catch (err) {
      U.toast(U.cleanError(err), 'error');
      return list;
    }
  }

  async function clear() {
    try {
      list = (await window.api.historyClear()) || [];
      App.emit('history:change', list);
      return list;
    } catch (err) {
      U.toast(U.cleanError(err), 'error');
      return list;
    }
  }

  function timeText(ts) {
    if (!ts) return '';
    const d = new Date(ts);
    const p = (n) => String(n).padStart(2, '0');
    return `${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
  }

  function pick(cmd, closeAfter) {
    navigator.clipboard.writeText(cmd).then(
      () => U.toast('已复制到剪贴板', 'ok', 1400),
      () => U.toast('复制失败', 'error')
    );
    const input = $('#cmd-input');
    if (input) {
      input.value = cmd;
      input.focus();
      input.setSelectionRange(cmd.length, cmd.length);
    }
    if (closeAfter) $('#modal-cancel').click();
  }

  function openDialog() {
    // 打开前先从本地配置重新读一遍：无论命令是从终端直接敲的、命令栏发的还是快捷命令执行的，
    // 只要已落盘就一定能在这里看到（也顺带修正模块内缓存的滞后）
    window.api
      .historyList()
      .then((fresh) => {
        if (Array.isArray(fresh)) {
          list = fresh;
          App.emit('history:change', list);
        }
      })
      .catch(() => {})
      .then(() => renderDialog());
  }

  function renderDialog() {
    const render = (filter) => {
      const box = $('#his-list');
      const counter = $('#his-count');
      if (!box) return;
      const kw = String(filter || '').trim().toLowerCase();
      const rows = list.filter((x) => !kw || x.cmd.toLowerCase().includes(kw));
      counter.textContent = `共 ${list.length} 条${kw ? ` · 匹配 ${rows.length} 条` : ''}`;
      if (!rows.length) {
        box.innerHTML = `<div class="his-empty">${kw ? '没有匹配的命令' : '暂无历史命令，发送一条命令后会自动记录'}</div>`;
        return;
      }
      box.innerHTML = rows
        .map(
          (x, i) => `<div class="his-row" data-id="${x.id}" data-cmd="${U.esc(x.cmd)}" title="${U.esc(x.cmd)}">
            <span class="his-idx">${i + 1}</span>
            <span class="his-cmd">${U.esc(x.cmd)}</span>
            <span class="his-time">${timeText(x.ts)}</span>
            <button class="icon-btn" data-copy="${x.id}" title="复制">⧉</button>
            <button class="icon-btn" data-del="${x.id}" title="删除">✕</button>
          </div>`
        )
        .join('');
    };

    U.openModal({
      title: '命令历史',
      width: '700px',
      okText: '关闭',
      hideCancel: true,
      body: `
        <div style="display:flex;align-items:center;gap:8px;margin-bottom:9px">
          <input id="his-filter" type="text" placeholder="筛选命令…" style="flex:1" />
          <span id="his-count" class="key-hint" style="margin:0;white-space:nowrap"></span>
          <button class="btn sm danger" id="his-clear" type="button">清空全部</button>
        </div>
        <div class="his-list" id="his-list"></div>
        <div class="his-tip">单击一行或点「⧉」→ 复制并填入命令输入框；双击 → 复制并关闭；点「✕」删除该条。历史保存在本地配置中，重启后仍在。</div>`,
      onOk: () => true
    });

    setTimeout(() => {
      render('');
      const filter = $('#his-filter');
      if (filter) filter.addEventListener('input', () => render(filter.value));
      const box = $('#his-list');
      if (box) {
        box.addEventListener('click', async (e) => {
          const del = e.target.closest('[data-del]');
          if (del) {
            e.stopPropagation();
            await remove(del.dataset.del);
            render($('#his-filter') ? $('#his-filter').value : '');
            return;
          }
          const cp = e.target.closest('[data-copy]');
          if (cp) {
            const item = list.find((x) => x.id === cp.dataset.copy);
            if (item) pick(item.cmd, false);
            box.querySelectorAll('.his-row').forEach((r) => r.classList.remove('sel'));
            cp.closest('.his-row').classList.add('sel');
            return;
          }
          const row = e.target.closest('.his-row');
          if (row) {
            box.querySelectorAll('.his-row').forEach((r) => r.classList.remove('sel'));
            row.classList.add('sel');
            pick(row.dataset.cmd, false);
          }
        });
        box.addEventListener('dblclick', (e) => {
          const row = e.target.closest('.his-row');
          if (row) pick(row.dataset.cmd, true);
        });
      }
      const clearBtn = $('#his-clear');
      if (clearBtn) {
        clearBtn.addEventListener('click', async () => {
          if (!list.length) return;
          const ok = await U.confirmSub('清空命令历史', `确定删除全部 ${list.length} 条命令历史吗？`, '清空');
          if (!ok) return;
          await clear();
          render('');
        });
      }
      setTimeout(() => {
        if (filter) filter.focus();
      }, 40);
    }, 20);
  }

  document.addEventListener('DOMContentLoaded', init);

  return { init, commands, record, remove, clear, openDialog };
})();
