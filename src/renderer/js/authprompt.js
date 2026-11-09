'use strict';
/**
 * 凭据输入浮窗
 * - 连接时没有保存密码 / 私钥，或认证被服务器拒绝 → 弹出输入框
 * - 带半透明模糊遮罩：主窗口不可操作，点击遮罩关闭；浮窗本身仍可拖动
 * - 标题显示 root@ip:端口；左下「保存密码 / 密钥」默认勾选；右下「重新连接」
 * - 支持在浮窗里切换「密码 / 密钥」两种登录方式；密钥可从密钥库下拉选择或导入
 * - 重连成功后才按勾选状态保存配置
 */
window.AuthPrompt = (function () {
  const $ = U.qs;
  const IMPORT_VALUE = '__import__';

  /** 需要弹窗的失败原因 */
  const AUTH_ERROR = /未读取到登录密码|未提供私钥|认证被拒绝|认证失败次数过多|私钥已加密|私钥格式无法解析|私钥文件不存在|All configured authentication methods failed|Too many authentication failures|Permission denied|Encrypted private OpenSSH key|Cannot parse privateKey/i;

  let el = null;
  let backdrop = null;   // 模糊遮罩：主窗口不可点击，点击遮罩关闭浮窗
  let state = null;      // 当前显示的弹窗数据
  const queue = [];      // 等待显示的弹窗（右键分组「连接全部」时会一次产生多个）

  function ensureBackdrop() {
    if (backdrop && document.body.contains(backdrop)) return backdrop;
    backdrop = document.createElement('div');
    backdrop.className = 'ap-backdrop';
    backdrop.id = 'ap-backdrop';
    document.body.appendChild(backdrop);
    backdrop.addEventListener('mousedown', (e) => {
      if (e.target !== backdrop) return;
      if (!state || state.busy) return;
      close();
    });
    return backdrop;
  }

  function showBackdrop() {
    ensureBackdrop().classList.add('show');
  }

  function hideBackdrop() {
    if (backdrop) backdrop.classList.remove('show');
  }

  function shouldPrompt(message) {
    return AUTH_ERROR.test(String(message || ''));
  }

  /* ---------------- 浮窗外壳（可拖动，无遮罩） ---------------- */

  function ensure() {
    if (el && document.body.contains(el)) return el;
    el = document.createElement('div');
    el.className = 'auth-prompt';
    el.id = 'auth-prompt';
    document.body.appendChild(el);
    ensureBackdrop();

    let drag = null;
    el.addEventListener('mousedown', (e) => {
      if (!e.target.closest('.ap-head') || e.target.closest('button')) return;
      const r = el.getBoundingClientRect();
      el.style.left = r.left + 'px';
      el.style.top = r.top + 'px';
      el.style.transform = 'none';
      drag = { x: e.clientX, y: e.clientY, left: r.left, top: r.top };
      document.body.classList.add('dragging-panel');
      e.preventDefault();
    });
    window.addEventListener('mousemove', (e) => {
      if (!drag) return;
      const left = Math.max(4, Math.min(window.innerWidth - 120, drag.left + e.clientX - drag.x));
      const top = Math.max(4, Math.min(window.innerHeight - 48, drag.top + e.clientY - drag.y));
      el.style.left = left + 'px';
      el.style.top = top + 'px';
    });
    window.addEventListener('mouseup', () => {
      drag = null;
      document.body.classList.remove('dragging-panel');
    });
    return el;
  }

  function isShowing() {
    return !!state && !!el && el.classList.contains('show');
  }

  /** 关闭当前弹窗；队列里还有就接着显示下一个（依次出现，不会同时堆叠） */
  function close() {
    state = null;
    if (el) el.classList.remove('show');
    hideBackdrop();
    showNext();
  }

  function showNext() {
    while (queue.length) {
      const next = queue.shift();
      if (!App.findConnection(next.configId)) continue; // 配置可能已被删除
      activate(next);
      return;
    }
  }

  /** 队列数量变化时只更新角标，不重绘整个浮窗（避免打断正在输入的内容） */
  function renderQueueHint() {
    const box = $('#ap-queue');
    if (!box) return;
    box.classList.toggle('hidden', !queue.length);
    box.textContent = queue.length ? `队列中还有 ${queue.length} 个配置等待输入凭据` : '';
  }

  /* ---------------- 渲染 ---------------- */

  function keyOptions(selected) {
    const keys = App.state.data.keys || [];
    const items = keys
      .map(
        (k) =>
          `<option value="${U.esc(k.id)}"${k.id === selected ? ' selected' : ''}>${U.esc(k.name)}${
            k.keyType ? ' · ' + U.esc(k.keyType) : ''
          }${k.hasPassphrase ? ' · 含口令' : ''}</option>`
      )
      .join('');
    return `<option value=""${selected ? '' : ' selected'}>手动粘贴</option>${items}<option value="${IMPORT_VALUE}">＋ 导入新密钥…</option>`;
  }

  function keyBodyHtml(cfg) {
    return `<div class="field">
        <label>密钥来源</label>
        <select id="ap-key-sel">${keyOptions(state.pickKeyId)}</select>
      </div>
      <div class="field" id="ap-key-manual">
        <label>私钥${cfg.keyId ? '（粘贴新私钥可覆盖当前配置）' : ''}</label>
        <textarea id="ap-key" spellcheck="false" placeholder="-----BEGIN OPENSSH PRIVATE KEY-----"></textarea>
      </div>
      <div class="ap-key-lib hidden" id="ap-key-lib"></div>
      <div class="field hidden" id="ap-phrase-field">
        <label>私钥口令（私钥未加密可留空）</label>
        <input id="ap-phrase" type="password" autocomplete="new-password" placeholder="私钥口令（可选）" />
      </div>
      <div class="ap-hint" id="ap-key-hint"></div>`;
  }

  function bodyHtml(authType, cfg) {
    if (authType === 'key') return keyBodyHtml(cfg);
    return `<div class="field">
        <label>登录密码</label>
        <input id="ap-pass" type="password" autocomplete="new-password" placeholder="输入 ${U.esc(
          cfg.user || 'root'
        )} 的登录密码，回车可直接重连" />
      </div>
      <div class="ap-hint">密码将使用 AES / 系统安全存储加密保存在本机，不会明文落盘。</div>`;
  }

  function fillDraft(draft) {
    const user = $('#ap-user');
    if (user) user.value = (draft && draft.user) || '';
    const pass = $('#ap-pass');
    if (pass) pass.value = (draft && draft.password) || '';
    const key = $('#ap-key');
    if (key) key.value = (draft && draft.key) || '';
    const phrase = $('#ap-phrase');
    if (phrase) phrase.value = (draft && draft.phrase) || '';
  }

  function captureDraft() {
    if (!state) return;
    const user = $('#ap-user');
    if (user) state.draft.user = user.value;
    const pass = $('#ap-pass');
    if (pass) state.draft.password = pass.value;
    const key = $('#ap-key');
    if (key) state.draft.key = key.value;
    const phrase = $('#ap-phrase');
    if (phrase) state.draft.phrase = phrase.value;
  }

  /** 密钥来源切换：手动粘贴时显示文本框，选中密钥库条目时隐藏文本框 */
  function applyKeyMode() {
    const sel = $('#ap-key-sel');
    if (sel) {
      const manual = !state.pickKeyId;
      const manualBox = $('#ap-key-manual');
      if (manualBox) manualBox.classList.toggle('hidden', !manual);
      const libBox = $('#ap-key-lib');
      const key = state.pickKeyId ? (App.state.data.keys || []).find((k) => k.id === state.pickKeyId) : null;
      if (libBox) {
        libBox.classList.toggle('hidden', !key);
        if (key) {
          libBox.innerHTML = `已选用密钥库：<b>${U.esc(key.name)}</b>${key.keyType ? ' · ' + U.esc(key.keyType) : ''}${
            key.fingerprint ? ' · ' + U.esc(key.fingerprint.slice(0, 11)) : ''
          }${key.hasPassphrase ? ' · 含口令' : ''}`;
        }
      }
      const hint = $('#ap-key-hint');
      // 选中密钥库条目后，私钥文本框与口令框一并隐藏；
      // 只有连接时服务器提示"需要口令"才自动把口令框放出来
      const phraseField = $('#ap-phrase-field');
      if (phraseField) {
        phraseField.classList.toggle('hidden', !!state.pickKeyId && !state.showPassphrase);
      }
      if (hint) {
        if (manual) {
          hint.textContent = '粘贴完整私钥内容（含 BEGIN / END 行），.ppk 需先转换为 OpenSSH 格式；也可以从上方下拉选择已保存的密钥。';
        } else if (key && key.hasPassphrase) {
          hint.textContent = '将直接使用密钥库中的私钥（含已保存口令）连接，无需再输入口令。';
        } else {
          hint.textContent = '将直接使用密钥库中的私钥连接；若连接提示需要口令，会自动显示口令输入框。';
        }
      }
    }
  }

  /** 「保存密码 / 密钥」文案：用户名改动后提示会一并保存 */
  function syncSaveLabel() {
    if (!state) return;
    const el = $('#ap-save-label');
    if (!el) return;
    const cfg = App.findConnection(state.configId) || state.cfg;
    const changed = String((state.draft && state.draft.user) || '').trim() !== String(cfg.user || '');
    el.textContent = `保存${state.authType === 'key' ? '密钥' : '密码'}${changed ? '与用户名' : ''}`;
  }

  function paint() {
    const box = ensure();
    const cfg = App.findConnection(state.configId) || state.cfg;
    const addr = `${(state.draft && state.draft.user) || cfg.user || 'root'}@${cfg.host || ''}:${cfg.port || 22}`;
    const isKey = state.authType === 'key';
    box.innerHTML = `
      <div class="ap-head">
        <span class="ap-title" title="${U.esc(addr)}">${U.esc(addr)}</span>
        <button class="icon-btn ap-close" id="ap-close" title="关闭">✕</button>
      </div>
      <div class="ap-sub">${U.esc(cfg.name || cfg.host || '')}</div>
      <div class="ap-queue${queue.length ? '' : ' hidden'}" id="ap-queue">${
        queue.length ? `队列中还有 ${queue.length} 个配置等待输入凭据` : ''
      }</div>
      ${state.reason ? `<div class="ap-reason">${U.esc(state.reason)}</div>` : ''}
      <div class="ap-user">
        <div class="field">
          <label>用户名</label>
          <input id="ap-user" type="text" spellcheck="false" autocomplete="off" placeholder="登录用户名" />
        </div>
      </div>
      <div class="ap-switch" role="tablist">
        <button class="ap-switch-btn${isKey ? '' : ' active'}" data-auth="password">密码登录</button>
        <button class="ap-switch-btn${isKey ? ' active' : ''}" data-auth="key">密钥登录</button>
      </div>
      <div class="ap-body">${bodyHtml(state.authType, cfg)}</div>
      <div class="ap-foot">
        <label class="check-inline"><input type="checkbox" id="ap-save"${
          state.save === false ? '' : ' checked'
        } /> <span id="ap-save-label">保存${isKey ? '密钥' : '密码'}</span></label>
        <span class="pane-grow"></span>
        <button class="btn sm primary" id="ap-retry">重新连接</button>
      </div>`;
    fillDraft(state.draft);
    const saveBox = $('#ap-save');
    if (saveBox) saveBox.addEventListener('change', () => { state.save = saveBox.checked; });

    // 用户名可直接修改：标题与「保存」文案实时跟随
    const userBox = $('#ap-user');
    if (userBox) {
      userBox.addEventListener('input', () => {
        state.draft.user = userBox.value;
        const title = $('.ap-title');
        if (title) title.textContent = `${userBox.value.trim() || cfg.user || 'root'}@${cfg.host || ''}:${cfg.port || 22}`;
        syncSaveLabel();
      });
      userBox.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          submit();
        }
      });
    }
    syncSaveLabel();

    const closeBtn = $('#ap-close');
    if (closeBtn) closeBtn.addEventListener('click', close);
    box.querySelectorAll('[data-auth]').forEach((btn) => {
      btn.addEventListener('click', () => {
        if (state.authType === btn.dataset.auth) return;
        captureDraft();
        const sb = $('#ap-save');
        if (sb) state.save = sb.checked;
        state.authType = btn.dataset.auth;
        state.reason = '';
        paint();
      });
    });

    const keySel = $('#ap-key-sel');
    if (keySel) {
      keySel.addEventListener('change', () => {
        if (keySel.value === IMPORT_VALUE) {
          keySel.value = state.pickKeyId || '';
          importKey();
          return;
        }
        captureDraft();
        state.pickKeyId = keySel.value;
        state.showPassphrase = false;
        applyKeyMode();
        if (!state.pickKeyId) {
          const keyBox = $('#ap-key');
          if (keyBox) keyBox.focus();
        }
      });
    }
    applyKeyMode();

    const retry = $('#ap-retry');
    if (retry) retry.addEventListener('click', submit);
    const pass = $('#ap-pass');
    if (pass) {
      pass.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          submit();
        }
      });
    }
    const focusEl = isKey ? (state.pickKeyId ? keySel : $('#ap-key')) : $('#ap-pass');
    if (focusEl) setTimeout(() => focusEl.focus(), 30);
  }

  /** 导入密钥到密钥库，成功后自动选中该密钥 */
  function importKey() {
    if (!window.Connections || !Connections.importKeyDialog) return U.toast('密钥库不可用', 'error');
    Connections.importKeyDialog((newId) => {
      if (newId) {
        state.pickKeyId = newId;
        paint();
        el.classList.add('show');
        showBackdrop();
      }
    });
  }

  /** 真正显示某个配置的凭据浮窗 */
  function activate(item) {
    const cfg = App.findConnection(item.configId) || item.cfg;
    if (!cfg) return;
    ensure();
    state = {
      configId: cfg.id,
      cfg: Object.assign({}, cfg),
      session: item.session || null,
      authType: item.authType || (cfg.authType === 'key' ? 'key' : 'password'),
      reason: item.reason || '',
      save: true,
      busy: false,
      pickKeyId: '',
      showPassphrase: /口令/.test(String(item.reason || '')),
      draft: { user: cfg.user || 'root', password: '', key: '', phrase: '' }
    };
    // 每个新弹窗都回到顶部居中的默认位置（拖动过也重置），便于统一从顶部滑下
    if (el) {
      el.style.left = '';
      el.style.top = '';
      el.style.transform = '';
    }
    paint();
    el.classList.remove('show');
    void el.offsetWidth; // 触发重排，保证每次显示都能重播动画
    el.classList.add('show');
    showBackdrop();
  }

  /**
   * @param {{configId:string, session?:object, reason?:string, authType?:string}} opts
   * 同一时间只显示一个；已有弹窗时先入队，前一个处理完（成功 / 关闭）再显示下一个
   */
  function open(opts) {
    const cfg = App.findConnection((opts && opts.configId) || '');
    if (!cfg) return;
    const item = {
      configId: cfg.id,
      cfg,
      session: (opts && opts.session) || null,
      reason: (opts && opts.reason) || '',
      authType: (opts && opts.authType) || ''
    };
    ensure();
    if (isShowing()) {
      if (state.configId === item.configId) {
        // 同一个配置的再次报错：只更新原因，不新建弹窗
        if (item.reason) state.reason = item.reason;
        if (item.session) state.session = item.session;
        paint();
        el.classList.add('show');
        showBackdrop();
        return;
      }
      const i = queue.findIndex((q) => q.configId === item.configId);
      if (i >= 0) queue[i] = Object.assign({}, queue[i], item);
      else queue.push(item);
      renderQueueHint();
      return;
    }
    // 没有正在显示的弹窗，但队列里可能还压着别的（例如刚关闭上一个）
    const i = queue.findIndex((q) => q.configId === item.configId);
    if (i >= 0) queue.splice(i, 1);
    activate(item);
  }

  /* ---------------- 重连 + 成功后才保存 ---------------- */

  /** 同一配置下最近的一个标签（重试时复用它，避免标签越点越多） */
  function latestSessionFor(configId) {
    let last = null;
    App.state.sessions.forEach((s) => {
      if (s && s.config && s.config.id === configId) last = s;
    });
    return last;
  }

  async function persistConfig(authType, draft) {
    const cfg = App.findConnection(state.configId);
    if (!cfg) return null;
    const payload = {
      id: cfg.id,
      name: cfg.name,
      group: cfg.group,
      host: cfg.host,
      port: cfg.port,
      user: (draft && String(draft.user || '').trim()) || cfg.user,
      authType,
      keyPath: cfg.keyPath || '',
      proxyEnabled: !!cfg.proxyEnabled,
      proxyId: cfg.proxyId || '',
      clearMotd: cfg.clearMotd !== false
    };
    if (authType === 'key') {
      if (state.pickKeyId) {
        payload.keyId = state.pickKeyId;
      } else if (draft.key) {
        payload.privateKey = draft.key;
        payload.keyId = '';
        if (draft.phrase) payload.passphrase = draft.phrase;
      } else if (draft.phrase) {
        payload.passphrase = draft.phrase;
      }
    } else {
      payload.password = draft.password;
    }
    const res = await window.api.saveConnection(payload);
    if (res && res.state) App.setData(res.state);
    return res;
  }

  async function submit() {
    if (!state || state.busy) return;
    const authType = state.authType;
    captureDraft();
    const draft = state.draft;
    const cfg = App.findConnection(state.configId) || state.cfg;

    const username = String(draft.user || '').trim();
    if (!username) return U.toast('请输入登录用户名', 'error');
    if (authType === 'password' && !draft.password) return U.toast('请输入登录密码', 'error');
    if (authType === 'key') {
      const hasStoredKey = !!cfg.keyId || !!cfg.hasPrivateKey || !!cfg.keyPath;
      if (!state.pickKeyId && !draft.key && !hasStoredKey && !draft.phrase) {
        return U.toast('请选择 / 粘贴私钥，或填写私钥口令', 'error');
      }
    }

    const save = state.save !== false;
    const creds = { authType, user: username };
    if (authType === 'password') {
      creds.password = draft.password;
    } else if (state.pickKeyId) {
      creds.keyId = state.pickKeyId;
      if (draft.phrase) creds.passphrase = draft.phrase;
    } else {
      if (draft.key) creds.privateKey = draft.key;
      if (draft.phrase) creds.passphrase = draft.phrase;
    }

    const btn = $('#ap-retry');
    state.busy = true;
    if (btn) {
      btn.disabled = true;
      btn.textContent = '正在连接…';
    }

    let result = null;
    try {
      const configId = state.configId;
      const sess = latestSessionFor(configId) || state.session;
      result = sess && window.Term ? await Term.reconnectSession(sess, creds) : await Term.connect(configId, creds);
    } catch (err) {
      U.toast(U.cleanError(err), 'error', 4200);
    }

    state.busy = false;
    if (btn) {
      btn.disabled = false;
      btn.textContent = '重新连接';
    }
    if (!result) {
      // 失败：保留浮窗，把最新错误显示在浮窗里，方便继续改
      const cur = latestSessionFor(state.configId);
      if (cur && cur.error) {
        state.reason = cur.error;
        // 提示需要私钥口令时，重新显示口令输入框
        if (/口令|passphrase/i.test(cur.error)) state.showPassphrase = true;
      }
      paint();
      el.classList.add('show');
      showBackdrop();
      return;
    }

    // 连接成功：按勾选状态保存配置（登录方式 + 凭据来源）
    if (save) {
      try {
        await persistConfig(authType, draft);
        U.toast('连接成功，配置已保存', 'ok', 2200);
      } catch (err) {
        U.toast('连接成功，但保存配置失败：' + U.cleanError(err), 'error', 4200);
      }
    }
    close();
  }

  return { open, close, submit, shouldPrompt };
})();
