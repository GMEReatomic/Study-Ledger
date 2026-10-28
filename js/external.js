/* ==========================================================================
   外部工具页 · 邮箱本地备忘
   ========================================================================== */
(function () {
  'use strict';

  const T = window.Toolbox;
  const MEMO_KEY = T.STORAGE_KEYS.emailMemo;
  const MEMO_MAX = 2000;

  let saveTimer = 0;
  let memoLoaded = false;
  const els = {};

  function cacheElements() {
    els.memo = document.getElementById('emailMemo');
    els.status = document.getElementById('memoStatus');
    els.count = document.getElementById('memoCount');
    els.clear = document.getElementById('clearMemoBtn');
  }

  function updateCount(value) {
    if (els.count) els.count.textContent = `${value.length} / ${MEMO_MAX}`;
  }

  function setStatus(text, saved = false) {
    if (!els.status) return;
    els.status.textContent = text;
    els.status.classList.toggle('is-saved', saved);
  }

  function saveMemo(announce = false) {
    if (!els.memo) return;
    const value = els.memo.value.slice(0, MEMO_MAX);
    const ok = T.storageSet(MEMO_KEY, value);
    updateCount(value);
    if (!ok) {
      setStatus('本地存储不可用');
      if (announce) T.toast('浏览器本地存储不可用，备忘无法保存。', { type: 'error' });
      return;
    }
    setStatus(`已保存 ${T.formatTime(new Date(), false)}`, true);
    if (announce) T.toast('邮件备忘已保存在本机。', { type: 'info', duration: 1600 });
  }

  function scheduleSave() {
    if (!els.memo) return;
    updateCount(els.memo.value);
    setStatus('正在保存…');
    window.clearTimeout(saveTimer);
    saveTimer = window.setTimeout(() => saveMemo(false), 380);
  }

  async function clearMemo() {
    if (!els.memo || !els.memo.value) return;
    const ok = await T.confirmDialog({
      title: '清空邮件备忘？',
      message: '这条备注会从当前浏览器中移除，无法恢复。',
      confirmText: '清空备忘',
      cancelText: '保留',
      danger: true
    });
    if (!ok) return;
    els.memo.value = '';
    T.storageRemove(MEMO_KEY);
    updateCount('');
    setStatus('已清空', true);
    els.memo.focus();
    T.toast('邮件备忘已清空。', { type: 'info' });
  }

  function init() {
    cacheElements();
    if (!els.memo) return;
    const stored = T.storageGet(MEMO_KEY, '');
    els.memo.value = String(stored || '').slice(0, MEMO_MAX);
    memoLoaded = true;
    updateCount(els.memo.value);
    setStatus(els.memo.value ? '已读取本地备忘' : '本地保存', true);

    els.memo.addEventListener('input', scheduleSave);
    els.memo.addEventListener('blur', () => {
      window.clearTimeout(saveTimer);
      saveMemo(false);
    });
    els.clear?.addEventListener('click', clearMemo);

    window.addEventListener('pagehide', () => {
      if (memoLoaded) {
        window.clearTimeout(saveTimer);
        saveMemo(false);
      }
    }, { once: true });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init, { once: true });
  } else {
    init();
  }
})();
