'use strict';
/* 云账号：顶栏登录入口、登录 / 注册弹窗、个人信息面板、云同步开关 */
window.Account = (function () {
  const $ = U.qs;

  const state = {
    loggedIn: false,
    email: '',
    createdAt: 0,
    serviceExpiresAt: 0,
    usedPercent: 0,
    syncRev: 0,
    isAdmin: false,
    inviteCode: '',
    invitedCount: 0,
    inviteRewards: 0,
    inviteRewardDays: 0,
    inviteRewardMax: 0,
    apiBase: '',
    site: { siteName: '', latestVersion: '', versionNote: '' },
    siteError: false,
    cloud: { enabled: false, email: '', syncStatus: 'idle', lastSyncAt: 0, lastError: '' }
  };
  let boot = { firstUser: false, needCode: true, registrationOpen: true, siteName: '', latestVersion: '', emailSuffixes: [] };
  let mode = 'login';
  let codeTimer = null;
  let profileOpen = false;

  const DEFAULT_SUFFIXES = ['@gmail.com', '@qq.com'];

  /** IPC 错误会带一大段前缀，这里统一收敛成简短可读的提示 */
  function friendlyError(err) {
    let msg = String((err && err.message) || err || '');
    msg = msg.replace(/^Error invoking remote method '[^']+':\s*/i, '').replace(/^Error:\s*/i, '');
    if (/无法连接云服务|ECONNREFUSED|ENOTFOUND|EAI_AGAIN|fetch failed|网络|超时|timeout/i.test(msg)) {
      return '无法连接云服务，请检查网络或稍候片刻';
    }
    return msg || '操作失败';
  }

  /* ---------------- 顶栏按钮 ---------------- */

  function syncStatusText() {
    const c = state.cloud || {};
    if (!c.enabled) return '已关闭';
    const map = { syncing: '同步中…', pending: '待同步', success: '已同步', error: '同步失败' };
    return map[c.syncStatus] || '待同步';
  }

  function renderButton() {
    const btn = $('#tb-account');
    if (!btn) return;
    if (state.loggedIn) {
      btn.textContent = state.email;
      btn.title = '账号：' + state.email + ' · 云同步' + (state.cloud && state.cloud.enabled ? '已开启' : '已关闭');
      btn.classList.add('signed');
    } else {
      btn.textContent = '登录';
      btn.title = '登录 / 注册 LIULI 云服务';
      btn.classList.remove('signed');
    }
    btn.classList.toggle('syncing', !!(state.cloud && state.cloud.enabled && state.cloud.syncStatus === 'syncing'));
  }

  /* ---------------- 登录 / 注册弹窗 ---------------- */

  function tip(text, kind) {
    const el = $('#ac-tip');
    if (!el) return;
    el.textContent = text || '';
    el.className = 'ac-tip' + (kind ? ' ' + kind : '');
  }

  function setMode(next) {
    mode = next === 'register' ? 'register' : 'login';
    const reg = mode === 'register';
    U.qsa('.ac-tab').forEach((b) => b.classList.toggle('active', b.dataset.mode === mode));
    $('#ac-title').textContent = reg ? '注册云服务账号' : '登录云服务';
    $('#ac-submit').textContent = reg ? '注册并登录' : '登录';
    $('#ac-pass2-field').classList.toggle('hidden', !reg);
    $('#ac-invite-field').classList.toggle('hidden', !reg);
    const showCode = reg && boot.needCode && !boot.firstUser;
    $('#ac-code-field').classList.toggle('hidden', !showCode);
    $('#ac-pass').setAttribute('autocomplete', reg ? 'new-password' : 'current-password');
    tip('');
    updateFoot();
  }

  /** 邮箱 = 前缀 + 下拉后缀 */
  function currentEmail() {
    const local = $('#ac-email-local').value.trim();
    const suffix = $('#ac-suffix').value || DEFAULT_SUFFIXES[0];
    return local ? local + suffix : '';
  }

  function applySuffixes(list) {
    const sel = $('#ac-suffix');
    if (!sel) return;
    const arr = Array.isArray(list) && list.length ? list : DEFAULT_SUFFIXES;
    const keep = sel.value;
    sel.innerHTML = arr.map((s) => `<option value="${U.esc(s)}">${U.esc(s)}</option>`).join('');
    sel.value = arr.includes(keep) ? keep : arr[0];
  }

  function updateFoot() {
    const el = $('#ac-foot');
    if (el) el.textContent = boot.siteName || 'LIULI Shell 云服务';
    if (mode === 'register' && !boot.registrationOpen && !boot.firstUser) tip('管理员已关闭注册', 'error');
  }

  async function openModal() {
    if (state.loggedIn) {
      toggleProfile();
      return;
    }
    $('#ac-mask').classList.add('show');
    applySuffixes(DEFAULT_SUFFIXES);
    setMode('login');
    try {
      boot = await window.api.accountBootstrap();
      applySuffixes(boot.emailSuffixes);
      // 保留用户期间切到的「注册」页，只刷新字段可见性
      setMode(mode);
      updateFoot();
    } catch (err) {
      updateFoot();
      tip(friendlyError(err), 'error');
    }
    setTimeout(() => { try { $('#ac-email-local').focus(); } catch (_) {} }, 60);
  }

  function closeModal() {
    $('#ac-mask').classList.remove('show');
  }

  function startCountdown(btn) {
    let left = 60;
    btn.classList.remove('loading');
    btn.removeAttribute('aria-busy');
    btn.disabled = true;
    btn.textContent = left + 's';
    clearInterval(codeTimer);
    codeTimer = setInterval(() => {
      left--;
      if (left <= 0) {
        clearInterval(codeTimer);
        codeTimer = null;
        btn.disabled = false;
        btn.textContent = '获取验证码';
      } else {
        btn.textContent = left + 's';
      }
    }, 1000);
  }

  async function sendCode() {
    const email = currentEmail();
    if (!email) return tip('请填写邮箱前缀', 'error');
    if (!boot.registrationOpen && !boot.firstUser) return tip('管理员已关闭注册', 'error');
    const btn = $('#ac-send');
    btn.disabled = true;
    btn.classList.add('loading');
    btn.setAttribute('aria-busy', 'true');
    btn.textContent = '发送中';
    try {
      const r = await window.api.accountSendCode(email);
      startCountdown(btn);
      if (r && r.devCode) tip('开发模式验证码：' + r.devCode + '（仅本地调试可见）', 'note');
      else tip('验证码已发送，没收到请查看邮件垃圾箱', 'note');
      if (boot.firstUser) $('#ac-code-field').classList.add('hidden');
    } catch (err) {
      btn.classList.remove('loading');
      btn.removeAttribute('aria-busy');
      btn.disabled = false;
      btn.textContent = '获取验证码';
      tip(friendlyError(err), 'error');
    }
  }

  async function submit(e) {
    e.preventDefault();
    const email = currentEmail();
    const password = $('#ac-pass').value;
    if (!email) return tip('请填写邮箱前缀', 'error');
    if (!password) return tip('请填写密码', 'error');
    if (password.length < 6) return tip('密码至少 6 位', 'error');

    const btn = $('#ac-submit');
    btn.disabled = true;
    try {
      if (mode === 'login') {
        await window.api.accountLogin({ email, password });
        closeModal();
        U.toast('登录成功', 'ok');
      } else {
        if (!boot.registrationOpen && !boot.firstUser) return tip('管理员已关闭注册', 'error');
        const pass2 = $('#ac-pass2').value;
        if (password !== pass2) return tip('两次输入的密码不一致', 'error');
        const needCode = boot.needCode && !boot.firstUser;
        const code = $('#ac-code').value.trim();
        if (needCode && !/^\d{6}$/.test(code)) return tip('请填写 6 位邮箱验证码', 'error');
        await window.api.accountRegister({ email, password, code, inviteCode: $('#ac-invite').value.trim() });
        closeModal();
        U.toast('注册成功，已自动登录', 'ok');
      }
      $('#ac-pass').value = '';
      $('#ac-pass2').value = '';
      $('#ac-code').value = '';
      $('#ac-invite').value = '';
    } catch (err) {
      tip(friendlyError(err), 'error');
    } finally {
      btn.disabled = false;
    }
  }

  /* ---------------- 个人信息面板 ---------------- */

  function renderProfile() {
    const c = state.cloud || {};
    const email = state.email || '—';
    $('#acp-email').textContent = email;
    $('#acp-email').title = email;
    $('#acp-avatar').textContent = email.slice(0, 1).toUpperCase();
    $('#acp-since').textContent = state.createdAt ? '注册于 ' + U.fmtTime(state.createdAt) : '';

    const inviteCode = state.inviteCode || '';
    const inviteDays = Number(state.inviteRewardDays) || 0;
    // 未开启邀请奖励（获赠天数为 0）时整块隐藏
    const inviteBox = $('#acp-invite-box');
    if (inviteBox) inviteBox.classList.toggle('hidden', inviteDays <= 0);
    const inviteEl = $('#acp-invite');
    if (inviteEl) inviteEl.textContent = inviteCode || '—';
    const copyBtn = $('#acp-invite-copy');
    if (copyBtn) copyBtn.classList.toggle('hidden', !inviteCode);
    const inviteNote = $('#acp-invite-note');
    if (inviteNote) {
      const n = Number(state.invitedCount) || 0;
      inviteNote.textContent = inviteCode
        ? `已邀请 ${n} 人 · 每邀请1人 获赠${inviteDays}天云服务`
        : '';
    }

    // 账号状态：正常 / 即将到期 / 已到期
    const exp = Number(state.serviceExpiresAt) || 0;
    const now = Date.now();
    const accEl = $('#acp-account');
    if (exp && exp <= now) {
      accEl.textContent = '已到期';
      accEl.className = 'acp-v acp-danger';
    } else if (exp && exp - now <= 7 * 86400000) {
      accEl.textContent = '即将到期';
      accEl.className = 'acp-v acp-warn';
    } else {
      accEl.textContent = '正常';
      accEl.className = 'acp-v';
    }

    // 云服务到期：主题色表示可点击，临近/过期用提醒色
    const expEl = $('#acp-expire');
    if (!exp) {
      expEl.textContent = '长期有效';
      expEl.className = 'acp-v acp-link';
    } else {
      expEl.textContent = U.fmtTime(exp);
      expEl.className = 'acp-v acp-link' + (exp <= now ? ' acp-danger' : exp - now <= 7 * 86400000 ? ' acp-warn' : '');
    }

    // 最新版本（点击打开官网），下方显示当前版本的更新内容
    const site = state.site || {};
    const footLabel = $('#acp-foot-label');
    const verEl = $('#acp-version');
    const verNote = $('#acp-ver-note');
    if (state.siteError) {
      footLabel.textContent = '云服务链接异常 请稍后重试';
      footLabel.classList.add('acp-foot-err');
      verEl.classList.add('hidden');
      if (verNote) { verNote.textContent = ''; verNote.classList.add('hidden'); }
    } else {
      footLabel.textContent = '最新版本';
      footLabel.classList.remove('acp-foot-err');
      verEl.classList.remove('hidden');
      verEl.textContent = site.latestVersion ? 'v' + site.latestVersion : '—';
      if (verNote) {
        if (site.versionNote) {
          verNote.textContent = site.versionNote;
          verNote.classList.remove('hidden');
        } else {
          verNote.textContent = '';
          verNote.classList.add('hidden');
        }
      }
    }

    // 云端用量：只显示百分比
    const pct = Math.max(0, Math.min(100, Number(state.usedPercent) || 0));
    $('#acp-percent').textContent = pct + '%';
    const fill = $('#acp-bar-fill');
    fill.style.width = pct + '%';
    fill.className = pct >= 90 ? 'full' : pct >= 70 ? 'high' : '';

    // 云同步：标题 + 上次同步说明 + 开关
    const sw = $('#acp-sync');
    const serviceExpired = exp > 0 && exp <= now;
    sw.className = 'acp-toggle' + (c.enabled ? ' on' : '');
    sw.setAttribute('aria-checked', c.enabled ? 'true' : 'false');
    sw.disabled = serviceExpired && !c.enabled;
    sw.title = serviceExpired
      ? '云服务已到期，请先续费'
      : (c.enabled && c.syncStatus === 'error' && c.lastError
        ? '同步失败：' + c.lastError
        : '开启 / 关闭云同步');
    $('#acp-sync-title').textContent = '云同步服务 - ' + (c.enabled ? '已开启' : '关闭');
    $('#acp-sync-sub').textContent = serviceExpired
      ? '云服务已到期，同步已暂停'
      : (c.enabled
        ? (c.lastSyncAt ? '上次同步 - ' + U.fmtTime(c.lastSyncAt) : '尚未同步')
        : '未开启云同步服务');

    // 公告已移除
    $('#acp-now').disabled = !c.enabled || serviceExpired;
  }

  function openProfile() {
    renderProfile();
    $('#ac-pop').classList.add('show');
    profileOpen = true;
    window.api.accountRefresh().then((r) => {
      if (r && r.account) {
        state.siteError = false;
        applyState(r.account);
      }
    }).catch(() => {
      state.siteError = true;
      if (profileOpen) renderProfile();
    });
  }

  function closeProfile() {
    $('#ac-pop').classList.remove('show');
    profileOpen = false;
  }

  function toggleProfile() {
    if (profileOpen) closeProfile();
    else openProfile();
  }

  async function toggleSync() {
    const on = !(state.cloud && state.cloud.enabled);
    const exp = Number(state.serviceExpiresAt) || 0;
    if (on && exp > 0 && exp <= Date.now()) {
      U.toast('云服务已到期，请先续费后再开启云同步', 'error', 3200);
      return;
    }
    const wd = ((App.state.data.settings || {}).webdav) || {};
    if (on && wd.enabled !== false && (wd.url || '').trim()) {
      const ok = await U.confirmDialog('开启云同步', '开启云端同步会自动关闭 WebDAV 云同步，两者不能同时启用。继续？', '开启云同步', false);
      if (!ok) return;
    }
    const btn = $('#acp-sync');
    btn.disabled = true;
    try {
      const acc = await window.api.cloudSetSync(on);
      applyState(acc);
      if (on) {
        U.toast('云同步已开启，稍后会自动合并并上传配置', 'ok', 3200);
        if (wd.enabled !== false && (wd.url || '').trim()) U.toast('已自动关闭 WebDAV 云同步', 'info', 3200);
      } else {
        U.toast('云同步已关闭', 'info');
      }
    } catch (err) {
      U.toast(friendlyError(err), 'error', 4000);
    } finally {
      btn.disabled = false;
    }
  }

  async function syncNow() {
    const exp = Number(state.serviceExpiresAt) || 0;
    if (exp > 0 && exp <= Date.now()) {
      U.toast('云服务已到期，请先续费后再同步', 'error', 3200);
      return;
    }
    const btn = $('#acp-now');
    btn.disabled = true;
    btn.textContent = '同步中…';
    try {
      const r = await window.api.cloudSyncNow();
      const bits = ['同步完成'];
      if (r && r.added) bits.push('新增 ' + r.added + ' 项');
      if (r && r.firstSync) bits.push('首次合并');
      U.toast(bits.join('，'), 'ok', 3200);
    } catch (err) {
      U.toast(friendlyError(err), 'error', 4200);
    } finally {
      btn.textContent = '立即同步';
      btn.disabled = !(state.cloud && state.cloud.enabled);
    }
  }

  async function logout() {
    const ok = await U.confirmDialog('退出登录', '退出后本机配置仍保留，但会关闭云同步。确定退出？', '退出登录');
    if (!ok) return;
    try {
      const acc = await window.api.accountLogout();
      closeProfile();
      applyState(acc);
      U.toast('已退出登录', 'info');
    } catch (err) {
      U.toast(friendlyError(err), 'error');
    }
  }

  /* ---------------- 状态同步 ---------------- */

  function applyState(next) {
    if (!next) return;
    Object.assign(state, next);
    renderButton();
    if (profileOpen) renderProfile();
  }

  function init() {
    const btn = $('#tb-account');
    if (btn) btn.addEventListener('click', openModal);

    U.qsa('.ac-tab').forEach((b) => b.addEventListener('click', () => setMode(b.dataset.mode)));
    const close = $('#ac-close');
    if (close) close.addEventListener('click', closeModal);
    const mask = $('#ac-mask');
    if (mask) {
      mask.addEventListener('mousedown', (e) => {
        if (e.target === mask) closeModal();
      });
    }
    const form = $('#ac-form');
    if (form) form.addEventListener('submit', submit);
    const send = $('#ac-send');
    if (send) send.addEventListener('click', sendCode);

    const pop = $('#ac-pop');
    if (pop) {
      $('#acp-close').addEventListener('click', closeProfile);
      $('#acp-sync').addEventListener('click', toggleSync);
      $('#acp-now').addEventListener('click', syncNow);
      $('#acp-logout').addEventListener('click', logout);
      $('#acp-version').addEventListener('click', () => {
        window.api.openExternal('https://shell.minecft.cn').catch(() => {});
      });
      $('#acp-expire').addEventListener('click', () => {
        const base = String(state.apiBase || '').replace(/\/+$/, '');
        if (!base) return U.toast('未获取到云服务地址', 'error');
        window.api.openExternal(base + '/').catch(() => {});
      });
      const copyInvite = async () => {
        const code = state.inviteCode || '';
        if (!code) return;
        try {
          await navigator.clipboard.writeText(code);
          U.toast('邀请码已复制', 'ok', 2400);
        } catch (_) {
          U.toast('复制失败，请手动选择复制', 'error', 2400);
        }
      };
      $('#acp-invite').addEventListener('click', copyInvite);
      $('#acp-invite-copy').addEventListener('click', copyInvite);
    }
    document.addEventListener('mousedown', (e) => {
      if (!profileOpen) return;
      if (e.target.closest('#ac-pop') || e.target.closest('#tb-account')) return;
      closeProfile();
    });
    document.addEventListener('keydown', (e) => {
      if (e.key !== 'Escape') return;
      if (profileOpen) closeProfile();
      if ($('#ac-mask').classList.contains('show')) closeModal();
    });

    window.api.accountState().then(applyState).catch(() => {});
    window.api.on('account:changed', applyState);
  }

  document.addEventListener('DOMContentLoaded', init);
  return {
    init,
    open: openModal,
    profile: openProfile,
    state: () => state
  };
})();
