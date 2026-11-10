'use strict';
/* 左侧服务器监控面板 */
window.Sidebar = (function () {
  const $ = U.qs;

  function init() {
    window.api.on('monitor:stats', (stats) => {
      const sess = App.session(stats.sessionId);
      if (!sess) return;
      sess.stats = stats;
      pushSample(sess, stats);
      if (App.state.activeId === stats.sessionId) renderStats(sess);
    });

    window.api.on('monitor:procs', (payload) => {
      const sess = App.session(payload.sessionId);
      if (!sess) return;
      sess.procs = payload.rows || [];
      sess.procSort = payload.sort;
      if (App.state.activeId === payload.sessionId) renderProcs(sess);
    });

    // 服务器信息里的 IP / 端口：单击即可复制
    ['#info-ip', '#info-port'].forEach((sel) => {
      const el = $(sel);
      if (!el) return;
      el.addEventListener('click', () => {
        const v = String(el.dataset.value || el.textContent || '').trim();
        if (!v || v === '--') return;
        U.copy(v);
      });
    });

    App.on('active:change', (sess) => renderAll(sess));

    $('#nic-select').addEventListener('change', (e) => {
      const sess = App.active;
      if (!sess) return;
      sess.nic = e.target.value;
      sess.netHistory = [];
      drawChart(sess);
      renderNetLegend(sess);
    });

    document.querySelectorAll('.proc-table th.sortable').forEach((th) => {
      th.addEventListener('click', () => {
        const sess = App.active;
        if (!sess) return;
        sess.procSort = th.dataset.sort;
        renderProcs(sess);
        window.api.setProcSort({ sessionId: sess.id, sort: sess.procSort });
      });
    });

    // 点击进程预览表格 / 网络心跳图表 → 直接在终端区展开对应详情
    $('#proc-body').addEventListener('click', (e) => {
      if (e.target.closest('tr.placeholder')) return;
      openDetail('procs');
    });
    const openNet = () => openDetail('net');
    $('#net-chart').addEventListener('click', openNet);
    const legend = document.querySelector('.net-legend');
    if (legend) legend.addEventListener('click', openNet);
  }

  function openDetail(type) {
    const sess = App.active;
    if (!sess) return U.toast('请先连接服务器', 'error');
    Details.open(type, sess.id);
  }

  function renderAll(sess) {
    if (!sess) return reset();
    const srvName = sess.config.name || sess.config.host;
    const st = sess.status || 'online';
    $('#srv-name').textContent = srvName;
    $('#srv-host').textContent = st === 'connecting' ? '正在连接…' : `${sess.config.user}@${sess.config.host}:${sess.config.port}`;
    $('#srv-avatar').textContent = (srvName || 'SSH').slice(0, 2).toUpperCase();
    $('#srv-dot').className = 'dot ' + (st === 'online' ? 'online' : st === 'connecting' ? 'connecting' : st === 'unstable' ? 'unstable' : 'failed');
    $('#srv-dot').title = st === 'online' ? '已连接' : st === 'connecting' ? '连接中' : st === 'unstable' ? '连接不稳定' : '已断开';

    const info = sess.sysinfo || {};
    $('#info-os').textContent = info.os || '--';
    $('#info-os').title = info.os || '';
    $('#info-kernel').textContent = info.kernel || '--';
    $('#info-arch').textContent = info.arch || '--';
    $('#info-user').textContent = info.loginUser || sess.config.user || '--';
    // IP / 端口：点击即可复制，方便粘贴到别处；域名过长时优先在点号处折行
    const ipEl = $('#info-ip');
    const portEl = $('#info-port');
    if (ipEl) {
      const host = String(sess.config.host || '');
      // 域名优先在点号处折行：<wbr> 不占字符，复制时不受影响
      ipEl.innerHTML = host ? U.esc(host).replace(/\./g, '.<wbr>') : '--';
      ipEl.dataset.value = host;
      ipEl.title = '点击复制 IP：' + (host || '--');
    }
    if (portEl) {
      const port = String(sess.config.port || 22);
      portEl.textContent = port;
      portEl.dataset.value = port;
      portEl.title = '点击复制端口：' + port;
    }
    $('#info-uptime').textContent = (info.uptime || '--').replace(/^up\s+/i, '');
    $('#info-uptime').title = info.uptime || '';

    // 清空旧数据，避免切换服务器时短暂显示上一台的值
    $('#cpu-val').textContent = '--';
    $('#cpu-bar').style.width = '0%';
    $('#mem-val').textContent = '--';
    $('#mem-total').textContent = '/ --';
    $('#mem-bar').style.width = '0%';
    $('#swap-val').textContent = '--';
    $('#swap-total').textContent = '/ --';
    $('#swap-bar').style.width = '0%';
    $('#proc-body').innerHTML = '<tr class="placeholder"><td colspan="3">加载中…</td></tr>';
    $('#disk-body').innerHTML = '<tr class="placeholder"><td colspan="2">加载中…</td></tr>';
    $('#disk-extra').textContent = '';
    $('#nic-select').innerHTML = '<option value="">--</option>';
    $('#nic-select').dataset.sig = 'empty';
    $('#rx-rate').textContent = '0 B/s';
    $('#tx-rate').textContent = '0 B/s';

    if (sess.stats) renderStats(sess);
    if (sess.procs && sess.procs.length) renderProcs(sess);
    drawChart(sess);
  }

  function reset() {
    $('#srv-name').textContent = '未连接';
    $('#srv-host').textContent = '请在上方连接一台服务器';
    $('#srv-avatar').textContent = '--';
    $('#srv-dot').className = 'dot offline';
    ['info-os', 'info-kernel', 'info-arch', 'info-user', 'info-uptime', 'info-load', 'info-ip', 'info-port'].forEach((id) => {
      const el = $('#' + id);
      if (!el) return;
      el.textContent = '--';
      delete el.dataset.value;
    });
    $('#cpu-val').textContent = '--';
    $('#cpu-bar').style.width = '0%';
    $('#mem-val').textContent = '--';
    $('#mem-total').textContent = '/ --';
    $('#mem-bar').style.width = '0%';
    $('#swap-val').textContent = '--';
    $('#swap-total').textContent = '/ --';
    $('#swap-bar').style.width = '0%';
    $('#proc-body').innerHTML = '<tr class="placeholder"><td colspan="3">暂无数据</td></tr>';
    $('#disk-body').innerHTML = '<tr class="placeholder"><td colspan="2">暂无数据</td></tr>';
    $('#disk-extra').textContent = '';
    $('#nic-select').innerHTML = '<option value="">--</option>';
    $('#nic-select').dataset.sig = 'empty';
    $('#cpu-extra').textContent = '--';
    $('#mem-extra').textContent = '--';
    $('#swap-extra').textContent = '--';
    $('#rx-rate').textContent = '0 B/s';
    $('#tx-rate').textContent = '0 B/s';
    renderNetLegend(null);
    drawChart(null);
  }

  function renderStats(sess) {
    const st = sess.stats;
    if (!st || App.state.activeId !== sess.id) return;

    // CPU
    const usage = st.cpu && st.cpu.usage;
    if (usage === null || usage === undefined) {
      $('#cpu-val').textContent = '--';
      $('#cpu-bar').style.width = '0%';
    } else {
      $('#cpu-val').textContent = usage.toFixed(0);
      $('#cpu-bar').style.width = Math.min(100, usage) + '%';
      $('#cpu-bar').className = 'fill ' + (usage > 85 ? 'hot' : 'blue');
    }
    const cores = (st.cpu && st.cpu.cores) || (sess.sysinfo && sess.sysinfo.cores) || 0;
    const load = st.cpu && st.cpu.load && st.cpu.load.length ? st.cpu.load.join('  ') : '';
    $('#cpu-extra').textContent = `${cores} 核` + (load ? ` · 负载 ${load}` : '');
    $('#info-load').textContent = load || '--';

    // 内存
    const mem = st.mem || { total: 0, used: 0 };
    const memPct = mem.total ? (mem.used / mem.total) * 100 : 0;
    $('#mem-val').textContent = U.fmtBytes(mem.used);
    $('#mem-total').textContent = '/ ' + U.fmtBytes(mem.total);
    $('#mem-bar').style.width = memPct.toFixed(1) + '%';
    $('#mem-bar').className = 'fill ' + (memPct > 90 ? 'hot' : 'green');
    $('#mem-extra').textContent = memPct.toFixed(0) + '%';

    // Swap
    const sw = st.swap || { total: 0, used: 0 };
    if (!sw.total) {
      $('#swap-val').textContent = '未启用';
      $('#swap-total').textContent = '';
      $('#swap-bar').style.width = '0%';
      $('#swap-extra').textContent = '0';
    } else {
      const p = (sw.used / sw.total) * 100;
      $('#swap-val').textContent = U.fmtBytes(sw.used);
      $('#swap-total').textContent = '/ ' + U.fmtBytes(sw.total);
      $('#swap-bar').style.width = p.toFixed(1) + '%';
      $('#swap-bar').className = 'fill ' + (p > 80 ? 'hot' : 'amber');
      $('#swap-extra').textContent = p.toFixed(0) + '%';
    }

    // 网卡
    const ifaces = (st.net && st.net.ifaces) || [];
    const sig = ifaces.map((i) => i.name).join(',');
    if (!ifaces.length) {
      if ($('#nic-select').dataset.sig !== 'empty') {
        $('#nic-select').dataset.sig = 'empty';
        $('#nic-select').innerHTML = '<option value="">--</option>';
      }
      sess.nic = '';
    } else if ($('#nic-select').dataset.sig !== sig) {
      $('#nic-select').dataset.sig = sig;
      const prev = sess.nic;
      $('#nic-select').innerHTML = ifaces
        .map((i) => `<option value="${U.esc(i.name)}">${U.esc(i.name)}</option>`)
        .join('');
      const pick =
        (prev && ifaces.some((i) => i.name === prev) && prev) ||
        (ifaces.find((i) => !/^lo/.test(i.name)) || ifaces[0] || {}).name ||
        '';
      sess.nic = pick;
      $('#nic-select').value = pick;
    }
    if (sess.nic) {
      drawChart(sess);
      renderNetLegend(sess);
    }

    // 磁盘：始终列出全部挂载点，超出的在面板内滚动查看（不再用下拉框）
    const disks = st.disk || [];
    const tbody = $('#disk-body');
    const extra = $('#disk-extra');
    if (!disks.length) {
      extra.textContent = '';
      tbody.innerHTML = '<tr class="placeholder"><td colspan="2">暂无数据</td></tr>';
    } else {
      extra.textContent = disks.length > 1 ? `${disks.length} 个分区` : '';
      tbody.innerHTML = disks
        .map((d) => {
          const pct = Math.min(100, d.usedPct || 0);
          const cls = pct > 90 ? 'hot' : pct > 75 ? 'warn' : '';
          return `<tr title="${U.esc((d.fs || '') + ' → ' + d.mount)}">
            <td><div style="max-width:120px;overflow:hidden;text-overflow:ellipsis">${U.esc(d.mount)}</div>
              <span class="disk-bar ${cls}"><i style="width:${pct}%"></i></span></td>
            <td>${U.esc(d.avail)} / ${U.esc(d.size)}</td>
          </tr>`;
        })
        .join('');
    }
  }

  function pushSample(sess, st) {
    if (!sess.nic) return;
    const iface = ((st.net && st.net.ifaces) || []).find((i) => i.name === sess.nic);
    if (!iface) return;
    sess.netHistory = sess.netHistory || [];
    sess.netHistory.push({ rx: iface.rxRate || 0, tx: iface.txRate || 0 });
    while (sess.netHistory.length > 64) sess.netHistory.shift();
  }

  /* ---------------- 网络速率单位与量程 ---------------- */
  const MBPS_LADDER = [0.5, 1, 10, 100, 1000, 10000];

  function netUnit() {
    return U.unitFor('chart');
  }

  /** 字节/秒 → 当前显示单位的数值（Mbps 或 MB/s） */
  function toUnit(bytes) {
    return U.speedValueFromBytes(bytes, netUnit());
  }

  function fmtNum(v) {
    const n = Number(v) || 0;
    return n >= 100 ? n.toFixed(0) : n >= 10 ? n.toFixed(1) : n.toFixed(2);
  }

  function fmtAxis(v) {
    return fmtNum(v) + (netUnit() === 'mbps' ? ' Mbps' : ' MB/s');
  }

  function fmtNet(bytes) {
    return U.rateFromBytes(bytes, 'chart');
  }

  function renderNetLegend(sess) {
    const history = (sess && sess.netHistory) || [];
    const last = history[history.length - 1];
    $('#rx-rate').textContent = fmtNet(last ? last.rx : 0);
    $('#tx-rate').textContent = fmtNet(last ? last.tx : 0);
    const unitEl = $('#net-unit');
    if (unitEl) unitEl.textContent = netUnit() === 'mbps' ? 'Mbps' : 'MB/s';
  }

  function procHtml(rows) {
    return rows
      .map(
        (p) => `<tr title="PID ${p.pid}">
          <td>${U.esc(p.name)}</td>
          <td class="num">${p.cpu.toFixed(1)}%</td>
          <td class="num">${U.fmtBytes(p.rss)}</td>
        </tr>`
      )
      .join('');
  }

  /** 进程预览：按面板剩余高度「撑满」显示，多出来的直接裁掉，不出现滚动条。
   *  先用 3 行探针测出真实行距，再一次性渲染到刚好放满，最后做一次溢出校正。 */
  function renderProcs(sess) {
    const rows = (sess && sess.procs) || [];
    const tbody = $('#proc-body');
    if (!tbody) return;
    document.querySelectorAll('.proc-table th.sortable').forEach((th) => {
      th.classList.toggle('active', th.dataset.sort === (sess && sess.procSort));
    });
    if (!rows.length) {
      tbody.innerHTML = '<tr class="placeholder"><td colspan="3">暂无数据</td></tr>';
      return;
    }
    const panel = document.querySelector('.side-body .proc-panel');
    const cs = panel ? getComputedStyle(panel) : null;
    const bottomEdge = panel ? panel.getBoundingClientRect().bottom - (parseFloat(cs.paddingBottom) || 0) : 0;

    // 探针：3 行足够量出行距（border-collapse 下首行含底边框，用前两行的顶边差更准）
    tbody.innerHTML = procHtml(rows.slice(0, Math.min(3, rows.length)));
    const trs = tbody.children;
    let pitch = 0;
    if (trs.length >= 2) pitch = trs[1].getBoundingClientRect().top - trs[0].getBoundingClientRect().top;
    else if (trs.length === 1) pitch = trs[0].getBoundingClientRect().height;
    if (!(pitch > 8)) pitch = 21;

    let limit = rows.length;
    if (panel && bottomEdge > 0) {
      const avail = bottomEdge - tbody.getBoundingClientRect().top;
      limit = Math.max(1, Math.min(rows.length, Math.floor(avail / pitch + 0.002)));
    }
    tbody.innerHTML = procHtml(rows.slice(0, limit));
    // 浮点 / 边框误差校正：超出 0.5px 就退掉最后一行
    let guard = 0;
    while (guard++ < 4 && limit > 1 && panel && tbody.getBoundingClientRect().bottom > bottomEdge + 0.5) {
      tbody.removeChild(tbody.lastElementChild);
      limit--;
    }
  }

  /** 布局变化（收起下方面板 / 显示隐藏服务器信息 / 拖拽 / 窗口缩放）后重排右栏：
   *  图表按固定尺寸重绘，进程预览按新的可用高度重算行数 */
  function relayout() {
    try {
      drawChart(App.active);
      renderNetLegend(App.active);
    } catch (_) {}
    const s = App.active;
    if (s && s.procs && s.procs.length) {
      try { renderProcs(s); } catch (_) {}
    }
  }

  /* ---------------- 网络图表（左侧刻度 + 自适应量程） ---------------- */

  function cssVar(name, fallback) {
    const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
    return v || fallback;
  }

  function hexRgba(hex, alpha) {
    const h = String(hex || '').replace('#', '');
    if (h.length !== 6) return `rgba(22,102,90,${alpha})`;
    const n = parseInt(h, 16);
    return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${alpha})`;
  }

  /** 根据近期峰值选择量程档位，带滞回避免频繁跳档 */
  function pickScale(sess, peak) {
    const unit = netUnit();
    const ladder = MBPS_LADDER;
    if (sess.netScaleUnit !== unit) {
      sess.netScaleUnit = unit;
      sess.netScale = ladder[0];
      sess.netScaleDrop = 0;
    }
    let scale = Number(sess.netScale) || ladder[0];
    if (peak * 1.2 > scale) {
      scale = ladder.find((v) => v >= peak * 1.2) || ladder[ladder.length - 1];
      sess.netScaleDrop = 0;
    } else if (scale > ladder[0] && peak < scale * 0.28) {
      sess.netScaleDrop = (sess.netScaleDrop || 0) + 1;
      if (sess.netScaleDrop >= 3) {
        const i = Math.max(0, ladder.indexOf(scale) - 1);
        scale = ladder[i];
        sess.netScaleDrop = 0;
      }
    } else {
      sess.netScaleDrop = 0;
    }
    sess.netScale = scale;
    return scale;
  }

  function drawChart(sess) {
    const canvas = $('#net-chart');
    if (!canvas) return;
    const dpr = window.devicePixelRatio || 1;
    const cssW = canvas.clientWidth || 260;
    const cssH = canvas.clientHeight || 62;
    if (canvas.width !== Math.floor(cssW * dpr) || canvas.height !== Math.floor(cssH * dpr)) {
      canvas.width = Math.floor(cssW * dpr);
      canvas.height = Math.floor(cssH * dpr);
    }
    const ctx = canvas.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, cssW, cssH);

    const samples = (sess && sess.netHistory) || [];
    const grid = cssVar('--line', '#e7e5df');
    const muted = cssVar('--muted', '#8b939b');
    const right = 6;
    const top = 7;
    const bottom = 6;

    if (!sess) {
      ctx.fillStyle = muted;
      ctx.font = '10px ' + cssVar('--font-ui', '"Microsoft YaHei", sans-serif');
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('未连接服务器', cssW / 2, cssH / 2);
      return;
    }

    ctx.lineWidth = 1;
    ctx.font = '9px ' + cssVar('--font-mono', 'Consolas, monospace');
    ctx.textAlign = 'right';
    ctx.textBaseline = 'middle';

    if (sess.status === 'connecting' && !samples.length) {
      ctx.fillStyle = muted;
      ctx.font = '10px ' + cssVar('--font-ui', '"Microsoft YaHei", sans-serif');
      ctx.textAlign = 'center';
      ctx.fillText('正在连接…', cssW / 2, cssH / 2);
      return;
    }

    let peak = 0;
    samples.forEach((s) => {
      peak = Math.max(peak, toUnit(s.rx), toUnit(s.tx));
    });
    const scale = pickScale(sess, peak);
    const labels = [fmtAxis(scale), fmtAxis((scale * 2) / 3), fmtAxis(scale / 3), '0'];
    ctx.font = '9px ' + cssVar('--font-mono', 'Consolas, monospace');
    const labelW = Math.max(...labels.map((t) => ctx.measureText(t).width));
    const left = Math.max(44, Math.min(92, Math.ceil(labelW) + 7));
    const w = Math.max(20, cssW - left - right);
    const h = Math.max(20, cssH - top - bottom);

    // 网格 + 左侧刻度（0 / 1/3 / 2/3 / 满量程，含单位）
    for (let i = 0; i <= 3; i++) {
      const y = top + (h / 3) * i;
      ctx.strokeStyle = grid;
      ctx.beginPath();
      ctx.moveTo(left, y + 0.5);
      ctx.lineTo(cssW - right, y + 0.5);
      ctx.stroke();
      ctx.fillStyle = muted;
      ctx.fillText(labels[i], left - 5, y);
    }

    if (!samples.length) return;

    const stepX = w / Math.max(1, 63);
    const xAt = (i) => left + i * stepX;
    const yAt = (v) => top + h - (Math.min(toUnit(v), scale) / scale) * h;

    const line = (key, color, fill) => {
      ctx.beginPath();
      samples.forEach((pt, i) => {
        const x = xAt(i);
        const y = yAt(pt[key]);
        i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
      });
      ctx.strokeStyle = color;
      ctx.lineWidth = 1.6;
      ctx.lineJoin = 'round';
      ctx.stroke();

      if (fill) {
        ctx.lineTo(xAt(samples.length - 1), top + h);
        ctx.lineTo(xAt(0), top + h);
        ctx.closePath();
        const g = ctx.createLinearGradient(0, top, 0, top + h);
        g.addColorStop(0, fill);
        g.addColorStop(1, 'rgba(255,255,255,0)');
        ctx.fillStyle = g;
        ctx.fill();
      }
    };

    const ok = cssVar('--ok', '#1ea97c');
    const accent = cssVar('--accent', '#16665a');
    line('tx', ok, hexRgba(ok, 0.16));
    line('rx', accent, hexRgba(accent, 0.2));
  }

  return { init, reset, renderAll, drawChart, renderNetLegend, relayout };
})();
