'use strict';
/* 通用工具：DOM、格式化、弹窗、右键菜单、路径处理 */
window.U = (function () {
  const qs = (sel, root = document) => root.querySelector(sel);
  const qsa = (sel, root = document) => Array.from(root.querySelectorAll(sel));

  const esc = (s) =>
    String(s == null ? '' : s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');

  function fmtBytes(n, digits = 1) {
    n = Number(n) || 0;
    if (n < 1024) return n.toFixed(0) + ' B';
    const units = ['KB', 'MB', 'GB', 'TB', 'PB'];
    let i = -1;
    do {
      n /= 1024;
      i++;
    } while (n >= 1024 && i < units.length - 1);
    return n.toFixed(n >= 100 ? 0 : digits) + ' ' + units[i];
  }

  const fmtRate = (n) => fmtBytes(n, 1) + '/s';

  function fmtSizeCell(n) {
    if (n === null || n === undefined) return '';
    return fmtBytes(n, 1);
  }

  function fmtTime(ms) {
    if (!ms) return '';
    const d = new Date(ms);
    const p = (x) => String(x).padStart(2, '0');
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
  }

  function debounce(fn, wait = 150) {
    let t = null;
    const wrapped = (...args) => {
      if (t) clearTimeout(t);
      t = setTimeout(() => {
        t = null;
        fn(...args);
      }, wait);
    };
    wrapped.cancel = () => t && clearTimeout(t);
    return wrapped;
  }

  /* ---------------- Toast ---------------- */
  function toast(message, type = 'info', ms = 2600) {
    const box = qs('#toasts');
    if (!box) return;
    const el = document.createElement('div');
    el.className = 'toast' + (type === 'error' ? ' err' : type === 'ok' ? ' ok' : '');
    el.textContent = message;
    box.appendChild(el);
    setTimeout(() => {
      el.classList.add('hide');
      setTimeout(() => el.remove(), 220);
    }, ms);
  }

  /* ---------------- 弹窗 ----------------
   * opts.cancelValue：取消按钮返回的值（不传则返回 null）。
   * 用于「覆盖 / 重命名」这类二选一确认：okText 对应 onOk，cancelText 对应 cancelValue。
   */
  let modalResolver = null;

  function openModal(opts) {
    const mask = qs('#modal-mask');
    const okBtn = qs('#modal-ok');
    const cancelBtn = qs('#modal-cancel');
    qs('#modal-title').textContent = opts.title || '';
    qs('#modal-body').innerHTML = opts.body || '';
    okBtn.textContent = opts.okText || '保存';
    okBtn.className = 'btn ' + (opts.okClass || 'primary');
    cancelBtn.textContent = opts.cancelText || '取消';
    cancelBtn.style.display = opts.hideCancel ? 'none' : '';
    qs('#modal').style.width = opts.width || '520px';
    // 弹窗可能在设置面板（z 140）、凭据浮窗等更高层之上打开，
    // 固定 z-index:100 会被遮住导致控件点不到，这里按当前最上层动态抬高
    let base = 100;
    document.querySelectorAll('#settings-mask.show, #sub-mask.show, #ap-backdrop.show, .fe-mask.show, .fav-overlay.show').forEach((m) => {
      const z = parseInt(getComputedStyle(m).zIndex, 10) || 0;
      if (z > base) base = z;
    });
    mask.style.zIndex = String(base + 20);
    mask.classList.add('show');

    return new Promise((resolve) => {
      modalResolver = resolve;
      const finish = (value, ok) => {
        mask.classList.remove('show');
        mask.style.zIndex = '';
        modalResolver = null;
        okBtn.disabled = false;
        resolve(ok ? value : null);
      };
      const onOk = async () => {
        if (!opts.onOk) return finish(true, true);
        okBtn.disabled = true;
        try {
          const r = await opts.onOk();
          if (r === false) {
            okBtn.disabled = false;
            return;
          }
          finish(r === undefined ? true : r, true);
        } catch (err) {
          okBtn.disabled = false;
          toast(err.message || String(err), 'error', 3600);
        }
      };
      okBtn.onclick = onOk;
      cancelBtn.onclick = () => {
        if (opts.cancelValue !== undefined) finish(opts.cancelValue, true);
        else finish(null, false);
      };
      qs('#modal-close').onclick = () => finish(null, false);
      mask.onmousedown = (e) => {
        if (e.target === mask) finish(null, false);
      };
      const bodyEl = qs('#modal-body');
      bodyEl.onkeydown = (e) => {
        if (e.key === 'Enter' && !e.shiftKey && e.target.tagName !== 'TEXTAREA' && e.target.tagName !== 'SELECT') {
          e.preventDefault();
          onOk();
        }
      };
      setTimeout(() => {
        const first = bodyEl.querySelector('input:not([type=checkbox]):not([type=radio]), textarea');
        if (first) {
          first.focus();
          if (first.select) first.select();
        }
      }, 30);
    });
  }

  function confirmDialog(title, message, okText = '确定', danger = true) {
    return openModal({
      title,
      width: '420px',
      okText,
      okClass: danger ? 'btn danger' : 'btn primary',
      body: `<div style="line-height:1.7;color:#3d4757;white-space:pre-wrap">${esc(message)}</div>`
    }).then((v) => v !== null);
  }

  function promptDialog(title, label, value = '', placeholder = '') {
    return openModal({
      title,
      width: '420px',
      body: `<div class="field"><label>${esc(label)}</label><input id="dlg-input" type="text" value="${esc(value)}" placeholder="${esc(
        placeholder
      )}" /></div>`,
      onOk: () => {
        const v = qs('#dlg-input').value.trim();
        if (!v) throw new Error('请输入内容');
        return v;
      }
    });
  }

  /** 二级弹窗：叠在父弹窗之上，不销毁父弹窗内容（密钥导入、嵌套确认等） */
  function openSubModal(opts) {
    const mask = qs('#sub-mask');
    const okBtn = qs('#sub-ok');
    const cancelBtn = qs('#sub-cancel');
    qs('#sub-title').textContent = opts.title || '';
    qs('#sub-body').innerHTML = opts.body || '';
    okBtn.textContent = opts.okText || '确定';
    okBtn.className = 'btn ' + (opts.okClass || 'primary');
    cancelBtn.textContent = opts.cancelText || '取消';
    cancelBtn.style.display = opts.hideCancel ? 'none' : '';
    qs('#sub-modal').style.width = opts.width || '520px';
    mask.classList.add('show');

    return new Promise((resolve) => {
      const finish = (value, ok) => {
        mask.classList.remove('show');
        okBtn.disabled = false;
        resolve(ok ? value : null);
      };
      const onOk = async () => {
        if (!opts.onOk) return finish(true, true);
        okBtn.disabled = true;
        try {
          const r = await opts.onOk();
          if (r === false) {
            okBtn.disabled = false;
            return;
          }
          finish(r === undefined ? true : r, true);
        } catch (err) {
          okBtn.disabled = false;
          toast(err.message || String(err), 'error', 3600);
        }
      };
      okBtn.onclick = onOk;
      cancelBtn.onclick = () => finish(null, false);
      qs('#sub-close').onclick = () => finish(null, false);
      mask.onmousedown = (e) => {
        if (e.target === mask) finish(null, false);
      };
      const bodyEl = qs('#sub-body');
      bodyEl.onkeydown = (e) => {
        if (e.key === 'Enter' && !e.shiftKey && e.target.tagName !== 'TEXTAREA' && e.target.tagName !== 'SELECT') {
          e.preventDefault();
          onOk();
        }
      };
      setTimeout(() => {
        const first = bodyEl.querySelector('input:not([type=checkbox]):not([type=radio]), textarea');
        if (first) first.focus();
      }, 30);
    });
  }

  function confirmSub(title, message, okText = '确定') {
    return openSubModal({
      title,
      width: '420px',
      okText,
      okClass: 'btn danger',
      body: `<div style="line-height:1.7;color:#3d4757;white-space:pre-wrap">${esc(message)}</div>`
    }).then((v) => v !== null);
  }

  /* ---------------- 右键菜单 ---------------- */
  function ctxMenu(items, x, y) {
    const menu = qs('#ctx-menu');
    menu.innerHTML = items
      .map((it, i) => {
        if (it.sep) return '<div class="ctx-sep"></div>';
        return `<div class="ctx-item${it.danger ? ' danger' : ''}${it.disabled ? ' disabled' : ''}" data-i="${i}">${esc(it.label)}${
          it.key ? `<span class="k">${esc(it.key)}</span>` : ''
        }</div>`;
      })
      .join('');
    menu.classList.add('show');
    const rect = menu.getBoundingClientRect();
    const px = Math.min(x, window.innerWidth - rect.width - 8);
    const py = Math.min(y, window.innerHeight - rect.height - 8);
    menu.style.left = Math.max(4, px) + 'px';
    menu.style.top = Math.max(4, py) + 'px';
    const close = (e) => {
      if (!menu.contains(e.target)) {
        menu.classList.remove('show');
        document.removeEventListener('mousedown', close, true);
      }
    };
    setTimeout(() => document.addEventListener('mousedown', close, true), 0);
    menu.onclick = (e) => {
      const item = e.target.closest('.ctx-item');
      if (!item) return;
      const idx = Number(item.dataset.i);
      menu.classList.remove('show');
      const it = items[idx];
      if (!it || it.disabled) return;
      const fn = it.onClick;
      if (fn) fn();
    };
  }

  /* ---------------- 下拉框（统一的展开面板） ----------------
   * 原生 select 的展开列表由系统渲染，无法跟随主题；这里拦截 mousedown，
   * 用一个和右键菜单同风格的浮层代替，选中后回写 value 并派发 change。
   */
  let selMenu = null;
  let selSelect = null;

  function ensureSelMenu() {
    if (selMenu) return selMenu;
    selMenu = document.createElement('div');
    selMenu.className = 'sel-menu';
    selMenu.id = 'sel-menu';
    document.body.appendChild(selMenu);
    // 防止点击面板时输入框失焦
    selMenu.addEventListener('mousedown', (e) => e.preventDefault());
    selMenu.addEventListener('click', (e) => {
      const item = e.target.closest('.sel-item');
      if (!item || item.classList.contains('disabled')) return;
      const sel = selSelect;
      const idx = Number(item.dataset.i);
      closeSelMenu();
      if (!sel) return;
      const opt = sel.options[idx];
      if (!opt) return;
      if (sel.value !== opt.value) {
        sel.value = opt.value;
        sel.dispatchEvent(new Event('input', { bubbles: true }));
        sel.dispatchEvent(new Event('change', { bubbles: true }));
      }
      try { sel.focus({ preventScroll: true }); } catch (_) {}
    });
    return selMenu;
  }

  function buildSelItems(select) {
    const parts = [];
    let lastGroup = null;
    Array.from(select.options).forEach((o, i) => {
      const g = o.parentElement && o.parentElement.tagName === 'OPTGROUP' ? o.parentElement : null;
      if (g && g !== lastGroup) parts.push(`<div class="sel-group">${esc(g.label || '')}</div>`);
      lastGroup = g;
      const on = o.selected;
      parts.push(
        `<div class="sel-item${on ? ' on' : ''}${o.disabled ? ' disabled' : ''}" data-i="${i}">` +
          `<span class="sel-label">${esc(o.textContent || '')}</span>` +
          `<span class="sel-tick">${on ? '✓' : ''}</span>` +
        `</div>`
      );
    });
    return parts.join('');
  }

  function placeSelMenu(select) {
    const menu = selMenu;
    if (!menu) return;
    const rect = select.getBoundingClientRect();
    menu.style.minWidth = Math.max(120, Math.round(rect.width)) + 'px';
    menu.style.maxWidth = Math.min(380, Math.max(160, window.innerWidth - 16)) + 'px';
    menu.style.left = '0px';
    menu.style.top = '0px';
    const mw = menu.offsetWidth;
    const mh = menu.offsetHeight;
    let left = rect.left;
    if (left + mw > window.innerWidth - 8) left = Math.max(8, window.innerWidth - mw - 8);
    let top = rect.bottom + 4;
    if (top + mh > window.innerHeight - 8) {
      const up = rect.top - mh - 4;
      top = up >= 8 ? up : Math.max(8, window.innerHeight - mh - 8);
    }
    menu.style.left = Math.round(left) + 'px';
    menu.style.top = Math.round(top) + 'px';
  }

  function openSelMenu(select) {
    if (!select || select.disabled) return;
    if (select.multiple || Number(select.size) > 1) return;
    if (!select.options.length) return;
    if (select.dataset.nativeMenu === '1') return;
    ensureSelMenu();
    if (selSelect === select && selMenu.classList.contains('show')) {
      closeSelMenu();
      return;
    }
    selSelect = select;
    selMenu.innerHTML = buildSelItems(select);
    selMenu.classList.add('show');
    placeSelMenu(select);
    const cur = selMenu.querySelector('.sel-item.on');
    if (cur && cur.scrollIntoView) cur.scrollIntoView({ block: 'nearest' });
  }

  function closeSelMenu() {
    if (!selMenu) return;
    selMenu.classList.remove('show');
    selSelect = null;
  }

  function initSelectMenus() {
    document.addEventListener(
      'mousedown',
      (e) => {
        const t = e.target;
        const sel = t && t.closest ? t.closest('select') : null;
        if (sel && !sel.disabled && sel.dataset.nativeMenu !== '1') {
          e.preventDefault();
          openSelMenu(sel);
          return;
        }
        if (selMenu && selMenu.classList.contains('show') && !(t.closest && t.closest('#sel-menu'))) {
          closeSelMenu();
        }
      },
      true
    );
    document.addEventListener(
      'keydown',
      (e) => {
        if (e.key === 'Escape' && selMenu && selMenu.classList.contains('show')) {
          e.preventDefault();
          closeSelMenu();
          return;
        }
        // 键盘操作时也用同一套面板，避免又弹出系统原生列表
        const sel = e.target && e.target.closest ? e.target.closest('select') : null;
        if (!sel || sel.disabled || sel.dataset.nativeMenu === '1') return;
        if (e.key === 'Enter' || e.key === ' ' || e.key === 'ArrowDown' || e.key === 'ArrowUp') {
          e.preventDefault();
          openSelMenu(sel);
        }
      },
      true
    );
    document.addEventListener(
      'scroll',
      (e) => {
        if (selMenu && selMenu.contains(e.target)) return;
        closeSelMenu();
      },
      true
    );
    window.addEventListener('resize', closeSelMenu);
    window.addEventListener('blur', closeSelMenu);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', initSelectMenus);
  else setTimeout(initSelectMenus, 0);

  /* ---------------- 路径 ---------------- */
  const posix = {
    join(...parts) {
      const segs = [];
      for (const p of parts) {
        if (!p) continue;
        for (const s of String(p).split('/')) {
          if (!s || s === '.') continue;
          if (s === '..') segs.pop();
          else segs.push(s);
        }
      }
      return '/' + segs.join('/');
    },
    dirname(p) {
      const s = String(p).replace(/\/+$/, '');
      const i = s.lastIndexOf('/');
      if (i <= 0) return '/';
      return s.slice(0, i);
    },
    basename(p) {
      const s = String(p).replace(/\/+$/, '');
      return s.slice(s.lastIndexOf('/') + 1) || '/';
    }
  };

  const clamp = (v, min, max) => Math.max(min, Math.min(max, v));

  function shortName(name, max = 16) {
    if (!name) return '';
    return name.length > max ? name.slice(0, max - 1) + '…' : name;
  }

  /** 去掉 IPC 包装前缀，只保留可读的错误信息 */
  function cleanError(err) {
    let msg = (err && err.message) || String(err || '');
    msg = msg.replace(/^Error invoking remote method '[^']*':\s*/i, '');
    msg = msg.replace(/^Error:\s*/i, '');
    return msg.trim() || '未知错误';
  }

  function copy(text) {
    return navigator.clipboard.writeText(String(text)).then(
      () => toast('已复制', 'ok', 1400),
      () => toast('复制失败', 'error')
    );
  }

  /* ---------------- 速率单位 ---------------- */
  /** 解析速率单位：具体项优先，未设置时跟随全局，默认 Mbps */
  function unitFor(kind, settings) {
    const s = settings || (window.App && window.App.settings) || {};
    const u = s.units && typeof s.units === 'object' ? s.units : {};
    const globalUnit = u.global || (s.netUnit === 'bytes' ? 'mbytes' : 'mbps');
    const own = u[kind];
    const unit = own === 'mbytes' || own === 'mbps' ? own : globalUnit;
    return unit === 'mbytes' ? 'mbytes' : 'mbps';
  }

  function unitLabel(unit) {
    return unit === 'mbytes' ? 'MB/s' : 'Mbps';
  }

  function fmtSpeedNumber(v) {
    const n = Number(v) || 0;
    return n >= 100 ? n.toFixed(0) : n >= 10 ? n.toFixed(1) : n.toFixed(2);
  }

  /** 字节/秒 → 指定单位的数值 */
  function speedValueFromBytes(bytes, unit) {
    const n = Number(bytes) || 0;
    return unit === 'mbytes' ? n / 1e6 : (n * 8) / 1e6;
  }

  /** Mbps → 指定单位的数值 */
  function speedValueFromMbps(mbps, unit) {
    const n = Number(mbps) || 0;
    return unit === 'mbytes' ? n / 8 : n;
  }

  function rateFromBytes(bytes, kind, settings) {
    const unit = unitFor(kind, settings);
    return fmtSpeedNumber(speedValueFromBytes(bytes, unit)) + ' ' + unitLabel(unit);
  }

  function rateFromMbps(mbps, kind, settings) {
    const unit = unitFor(kind, settings);
    return fmtSpeedNumber(speedValueFromMbps(mbps, unit)) + ' ' + unitLabel(unit);
  }

  /** 累计流量：bit 数自动选择 Gb / Mb / Kb */
  function trafficText(bytes) {
    const bits = Math.max(0, Number(bytes) || 0) * 8;
    if (bits >= 1e9) return fmtSpeedNumber(bits / 1e9) + ' Gb';
    if (bits >= 1e6) return fmtSpeedNumber(bits / 1e6) + ' Mb';
    if (bits >= 1e3) return fmtSpeedNumber(bits / 1e3) + ' Kb';
    return fmtSpeedNumber(bits) + ' b';
  }

  return {
    qs,
    qsa,
    esc,
    // 版本号与运行形态（由主进程提供，跟随 package.json / 是否是便携版）
    appVersion: ((window.api && window.api.appInfo) || {}).version || '1.14.2',
    dataFile: ((window.api && window.api.appInfo) || {}).dataFile || '',
    isPortable: !!(window.api && window.api.appInfo && window.api.appInfo.portable),
    versionText() {
      return 'LIULI Shell v' + (((window.api && window.api.appInfo) || {}).version || '1.14.2');
    },
    fmtBytes,
    fmtRate,
    fmtSizeCell,
    fmtTime,
    debounce,
    toast,
    openModal,
    openSubModal,
    confirmDialog,
    confirmSub,
    promptDialog,
    ctxMenu,
    initSelectMenus,
    posix,
    clamp,
    shortName,
    cleanError,
    copy,
    unitFor,
    unitLabel,
    speedValueFromBytes,
    speedValueFromMbps,
    rateFromBytes,
    rateFromMbps,
    trafficText
  };
})();
