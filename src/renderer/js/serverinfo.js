'use strict';
/* 右侧「服务器信息」面板：点击查看完整系统信息，打开后每秒自动刷新 */
window.ServerInfo = (function () {
  const esc = (v) => U.esc(v);
  let timer = null;
  let busy = false;
  let sessionId = '';
  let intervalMs = 1000;

  function kv(rows) {
    return rows
      .filter(([, v]) => v !== undefined && v !== null && String(v).trim() !== '')
      .map(([k, v]) => `<div class="si-row"><span>${esc(k)}</span><b>${esc(v)}</b></div>`)
      .join('');
  }

  function kvline(rows) {
    return rows
      .filter(([, v]) => v !== undefined && v !== null && String(v).trim() !== '')
      .map(([k, v], i) => {
        const sep = i ? '<span class="si-sep">·</span>' : '';
        return `${sep}<span class="si-pair"><span>${esc(k)}</span><b>${esc(v)}</b></span>`;
      })
      .join('');
  }

  function fmtMhz(text) {
    const n = Number(String(text || '').replace(/[^\d.]/g, ''));
    if (!(n > 0)) return '';
    return n >= 1000 ? (n / 1000).toFixed(2) + ' GHz' : n.toFixed(0) + ' MHz';
  }

  function bar(used, total, cls) {
    const pct = total > 0 ? Math.min(100, (used / total) * 100) : 0;
    return `<div class="si-bar"><i class="${cls || 'si-fill'}" style="width:${pct.toFixed(1)}%"></i></div>`;
  }

  function gridHtml(d) {
    const cpu = d.cpu || {};
    const usage = cpu.usage;
    let cpuBar = '';
    let cpuLegend = '';
    if (usage) {
      const segs = [
        ['si-cpu-user', '用户', Number(usage.user) || 0],
        ['si-cpu-sys', '系统', Number(usage.system) || 0],
        ['si-cpu-io', 'IO', Number(usage.io) || 0],
        ['si-cpu-idle', '空闲', Number(usage.idle) || 0]
      ];
      const sum = segs.reduce((n, s) => n + s[2], 0) || 1;
      cpuBar = `<div class="si-bar si-cpu-bar">${segs
        .map(([c, , v]) => `<i class="${c}" style="width:${((v / sum) * 100).toFixed(2)}%"></i>`)
        .join('')}</div>`;
      cpuLegend = `<div class="si-legend">${segs
        .map(([c, label, v]) => `<span><i class="${c}"></i>${label} ${v.toFixed(1)}%</span>`)
        .join('')}</div>`;
    }

    const mem = d.memory || {};
    const sw = d.swap || {};
    const netRows = (d.net || [])
      .map(
        (i) => `<tr>
          <td class="mono">${esc(i.name)}</td>
          <td class="mono">${U.fmtBytes(i.rxBytes)}</td>
          <td class="mono">${U.fmtBytes(i.txBytes)}</td>
          <td class="mono">${U.rateFromBytes(i.rxRate, 'netDetail')}</td>
          <td class="mono">${U.rateFromBytes(i.txRate, 'netDetail')}</td>
        </tr>`
      )
      .join('');
    const diskRows = (d.disks || [])
      .map(
        (x) => `<tr>
          <td title="${esc(x.fs)}">${esc(x.mount)}</td>
          <td class="mono">${esc(x.fs)}</td>
          <td class="mono">${U.fmtBytes(x.used)} / ${U.fmtBytes(x.total)}</td>
          <td class="num"><span class="si-mini"><i style="width:${Math.min(100, x.usedPct || 0)}%"></i></span>${x.usedPct || 0}%</td>
        </tr>`
      )
      .join('');

    return `<div class="si-grid">
      <section class="si-card">
        <h4>系统</h4>
        <div class="si-kv">${kv([
          ['操作系统', d.os],
          ['内核', [d.kernelName, d.kernel].filter(Boolean).join(' ')],
          ['硬件架构', d.arch],
          ['主机名称', d.hostname],
          ['登录用户', d.user],
          ['运行时间', d.uptime],
          ['负载', (d.load || []).join(' / ')]
        ])}</div>
      </section>
      <section class="si-card">
        <h4>CPU</h4>
        <div class="si-kv">${kv([
          ['型号', cpu.model],
          ['核心数', cpu.cores ? cpu.cores + ' 核' : ''],
          ['频率', fmtMhz(cpu.mhz)],
          ['缓存', cpu.cache]
        ])}</div>
        ${cpuBar}${cpuLegend || '<div class="si-empty">占用率采样中…</div>'}
      </section>
      <section class="si-card">
        <h4>内存</h4>
        <div class="si-kv si-kv-line">${kvline([
          ['总计', U.fmtBytes(mem.total)],
          ['已用', U.fmtBytes(mem.used)],
          ['剩余', U.fmtBytes(mem.available || mem.free)]
        ])}</div>
        ${bar(mem.used, mem.total)}
      </section>
      <section class="si-card">
        <h4>Swap</h4>
        <div class="si-kv si-kv-line">${kvline([
          ['总计', U.fmtBytes(sw.total)],
          ['已用', U.fmtBytes(sw.used)],
          ['剩余', U.fmtBytes(sw.free)]
        ])}</div>
        ${sw.total ? bar(sw.used, sw.total) : '<div class="si-empty">未启用 Swap</div>'}
      </section>
      <section class="si-card wide">
        <h4>网络接口</h4>
        ${
          netRows
            ? `<div class="si-table-wrap"><table class="si-table">
                <thead><tr><th>接口</th><th>接收量</th><th>发送量</th><th>下行速率</th><th>上行速率</th></tr></thead>
                <tbody>${netRows}</tbody>
              </table></div>`
            : '<div class="si-empty">暂无网络接口数据</div>'
        }
      </section>
      <section class="si-card wide">
        <h4>文件系统</h4>
        ${
          diskRows
            ? `<div class="si-table-wrap"><table class="si-table">
                <thead><tr><th>挂载点</th><th>文件系统</th><th>已用 / 总量</th><th>使用率</th></tr></thead>
                <tbody>${diskRows}</tbody>
              </table></div>`
            : '<div class="si-empty">暂无文件系统数据</div>'
        }
      </section>
    </div>`;
  }

  function isOpen() {
    const mask = U.qs('#modal-mask');
    return !!(mask && mask.classList.contains('show') && U.qs('#si-content'));
  }

  function stop() {
    if (timer) clearInterval(timer);
    timer = null;
  }

  function start() {
    stop();
    timer = setInterval(() => {
      if (!isOpen()) {
        stop();
        return;
      }
      load(false);
    }, intervalMs);
  }

  function bindControls() {
    const btn = U.qs('#si-refresh');
    if (btn) btn.onclick = () => load(true);
    const sel = U.qs('#si-interval');
    if (sel) {
      sel.onchange = () => {
        intervalMs = Math.max(500, Number(sel.value) || 1000);
        start();
      };
    }
  }

  async function load(showLoading) {
    if (busy || !sessionId) return;
    busy = true;
    const content = U.qs('#si-content');
    if (showLoading && content) content.innerHTML = '<div class="si-loading">正在读取服务器信息…</div>';
    try {
      const d = await window.api.sysinfoDetail({ sessionId });
      const el = U.qs('#si-content');
      if (!el) return;
      const body = U.qs('#modal-body');
      const top = body ? body.scrollTop : 0;
      const wraps = Array.from(el.querySelectorAll('.si-table-wrap')).map((x) => x.scrollTop);
      el.innerHTML = gridHtml(d);
      el.querySelectorAll('.si-table-wrap').forEach((x, i) => {
        if (wraps[i]) x.scrollTop = wraps[i];
      });
      if (body) body.scrollTop = top;
    } catch (err) {
      if (showLoading) {
        const el = U.qs('#si-content');
        if (el) el.innerHTML = `<div class="si-error">读取失败：${esc(U.cleanError(err))}</div>`;
      }
    } finally {
      busy = false;
    }
  }

  function open() {
    const sess = App.active;
    if (!sess) return U.toast('请先连接服务器', 'error');
    stop();
    sessionId = sess.id;
    intervalMs = 1000;
    const name = sess.config.name || sess.config.host;
    U.openModal({
      title: `服务器详情 - ${name}`,
      width: '860px',
      hideCancel: true,
      okText: '关闭',
      body: `<div class="si-head">
          <span>系统实时信息</span>
          <span class="si-tools">
            <span class="si-auto">自动刷新</span>
            <select id="si-interval" title="刷新频率">
              <option value="1000" selected>1 秒</option>
              <option value="2000">2 秒</option>
              <option value="5000">5 秒</option>
              <option value="10000">10 秒</option>
            </select>
            <button class="btn sm" id="si-refresh">刷新</button>
          </span>
        </div>
        <div id="si-content"><div class="si-loading">正在读取服务器信息…</div></div>`
    });
    bindControls();
    load(true);
    start();
  }

  function init() {
    const panel = U.qs('#srv-info-panel');
    if (!panel) return;
    panel.addEventListener('click', (e) => {
      if (e.target.closest('button')) return;
      open();
    });
  }

  document.addEventListener('DOMContentLoaded', init);
  return { open };
})();
