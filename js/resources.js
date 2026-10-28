/* ==========================================================================
   学习网站导航
   - 默认内置 OI Wiki 等学习入口
   - 自定义条目保存到 localStorage 的 studyResources 键
   - 支持搜索、添加、编辑、删除、恢复默认
   ========================================================================== */
(function () {
  'use strict';

  const T = window.Toolbox;
  const STORAGE_KEY = 'studyResources';

  const DEFAULT_RESOURCES = [
    {
      id: 'builtin-oi-wiki',
      title: 'OI Wiki',
      url: 'https://oi-wiki.org/',
      description: '算法竞赛与计算机科学知识库，学习网站导航的主入口。',
      category: '算法',
      builtin: true,
      primary: true
    },
    {
      id: 'builtin-oi-complexity',
      title: 'OI Wiki · 复杂度速查',
      url: 'https://oi-wiki.org/basic/complexity/',
      description: '渐进记号、主定理、常见复杂度与证明方法，保留为默认速查条目。',
      category: '算法',
      builtin: true
    },
    {
      id: 'builtin-hello-algo',
      title: 'Hello 算法',
      url: 'https://www.hello-algo.com/',
      description: '用动画和图解讲数据结构与算法，适合配合笔记重新理解概念。',
      category: '算法',
      builtin: true
    },
    {
      id: 'builtin-csdiy',
      title: 'CS 自学指南',
      url: 'https://csdiy.wiki/',
      description: '计算机课程、教材与自学路线索引，适合按主题补齐知识。',
      category: '课程',
      builtin: true
    },
    {
      id: 'builtin-mdn',
      title: 'MDN Web Docs',
      url: 'https://developer.mozilla.org/zh-CN/',
      description: 'Web 平台参考文档，查 HTML、CSS、JavaScript 和浏览器 API。',
      category: 'Web',
      builtin: true
    },
    {
      id: 'builtin-luogu',
      title: '洛谷',
      url: 'https://www.luogu.com.cn/',
      description: '中文算法题库与讨论区，适合找题、看题解和做专项练习。',
      category: '算法',
      builtin: true
    },
    {
      id: 'builtin-desmos',
      title: 'Desmos 图形计算器',
      url: 'https://www.desmos.com/calculator',
      description: '在线函数图像工具，用来观察公式、曲线和参数变化。',
      category: '数学',
      builtin: true
    }
  ];

  const state = {
    items: [],
    query: '',
    editingId: '',
    storageWarned: false
  };

  const els = {};

  function cacheElements() {
    [
      'studySearch', 'studyCount', 'studyResourceList', 'addStudyResourceBtn',
      'restoreStudyResourcesBtn', 'studyResourceDialog', 'studyResourceForm',
      'studyResourceDialogTitle', 'studyResourceDialogIntro', 'studyResourceId',
      'studyResourceTitle', 'studyResourceUrl', 'studyResourceDescription',
      'studyResourceCategory', 'studyResourceError', 'studyResourceCancelBtn',
      'studyResourceSaveBtn'
    ].forEach((id) => {
      els[id] = document.getElementById(id);
    });
  }

  function cloneDefaults() {
    return DEFAULT_RESOURCES.map((item) => ({ ...item }));
  }

  function normalizeUrl(input) {
    let raw = String(input || '').trim();
    if (!raw) return '';
    if (!/^[a-z][a-z0-9+.-]*:/i.test(raw)) raw = `https://${raw}`;
    const safe = T.safeUrl(raw);
    if (!safe) return '';
    try {
      const parsed = new URL(safe);
      if (!['http:', 'https:'].includes(parsed.protocol)) return '';
      return parsed.href;
    } catch (error) {
      return '';
    }
  }

  function normalizeItem(item, index = 0) {
    if (!T.isPlainObject(item)) return null;
    const title = String(item.title || '').trim().slice(0, 60);
    const url = normalizeUrl(item.url);
    if (!title || !url) return null;
    return {
      id: String(item.id || `study-${Date.now()}-${index}`),
      title,
      url,
      description: String(item.description || '').trim().slice(0, 160),
      category: String(item.category || '').trim().slice(0, 24),
      builtin: Boolean(item.builtin),
      createdAt: typeof item.createdAt === 'string' ? item.createdAt : new Date().toISOString()
    };
  }

  function saveResources() {
    const ok = T.storageSetJSON(STORAGE_KEY, {
      version: 2,
      updatedAt: new Date().toISOString(),
      items: state.items
    });
    if (!ok && !state.storageWarned) {
      state.storageWarned = true;
      T.toast('浏览器本地存储不可用，本次修改可能不会保留。', { type: 'error' });
    }
    return ok;
  }

  function loadResources() {
    const stored = T.storageGetJSON(STORAGE_KEY, null);
    if (stored === null) {
      state.items = cloneDefaults();
      saveResources();
      return;
    }

    const rawItems = Array.isArray(stored) ? stored : stored.items;
    if (!Array.isArray(rawItems)) {
      state.items = cloneDefaults();
      saveResources();
      return;
    }

    state.items = rawItems.map(normalizeItem).filter(Boolean);

    // v1 只有复杂度页；升级时补一次 OI Wiki 主入口，不覆盖用户后续的删除选择。
    if ((Number(stored.version) || 1) < 2) {
      const hasMain = state.items.some((item) => item.url === 'https://oi-wiki.org/');
      if (!hasMain) state.items.unshift({ ...DEFAULT_RESOURCES[0] });
      saveResources();
    }
  }

  function hostOf(url) {
    try {
      return new URL(url).hostname.replace(/^www\./, '');
    } catch (error) {
      return '';
    }
  }

  function resourceRow(item, index) {
    const safeTitle = T.escapeHtml(item.title);
    const safeUrl = T.escapeHtml(item.url);
    const safeDescription = T.escapeHtml(item.description || '还没有写描述。');
    const category = item.category
      ? `<span class="tag tag--brown">${T.escapeHtml(item.category)}</span>`
      : '';
    const builtin = item.builtin ? '<span class="tag">默认</span>' : '';
    const primary = item.url === 'https://oi-wiki.org/' || item.primary
      ? '<span class="tag tag--brown">主入口</span>'
      : '';
    const host = hostOf(item.url);

    return `
      <article class="study-resource-row" data-id="${T.escapeHtml(item.id)}">
        <span class="study-resource-index" aria-hidden="true">${String(index + 1).padStart(2, '0')}</span>
        <div class="study-resource-main">
          <div class="study-resource-titleline">
            <a class="study-resource-link" href="${safeUrl}" target="_blank" rel="noopener noreferrer" title="打开 ${safeTitle}">
              ${safeTitle}
              <svg class="icon icon--tiny" aria-hidden="true"><use href="assets/icons.svg#icon-arrow-up-right"></use></svg>
            </a>
            ${primary}
            ${builtin}
            ${category}
          </div>
          <p class="study-resource-description">${safeDescription}</p>
          <span class="study-resource-host">${T.escapeHtml(host)}</span>
        </div>
        <div class="study-resource-actions">
          <button class="btn btn--icon btn--small" type="button" data-action="edit" aria-label="编辑 ${safeTitle}" title="编辑">
            <svg class="icon" aria-hidden="true"><use href="assets/icons.svg#icon-pen"></use></svg>
          </button>
          <button class="btn btn--icon btn--small" type="button" data-action="delete" aria-label="删除 ${safeTitle}" title="删除">
            <svg class="icon" aria-hidden="true"><use href="assets/icons.svg#icon-trash"></use></svg>
          </button>
        </div>
      </article>
    `;
  }

  function emptyMarkup(kind) {
    if (kind === 'search') {
      return `
        <div class="empty-state empty-state--compact">
          <svg class="icon" aria-hidden="true"><use href="assets/icons.svg#icon-search"></use></svg>
          <div>
            <strong>没有匹配的网站</strong>
            <span>换一个标题、描述或分类关键词试试。</span>
          </div>
          <button class="btn btn--small" type="button" data-action="clear-search">清空搜索</button>
        </div>
      `;
    }
    return `
      <div class="empty-state">
        <svg class="icon" aria-hidden="true"><use href="assets/icons.svg#icon-globe"></use></svg>
        <div>
          <strong>学习书架还是空的</strong>
          <span>添加第一个网站，或者恢复默认，把 OI Wiki 主入口找回来。</span>
        </div>
        <button class="btn btn--primary btn--small" type="button" data-action="add">
          <svg class="icon" aria-hidden="true"><use href="assets/icons.svg#icon-plus"></use></svg>
          添加网站
        </button>
      </div>
    `;
  }

  function renderResources() {
    if (!els.studyResourceList) return;
    const query = state.query.trim().toLowerCase();
    const filtered = state.items.filter((item) => {
      if (!query) return true;
      return `${item.title}\n${item.description}\n${item.category}`.toLowerCase().includes(query);
    });

    if (els.studyCount) {
      els.studyCount.textContent = query
        ? `${filtered.length} / ${state.items.length} 个站点`
        : `${state.items.length} 个站点`;
    }

    if (!state.items.length) {
      els.studyResourceList.innerHTML = emptyMarkup('all');
      return;
    }
    if (!filtered.length) {
      els.studyResourceList.innerHTML = emptyMarkup('search');
      return;
    }

    els.studyResourceList.innerHTML = filtered.map(resourceRow).join('');
  }

  function clearError() {
    if (!els.studyResourceError) return;
    const text = els.studyResourceError.querySelector('span');
    if (text) text.textContent = '';
    els.studyResourceError.hidden = true;
  }

  function showError(message) {
    if (!els.studyResourceError) return;
    const text = els.studyResourceError.querySelector('span');
    if (text) text.textContent = message;
    els.studyResourceError.hidden = false;
  }

  function openDialog(item = null) {
    if (!els.studyResourceDialog || !els.studyResourceForm) return;
    clearError();
    els.studyResourceForm.reset();
    state.editingId = item ? item.id : '';
    els.studyResourceId.value = item ? item.id : '';
    els.studyResourceTitle.value = item ? item.title : '';
    els.studyResourceUrl.value = item ? item.url : '';
    els.studyResourceDescription.value = item ? item.description : '';
    els.studyResourceCategory.value = item ? item.category : '';
    els.studyResourceDialogTitle.textContent = item ? '编辑学习网站' : '添加学习网站';
    els.studyResourceDialogIntro.textContent = item
      ? '修改后仍保存在本机浏览器，不会同步到其他设备。'
      : '给书架添一个入口，保存后可在本页搜索和编辑。';

    if (!els.studyResourceDialog.open) els.studyResourceDialog.showModal();
    window.setTimeout(() => els.studyResourceTitle?.focus(), 60);
  }

  function closeDialog() {
    if (els.studyResourceDialog?.open) els.studyResourceDialog.close();
    state.editingId = '';
    els.studyResourceForm?.reset();
    clearError();
  }

  function handleSubmit(event) {
    event.preventDefault();
    clearError();

    const title = String(els.studyResourceTitle.value || '').trim().slice(0, 60);
    const rawUrl = String(els.studyResourceUrl.value || '').trim();
    const description = String(els.studyResourceDescription.value || '').trim().slice(0, 160);
    const category = String(els.studyResourceCategory.value || '').trim().slice(0, 24);
    const url = normalizeUrl(rawUrl);

    if (!title) {
      showError('请填写网站标题。');
      els.studyResourceTitle.focus();
      return;
    }
    if (!url) {
      showError('请填写有效的 http:// 或 https:// 网址。');
      els.studyResourceUrl.focus();
      return;
    }

    const editing = state.items.find((item) => item.id === state.editingId);
    if (editing) {
      editing.title = title;
      editing.url = url;
      editing.description = description;
      editing.category = category;
    } else {
      state.items.unshift({
        id: T.uid(),
        title,
        url,
        description,
        category,
        builtin: false,
        createdAt: new Date().toISOString()
      });
    }

    saveResources();
    closeDialog();
    renderResources();
    T.toast(editing ? '学习网站已更新。' : '学习网站已添加到本机书架。');
  }

  async function deleteResource(item) {
    const ok = await T.confirmDialog({
      title: '从学习书架删除？',
      message: item.builtin
        ? `「${item.title}」是默认入口，删除后可以点击“恢复默认”找回。`
        : `「${item.title}」将从本机学习书架中移除。`,
      confirmText: '删除网站',
      cancelText: '保留',
      danger: true
    });
    if (!ok) return;
    state.items = state.items.filter((entry) => entry.id !== item.id);
    saveResources();
    renderResources();
    T.toast(item.builtin ? '已删除默认入口，可随时恢复默认。' : '学习网站已删除。', { type: 'info' });
  }

  async function restoreDefaults() {
    const ok = await T.confirmDialog({
      title: '恢复默认学习书架？',
      message: '会恢复 OI Wiki 等内置入口，当前书架里的自定义网站也会被替换。',
      confirmText: '恢复默认',
      cancelText: '取消',
      danger: true
    });
    if (!ok) return;
    state.items = cloneDefaults();
    state.query = '';
    if (els.studySearch) els.studySearch.value = '';
    saveResources();
    renderResources();
    T.toast('已恢复默认学习网站。');
  }

  function handleListClick(event) {
    const actionButton = event.target.closest('[data-action]');
    if (actionButton) {
      const action = actionButton.dataset.action;
      if (action === 'add') {
        openDialog();
        return;
      }
      if (action === 'clear-search') {
        state.query = '';
        if (els.studySearch) {
          els.studySearch.value = '';
          els.studySearch.focus();
        }
        renderResources();
        return;
      }
      const row = actionButton.closest('[data-id]');
      const item = row ? state.items.find((entry) => entry.id === row.dataset.id) : null;
      if (!item) return;
      if (action === 'edit') openDialog(item);
      if (action === 'delete') deleteResource(item);
      return;
    }

    const link = event.target.closest('.study-resource-link');
    if (link) {
      // 链接本身使用 target="_blank"，这里不改写点击行为。
      return;
    }
  }

  function init() {
    cacheElements();
    if (!els.studyResourceList) return;
    loadResources();
    renderResources();

    els.studySearch?.addEventListener('input', () => {
      state.query = els.studySearch.value;
      renderResources();
    });
    els.addStudyResourceBtn?.addEventListener('click', () => openDialog());
    els.restoreStudyResourcesBtn?.addEventListener('click', restoreDefaults);
    els.studyResourceList?.addEventListener('click', handleListClick);
    els.studyResourceForm?.addEventListener('submit', handleSubmit);
    els.studyResourceCancelBtn?.addEventListener('click', closeDialog);
    els.studyResourceDialog?.addEventListener('cancel', (event) => {
      event.preventDefault();
      closeDialog();
    });
    els.studyResourceDialog?.addEventListener('click', (event) => {
      if (event.target === els.studyResourceDialog) closeDialog();
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init, { once: true });
  } else {
    init();
  }
})();
