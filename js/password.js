/* ==========================================================================
   密码保险箱
   - PBKDF2(SHA-256, 100000) 派生 AES-GCM 256 密钥
   - 每条记录独立随机 IV，整体加密后写入 IndexedDB
   - 主密码不落盘，仅保存盐与加密验证块
   ========================================================================== */
(function () {
  'use strict';

  const T = window.Toolbox;
  const META_KEY = 'vault-settings';
  const VERIFIER_TEXT = 'toolbox-vault-verifier-v1';
  const AUTO_LOCK_MS = 5 * 60 * 1000;
  const MAX_BACKUP_BYTES = 12 * 1024 * 1024;
  const MASK = '••••••••••••';

  const state = {
    key: null,
    meta: null,
    records: [],
    search: '',
    editingId: null,
    generatedPassword: '',
    lastActivity: 0,
    ticker: null
  };

  const els = {};

  function cacheElements() {
    [
      'cryptoWarning', 'vaultLoading', 'vaultUnsupported', 'vaultSetup', 'vaultLock',
      'vaultUnlocked', 'setupForm', 'setupPassword', 'setupConfirm', 'setupError',
      'setupSubmit', 'unlockForm', 'unlockPassword', 'unlockError', 'unlockSubmit',
      'autoLockCountdown', 'vaultRecordCount', 'exportVaultBtn', 'importVaultBtn',
      'lockNowBtn', 'vaultSearch', 'addRecordBtn', 'vaultList', 'generatedPassword',
      'copyGeneratedBtn', 'generatorLength', 'generatorLengthValue', 'genUpper',
      'genLower', 'genDigits', 'genSymbols', 'regenerateBtn', 'useGeneratedBtn',
      'backupFile', 'recordDialog', 'recordForm', 'recordId', 'recordSite',
      'recordUsername', 'recordUrl', 'recordPassword', 'recordNotes', 'recordError',
      'recordDialogTitle', 'recordDialogIntro', 'recordSaveBtn', 'recordCancelBtn',
      'recordGenerateBtn', 'setupImportBtn', 'unlockImportBtn'
    ].forEach((id) => {
      els[id] = document.getElementById(id);
    });
  }

  /* ------------------------------------------------------------------------
     视图与通用提示
     ------------------------------------------------------------------------ */
  function showView(name) {
    const views = {
      loading: els.vaultLoading,
      unsupported: els.vaultUnsupported,
      setup: els.vaultSetup,
      lock: els.vaultLock,
      unlocked: els.vaultUnlocked
    };
    Object.entries(views).forEach(([key, node]) => {
      if (node) node.hidden = key !== name;
    });
  }

  function setBusy(button, busy, label = '处理中…') {
    if (!button) return;
    if (busy) {
      if (!button.dataset.idleHtml) button.dataset.idleHtml = button.innerHTML;
      button.disabled = true;
      button.innerHTML = `<span class="spinner" aria-hidden="true"></span>${T.escapeHtml(label)}`;
    } else {
      button.disabled = false;
      if (button.dataset.idleHtml) {
        button.innerHTML = button.dataset.idleHtml;
        delete button.dataset.idleHtml;
      }
    }
  }

  function showInlineError(node, message) {
    if (!node) return;
    const text = node.querySelector('span');
    if (text) text.textContent = message;
    else node.textContent = message;
    node.hidden = false;
  }

  function clearInlineError(node) {
    if (!node) return;
    const text = node.querySelector('span');
    if (text) text.textContent = '';
    node.hidden = true;
  }

  function focusUnlock() {
    window.setTimeout(() => els.unlockPassword?.focus(), 80);
  }

  function setPasswordVisibility(input, show) {
    if (!input) return;
    input.type = show ? 'text' : 'password';
    const button = document.querySelector(`[data-toggle-password][data-target="#${input.id}"]`);
    if (button) {
      button.innerHTML = T.iconMarkup(show ? 'eye-off' : 'eye');
      button.setAttribute('aria-pressed', String(show));
      button.setAttribute('aria-label', show ? '隐藏密码' : '显示密码');
    }
  }

  function initPasswordToggles() {
    document.addEventListener('click', (event) => {
      const button = event.target.closest('[data-toggle-password]');
      if (!button) return;
      const target = document.querySelector(button.dataset.target || '');
      if (!target) return;
      setPasswordVisibility(target, target.type === 'password');
    });
  }

  /* ------------------------------------------------------------------------
     IDB 中的保险箱元信息
     ------------------------------------------------------------------------ */
  function isValidMeta(meta) {
    return Boolean(
      T.isPlainObject(meta)
      && typeof meta.salt === 'string'
      && meta.salt.length >= 16
      && Number(meta.iterations) === T.PBKDF2_ITERATIONS
      && T.isPlainObject(meta.verifier)
      && typeof meta.verifier.iv === 'string'
      && typeof meta.verifier.data === 'string'
    );
  }

  function timestampOf(value) {
    const parsed = Date.parse(String(value || ''));
    return Number.isFinite(parsed) ? parsed : 0;
  }

  function normalizePayload(payload) {
    if (!T.isPlainObject(payload)) return null;
    const site = String(payload.site || '').trim().slice(0, 80);
    const password = String(payload.password == null ? '' : payload.password);
    if (!site || !password) return null;
    return {
      site,
      username: String(payload.username || '').trim().slice(0, 120),
      password,
      url: String(payload.url || '').trim().slice(0, 300),
      notes: String(payload.notes || '').trim().slice(0, 500)
    };
  }

  /* ------------------------------------------------------------------------
     初始化与状态切换
     ------------------------------------------------------------------------ */
  async function init() {
    cacheElements();
    initPasswordToggles();
    bindActivityTracking();
    bindBaseEvents();
    initGenerator();

    if (!T.crypto.available()) {
      if (els.cryptoWarning) els.cryptoWarning.hidden = false;
      showView('unsupported');
      return;
    }

    try {
      const meta = await T.db.get('meta', META_KEY);
      if (!meta) {
        showView('setup');
        window.setTimeout(() => els.setupPassword?.focus(), 80);
        return;
      }
      if (!isValidMeta(meta)) {
        throw new Error('保险箱元信息损坏，无法验证主密码');
      }
      state.meta = meta;
      showView('lock');
      focusUnlock();
    } catch (error) {
      console.error('保险箱初始化失败', error);
      if (els.cryptoWarning) {
        els.cryptoWarning.hidden = false;
        const text = els.cryptoWarning.querySelector('span');
        if (text) {
          text.innerHTML = `<strong>保险箱无法初始化。</strong> ${T.escapeHtml(error.message || '本地数据库打开失败')}。请刷新页面或检查浏览器是否允许 IndexedDB。`;
        }
      }
      showView('unsupported');
    }
  }

  function clearSession() {
    stopAutoLock();
    state.key = null;
    state.records = [];
    state.search = '';
    state.generatedPassword = '';
    closeRecordDialog();
    if (els.vaultSearch) els.vaultSearch.value = '';
    if (els.vaultList) els.vaultList.innerHTML = '';
    if (els.generatedPassword) els.generatedPassword.textContent = '点击下方按钮生成';
    if (els.unlockPassword) els.unlockPassword.value = '';
    if (els.unlockError) clearInlineError(els.unlockError);
    if (els.autoLockCountdown) els.autoLockCountdown.textContent = '05:00';
  }

  function lockVault(message, options = {}) {
    clearSession();
    showView('lock');
    if (message && options.silent !== true) {
      T.toast(message, { type: 'info', duration: 4200 });
    }
    focusUnlock();
  }

  /* ------------------------------------------------------------------------
     设置主密码
     ------------------------------------------------------------------------ */
  async function handleSetup(event) {
    event.preventDefault();
    clearInlineError(els.setupError);

    const password = els.setupPassword.value;
    const confirmation = els.setupConfirm.value;

    if (Array.from(password).length < 8) {
      showInlineError(els.setupError, '主密码至少需要 8 个字符。');
      els.setupPassword.focus();
      return;
    }
    if (password !== confirmation) {
      showInlineError(els.setupError, '两次输入的主密码不一致。');
      els.setupConfirm.focus();
      return;
    }

    setBusy(els.setupSubmit, true, '正在派生密钥…');
    try {
      const salt = T.crypto.createSalt();
      const key = await T.crypto.deriveKey(password, salt, T.PBKDF2_ITERATIONS);
      const verifier = await T.crypto.encryptJSON(VERIFIER_TEXT, key);
      const now = new Date().toISOString();
      const meta = {
        key: META_KEY,
        version: 1,
        salt,
        iterations: T.PBKDF2_ITERATIONS,
        hash: 'SHA-256',
        cipher: 'AES-GCM',
        verifier,
        createdAt: now,
        updatedAt: now
      };
      await T.db.put('meta', meta);

      state.meta = meta;
      state.key = key;
      state.records = [];
      els.setupPassword.value = '';
      els.setupConfirm.value = '';
      enterVault({ fresh: true });
    } catch (error) {
      console.error(error);
      showInlineError(els.setupError, error.message || '创建保险箱失败，请重试。');
    } finally {
      setBusy(els.setupSubmit, false);
    }
  }

  /* ------------------------------------------------------------------------
     解锁
     ------------------------------------------------------------------------ */
  async function handleUnlock(event) {
    event.preventDefault();
    clearInlineError(els.unlockError);
    const password = els.unlockPassword.value;
    if (!password) {
      showInlineError(els.unlockError, '请输入主密码。');
      return;
    }
    if (!isValidMeta(state.meta)) {
      showInlineError(els.unlockError, '保险箱元信息损坏，无法解锁。');
      return;
    }

    setBusy(els.unlockSubmit, true, '正在解锁…');
    try {
      const key = await T.crypto.deriveKey(password, state.meta.salt, state.meta.iterations);
      const verifier = await T.crypto.decryptJSON(state.meta.verifier, key);
      if (verifier !== VERIFIER_TEXT) {
        throw new Error('主密码不正确。');
      }

      // 只有验证块与全部记录都解密成功，才把密钥留在当前会话内存中。
      const records = await loadRecords(key);
      state.key = key;
      state.records = records;
      els.unlockPassword.value = '';
      enterVault({ fresh: false });
      T.toast('保险箱已解锁，5 分钟无操作后会自动锁定。');
    } catch (error) {
      console.error('解锁失败', error);
      state.key = null;
      state.records = [];
      const message = error && /操作|Operation|decrypt|不匹配/i.test(String(error.message || error.name))
        ? '主密码不正确，或保险箱数据已损坏。'
        : (error.message || '解锁失败，请重试。');
      showInlineError(els.unlockError, message);
      els.unlockPassword.select();
    } finally {
      setBusy(els.unlockSubmit, false);
    }
  }

  async function loadRecords(key) {
    const rawRecords = await T.db.getAll('vault');
    const records = [];
    let broken = 0;

    for (const item of rawRecords) {
      if (!T.isPlainObject(item) || !item.id || !T.isPlainObject(item.payload)) {
        broken += 1;
        continue;
      }
      try {
        const payload = await T.crypto.decryptJSON(item.payload, key);
        const normalized = normalizePayload(payload);
        if (!normalized) {
          broken += 1;
          continue;
        }
        records.push({
          id: String(item.id),
          ...normalized,
          createdAt: typeof item.createdAt === 'string' ? item.createdAt : '',
          updatedAt: typeof item.updatedAt === 'string' ? item.updatedAt : ''
        });
      } catch (error) {
        broken += 1;
      }
    }

    records.sort((a, b) => timestampOf(b.updatedAt) - timestampOf(a.updatedAt));
    if (broken > 0) {
      T.toast(`${broken} 条记录无法解密，可能是损坏或来自不同主密码的备份。`, { type: 'error', duration: 5200 });
    }
    return records;
  }

  function enterVault(options = {}) {
    if (!state.key) {
      lockVault('保险箱已锁定，请重新输入主密码。', { silent: true });
      return;
    }
    showView('unlocked');
    state.search = '';
    if (els.vaultSearch) els.vaultSearch.value = '';
    renderRecords();
    els.generatedPassword.textContent = '正在生成…';
    generateNewPassword({ quiet: true });
    startAutoLock();
    window.setTimeout(() => els.vaultSearch?.focus(), 100);
    if (options.fresh) {
      T.toast('保险箱已创建。请记住主密码，并定期导出加密备份。', { type: 'success', duration: 4600 });
    }
  }

  /* ------------------------------------------------------------------------
     记录列表
     ------------------------------------------------------------------------ */
  function recordMatches(record, query) {
    if (!query) return true;
    return [record.site, record.username, record.notes, record.url]
      .join('\n')
      .toLowerCase()
      .includes(query.toLowerCase());
  }

  function recordTemplate(record) {
    const initial = Array.from(record.site)[0] || '?';
    const safeExternal = T.safeUrl(record.url);
    const escapedSite = T.escapeHtml(record.site);
    const notes = record.notes
      ? `<p class="vault-record__note">${T.escapeHtml(T.truncate(record.notes, 120))}</p>`
      : '';
    const urlLink = safeExternal
      ? `<a href="${T.escapeHtml(safeExternal)}" target="_blank" rel="noopener noreferrer" aria-label="打开 ${escapedSite} 的网址" title="打开网址">
           <svg class="icon" aria-hidden="true"><use href="assets/icons.svg#icon-external"></use></svg>
         </a>`
      : '';

    return `
      <article class="vault-record" data-id="${T.escapeHtml(record.id)}">
        <div class="vault-record__identity">
          <span class="vault-record__initial" aria-hidden="true">${T.escapeHtml(initial)}</span>
          <div style="min-width:0">
            <div class="vault-record__site">
              <strong>${escapedSite}</strong>${urlLink}
            </div>
            <div class="vault-record__username">${record.username ? T.escapeHtml(record.username) : '未填写用户名'}</div>
            ${notes}
          </div>
        </div>
        <div class="vault-secret">
          <code class="vault-secret__value" data-secret aria-label="密码已隐藏">${MASK}</code>
          <button class="btn btn--icon" type="button" data-action="reveal" aria-label="显示或隐藏 ${escapedSite} 的密码" aria-pressed="false" title="显示 / 隐藏">
            <svg class="icon" aria-hidden="true"><use href="assets/icons.svg#icon-eye"></use></svg>
          </button>
          <button class="btn btn--icon" type="button" data-action="copy-password" aria-label="复制 ${escapedSite} 的密码" title="复制密码">
            <svg class="icon" aria-hidden="true"><use href="assets/icons.svg#icon-copy"></use></svg>
          </button>
        </div>
        <div class="vault-record__actions">
          ${record.username ? `
            <button class="btn btn--icon" type="button" data-action="copy-username" aria-label="复制 ${escapedSite} 的用户名" title="复制用户名">
              <svg class="icon" aria-hidden="true"><use href="assets/icons.svg#icon-user"></use></svg>
            </button>` : ''}
          <button class="btn btn--icon" type="button" data-action="edit" aria-label="编辑 ${escapedSite}" title="编辑">
            <svg class="icon" aria-hidden="true"><use href="assets/icons.svg#icon-pen"></use></svg>
          </button>
          <button class="btn btn--icon btn--danger-quiet" type="button" data-action="delete" aria-label="删除 ${escapedSite}" title="删除">
            <svg class="icon" aria-hidden="true"><use href="assets/icons.svg#icon-trash"></use></svg>
          </button>
        </div>
      </article>
    `;
  }

  function renderRecords() {
    if (!els.vaultList) return;
    const filtered = state.records.filter((record) => recordMatches(record, state.search));
    if (els.vaultRecordCount) {
      els.vaultRecordCount.textContent = `${state.records.length} 条记录`;
    }

    if (!state.records.length) {
      els.vaultList.innerHTML = `
        <div class="empty-state">
          <svg class="icon" aria-hidden="true"><use href="assets/icons.svg#icon-lock"></use></svg>
          <div>
            <strong>保险箱还空着</strong>
            <span>添加第一条账号记录。站点、用户名、密码与备注会一起加密。</span>
          </div>
          <button class="btn btn--primary btn--small" type="button" data-action="add-record">
            <svg class="icon" aria-hidden="true"><use href="assets/icons.svg#icon-plus"></use></svg>
            添加第一条记录
          </button>
        </div>
      `;
      return;
    }

    if (!filtered.length) {
      els.vaultList.innerHTML = `
        <div class="empty-state empty-state--compact">
          <svg class="icon" aria-hidden="true"><use href="assets/icons.svg#icon-search"></use></svg>
          <div>
            <strong>没有匹配的记录</strong>
            <span>试试站点名、用户名或备注里的另一个关键词。</span>
          </div>
          <button class="btn btn--small" type="button" data-action="clear-search">清除搜索</button>
        </div>
      `;
      return;
    }

    els.vaultList.innerHTML = filtered.map(recordTemplate).join('');
  }

  function getRecordById(id) {
    return state.records.find((record) => record.id === id);
  }

  async function copyRecordValue(record, field) {
    const value = String(record[field] || '');
    if (!value) {
      T.toast('这一项还没有填写。', { type: 'info' });
      return;
    }
    try {
      await T.copyText(value);
      const label = field === 'password' ? '密码' : '用户名';
      T.toast(`已复制「${record.site}」的${label}。`);
      touchActivity();
    } catch (error) {
      T.toast(error.message || '复制失败，请手动复制。', { type: 'error' });
    }
  }

  async function deleteRecord(record) {
    const ok = await T.confirmDialog({
      title: '删除这条密码记录？',
      message: `「${record.site}」的记录会从本机保险箱中移除，此操作无法撤销。`,
      confirmText: '删除记录',
      cancelText: '保留',
      danger: true
    });
    if (!ok) return;
    if (!state.key) {
      lockVault('保险箱已锁定。', { silent: true });
      return;
    }
    try {
      await T.db.delete('vault', record.id);
      state.records = state.records.filter((item) => item.id !== record.id);
      renderRecords();
      T.toast('记录已删除。');
      touchActivity();
    } catch (error) {
      T.toast('删除失败，请重试。', { type: 'error' });
    }
  }

  function handleVaultListClick(event) {
    const button = event.target.closest('[data-action]');
    if (!button) return;
    const action = button.dataset.action;

    if (action === 'add-record') {
      openRecordDialog();
      return;
    }
    if (action === 'clear-search') {
      state.search = '';
      if (els.vaultSearch) {
        els.vaultSearch.value = '';
        els.vaultSearch.focus();
      }
      renderRecords();
      return;
    }

    const container = button.closest('[data-id]');
    const record = container ? getRecordById(container.dataset.id) : null;
    if (!record) return;

    if (action === 'reveal') {
      const valueNode = container.querySelector('[data-secret]');
      if (!valueNode) return;
      const reveal = !valueNode.classList.contains('is-revealed');
      valueNode.textContent = reveal ? record.password : MASK;
      valueNode.classList.toggle('is-revealed', reveal);
      valueNode.setAttribute('aria-label', reveal ? '密码已显示' : '密码已隐藏');
      button.innerHTML = T.iconMarkup(reveal ? 'eye-off' : 'eye');
      button.setAttribute('aria-pressed', String(reveal));
      button.setAttribute('aria-label', `${reveal ? '隐藏' : '显示'} ${record.site} 的密码`);
      touchActivity();
      return;
    }

    if (action === 'copy-password') {
      copyRecordValue(record, 'password');
      return;
    }
    if (action === 'copy-username') {
      copyRecordValue(record, 'username');
      return;
    }
    if (action === 'edit') {
      openRecordDialog(record);
      return;
    }
    if (action === 'delete') {
      deleteRecord(record);
    }
  }

  /* ------------------------------------------------------------------------
     新增 / 编辑记录对话框
     ------------------------------------------------------------------------ */
  function openRecordDialog(record = null, presetPassword = '') {
    if (!state.key) {
      lockVault('保险箱已锁定，请重新解锁。', { silent: true });
      return;
    }
    clearInlineError(els.recordError);
    els.recordForm.reset();
    els.recordId.value = record ? record.id : '';
    els.recordSite.value = record ? record.site : '';
    els.recordUsername.value = record ? record.username : '';
    els.recordUrl.value = record ? record.url : '';
    els.recordPassword.value = record ? record.password : presetPassword;
    els.recordNotes.value = record ? record.notes : '';
    setPasswordVisibility(els.recordPassword, false);

    els.recordDialogTitle.textContent = record ? '编辑密码记录' : '添加一条记录';
    els.recordDialogIntro.textContent = record
      ? '修改后的整条记录会重新加密，并生成新的随机 IV。'
      : '站点、用户名与密码会在保存前整体加密后写入 IndexedDB。';

    if (!els.recordDialog.open) els.recordDialog.showModal();
    window.setTimeout(() => els.recordSite?.focus(), 60);
    touchActivity();
  }

  function closeRecordDialog() {
    if (els.recordDialog && els.recordDialog.open) {
      els.recordDialog.close();
    }
    state.editingId = null;
    if (els.recordForm) els.recordForm.reset();
    if (els.recordError) clearInlineError(els.recordError);
  }

  async function handleRecordSubmit(event) {
    event.preventDefault();
    clearInlineError(els.recordError);

    if (!state.key) {
      closeRecordDialog();
      lockVault('保险箱已锁定，请重新解锁。', { silent: true });
      return;
    }

    const site = els.recordSite.value.trim().slice(0, 80);
    const username = els.recordUsername.value.trim().slice(0, 120);
    const password = els.recordPassword.value;
    const notes = els.recordNotes.value.trim().slice(0, 500);
    let urlInput = els.recordUrl.value.trim();
    let url = '';

    if (!site) {
      showInlineError(els.recordError, '请填写站点或应用名称。');
      els.recordSite.focus();
      return;
    }
    if (!password) {
      showInlineError(els.recordError, '请填写密码，或者用生成器生成一个。');
      els.recordPassword.focus();
      return;
    }
    if (urlInput) {
      if (!/^https?:\/\//i.test(urlInput)) urlInput = `https://${urlInput}`;
      url = T.safeUrl(urlInput);
      if (!url) {
        showInlineError(els.recordError, '网址格式不正确，请填写如 https://example.com 的地址。');
        els.recordUrl.focus();
        return;
      }
    }

    const editingId = els.recordId.value || null;
    const existing = editingId ? getRecordById(editingId) : null;
    const now = new Date().toISOString();
    const id = editingId || T.uid();

    setBusy(els.recordSaveBtn, true, '正在加密…');
    try {
      const payload = normalizePayload({ site, username, password, url, notes });
      if (!payload) throw new Error('记录内容不完整');
      const encrypted = await T.crypto.encryptJSON(payload, state.key);
      const stored = {
        id,
        version: 1,
        payload: encrypted,
        createdAt: existing?.createdAt || now,
        updatedAt: now
      };
      await T.db.put('vault', stored);

      const cleanRecord = {
        id,
        ...payload,
        createdAt: stored.createdAt,
        updatedAt: stored.updatedAt
      };
      if (existing) {
        state.records = state.records.map((item) => item.id === id ? cleanRecord : item);
      } else {
        state.records.unshift(cleanRecord);
      }
      state.records.sort((a, b) => timestampOf(b.updatedAt) - timestampOf(a.updatedAt));
      closeRecordDialog();
      renderRecords();
      T.toast(existing ? '记录已更新并重新加密。' : '记录已加密保存。');
      touchActivity();
    } catch (error) {
      console.error(error);
      showInlineError(els.recordError, error.message || '保存失败，请重试。');
    } finally {
      setBusy(els.recordSaveBtn, false);
    }
  }

  /* ------------------------------------------------------------------------
     密码生成器
     ------------------------------------------------------------------------ */
  function initGenerator() {
    if (!els.generatorLength) return;
    els.generatorLength.addEventListener('input', () => {
      if (els.generatorLengthValue) els.generatorLengthValue.textContent = els.generatorLength.value;
      touchActivity();
    });
    els.regenerateBtn?.addEventListener('click', () => {
      generateNewPassword();
      touchActivity();
    });
    els.copyGeneratedBtn?.addEventListener('click', async () => {
      const value = state.generatedPassword || generateNewPassword({ quiet: true });
      if (!value) return;
      try {
        await T.copyText(value);
        T.toast('随机密码已复制。');
        touchActivity();
      } catch (error) {
        T.toast(error.message || '复制失败。', { type: 'error' });
      }
    });
    els.useGeneratedBtn?.addEventListener('click', () => {
      if (!state.key) return;
      const value = state.generatedPassword || generateNewPassword({ quiet: true });
      if (value) openRecordDialog(null, value);
    });
    els.recordGenerateBtn?.addEventListener('click', () => {
      const value = generateNewPassword({ quiet: true });
      if (!value) return;
      els.recordPassword.value = value;
      setPasswordVisibility(els.recordPassword, true);
      touchActivity();
    });
  }

  function getGeneratorOptions() {
    return {
      length: Number(els.generatorLength?.value) || 20,
      upper: Boolean(els.genUpper?.checked),
      lower: Boolean(els.genLower?.checked),
      digits: Boolean(els.genDigits?.checked),
      symbols: Boolean(els.genSymbols?.checked)
    };
  }

  function generateNewPassword(options = {}) {
    if (!T.crypto.available()) return '';
    const settings = getGeneratorOptions();
    if (!settings.upper && !settings.lower && !settings.digits && !settings.symbols) {
      if (!options.quiet) T.toast('请至少选择一种字符类型。', { type: 'info' });
      return '';
    }
    try {
      const value = T.crypto.generatePassword(settings);
      state.generatedPassword = value;
      if (els.generatedPassword) els.generatedPassword.textContent = value;
      return value;
    } catch (error) {
      if (!options.quiet) T.toast(error.message || '密码生成失败。', { type: 'error' });
      return '';
    }
  }

  /* ------------------------------------------------------------------------
     5 分钟无操作自动锁定
     ------------------------------------------------------------------------ */
  function touchActivity() {
    if (!state.key) return;
    state.lastActivity = Date.now();
  }

  function startAutoLock() {
    stopAutoLock();
    state.lastActivity = Date.now();
    updateAutoLockCountdown();
    state.ticker = window.setInterval(() => {
      if (!state.key) return;
      const elapsed = Date.now() - state.lastActivity;
      if (elapsed >= AUTO_LOCK_MS) {
        lockVault('已因 5 分钟无操作自动锁定。');
        return;
      }
      updateAutoLockCountdown();
    }, 1000);
  }

  function stopAutoLock() {
    if (state.ticker) {
      window.clearInterval(state.ticker);
      state.ticker = null;
    }
  }

  function updateAutoLockCountdown() {
    if (!state.key || !els.autoLockCountdown) return;
    const remaining = Math.max(0, AUTO_LOCK_MS - (Date.now() - state.lastActivity));
    const minutes = Math.floor(remaining / 60000);
    const seconds = Math.floor((remaining % 60000) / 1000);
    els.autoLockCountdown.textContent = `${T.pad2(minutes)}:${T.pad2(seconds)}`;
  }

  function bindActivityTracking() {
    ['pointerdown', 'keydown', 'input', 'wheel'].forEach((eventName) => {
      document.addEventListener(eventName, touchActivity, { passive: true });
    });
    document.addEventListener('scroll', touchActivity, { passive: true });
    document.addEventListener('visibilitychange', () => {
      if (!state.key || document.hidden) return;
      if (Date.now() - state.lastActivity >= AUTO_LOCK_MS) {
        lockVault('页面在后台超过 5 分钟，保险箱已自动锁定。');
      } else {
        updateAutoLockCountdown();
      }
    });
  }

  /* ------------------------------------------------------------------------
     加密备份：导出 / 导入
     ------------------------------------------------------------------------ */
  async function exportBackup() {
    if (!state.key) {
      lockVault('请先解锁保险箱。', { silent: true });
      return;
    }
    try {
      const meta = await T.db.get('meta', META_KEY);
      const records = await T.db.getAll('vault');
      if (!isValidMeta(meta)) throw new Error('保险箱元信息缺失');
      const backup = {
        format: 'toolbox-vault-backup',
        version: 1,
        app: '一页工作台',
        exportedAt: new Date().toISOString(),
        note: 'AES-GCM encrypted ciphertext. Restoring requires the original master password.',
        meta,
        records
      };
      T.downloadFile(
        `toolbox-vault-backup-${T.formatStamp()}.json`,
        JSON.stringify(backup, null, 2),
        'application/json;charset=utf-8'
      );
      T.toast('加密备份已导出。备份仍需要原主密码才能恢复。', { duration: 4400 });
      touchActivity();
    } catch (error) {
      console.error(error);
      T.toast('导出失败，请重试。', { type: 'error' });
    }
  }

  function isBase64Text(value, maxLength = 2000000) {
    return typeof value === 'string'
      && value.length > 0
      && value.length <= maxLength
      && value.length % 4 === 0
      && /^[A-Za-z0-9+/]+={0,2}$/.test(value);
  }

  function validateBackup(backup) {
    if (!T.isPlainObject(backup) || backup.format !== 'toolbox-vault-backup' || backup.version !== 1) {
      throw new Error('不是有效的“一页工作台”保险箱备份');
    }
    const meta = backup.meta;
    if (!T.isPlainObject(meta)
      || !isBase64Text(meta.salt, 128)
      || Number(meta.iterations) !== T.PBKDF2_ITERATIONS
      || !T.isPlainObject(meta.verifier)
      || !isBase64Text(meta.verifier.iv, 128)
      || !isBase64Text(meta.verifier.data, 200000)) {
      throw new Error('备份中的加密元信息不完整');
    }
    if (!Array.isArray(backup.records) || backup.records.length > 2000) {
      throw new Error('备份记录数量异常');
    }

    const seen = new Set();
    const cleanRecords = [];
    for (const item of backup.records) {
      if (!T.isPlainObject(item)
        || typeof item.id !== 'string'
        || item.id.length === 0
        || item.id.length > 160
        || !T.isPlainObject(item.payload)
        || !isBase64Text(item.payload.iv, 128)
        || !isBase64Text(item.payload.data, 2000000)) {
        throw new Error('备份中存在损坏的记录');
      }
      if (seen.has(item.id)) continue;
      seen.add(item.id);
      cleanRecords.push({
        id: item.id,
        version: 1,
        payload: {
          iv: item.payload.iv,
          data: item.payload.data
        },
        createdAt: typeof item.createdAt === 'string' ? item.createdAt.slice(0, 40) : '',
        updatedAt: typeof item.updatedAt === 'string' ? item.updatedAt.slice(0, 40) : ''
      });
    }

    return {
      meta: {
        key: META_KEY,
        version: 1,
        salt: meta.salt,
        iterations: T.PBKDF2_ITERATIONS,
        hash: 'SHA-256',
        cipher: 'AES-GCM',
        verifier: {
          iv: meta.verifier.iv,
          data: meta.verifier.data
        },
        createdAt: typeof meta.createdAt === 'string' ? meta.createdAt.slice(0, 40) : new Date().toISOString(),
        updatedAt: typeof meta.updatedAt === 'string' ? meta.updatedAt.slice(0, 40) : new Date().toISOString()
      },
      records: cleanRecords
    };
  }

  async function writeBackupAtomically(backup) {
    const db = await T.db.open();
    await new Promise((resolve, reject) => {
      const tx = db.transaction(['meta', 'vault'], 'readwrite');
      const metaStore = tx.objectStore('meta');
      const vaultStore = tx.objectStore('vault');
      metaStore.clear();
      vaultStore.clear();
      metaStore.put(backup.meta);
      backup.records.forEach((record) => vaultStore.put(record));
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error || new Error('写入备份失败'));
      tx.onabort = () => reject(tx.error || new Error('写入备份被取消'));
    });
  }

  async function handleBackupFile() {
    const file = els.backupFile?.files?.[0];
    if (els.backupFile) els.backupFile.value = '';
    if (!file) return;
    if (file.size > MAX_BACKUP_BYTES) {
      T.toast('备份文件超过 12 MB，已拒绝导入。', { type: 'error' });
      return;
    }

    try {
      const text = await T.readFileAsText(file);
      let rawBackup;
      try {
        rawBackup = JSON.parse(text);
      } catch (error) {
        throw new Error('文件不是有效的 JSON');
      }
      const backup = validateBackup(rawBackup);
      const existingCount = await T.db.count('vault');
      const ok = await T.confirmDialog({
        title: '用备份替换当前保险箱？',
        message: existingCount > 0
          ? `当前保险箱中的 ${existingCount} 条记录将被备份中的 ${backup.records.length} 条记录替换。当前保险箱会立即上锁。`
          : `将导入 ${backup.records.length} 条加密记录。导入后需要用这个备份对应的主密码解锁。`,
        confirmText: '导入并替换',
        cancelText: '取消',
        danger: true
      });
      if (!ok) return;

      await writeBackupAtomically(backup);
      state.meta = backup.meta;
      clearSession();
      showView('lock');
      T.toast('加密备份已导入，请使用备份对应的主密码解锁。', { type: 'success', duration: 5200 });
      focusUnlock();
    } catch (error) {
      console.error(error);
      T.toast(`导入失败：${error.message || '文件无法读取'}`, { type: 'error', duration: 5200 });
    }
  }

  /* ------------------------------------------------------------------------
     事件绑定
     ------------------------------------------------------------------------ */
  function bindBaseEvents() {
    els.setupForm?.addEventListener('submit', handleSetup);
    els.unlockForm?.addEventListener('submit', handleUnlock);
    els.lockNowBtn?.addEventListener('click', () => {
      lockVault('保险箱已手动锁定。');
    });
    els.addRecordBtn?.addEventListener('click', () => openRecordDialog());
    els.vaultSearch?.addEventListener('input', () => {
      state.search = els.vaultSearch.value;
      renderRecords();
    });
    els.vaultSearch?.addEventListener('keydown', (event) => {
      if (event.key === 'Escape' && els.vaultSearch.value) {
        event.stopPropagation();
        state.search = '';
        els.vaultSearch.value = '';
        renderRecords();
      }
    });
    els.vaultList?.addEventListener('click', handleVaultListClick);
    els.exportVaultBtn?.addEventListener('click', exportBackup);
    els.importVaultBtn?.addEventListener('click', () => els.backupFile?.click());
    els.setupImportBtn?.addEventListener('click', () => els.backupFile?.click());
    els.unlockImportBtn?.addEventListener('click', () => els.backupFile?.click());
    els.backupFile?.addEventListener('change', handleBackupFile);

    els.recordForm?.addEventListener('submit', handleRecordSubmit);
    els.recordCancelBtn?.addEventListener('click', closeRecordDialog);
    els.recordDialog?.addEventListener('cancel', (event) => {
      event.preventDefault();
      closeRecordDialog();
    });
    els.recordDialog?.addEventListener('click', (event) => {
      if (event.target === els.recordDialog) closeRecordDialog();
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init, { once: true });
  } else {
    init();
  }
})();
