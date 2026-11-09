'use strict';
/* 全局状态：会话、数据、面板联动 */
window.App = (function () {
  const listeners = {};

  const state = {
    data: { groups: [], connections: [], snippetBoards: [], settings: {} },
    sessions: new Map(),
    activeId: null,
    filter: '',
    clipboard: null,
    pendingData: new Map(),
    pendingSysinfo: new Map(),
    transfers: new Map(),
    sendTarget: 'current'
  };

  function on(evt, fn) {
    (listeners[evt] = listeners[evt] || []).push(fn);
    return () => {
      listeners[evt] = (listeners[evt] || []).filter((f) => f !== fn);
    };
  }

  function emit(evt, payload) {
    (listeners[evt] || []).forEach((fn) => {
      try {
        fn(payload);
      } catch (err) {
        console.error('[app] listener error', err);
      }
    });
  }

  const api = {
    state,
    on,
    emit,
    get active() {
      return state.activeId ? state.sessions.get(state.activeId) || null : null;
    },
    get settings() {
      return state.data.settings || {};
    },
    session(id) {
      return state.sessions.get(id) || null;
    },
    addSession(sess, beforeId) {
      if (beforeId) {
        const entries = Array.from(state.sessions.entries());
        const idx = entries.findIndex(([id]) => id === beforeId);
        if (idx >= 0) entries.splice(idx, 0, [sess.id, sess]);
        else entries.push([sess.id, sess]);
        state.sessions = new Map(entries);
      } else {
        state.sessions.set(sess.id, sess);
      }
      emit('sessions:change');
    },
    /** 用真实会话替换连接中的占位会话，并保持标签位置 */
    replaceSession(oldId, sess) {
      const entries = Array.from(state.sessions.entries());
      const idx = entries.findIndex(([id]) => id === oldId);
      const wasActive = state.activeId === oldId;
      if (idx >= 0) entries[idx] = [sess.id, sess];
      else entries.push([sess.id, sess]);
      state.sessions = new Map(entries);
      if (wasActive) state.activeId = sess.id;
      emit('sessions:change');
      if (wasActive) emit('active:change', sess);
    },
    /** 拖拽排序：把 id 插到 targetId 前/后 */
    moveSession(id, targetId, after) {
      if (!id || !targetId || id === targetId) return;
      const entries = Array.from(state.sessions.entries());
      const from = entries.findIndex(([x]) => x === id);
      if (from < 0) return;
      const [item] = entries.splice(from, 1);
      let to = entries.findIndex(([x]) => x === targetId);
      if (to < 0) return;
      if (after) to += 1;
      entries.splice(to, 0, item);
      state.sessions = new Map(entries);
      emit('sessions:change');
    },
    removeSession(id) {
      if (!state.sessions.has(id)) return;
      state.sessions.delete(id);
      if (state.activeId === id) {
        const next = Array.from(state.sessions.keys())[0] || null;
        api.setActive(next);
      }
      emit('sessions:change');
    },
    setActive(id) {
      if (id && !state.sessions.has(id)) return;
      state.activeId = id;
      emit('active:change', id ? state.sessions.get(id) : null);
    },
    setData(data) {
      state.data = data;
      const t = (data.settings || {}).sendTarget;
      state.sendTarget = t === 'all' ? 'all' : 'current';
      emit('data:change', data);
    },
    /** 全局保存发送目标（当前会话 / 全部会话） */
    setSendTarget(value) {
      const v = value === 'all' ? 'all' : 'current';
      state.sendTarget = v;
      state.data.settings.sendTarget = v;
      window.api.saveSettings({ sendTarget: v });
      emit('target:change', v);
    },
    findConnection(id) {
      return (state.data.connections || []).find((c) => c.id === id) || null;
    }
  };

  return api;
})();
