/* ==========================================================================
   Aster 知识库
   - Markdown + LaTeX 实时预览、Callout、文件夹与命令面板
   - 先保护 $...$ / $$...$$ 公式，交给 markdown-it 渲染后再恢复并调用 KaTeX
   - 笔记写入 IndexedDB 的 notes 仓库；folder 为空字符串表示未分类
   ========================================================================== */
(function () {
  'use strict';

  const T = window.Toolbox;
  const FOLDERS_KEY = 'asterFolders';
  const NOTE_ORDER_KEY = 'asterNoteOrder';
  const ALL_FOLDERS = '__all__';
  const UNCATEGORIZED = '';
  const RENDERER_URLS = {
    markdownIt: [
      'https://cdn.jsdelivr.net/npm/markdown-it@14.1.0/dist/markdown-it.min.js',
      'https://unpkg.com/markdown-it@14.1.0/dist/markdown-it.min.js'
    ],
    katexJs: [
      'https://cdn.jsdelivr.net/npm/katex@0.16.22/dist/katex.min.js',
      'https://unpkg.com/katex@0.16.22/dist/katex.min.js'
    ],
    katexCss: [
      'https://cdn.jsdelivr.net/npm/katex@0.16.22/dist/katex.min.css',
      'https://unpkg.com/katex@0.16.22/dist/katex.min.css'
    ]
  };

  const INSERT_TEMPLATES = {
    fraction: '\\frac{a}{b}',
    sqrt: '\\sqrt{x}',
    supsub: 'x_{i}^{2}',
    integral: '\\int_{a}^{b} f(x)\\,dx',
    sum: '\\sum_{i=1}^{n} a_i',
    matrix: '\\begin{pmatrix} a & b \\\\ c & d \\end{pmatrix}',
    limit: '\\lim_{x \\to 0} \\frac{\\sin x}{x}',
    aligned: '\\begin{aligned} a &= b \\\\ c &= d \\end{aligned}',
    cases: '\\begin{cases} x, & x > 0 \\\\ 0, & x \\le 0 \\end{cases}',
    greek: '\\alpha \\beta \\gamma \\theta \\lambda \\mu \\pi \\sigma \\omega'
  };

  const NEW_NOTE_CONTENT = '## 主题\n\n\n## 要点\n\n\n## 补充\n\n';
  const SAMPLE_CONTENT = [
    '# 示例：因式分解',
    '',
    '> [!tip]+ 阅读提示',
    '> 这是一篇可以自由修改的示例笔记。',
    '> 试着在左侧修改标题，再切到思维导图拖动节点。',
    '',
    '## 题目',
    '',
    '解方程 $x^2 - 5x + 6 = 0$，并写出推导过程。',
    '',
    '## 思路',
    '',
    '观察常数项与一次项，尝试因式分解：',
    '',
    '$$',
    'x^2 - 5x + 6 = (x-2)(x-3)',
    '$$',
    '',
    '所以 $x_1 = 2$，$x_2 = 3$。',
    '',
    '## 复杂度',
    '',
    '- 时间：$O(1)$',
    '- 空间：$O(1)$',
    '',
    '## 小结',
    '',
    '1. 先观察常数项与一次项。',
    '2. 再代回原式验证根。',
    '',
    '```python',
    'roots = [2, 3]',
    'print(roots)',
    '```'
  ].join('\n');

  const state = {
    notes: [],
    activeId: null,
    search: '',
    activeTag: '',
    folderFilter: ALL_FOLDERS,
    searchScope: 'folder',
    folders: [],
    noteOrder: [],
    contextNoteId: '',
    markdownIt: null,
    katex: false,
    katexCss: false,
    libsLoading: true,
    previewTimer: 0,
    saveTimer: 0,
    saveChain: Promise.resolve(),
    dirty: false,
    saveErrorNotified: false,
    previewFullscreen: false,
    scrollSyncFrame: 0,
    scrollSyncTimer: 0,
    scrollSyncLock: false,
    dragNoteId: ''
  };

  const els = {};

  function cacheElements() {
    [
      'notesApp', 'noteTitle', 'noteTags', 'noteTagChips', 'noteFolder',
      'folderOptions', 'markdownInput', 'previewPane', 'previewContent', 'previewScroll',
      'previewNotice', 'renderNotice', 'renderBadge', 'previewFullscreenBtn',
      'saveStatus', 'noteSearch', 'noteList', 'tagFilters', 'searchScopeToggle',
      'folderTree', 'newFolderBtn', 'newFolderForm', 'newFolderInput',
      'newFolderCancel', 'noteCount', 'newNoteBtn', 'sampleNoteBtn',
      'deleteNoteBtn', 'inlineDeleteBar', 'inlineDeleteConfirm', 'inlineDeleteCancel',
      'importNoteBtn', 'importNoteFile', 'exportMarkdownBtn', 'exportHtmlBtn',
      'libraryToggle', 'notesSidebar', 'notesScrim', 'editorTab', 'previewTab',
      'mindmapTab', 'mindmapView', 'cheatSheet', 'focusCheatBtn', 'noteContextMenu',
      'contextFolderList', 'contextNewFolderForm', 'contextNewFolderInput',
      'mindmapNodeEditor', 'mindmapNodeTitleInput', 'mindmapSaveNodeBtn',
      'mindmapAddChildBtn', 'mindmapDeleteNodeBtn'
    ].forEach((id) => {
      els[id] = document.getElementById(id);
    });
    els.renderNotice = document.getElementById('renderNotice');
  }

  /* ------------------------------------------------------------------------
     数据规范化
     ------------------------------------------------------------------------ */
  function normalizeTags(input) {
    const raw = Array.isArray(input) ? input.join(',') : String(input || '');
    const values = raw.split(/[,，;；\n]/);
    const seen = new Set();
    const tags = [];
    for (const value of values) {
      const tag = String(value).trim().replace(/^#+/, '').slice(0, 20);
      if (!tag) continue;
      const key = tag.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      tags.push(tag);
      if (tags.length >= 8) break;
    }
    return tags;
  }

  function normalizeFolder(value) {
    return String(value == null ? '' : value)
      .replace(/\s+/g, ' ')
      .replace(/^\/+|\/+$/g, '')
      .trim()
      .slice(0, 80);
  }

  function normalizeNote(note) {
    if (!T.isPlainObject(note)) return null;
    const id = String(note.id || '');
    if (!id) return null;
    const now = new Date().toISOString();
    return {
      id,
      title: String(note.title || '').trim().slice(0, 100) || '未命名笔记',
      content: String(note.content == null ? '' : note.content).slice(0, 500000),
      tags: normalizeTags(note.tags),
      folder: normalizeFolder(note.folder),
      createdAt: typeof note.createdAt === 'string' ? note.createdAt : now,
      updatedAt: typeof note.updatedAt === 'string' ? note.updatedAt : now
    };
  }

  function timestampOf(note) {
    const value = Date.parse(note.updatedAt || '');
    return Number.isFinite(value) ? value : 0;
  }

  function saveFolders() {
    T.storageSetJSON(FOLDERS_KEY, state.folders);
  }

  function saveNoteOrder() {
    T.storageSetJSON(NOTE_ORDER_KEY, state.noteOrder);
  }

  function loadFolderState() {
    const storedFolders = T.storageGetJSON(FOLDERS_KEY, []);
    state.folders = Array.isArray(storedFolders)
      ? storedFolders.map(normalizeFolder).filter(Boolean)
      : [];
    const storedOrder = T.storageGetJSON(NOTE_ORDER_KEY, []);
    state.noteOrder = Array.isArray(storedOrder) ? storedOrder.map(String) : [];
  }

  function ensureNoteOrder() {
    const ids = new Set(state.notes.map((note) => note.id));
    state.noteOrder = state.noteOrder.filter((id) => ids.has(id));
    const known = new Set(state.noteOrder);
    state.notes.forEach((note) => {
      if (!known.has(note.id)) {
        state.noteOrder.push(note.id);
        known.add(note.id);
      }
    });
    saveNoteOrder();
  }

  function sortNotes() {
    const rank = new Map(state.noteOrder.map((id, index) => [id, index]));
    state.notes.sort((a, b) => {
      const ar = rank.has(a.id) ? rank.get(a.id) : Number.MAX_SAFE_INTEGER;
      const br = rank.has(b.id) ? rank.get(b.id) : Number.MAX_SAFE_INTEGER;
      return ar - br || timestampOf(b) - timestampOf(a);
    });
  }

  function collectFolders() {
    const names = new Set(state.folders);
    state.notes.forEach((note) => {
      if (note.folder) names.add(note.folder);
    });
    const ordered = state.folders.filter((name) => names.has(name));
    const extras = Array.from(names).filter((name) => !ordered.includes(name)).sort((a, b) => a.localeCompare(b, 'zh-CN'));
    state.folders = [...ordered, ...extras];
    const counts = new Map();
    state.notes.forEach((note) => {
      const key = note.folder || UNCATEGORIZED;
      counts.set(key, (counts.get(key) || 0) + 1);
    });
    return { folders: state.folders, counts };
  }

  function folderLabel(folder) {
    return folder || '未分类';
  }

  function activeFolderLabel() {
    if (state.folderFilter === ALL_FOLDERS) return '全部';
    return folderLabel(state.folderFilter);
  }

  function activeNote() {
    return state.notes.find((note) => note.id === state.activeId) || null;
  }

  function findNote(id) {
    return state.notes.find((note) => note.id === id) || null;
  }

  function formatNoteDate(value) {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return '';
    const now = new Date();
    if (date.toDateString() === now.toDateString()) {
      return T.formatTime(date, false);
    }
    if (date.getFullYear() === now.getFullYear()) {
      return `${date.getMonth() + 1}月${date.getDate()}日`;
    }
    return `${date.getFullYear()}.${date.getMonth() + 1}.${date.getDate()}`;
  }

  function plainSnippet(content) {
    return T.truncate(
      String(content || '')
        .replace(/```[\s\S]*?```/g, ' ')
        .replace(/<[^>]*>/g, ' ')
        .replace(/&[a-z]+;/gi, ' ')
        .replace(/[`#>*_~$\\[\]()]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim(),
      95
    );
  }

  /* ------------------------------------------------------------------------
     笔记侧栏
     ------------------------------------------------------------------------ */
  function collectTags() {
    const counts = new Map();
    state.notes.forEach((note) => {
      note.tags.forEach((tag) => {
        counts.set(tag, (counts.get(tag) || 0) + 1);
      });
    });
    return Array.from(counts.entries())
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], 'zh-CN'))
      .map(([tag, count]) => ({ tag, count }));
  }

  function renderTagFilters(tags) {
    if (!els.tagFilters) return;
    const buttons = [
      `<button class="tag-filter-btn${state.activeTag ? '' : ' is-active'}" type="button" data-tag="" aria-pressed="${state.activeTag ? 'false' : 'true'}">全部</button>`
    ];
    tags.forEach(({ tag, count }) => {
      const active = state.activeTag === tag;
      buttons.push(
        `<button class="tag-filter-btn${active ? ' is-active' : ''}" type="button" data-tag="${T.escapeHtml(tag)}" aria-pressed="${active ? 'true' : 'false'}" title="${T.escapeHtml(tag)} · ${count} 篇">${T.escapeHtml(tag)}</button>`
      );
    });
    els.tagFilters.innerHTML = buttons.join('');
  }

  function renderSearchScope() {
    if (!els.searchScopeToggle) return;
    T.$$('[data-search-scope]', els.searchScopeToggle).forEach((button) => {
      const active = button.dataset.searchScope === state.searchScope;
      button.classList.toggle('is-active', active);
      button.setAttribute('aria-pressed', String(active));
    });
  }

  function renderFolderTree(folders, counts) {
    if (!els.folderTree) return;
    const total = state.notes.length;
    const uncategorized = counts.get(UNCATEGORIZED) || 0;
    const rows = [
      `<button class="folder-row__button${state.folderFilter === ALL_FOLDERS ? ' is-active' : ''}" type="button" data-folder-filter="${ALL_FOLDERS}" aria-pressed="${state.folderFilter === ALL_FOLDERS ? 'true' : 'false'}">
        ${T.iconMarkup('layers', 'icon--tiny')}
        <span>全部笔记</span><em>${total}</em>
      </button>`,
      `<button class="folder-row__button${state.folderFilter === UNCATEGORIZED ? ' is-active' : ''}" type="button" data-folder-filter="" aria-pressed="${state.folderFilter === UNCATEGORIZED ? 'true' : 'false'}">
        ${T.iconMarkup('note', 'icon--tiny')}
        <span>未分类</span><em>${uncategorized}</em>
      </button>`
    ];
    folders.forEach((folder) => {
      const active = state.folderFilter === folder;
      rows.push(`<div class="folder-row" draggable="true" data-folder-name="${T.escapeHtml(folder)}">
        <span class="folder-row__grip" aria-hidden="true">${T.iconMarkup('grip', 'icon--tiny')}</span>
        <button class="folder-row__button${active ? ' is-active' : ''}" type="button" data-folder-filter="${T.escapeHtml(folder)}" aria-pressed="${active ? 'true' : 'false'}">
          ${T.iconMarkup('folder', 'icon--tiny')}
          <span>${T.escapeHtml(folder)}</span><em>${counts.get(folder) || 0}</em>
        </button>
      </div>`);
    });
    els.folderTree.innerHTML = rows.join('');
  }

  function updateFolderOptions() {
    if (!els.folderOptions) return;
    els.folderOptions.innerHTML = state.folders
      .map((folder) => `<option value="${T.escapeHtml(folder)}"></option>`)
      .join('');
  }

  function renderSidebar() {
    if (!els.noteList) return;
    const tags = collectTags();
    if (state.activeTag && !tags.some((item) => item.tag === state.activeTag)) {
      state.activeTag = '';
    }
    const { folders, counts } = collectFolders();
    renderTagFilters(tags);
    renderSearchScope();
    renderFolderTree(folders, counts);
    updateFolderOptions();

    const query = state.search.trim().toLowerCase();
    const filtered = state.notes.filter((note) => {
      if (state.activeTag && !note.tags.includes(state.activeTag)) return false;
      if (state.searchScope === 'folder' && state.folderFilter !== ALL_FOLDERS && note.folder !== state.folderFilter) {
        return false;
      }
      if (!query) return true;
      return `${note.title}\n${note.content}\n${note.tags.join(' ')}\n${note.folder}`.toLowerCase().includes(query);
    });

    if (!state.notes.length) {
      els.noteList.innerHTML = '<li class="note-list__empty">还没有笔记。<br>点击上方「新建」开始第一页。</li>';
    } else if (!filtered.length) {
      els.noteList.innerHTML = `<li class="note-list__empty">没有匹配的笔记。<br>${query ? '换个关键词或标签试试。' : '这个文件夹还是空的。'}</li>`;
    } else {
      els.noteList.innerHTML = filtered.map((note) => {
        const active = note.id === state.activeId;
        const tagMarkup = note.tags.slice(0, 2).map((tag) => `<span class="tag">${T.escapeHtml(tag)}</span>`).join('');
        return `
          <li class="note-list__row" draggable="true" data-note-id="${T.escapeHtml(note.id)}">
            <span class="note-item__grip" aria-hidden="true" title="拖动排序">${T.iconMarkup('grip', 'icon--tiny')}</span>
            <button class="note-item${active ? ' is-active' : ''}" type="button" data-note-id="${T.escapeHtml(note.id)}" aria-pressed="${active ? 'true' : 'false'}">
              <span class="note-item__title">${T.escapeHtml(note.title)}</span>
              <span class="note-item__snippet">${T.escapeHtml(plainSnippet(note.content))}</span>
              <span class="note-item__meta">
                <time datetime="${T.escapeHtml(note.updatedAt)}">${T.escapeHtml(formatNoteDate(note.updatedAt))}</time>
                ${note.folder ? `<span class="tag tag--brown">${T.escapeHtml(note.folder)}</span>` : ''}
                ${tagMarkup}
              </span>
            </button>
          </li>
        `;
      }).join('');
    }

    els.noteList.setAttribute('aria-busy', 'false');
    if (els.noteCount) {
      els.noteCount.textContent = state.notes.length
        ? `${filtered.length} / ${state.notes.length} 篇笔记`
        : '0 篇笔记';
    }
    if (els.sampleNoteBtn) els.sampleNoteBtn.hidden = state.notes.length > 0;
  }

  /* ------------------------------------------------------------------------
     编辑器
     ------------------------------------------------------------------------ */
  function updateEditorAvailability(hasNote) {
    if (els.noteTitle) els.noteTitle.disabled = !hasNote;
    if (els.noteTags) els.noteTags.disabled = !hasNote;
    if (els.noteFolder) els.noteFolder.disabled = !hasNote;
    if (els.markdownInput) els.markdownInput.disabled = !hasNote;
    if (els.deleteNoteBtn) els.deleteNoteBtn.disabled = !hasNote;
    if (els.importNoteBtn) els.importNoteBtn.disabled = false;
    if (els.exportMarkdownBtn) els.exportMarkdownBtn.disabled = !hasNote;
    if (els.exportHtmlBtn) els.exportHtmlBtn.disabled = !hasNote;
    if (els.mindmapTab) els.mindmapTab.disabled = !hasNote;
    if (els.notesApp) els.notesApp.classList.toggle('is-empty', !hasNote);
    if (!hasNote) hideDeleteConfirmation();
  }

  /** 把当前 DOM 中的笔记内容同步给可选的思维导图模块。 */
  function requestMindmapRefresh(options = {}) {
    if (!window.NotesMindmap || typeof window.NotesMindmap.refresh !== 'function') return;
    try {
      window.NotesMindmap.refresh(options);
    } catch (error) {
      console.warn('思维导图刷新失败', error);
    }
  }

  function renderTagChips(tags) {
    if (!els.noteTagChips) return;
    els.noteTagChips.innerHTML = tags.map((tag) => `<span class="tag tag--brown">${T.escapeHtml(tag)}</span>`).join('');
  }

  function populateEditor(note) {
    updateEditorAvailability(Boolean(note));
    hideDeleteConfirmation();
    if (!note) {
      if (els.noteTitle) els.noteTitle.value = '';
      if (els.noteTags) els.noteTags.value = '';
      if (els.noteFolder) els.noteFolder.value = '';
      if (els.markdownInput) els.markdownInput.value = '';
      renderTagChips([]);
      setSaveStatus('idle', '空白页');
      renderPreview({ resetScroll: true });
      requestMindmapRefresh({ force: true, reason: 'empty-note' });
      return;
    }

    els.noteTitle.value = note.title;
    els.noteTags.value = note.tags.join(', ');
    if (els.noteFolder) els.noteFolder.value = note.folder;
    els.markdownInput.value = note.content;
    renderTagChips(note.tags);
    state.dirty = false;
    setSaveStatus('saved', '已保存');
    renderPreview({ resetScroll: true });
    requestMindmapRefresh({ force: true, reason: 'note-loaded' });
  }

  function syncActiveFromInputs() {
    const note = activeNote();
    if (!note) return null;
    note.title = String(els.noteTitle.value || '').trim().slice(0, 100) || '未命名笔记';
    note.content = String(els.markdownInput.value || '');
    note.tags = normalizeTags(els.noteTags.value);
    note.folder = normalizeFolder(els.noteFolder ? els.noteFolder.value : note.folder);
    return note;
  }

  function rememberFolder(folder) {
    const value = normalizeFolder(folder);
    if (!value || state.folders.includes(value)) return;
    state.folders.push(value);
    saveFolders();
    renderSidebar();
  }

  function setSaveStatus(kind, text) {
    if (!els.saveStatus) return;
    const icon = kind === 'saved' ? 'check' : kind === 'saving' ? 'save' : kind === 'error' ? 'alert' : 'pen';
    els.saveStatus.className = `save-status${kind === 'saved' ? ' is-saved' : kind === 'saving' ? ' is-saving' : ''}`;
    els.saveStatus.innerHTML = `${T.iconMarkup(icon)}<span>${T.escapeHtml(text)}</span>`;
  }

  function scheduleSave() {
    if (!state.activeId) return;
    state.dirty = true;
    state.saveErrorNotified = false;
    setSaveStatus('dirty', '未保存');
    window.clearTimeout(state.saveTimer);
    state.saveTimer = window.setTimeout(() => {
      flushSave();
    }, 750);
  }

  function markDirty() {
    if (!state.activeId) return;
    syncActiveFromInputs();
    scheduleSave();
  }

  function flushSave() {
    window.clearTimeout(state.saveTimer);
    if (!state.activeId || !state.dirty) return state.saveChain;

    const note = syncActiveFromInputs();
    if (!note) return state.saveChain;
    note.updatedAt = new Date().toISOString();
    const snapshot = {
      ...note,
      tags: [...note.tags]
    };
    state.dirty = false;
    setSaveStatus('saving', '保存中…');

    const task = state.saveChain.catch(() => undefined).then(async () => {
      await T.db.put('notes', snapshot);
      if (snapshot.folder && !state.folders.includes(snapshot.folder)) {
        state.folders.push(snapshot.folder);
        saveFolders();
      }
      if (state.activeId === snapshot.id && !state.dirty) {
        setSaveStatus('saved', '已保存');
      }
      sortNotes();
      renderSidebar();
    }).catch((error) => {
      console.error('笔记保存失败', error);
      if (state.activeId === snapshot.id) {
        state.dirty = true;
        setSaveStatus('error', '保存失败');
        if (!state.saveErrorNotified) {
          state.saveErrorNotified = true;
          T.toast('笔记保存失败，请检查浏览器存储空间。', { type: 'error' });
        }
      }
    });

    state.saveChain = task;
    return task;
  }

  async function selectNote(id, options = {}) {
    if (!id || id === state.activeId) {
      closeSidebar();
      return;
    }
    await flushSave();
    if (state.dirty) await flushSave();
    const note = findNote(id);
    if (!note) return;
    state.activeId = id;
    state.dirty = false;
    populateEditor(note);
    renderSidebar();
    if (state.notes.length) {
      if (options.focusTitle) {
        els.noteTitle.focus();
        els.noteTitle.select();
      } else {
        closeSidebar();
      }
    }
  }

  async function createNote(options = {}) {
    await flushSave();
    const now = new Date().toISOString();
    const sample = Boolean(options.sample);
    const hasCustomContent = Object.prototype.hasOwnProperty.call(options, 'content');
    const targetFolder = Object.prototype.hasOwnProperty.call(options, 'folder')
      ? normalizeFolder(options.folder)
      : (state.folderFilter !== ALL_FOLDERS ? state.folderFilter : '');
    const note = {
      id: T.uid(),
      title: options.title ? String(options.title).trim().slice(0, 100) : (sample ? '示例：一元二次方程' : '未命名笔记'),
      content: hasCustomContent ? String(options.content || '').slice(0, 500000) : (sample ? SAMPLE_CONTENT : NEW_NOTE_CONTENT),
      tags: options.tags ? normalizeTags(options.tags) : (sample ? ['数学', '例题'] : []),
      folder: targetFolder,
      createdAt: now,
      updatedAt: now
    };
    try {
      await T.db.put('notes', note);
    } catch (error) {
      T.toast('新建笔记失败，请检查浏览器存储空间。', { type: 'error' });
      return null;
    }

    state.notes.unshift(note);
    state.noteOrder.unshift(note.id);
    ensureNoteOrder();
    if (note.folder && !state.folders.includes(note.folder)) {
      state.folders.push(note.folder);
      saveFolders();
    }
    state.activeId = note.id;
    state.search = '';
    state.activeTag = '';
    state.dirty = false;
    if (els.noteSearch) els.noteSearch.value = '';
    updateEditorAvailability(true);
    populateEditor(note);
    renderSidebar();
    setSaveStatus('saved', '已保存');
    if (els.notesApp) {
      els.notesApp.dataset.pane = 'editor';
      setPane('editor');
    }
    if (options.focusTitle !== false) {
      window.setTimeout(() => {
        if (els.noteTitle) {
          els.noteTitle.focus();
          els.noteTitle.select();
        }
      }, 60);
    }
    T.toast(
      options.toast || (sample ? '示例笔记已载入，可以自由修改。' : '新的一页已经摊开。'),
      { type: 'success', duration: 2200 }
    );
    return note;
  }

  function showDeleteConfirmation() {
    const note = activeNote();
    if (!note || !els.inlineDeleteBar) return;
    const text = document.getElementById('inlineDeleteText');
    if (text) text.textContent = `确定删除「${note.title}」？删除后无法恢复。`;
    els.inlineDeleteBar.hidden = false;
    if (els.inlineDeleteCancel) els.inlineDeleteCancel.focus();
  }

  function hideDeleteConfirmation(restoreFocus = false) {
    if (!els.inlineDeleteBar || els.inlineDeleteBar.hidden) return;
    els.inlineDeleteBar.hidden = true;
    if (restoreFocus) els.deleteNoteBtn?.focus();
  }

  function clearEditorAfterDelete() {
    state.activeId = null;
    updateEditorAvailability(false);
    if (els.noteTitle) els.noteTitle.value = '';
    if (els.noteTags) els.noteTags.value = '';
    if (els.noteFolder) els.noteFolder.value = '';
    if (els.markdownInput) els.markdownInput.value = '';
    renderTagChips([]);
    renderPreview({ resetScroll: true });
    setSaveStatus('idle', '空白页');
    requestMindmapRefresh({ force: true, reason: 'note-deleted' });
  }

  async function deleteCurrentNote() {
    const note = activeNote();
    if (!note) return;
    hideDeleteConfirmation();

    window.clearTimeout(state.saveTimer);
    state.dirty = false;
    await state.saveChain.catch(() => undefined);

    try {
      await T.db.delete('notes', note.id);
    } catch (error) {
      T.toast('删除失败，请重试。', { type: 'error' });
      return;
    }

    const index = state.notes.findIndex((item) => item.id === note.id);
    state.notes = state.notes.filter((item) => item.id !== note.id);
    state.noteOrder = state.noteOrder.filter((id) => id !== note.id);
    saveNoteOrder();
    const next = state.notes[Math.min(index, state.notes.length - 1)] || null;
    if (next) {
      state.activeId = next.id;
      populateEditor(next);
    } else {
      clearEditorAfterDelete();
    }
    renderSidebar();
    T.toast('笔记已删除。', { type: 'info' });
  }

  /* ------------------------------------------------------------------------
     公式保护与 Markdown 渲染
     ------------------------------------------------------------------------ */
  function isLineStart(source, index) {
    let cursor = index - 1;
    while (cursor >= 0 && source[cursor] !== '\n') {
      if (source[cursor] !== ' ' && source[cursor] !== '\t') return false;
      cursor -= 1;
    }
    return true;
  }

  function findUnescaped(source, sequence, from) {
    let index = from;
    while (index < source.length) {
      const found = source.indexOf(sequence, index);
      if (found === -1) return -1;
      let slashes = 0;
      for (let cursor = found - 1; cursor >= 0 && source[cursor] === '\\'; cursor -= 1) {
        slashes += 1;
      }
      if (slashes % 2 === 0) return found;
      index = found + 1;
    }
    return -1;
  }

  function fenceEnd(source, start, char, runLength) {
    let lineStart = source.indexOf('\n', start + runLength);
    if (lineStart === -1) return source.length;
    lineStart += 1;
    while (lineStart < source.length) {
      const nextBreak = source.indexOf('\n', lineStart);
      const lineEnd = nextBreak === -1 ? source.length : nextBreak;
      const line = source.slice(lineStart, lineEnd);
      const match = line.match(/^[ \t]*(`{3,}|~{3,})[ \t]*$/);
      if (match && match[1][0] === char && match[1].length >= runLength) {
        return lineEnd;
      }
      if (nextBreak === -1) break;
      lineStart = nextBreak + 1;
    }
    return source.length;
  }

  function inlineCodeEnd(source, start, runLength) {
    let cursor = start + runLength;
    while (cursor < source.length) {
      if (source[cursor] === '`') {
        let end = cursor;
        while (source[end] === '`') end += 1;
        if (end - cursor === runLength) return end;
        cursor = end;
      } else {
        cursor += 1;
      }
    }
    return -1;
  }

  /**
   * 先保护公式，避免 Markdown 把 _ ^ * 等 LaTeX 字符当成格式。
   * 代码块与行内代码中的 $ 不会被提取。
   */
  function protectMath(source) {
    const mathTokens = [];
    const nonce = Math.random().toString(36).slice(2, 9).toUpperCase();
    let output = '';
    let i = 0;

    const addMath = (tex, display) => {
      const token = `TBXMATH${nonce}${mathTokens.length}END`;
      mathTokens.push({ token, tex, display });
      return token;
    };

    while (i < source.length) {
      const char = source[i];

      // 围栏代码块：整体保留（包括带语言标记的围栏），不解析其中的 $。
      if ((char === '`' || char === '~') && isLineStart(source, i)) {
        let runLength = 1;
        while (source[i + runLength] === char) runLength += 1;
        if (runLength >= 3) {
          const end = fenceEnd(source, i, char, runLength);
          output += source.slice(i, end);
          i = end;
          continue;
        }
      }

      // 行内代码：原样保留。
      if (char === '`') {
        let runLength = 1;
        while (source[i + runLength] === '`') runLength += 1;
        const end = inlineCodeEnd(source, i, runLength);
        if (end !== -1) {
          output += source.slice(i, end);
          i = end;
          continue;
        }
        output += char;
        i += 1;
        continue;
      }

      // 反斜杠转义：\$ 不当作公式起始。
      if (char === '\\') {
        output += source.slice(i, Math.min(i + 2, source.length));
        i += 2;
        continue;
      }

      // 块级公式 $$...$$
      if (char === '$' && source[i + 1] === '$') {
        const close = findUnescaped(source, '$$', i + 2);
        if (close !== -1) {
          const tex = source.slice(i + 2, close).trim();
          if (tex) {
            output += addMath(tex, true);
            i = close + 2;
            continue;
          }
        }
      }

      // 行内公式 $...$，限制在同一行，且首尾不能是空白。
      if (char === '$') {
        let cursor = i + 1;
        let close = -1;
        while (cursor < source.length && source[cursor] !== '\n') {
          if (source[cursor] === '\\') {
            cursor += 2;
            continue;
          }
          if (source[cursor] === '$') {
            close = cursor;
            break;
          }
          cursor += 1;
        }
        if (close !== -1) {
          const tex = source.slice(i + 1, close);
          const startsClean = tex.length > 0 && !/^\s/.test(tex);
          const endsClean = tex.length > 0 && !/\s$/.test(tex);
          if (startsClean && endsClean) {
            output += addMath(tex, false);
            i = close + 1;
            continue;
          }
        }
      }

      output += char;
      i += 1;
    }

    return { markdown: output, mathTokens };
  }

  /**
   * 在 markdown-it 之前保护受控的颜色 / 下划线 HTML。
   * 这里只接受四个颜色类和 <u>，恢复时会对内容再次 escapeHtml，
   * 因此仍然保持 html:false 的安全边界，不执行用户原始 HTML。
   */
  function protectInlineFormatting(source) {
    const formatTokens = [];
    const nonce = Math.random().toString(36).slice(2, 9).toUpperCase();
    let output = '';
    let i = 0;

    const addFormat = (kind, className, content) => {
      const token = `TBXSTYLE${nonce}${formatTokens.length}END`;
      formatTokens.push({ token, kind, className, content });
      return token;
    };

    while (i < source.length) {
      const char = source[i];

      // 围栏代码块整体跳过（包括 ```js 这类带语言标记的围栏）。
      if ((char === '`' || char === '~') && isLineStart(source, i)) {
        let runLength = 1;
        while (source[i + runLength] === char) runLength += 1;
        if (runLength >= 3) {
          const end = fenceEnd(source, i, char, runLength);
          output += source.slice(i, end);
          i = end;
          continue;
        }
      }

      // 行内代码整体跳过。
      if (char === '`') {
        let runLength = 1;
        while (source[i + runLength] === '`') runLength += 1;
        const end = inlineCodeEnd(source, i, runLength);
        if (end !== -1) {
          output += source.slice(i, end);
          i = end;
          continue;
        }
        output += char;
        i += 1;
        continue;
      }

      // 反斜杠转义的尖括号不处理。
      if (char === '\\') {
        output += source.slice(i, Math.min(i + 2, source.length));
        i += 2;
        continue;
      }

      if (source.startsWith('<u>', i)) {
        const close = source.indexOf('</u>', i + 3);
        if (close !== -1) {
          const content = source.slice(i + 3, close);
          if (content && !/[\r\n]/.test(content)) {
            output += addFormat('underline', '', content);
            i = close + 4;
            continue;
          }
        }
      }

      if (source.startsWith('<span class="', i)) {
        const openMatch = /^<span class="(mark-(?:ink|rust|olive|mauve))">/.exec(source.slice(i));
        if (openMatch) {
          const contentStart = i + openMatch[0].length;
          const close = source.indexOf('</span>', contentStart);
          if (close !== -1) {
            const content = source.slice(contentStart, close);
            if (content && !/[\r\n]/.test(content)) {
              output += addFormat('color', openMatch[1], content);
              i = close + 7;
              continue;
            }
          }
        }
      }

      output += char;
      i += 1;
    }

    return { markdown: output, formatTokens };
  }

  function restoreInlineFormatting(html, formatTokens) {
    let output = html;
    formatTokens.forEach((item) => {
      let replacement = '';
      if (item.kind === 'underline') {
        replacement = `<u>${T.escapeHtml(item.content)}</u>`;
      } else if (/^mark-(?:ink|rust|olive|mauve)$/.test(item.className)) {
        replacement = `<span class="${item.className}">${T.escapeHtml(item.content)}</span>`;
      }
      if (replacement) output = output.split(item.token).join(replacement);
    });
    return output;
  }

  function renderTex(tex, display) {
    if (state.katex && window.katex && typeof window.katex.renderToString === 'function') {
      try {
        const rendered = window.katex.renderToString(tex, {
          displayMode: display,
          throwOnError: false,
          strict: 'ignore',
          trust: false,
          output: 'htmlAndMathml'
        });
        return `<span class="math-${display ? 'display' : 'inline'}">${rendered}</span>`;
      } catch (error) {
        // KaTeX 通常不会抛错，这里兜底避免整页预览中断。
      }
    }
    const raw = display ? `$$${tex}$$` : `$${tex}$`;
    return `<span class="math-fallback${display ? ' math-fallback--display' : ''}">${T.escapeHtml(raw)}</span>`;
  }

  function restoreMath(html, mathTokens) {
    let output = html;
    mathTokens.forEach((item) => {
      output = output.split(item.token).join(renderTex(item.tex, item.display));
    });
    return output;
  }

  function transformCallouts(html) {
    if (!html || !/\[!(?:note|warning|tip)\]/i.test(html)) return html;
    const template = document.createElement('div');
    template.innerHTML = html;
    const quotes = Array.from(template.querySelectorAll('blockquote'));
    if (!quotes.length) return html;

    const labels = {
      note: { tag: 'NOTE', title: '笔记' },
      warning: { tag: 'WARNING', title: '注意' },
      tip: { tag: 'TIP', title: '提示' }
    };

    // 从最深层开始处理，嵌套 Callout 的内层会先变成 details，再被外层整体搬走。
    quotes.reverse().forEach((quote) => {
      const first = quote.firstElementChild;
      if (!first || first.tagName !== 'P') return;
      const parts = first.innerHTML.split(/<br\s*\/?>/i);
      const firstLineWrap = document.createElement('div');
      firstLineWrap.innerHTML = parts[0] || '';
      const firstLine = firstLineWrap.textContent.trim();
      const match = /^\[!(note|warning|tip)\]([+-])?\s*(.*)$/i.exec(firstLine);
      if (!match) return;
      const type = match[1].toLowerCase();
      const folded = match[2] === '-';
      const title = (match[3] || '').trim() || labels[type].title;

      const rest = parts.slice(1).join('<br>');
      first.innerHTML = rest;
      if (!first.textContent.trim() && !first.querySelector('img, hr')) first.remove();

      const details = document.createElement('details');
      details.className = `callout callout--${type}`;
      details.open = !folded;
      details.dataset.callout = type;

      const summary = document.createElement('summary');
      summary.className = 'callout__summary';
      const tag = document.createElement('span');
      tag.className = 'callout__tag';
      tag.textContent = labels[type].tag;
      const titleNode = document.createElement('span');
      titleNode.className = 'callout__title';
      titleNode.textContent = title;
      const chevron = document.createElement('span');
      chevron.className = 'callout__chevron';
      chevron.setAttribute('aria-hidden', 'true');
      summary.append(tag, titleNode, chevron);

      const body = document.createElement('div');
      body.className = 'callout__body';
      while (quote.firstChild) body.appendChild(quote.firstChild);
      details.append(summary, body);
      quote.replaceWith(details);
    });
    return template.innerHTML;
  }

  function createMarkdownRenderer(factory) {
    const md = factory({
      html: false,
      linkify: true,
      breaks: true,
      typographer: false
    });

    // 只放行 http(s) / mailto，防止 javascript: 等协议进入预览与导出。
    md.validateLink = (url) => {
      try {
        const parsed = new URL(String(url), window.location.href);
        return ['http:', 'https:', 'mailto:'].includes(parsed.protocol);
      } catch (error) {
        return false;
      }
    };

    const defaultLinkOpen = md.renderer.rules.link_open
      || function (tokens, idx, options, env, self) {
        return self.renderToken(tokens, idx, options);
      };

    md.renderer.rules.link_open = (tokens, idx, options, env, self) => {
      const href = tokens[idx].attrGet('href') || '';
      if (/^(https?:|mailto:)/i.test(href)) {
        tokens[idx].attrSet('target', '_blank');
        tokens[idx].attrSet('rel', 'noopener noreferrer');
      }
      return defaultLinkOpen(tokens, idx, options, env, self);
    };

    const defaultImage = md.renderer.rules.image
      || function (tokens, idx, options, env, self) {
        return self.renderToken(tokens, idx, options);
      };
    md.renderer.rules.image = (tokens, idx, options, env, self) => {
      tokens[idx].attrSet('loading', 'lazy');
      tokens[idx].attrSet('decoding', 'async');
      tokens[idx].attrSet('referrerpolicy', 'no-referrer');
      return defaultImage(tokens, idx, options, env, self);
    };

    return md;
  }

  /** markdown-it 未加载时的轻量兜底，只用于保证页面不会空白。 */
  function fallbackInline(text) {
    const codeTokens = [];
    let output = T.escapeHtml(text);
    output = output.replace(/`([^`]+)`/g, (match, code) => {
      const token = `@@TBXCODE${codeTokens.length}@@`;
      codeTokens.push(`<code>${T.escapeHtml(code)}</code>`);
      return token;
    });
    output = output.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
    output = output.replace(/(^|[^*])\*([^*\n]+)\*/g, '$1<em>$2</em>');
    output = output.replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, (match, label, rawUrl) => {
      const safe = T.safeUrl(rawUrl.replace(/&amp;/g, '&'));
      if (!safe) return label;
      return `<a href="${T.escapeHtml(safe)}" target="_blank" rel="noopener noreferrer">${label}</a>`;
    });
    codeTokens.forEach((code, index) => {
      output = output.replace(`@@TBXCODE${index}@@`, code);
    });
    return output;
  }

  function fallbackMarkdown(source) {
    const lines = String(source || '').replace(/\r\n?/g, '\n').split('\n');
    const html = [];
    let paragraph = [];
    let listTag = '';
    let listItems = [];

    const flushParagraph = () => {
      if (!paragraph.length) return;
      html.push(`<p>${paragraph.map(fallbackInline).join('<br>')}</p>`);
      paragraph = [];
    };
    const flushList = () => {
      if (!listItems.length) return;
      html.push(`<${listTag}>${listItems.map((item) => `<li>${fallbackInline(item)}</li>`).join('')}</${listTag}>`);
      listItems = [];
      listTag = '';
    };

    for (let i = 0; i < lines.length; i += 1) {
      const line = lines[i];

      if (/^```/.test(line.trim()) || /^~~~/.test(line.trim())) {
        flushParagraph();
        flushList();
        const fence = line.trim().slice(0, 3);
        const language = line.trim().slice(3).trim().replace(/[^\w-]/g, '');
        const codeLines = [];
        i += 1;
        while (i < lines.length && !lines[i].trim().startsWith(fence)) {
          codeLines.push(lines[i]);
          i += 1;
        }
        html.push(`<pre><code${language ? ` class="language-${language}"` : ''}>${T.escapeHtml(codeLines.join('\n'))}</code></pre>`);
        continue;
      }

      if (!line.trim()) {
        flushParagraph();
        flushList();
        continue;
      }

      const heading = line.match(/^(#{1,6})\s+(.+)$/);
      if (heading) {
        flushParagraph();
        flushList();
        const level = heading[1].length;
        html.push(`<h${level}>${fallbackInline(heading[2])}</h${level}>`);
        continue;
      }

      if (/^\s*([-*_])(?:\s*\1){2,}\s*$/.test(line)) {
        flushParagraph();
        flushList();
        html.push('<hr>');
        continue;
      }

      if (/^>\s?/.test(line)) {
        flushParagraph();
        flushList();
        const quoteLines = [];
        while (i < lines.length && /^>\s?/.test(lines[i])) {
          quoteLines.push(lines[i].replace(/^>\s?/, ''));
          i += 1;
        }
        i -= 1;
        html.push(`<blockquote><p>${quoteLines.map(fallbackInline).join('<br>')}</p></blockquote>`);
        continue;
      }

      const unordered = line.match(/^\s*[-*+]\s+(.+)$/);
      const ordered = line.match(/^\s*\d+\.\s+(.+)$/);
      if (unordered || ordered) {
        flushParagraph();
        const nextTag = unordered ? 'ul' : 'ol';
        if (listTag && listTag !== nextTag) flushList();
        listTag = nextTag;
        listItems.push((unordered || ordered)[1]);
        continue;
      }

      flushList();
      paragraph.push(line);
    }

    flushParagraph();
    flushList();
    return html.join('\n');
  }

  function renderMarkdownToHtml(source) {
    // 先保护公式，再保护颜色/下划线；这样颜色内部仍可包含 $...$。
    const { markdown, mathTokens } = protectMath(String(source || ''));
    const { markdown: protectedMarkdown, formatTokens } = protectInlineFormatting(markdown);
    let html;
    if (state.markdownIt) {
      try {
        html = state.markdownIt.render(protectedMarkdown);
      } catch (error) {
        html = fallbackMarkdown(protectedMarkdown);
      }
    } else {
      html = fallbackMarkdown(protectedMarkdown);
    }
    html = restoreInlineFormatting(html, formatTokens);
    html = transformCallouts(html);
    return restoreMath(html, mathTokens);
  }

  function renderPreview(options = {}) {
    if (!els.previewContent) return;
    const note = activeNote();
    const scrollTop = options.resetScroll === false && els.previewScroll ? els.previewScroll.scrollTop : 0;

    if (!note) {
      els.previewContent.innerHTML = `
        <div class="preview-empty">
          <svg class="icon" aria-hidden="true"><use href="assets/icons.svg#icon-note"></use></svg>
          <div><strong>空白页</strong>新建或选择一篇笔记后，这里会出现排版好的预览。</div>
        </div>
      `;
    } else if (!note.content.trim()) {
      els.previewContent.innerHTML = `
        <div class="preview-empty">
          <svg class="icon" aria-hidden="true"><use href="assets/icons.svg#icon-pen"></use></svg>
          <div><strong>从第一行开始</strong>左侧支持 Markdown，行内公式写成 $x^2$，块级公式用 $$ 包裹。</div>
        </div>
      `;
    } else {
      els.previewContent.innerHTML = renderMarkdownToHtml(note.content);
    }

    if (els.previewScroll) {
      els.previewScroll.scrollTop = scrollTop;
    }
  }

  function schedulePreviewRefresh() {
    window.clearTimeout(state.previewTimer);
    state.previewTimer = window.setTimeout(() => {
      renderPreview({ resetScroll: false });
    }, 45);
  }

  /* ------------------------------------------------------------------------
     markdown-it / KaTeX 动态加载
     ------------------------------------------------------------------------ */
  function loadScriptOnce(src, timeoutMs = 8000) {
    return new Promise((resolve, reject) => {
      const script = document.createElement('script');
      script.src = src;
      script.async = true;
      let settled = false;
      const timer = window.setTimeout(() => finish(new Error('加载超时')), timeoutMs);

      function finish(error) {
        if (settled) return;
        settled = true;
        window.clearTimeout(timer);
        script.onload = null;
        script.onerror = null;
        if (error) {
          script.remove();
          reject(error);
        } else {
          resolve();
        }
      }

      script.onload = () => finish();
      script.onerror = () => finish(new Error('资源加载失败'));
      document.head.appendChild(script);
    });
  }

  function loadStyleOnce(href, timeoutMs = 8000) {
    return new Promise((resolve, reject) => {
      const link = document.createElement('link');
      link.rel = 'stylesheet';
      link.href = href;
      let settled = false;
      const timer = window.setTimeout(() => finish(new Error('加载超时')), timeoutMs);

      function finish(error) {
        if (settled) return;
        settled = true;
        window.clearTimeout(timer);
        link.onload = null;
        link.onerror = null;
        if (error) {
          link.remove();
          reject(error);
        } else {
          resolve();
        }
      }

      link.onload = () => finish();
      link.onerror = () => finish(new Error('样式加载失败'));
      document.head.appendChild(link);
    });
  }

  async function loadWithFallback(urls, loader) {
    let lastError = null;
    for (const url of urls) {
      try {
        await loader(url);
        return true;
      } catch (error) {
        lastError = error;
      }
    }
    if (lastError) console.warn('资源加载失败', lastError);
    return false;
  }

  function updateRendererStatus() {
    if (els.renderBadge) {
      if (state.libsLoading) {
        els.renderBadge.textContent = '加载 markdown-it · KaTeX…';
        els.renderBadge.classList.remove('is-warn');
      } else if (state.markdownIt && state.katex) {
        els.renderBadge.textContent = 'markdown-it · KaTeX';
        els.renderBadge.classList.toggle('is-warn', !state.katexCss);
      } else if (state.markdownIt) {
        els.renderBadge.textContent = 'Markdown 可用 · 公式基础模式';
        els.renderBadge.classList.add('is-warn');
      } else {
        els.renderBadge.textContent = '基础排版模式';
        els.renderBadge.classList.add('is-warn');
      }
    }

    if (els.renderNotice) {
      if (state.libsLoading) {
        els.renderNotice.hidden = true;
      } else if (!state.markdownIt || !state.katex) {
        const missing = [];
        if (!state.markdownIt) missing.push('markdown-it');
        if (!state.katex) missing.push('KaTeX');
        els.renderNotice.hidden = false;
        els.renderNotice.textContent = `${missing.join(' 与 ')} 未能从 CDN 加载。当前已切换到基础排版模式，公式会以源码显示；检查网络后刷新页面即可恢复完整渲染。`;
      } else if (!state.katexCss) {
        els.renderNotice.hidden = false;
        els.renderNotice.textContent = '公式渲染脚本已加载，但 KaTeX 样式表未能加载，公式排版可能不完整。';
      } else {
        els.renderNotice.hidden = true;
        els.renderNotice.textContent = '';
      }
    }
  }

  async function loadRendererLibraries() {
    state.libsLoading = true;
    updateRendererStatus();

    const [markdownResult, katexResult, cssResult] = await Promise.all([
      loadWithFallback(RENDERER_URLS.markdownIt, loadScriptOnce),
      loadWithFallback(RENDERER_URLS.katexJs, loadScriptOnce),
      loadWithFallback(RENDERER_URLS.katexCss, loadStyleOnce)
    ]);

    if (markdownResult && typeof window.markdownit === 'function') {
      try {
        state.markdownIt = createMarkdownRenderer(window.markdownit);
      } catch (error) {
        state.markdownIt = null;
      }
    }
    state.katex = Boolean(katexResult && window.katex && typeof window.katex.renderToString === 'function');
    state.katexCss = Boolean(cssResult);
    state.libsLoading = false;
    updateRendererStatus();

    if (state.activeId) {
      renderPreview({ resetScroll: false });
      // 公式渲染库就绪后，重新排版导图详情中的公式。
      requestMindmapRefresh({ force: true, reason: 'renderer-ready' });
    }
  }

  /* ------------------------------------------------------------------------
     移动端面板 / 侧栏
     ------------------------------------------------------------------------ */
  function openSidebar() {
    if (!els.notesApp) return;
    els.notesApp.classList.add('sidebar-open');
    els.libraryToggle?.setAttribute('aria-expanded', 'true');
  }

  function closeSidebar() {
    if (!els.notesApp) return;
    els.notesApp.classList.remove('sidebar-open');
    els.libraryToggle?.setAttribute('aria-expanded', 'false');
  }

  function setPane(pane) {
    if (!els.notesApp) return;
    const nextPane = ['editor', 'preview', 'mindmap'].includes(pane) ? pane : 'editor';
    els.notesApp.dataset.pane = nextPane;
    [
      ['editor', els.editorTab],
      ['preview', els.previewTab],
      ['mindmap', els.mindmapTab]
    ].forEach(([name, tab]) => {
      if (!tab) return;
      const active = name === nextPane;
      tab.classList.toggle('is-active', active);
      tab.setAttribute('aria-selected', String(active));
      tab.tabIndex = active ? 0 : -1;
    });
    if (nextPane === 'preview') renderPreview({ resetScroll: false });
    if (nextPane === 'mindmap') {
      requestMindmapRefresh({ force: true, reason: 'pane-shown' });
    }
  }

  /* ------------------------------------------------------------------------
     插入模板 / AI / 导出
     ------------------------------------------------------------------------ */
  function insertLatexTemplate(type) {
    const template = INSERT_TEMPLATES[type];
    if (!template || !els.markdownInput) return;
    const input = els.markdownInput;
    const start = input.selectionStart || 0;
    const end = input.selectionEnd || 0;
    const text = input.value;
    const leading = start > 0 && text[start - 1] !== '\n' ? '\n' : '';
    const trailing = end < text.length && text[end] !== '\n' ? '\n' : '';
    const insertion = `${leading}$$\n${template}\n$$${trailing}`;

    input.setRangeText(insertion, start, end, 'end');
    const formulaStart = start + leading.length + 3;
    input.setSelectionRange(formulaStart, formulaStart + template.length);
    input.focus();
    input.dispatchEvent(new Event('input', { bubbles: true }));
    setPane('editor');
  }

  function refreshEditorAfterInsert() {
    const input = els.markdownInput;
    if (!input) return;
    input.dispatchEvent(new Event('input', { bubbles: true }));
    setPane('editor');
  }

  function wrapEditorSelection(prefix, suffix, placeholder) {
    const input = els.markdownInput;
    if (!input) return;
    const start = input.selectionStart || 0;
    const end = input.selectionEnd || 0;
    const selected = input.value.slice(start, end);
    const content = selected || placeholder;
    const insertion = `${prefix}${content}${suffix}`;
    input.setRangeText(insertion, start, end, 'end');
    const contentStart = start + prefix.length;
    input.setSelectionRange(contentStart, contentStart + content.length);
    input.focus();
    refreshEditorAfterInsert();
  }

  function insertDisplayMath() {
    const input = els.markdownInput;
    if (!input) return;
    const start = input.selectionStart || 0;
    const end = input.selectionEnd || 0;
    const selected = input.value.slice(start, end) || '...';
    const leading = start > 0 && input.value[start - 1] !== '\n' ? '\n' : '';
    const trailing = end < input.value.length && input.value[end] !== '\n' ? '\n' : '';
    const insertion = `${leading}$$\n${selected}\n$$${trailing}`;
    input.setRangeText(insertion, start, end, 'end');
    const from = start + leading.length + 3;
    input.setSelectionRange(from, from + selected.length);
    input.focus();
    refreshEditorAfterInsert();
  }

  function applyFormat(action) {
    if (action === 'display-math') {
      insertDisplayMath();
      return;
    }
    if (action === 'inline-math') {
      wrapEditorSelection('$', '$', 'x^2');
      return;
    }
    const pairs = {
      bold: ['**', '**', '重点文字'],
      italic: ['*', '*', '强调'],
      strike: ['~~', '~~', '划掉'],
      underline: ['<u>', '</u>', '下划线']
    };
    const pair = pairs[action];
    if (pair) wrapEditorSelection(pair[0], pair[1], pair[2]);
  }

  function applyColor(color) {
    if (!['ink', 'rust', 'olive', 'mauve'].includes(color)) return;
    wrapEditorSelection(`<span class="${color ? `mark-${color}` : ''}">`, '</span>', '彩色文字');
  }

  function setPreviewFullscreen(active) {
    if (!els.previewPane || !els.previewFullscreenBtn) return;
    state.previewFullscreen = Boolean(active);
    els.previewPane.classList.toggle('is-fullscreen', state.previewFullscreen);
    document.body.classList.toggle('preview-fullscreen-open', state.previewFullscreen);
    els.previewFullscreenBtn.setAttribute('aria-pressed', String(state.previewFullscreen));
    const use = els.previewFullscreenBtn.querySelector('use');
    const label = els.previewFullscreenBtn.querySelector('span');
    if (use) use.setAttribute('href', `assets/icons.svg#icon-${state.previewFullscreen ? 'minimize' : 'maximize'}`);
    if (label) label.textContent = state.previewFullscreen ? '退出' : '全屏';
    if (state.previewFullscreen) {
      els.previewScroll?.setAttribute('tabindex', '-1');
      els.previewScroll?.focus({ preventScroll: true });
    } else {
      els.previewFullscreenBtn.focus({ preventScroll: true });
    }
  }

  function togglePreviewFullscreen() {
    setPreviewFullscreen(!state.previewFullscreen);
  }

  function importLocalFile() {
    els.importNoteFile?.click();
  }

  async function handleImportFile() {
    const file = els.importNoteFile?.files && els.importNoteFile.files[0];
    if (!file) return;
    if (!/\.(md|txt)$/i.test(file.name)) {
      T.toast('请选择 .md 或 .txt 文件。', { type: 'info' });
      els.importNoteFile.value = '';
      return;
    }
    if (file.size > 2 * 1024 * 1024) {
      T.toast('文件超过 2 MB，请拆分后再导入。', { type: 'error' });
      els.importNoteFile.value = '';
      return;
    }
    try {
      const content = await T.readFileAsText(file);
      const title = file.name.replace(/\.[^.]+$/, '').trim().slice(0, 100) || '导入笔记';
      const folder = state.folderFilter !== ALL_FOLDERS ? state.folderFilter : '';
      const note = await createNote({
        title,
        content,
        folder,
        tags: [],
        focusTitle: false,
        toast: `已导入「${title}」。`
      });
      if (note) {
        els.markdownInput?.focus();
        els.markdownInput?.setSelectionRange(0, 0);
      }
    } catch (error) {
      console.error('导入文件失败', error);
      T.toast('读取文件失败，请换一个文件重试。', { type: 'error' });
    } finally {
      els.importNoteFile.value = '';
    }
  }

  function bindScrollSync() {
    const editor = els.markdownInput;
    const preview = els.previewScroll;
    if (!editor || !preview) return;
    let frame = 0;
    let releaseTimer = 0;

    const sync = (from, to) => {
      if (state.scrollSyncLock || !from || !to) return;
      if (from.clientHeight <= 0 || to.clientHeight <= 0) return;
      const fromMax = from.scrollHeight - from.clientHeight;
      const toMax = to.scrollHeight - to.clientHeight;
      if (fromMax <= 0 || toMax <= 0) return;
      const ratio = Math.min(1, Math.max(0, from.scrollTop / fromMax));
      state.scrollSyncLock = true;
      to.scrollTop = ratio * toMax;
      window.clearTimeout(releaseTimer);
      releaseTimer = window.setTimeout(() => { state.scrollSyncLock = false; }, 80);
    };

    const schedule = (from, to) => {
      window.cancelAnimationFrame(frame);
      frame = window.requestAnimationFrame(() => sync(from, to));
    };

    editor.addEventListener('scroll', () => schedule(editor, preview), { passive: true });
    preview.addEventListener('scroll', () => schedule(preview, editor), { passive: true });
  }

  function openCheatSheet() {
    if (!els.cheatSheet) return;
    els.cheatSheet.open = true;
    els.cheatSheet.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    const summary = els.cheatSheet.querySelector('summary');
    if (summary) summary.focus();
  }

  /* ------------------------------------------------------------------------
     文件夹、右键菜单、拖拽排序
     ------------------------------------------------------------------------ */
  function setFolderFilter(folder) {
    state.folderFilter = folder === ALL_FOLDERS ? ALL_FOLDERS : normalizeFolder(folder);
    state.searchScope = 'folder';
    renderSidebar();
    if (window.matchMedia('(max-width: 760px)').matches) closeSidebar();
  }

  function addFolder(name) {
    const folder = normalizeFolder(name);
    if (!folder) return '';
    if (!state.folders.includes(folder)) {
      state.folders.push(folder);
      saveFolders();
      renderSidebar();
    }
    return folder;
  }

  function openNewFolderForm() {
    if (!els.newFolderForm) return;
    els.newFolderForm.hidden = false;
    if (els.newFolderInput) {
      els.newFolderInput.value = '';
      els.newFolderInput.focus();
    }
  }

  function closeNewFolderForm() {
    if (els.newFolderForm) els.newFolderForm.hidden = true;
  }

  async function moveNoteToFolder(noteId, folder) {
    const note = findNote(noteId);
    if (!note) return;
    const target = normalizeFolder(folder);
    note.folder = target;
    if (target) addFolder(target);
    hideContextMenu();
    if (note.id === state.activeId) {
      if (els.noteFolder) els.noteFolder.value = target;
      markDirty();
      flushSave();
    } else {
      note.updatedAt = new Date().toISOString();
      try {
        await T.db.put('notes', note);
      } catch (error) {
        T.toast('移动到文件夹失败，请重试。', { type: 'error' });
        return;
      }
      renderSidebar();
    }
    T.toast(`已移动到「${folderLabel(target)}」。`, { type: 'info', duration: 1800 });
  }

  function renderContextFolders() {
    if (!els.contextFolderList) return;
    const note = findNote(state.contextNoteId);
    if (!note) return;
    const rows = [`<button class="note-context__folder${note.folder === UNCATEGORIZED ? ' is-current' : ''}" type="button" data-context-folder="">${T.iconMarkup('note', 'icon--tiny')}未分类</button>`];
    state.folders.forEach((folder) => {
      rows.push(`<button class="note-context__folder${note.folder === folder ? ' is-current' : ''}" type="button" data-context-folder="${T.escapeHtml(folder)}">${T.iconMarkup('folder', 'icon--tiny')}${T.escapeHtml(folder)}</button>`);
    });
    els.contextFolderList.innerHTML = rows.join('');
  }

  function setContextPanel(panel) {
    if (!els.noteContextMenu) return;
    T.$$('[data-context-panel]', els.noteContextMenu).forEach((node) => {
      node.hidden = node.dataset.contextPanel !== panel;
    });
    if (panel === 'move') {
      renderContextFolders();
      window.requestAnimationFrame(() => {
        els.noteContextMenu?.querySelector('[data-context-folder]')?.focus({ preventScroll: true });
      });
    } else {
      window.requestAnimationFrame(() => {
        els.noteContextMenu?.querySelector('[data-context-action]:not([hidden])')?.focus({ preventScroll: true });
      });
    }
  }

  function hideContextMenu() {
    if (!els.noteContextMenu || els.noteContextMenu.hidden) return;
    els.noteContextMenu.hidden = true;
    state.contextNoteId = '';
    setContextPanel('root');
  }

  function openContextMenu(x, y, noteId) {
    if (!els.noteContextMenu) return;
    const note = findNote(noteId);
    if (!note) return;
    state.contextNoteId = noteId;
    setContextPanel('root');
    els.noteContextMenu.hidden = false;
    els.noteContextMenu.style.left = '0px';
    els.noteContextMenu.style.top = '0px';
    const rect = els.noteContextMenu.getBoundingClientRect();
    const left = Math.max(8, Math.min(x, window.innerWidth - rect.width - 10));
    const top = Math.max(8, Math.min(y, window.innerHeight - rect.height - 10));
    els.noteContextMenu.style.left = `${left}px`;
    els.noteContextMenu.style.top = `${top}px`;
    const first = els.noteContextMenu.querySelector('[data-context-action]:not([hidden])');
    if (first) first.focus({ preventScroll: true });
  }

  function reorderNoteList(dragId, targetId, after = false) {
    if (!dragId || !targetId || dragId === targetId) return;
    const order = state.noteOrder.slice();
    const from = order.indexOf(dragId);
    const target = order.indexOf(targetId);
    if (from < 0 || target < 0) return;
    order.splice(from, 1);
    const insertAt = order.indexOf(targetId) + (after ? 1 : 0);
    order.splice(insertAt, 0, dragId);
    state.noteOrder = order;
    saveNoteOrder();
    sortNotes();
    renderSidebar();
  }

  function reorderFolders(dragFolder, targetFolder, after = false) {
    if (!dragFolder || !targetFolder || dragFolder === targetFolder) return;
    const from = state.folders.indexOf(dragFolder);
    const target = state.folders.indexOf(targetFolder);
    if (from < 0 || target < 0) return;
    const folders = state.folders.slice();
    folders.splice(from, 1);
    const insertAt = folders.indexOf(targetFolder) + (after ? 1 : 0);
    folders.splice(insertAt, 0, dragFolder);
    state.folders = folders;
    saveFolders();
    renderSidebar();
  }

  function dragAfter(event, selector) {
    const row = event.target.closest(selector);
    if (!row) return false;
    const rect = row.getBoundingClientRect();
    return event.clientY > rect.top + rect.height / 2;
  }

  function clearDropTargets() {
    T.$$('.is-drop-target').forEach((node) => node.classList.remove('is-drop-target'));
  }

  function bindFolderEvents() {
    els.folderTree?.addEventListener('click', (event) => {
      const button = event.target.closest('[data-folder-filter]');
      if (!button) return;
      setFolderFilter(button.dataset.folderFilter);
    });

    els.newFolderBtn?.addEventListener('click', () => {
      if (els.newFolderForm?.hidden) openNewFolderForm();
      else closeNewFolderForm();
    });
    els.newFolderCancel?.addEventListener('click', closeNewFolderForm);
    els.newFolderForm?.addEventListener('submit', (event) => {
      event.preventDefault();
      const folder = addFolder(els.newFolderInput?.value);
      if (!folder) {
        T.toast('先给文件夹起一个名字。', { type: 'info' });
        return;
      }
      closeNewFolderForm();
      state.folderFilter = folder;
      state.searchScope = 'folder';
      renderSidebar();
    });

    let dragFolder = '';
    els.folderTree?.addEventListener('dragstart', (event) => {
      const row = event.target.closest('[data-folder-name]');
      if (!row) return;
      dragFolder = row.dataset.folderName;
      event.dataTransfer.effectAllowed = 'move';
      event.dataTransfer.setData('text/plain', dragFolder);
      row.classList.add('is-dragging');
    });
    els.folderTree?.addEventListener('dragover', (event) => {
      const row = event.target.closest('[data-folder-name]');
      if (!row || row.dataset.folderName === dragFolder) return;
      event.preventDefault();
      event.dataTransfer.dropEffect = 'move';
      clearDropTargets();
      row.classList.add('is-drop-target');
    });
    els.folderTree?.addEventListener('drop', (event) => {
      const row = event.target.closest('[data-folder-name]');
      if (!row || !dragFolder) return;
      event.preventDefault();
      reorderFolders(dragFolder, row.dataset.folderName, dragAfter(event, '[data-folder-name]'));
      dragFolder = '';
      clearDropTargets();
    });
    els.folderTree?.addEventListener('dragend', () => {
      dragFolder = '';
      T.$$('.is-dragging').forEach((node) => node.classList.remove('is-dragging'));
      clearDropTargets();
    });
  }

  function bindNoteDrag() {
    els.noteList?.addEventListener('dragstart', (event) => {
      const row = event.target.closest('[data-note-id]');
      if (!row) return;
      state.dragNoteId = row.dataset.noteId;
      event.dataTransfer.effectAllowed = 'move';
      event.dataTransfer.setData('text/plain', state.dragNoteId);
      row.classList.add('is-dragging');
    });
    els.noteList?.addEventListener('dragover', (event) => {
      const row = event.target.closest('.note-list__row[data-note-id]');
      if (!row || row.dataset.noteId === state.dragNoteId) return;
      event.preventDefault();
      event.dataTransfer.dropEffect = 'move';
      clearDropTargets();
      row.classList.add('is-drop-target');
    });
    els.noteList?.addEventListener('drop', (event) => {
      const row = event.target.closest('.note-list__row[data-note-id]');
      if (!row || !state.dragNoteId) return;
      event.preventDefault();
      reorderNoteList(state.dragNoteId, row.dataset.noteId, dragAfter(event, '.note-list__row[data-note-id]'));
      state.dragNoteId = '';
      clearDropTargets();
    });
    els.noteList?.addEventListener('dragend', () => {
      state.dragNoteId = '';
      T.$$('.is-dragging').forEach((node) => node.classList.remove('is-dragging'));
      clearDropTargets();
    });
  }

  function bindContextMenu() {
    els.noteList?.addEventListener('contextmenu', (event) => {
      const row = event.target.closest('[data-note-id]');
      if (!row) return;
      event.preventDefault();
      openContextMenu(event.clientX, event.clientY, row.dataset.noteId);
    });

    els.noteContextMenu?.addEventListener('click', async (event) => {
      const action = event.target.closest('[data-context-action]')?.dataset.contextAction;
      const folderButton = event.target.closest('[data-context-folder]');
      const back = event.target.closest('[data-context-back]');
      if (back) {
        setContextPanel('root');
        return;
      }
      if (folderButton) {
        await moveNoteToFolder(state.contextNoteId, folderButton.dataset.contextFolder);
        return;
      }
      if (!action) return;
      const noteId = state.contextNoteId;
      const note = findNote(noteId);
      if (!note) return;
      if (action === 'rename') {
        hideContextMenu();
        await selectNote(noteId, { focusTitle: true });
        return;
      }
      if (action === 'move') {
        setContextPanel('move');
        return;
      }
      if (action === 'delete') {
        hideContextMenu();
        if (state.activeId !== noteId) await selectNote(noteId);
        showDeleteConfirmation();
      }
    });

    els.contextNewFolderForm?.addEventListener('submit', async (event) => {
      event.preventDefault();
      const folder = normalizeFolder(els.contextNewFolderInput?.value);
      if (!folder) {
        T.toast('先给新文件夹起一个名字。', { type: 'info' });
        return;
      }
      addFolder(folder);
      if (els.contextNewFolderInput) els.contextNewFolderInput.value = '';
      await moveNoteToFolder(state.contextNoteId, folder);
    });

    document.addEventListener('click', (event) => {
      if (!els.noteContextMenu || els.noteContextMenu.hidden) return;
      if (event.target.closest('#noteContextMenu')) return;
      hideContextMenu();
    });
    document.addEventListener('scroll', () => {
      if (els.noteContextMenu && !els.noteContextMenu.hidden) hideContextMenu();
    }, true);
    window.addEventListener('resize', hideContextMenu);
  }

  function handleAiLink(event, link) {
    event.preventDefault();
    const input = els.markdownInput;
    const selected = input && input.selectionStart !== input.selectionEnd
      ? input.value.slice(input.selectionStart, input.selectionEnd)
      : '';
    const source = (selected || (input ? input.value : '')).trim();
    const note = activeNote();
    const title = note && note.title !== '未命名笔记' ? `关于「${note.title}」的题目：\n\n` : '';
    const prompt = source ? `${title}${source}` : '';

    const targetWindow = window.open(link.href, '_blank');
    if (targetWindow) {
      try { targetWindow.opener = null; } catch (error) { /* ignore */ }
    } else {
      T.toast('浏览器拦截了新窗口，请允许本站打开标签页后重试。', { type: 'error' });
    }

    if (!source) {
      T.toast('笔记还是空的，先把题目写下来吧。', { type: 'info' });
      return;
    }

    T.copyText(prompt).then(() => {
      T.toast(`题目已复制，正在打开 ${link.dataset.aiPlatform || 'AI'}。`);
    }).catch(() => {
      T.toast('题目复制失败，请手动复制。', { type: 'error' });
    });
  }

  function getCurrentNoteForExport() {
    const note = activeNote();
    if (!note) {
      T.toast('当前没有可导出的笔记。', { type: 'info' });
      return null;
    }
    syncActiveFromInputs();
    return note;
  }

  function exportMarkdown() {
    const note = getCurrentNoteForExport();
    if (!note) return;
    const tagLine = note.tags.length ? `> 标签：${note.tags.join(' · ')}\n\n` : '';
    const content = `# ${note.title}\n\n${tagLine}${note.content}\n`;
    T.downloadFile(`${T.safeFilename(note.title, 'Aster-note')}.md`, content, 'text/markdown;charset=utf-8');
    T.toast('Markdown 笔记已导出。');
  }

  let katexCssCache = '';
  const katexFontCache = new Map();
  let htmlExportBusy = false;

  function arrayBufferToBase64(buffer) {
    const bytes = new Uint8Array(buffer);
    let binary = '';
    const chunk = 0x8000;
    for (let i = 0; i < bytes.length; i += chunk) {
      binary += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk));
    }
    return btoa(binary);
  }

  /**
   * 尽量把 KaTeX CSS 与 WOFF2 字体内嵌进导出的 HTML，
   * 这样公式样式不依赖网络。任何一步失败时回退到 CDN 样式表。
   */
  async function buildEmbeddedKatexCss() {
    if (katexCssCache) return katexCssCache;
    if (!state.katexCss) return '';
    const href = 'https://cdn.jsdelivr.net/npm/katex@0.16.22/dist/katex.min.css';
    try {
      const response = await fetch(href, { cache: 'force-cache' });
      if (!response.ok) throw new Error('KaTeX CSS 获取失败');
      let css = await response.text();
      const base = new URL(href);
      const matches = Array.from(css.matchAll(/url\((fonts\/[^)'"]+\.woff2)\)/g));
      const fontPaths = Array.from(new Set(matches.map((match) => match[1])));
      if (!fontPaths.length) throw new Error('KaTeX 字体路径未找到');

      await Promise.all(fontPaths.map(async (fontPath) => {
        const fontUrl = new URL(fontPath, base).href;
        let encoded = katexFontCache.get(fontUrl);
        if (!encoded) {
          const fontResponse = await fetch(fontUrl, { cache: 'force-cache' });
          if (!fontResponse.ok) throw new Error('KaTeX 字体获取失败');
          encoded = arrayBufferToBase64(await fontResponse.arrayBuffer());
          katexFontCache.set(fontUrl, encoded);
        }
        const dataUri = `data:font/woff2;base64,${encoded}`;
        css = css.split(`url(${fontPath})`).join(`url(${dataUri})`);
        css = css.split(`url("${fontPath}")`).join(`url("${dataUri}")`);
        css = css.split(`url('${fontPath}')`).join(`url('${dataUri}')`);
      }));

      katexCssCache = css;
      return css;
    } catch (error) {
      console.warn('KaTeX 样式内嵌失败，导出 HTML 将回退到 CDN 样式。', error);
      return '';
    }
  }

  async function exportHtml() {
    if (htmlExportBusy) return;
    const note = getCurrentNoteForExport();
    if (!note) return;
    const snapshot = {
      title: note.title,
      content: note.content,
      tags: [...note.tags]
    };
    htmlExportBusy = true;
    if (els.exportHtmlBtn) els.exportHtmlBtn.disabled = true;
    T.toast('正在打包公式样式与字体…', { type: 'info', duration: 1600 });

    try {
      const embeddedCss = await buildEmbeddedKatexCss();
      const rendered = renderMarkdownToHtml(snapshot.content);
      const tags = snapshot.tags.map((tag) => `<span>${T.escapeHtml(tag)}</span>`).join('');
      const exportedAt = new Date().toLocaleString('zh-CN', { hour12: false });
      const katexCss = 'https://cdn.jsdelivr.net/npm/katex@0.16.22/dist/katex.min.css';
      const katexStyles = embeddedCss
        ? `<style>${embeddedCss}</style>`
        : `<link rel="stylesheet" href="${katexCss}" crossorigin="anonymous">`;
      const documentHtml = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="generator" content="一页工作台 · Aster 知识库">
<title>${T.escapeHtml(snapshot.title)}</title>
${katexStyles}
<style>
:root{--paper:#faf8f2;--panel:#fffdf9;--ink:#2c3e50;--soft:#596875;--faint:#89918e;--brown:#826347;--line:#e4ddd0}
*{box-sizing:border-box}html{background:var(--paper)}body{margin:0;color:var(--ink);background-color:var(--paper);background-image:repeating-linear-gradient(to bottom,transparent 0,transparent 31px,rgba(44,62,80,.035) 31px,rgba(44,62,80,.035) 32px);font-family:ui-sans-serif,-apple-system,BlinkMacSystemFont,"Segoe UI","PingFang SC","Microsoft YaHei",sans-serif;font-size:15px;line-height:1.8}
.sheet{width:min(820px,calc(100% - 40px));margin:52px auto;padding:48px 58px 44px;border:1px solid var(--line);border-radius:16px;background:var(--panel);box-shadow:0 20px 60px rgba(44,62,80,.08)}
.eyebrow{color:var(--brown);font-size:10px;font-weight:700;letter-spacing:.18em;text-transform:uppercase}.sheet h1{margin:10px 0 0;font-family:"Iowan Old Style","Palatino Linotype","Songti SC",Georgia,serif;font-size:34px;line-height:1.3;letter-spacing:-.02em}.meta{display:flex;flex-wrap:wrap;gap:8px;margin-top:12px;color:var(--faint);font-size:10px}.meta span{padding:2px 7px;border:1px solid var(--line);border-radius:999px;background:#f7f3e9}.rule{height:1px;margin:24px 0 30px;background:var(--line)}
.markdown-body{overflow-wrap:anywhere}.markdown-body h1,.markdown-body h2,.markdown-body h3,.markdown-body h4{font-family:"Iowan Old Style","Palatino Linotype","Songti SC",Georgia,serif;line-height:1.45;margin:1.5em 0 .6em}.markdown-body h1{font-size:27px;padding-bottom:7px;border-bottom:1px solid var(--line)}.markdown-body h2{font-size:22px;padding-bottom:5px;border-bottom:1px dashed var(--line)}.markdown-body h3{font-size:18px}.markdown-body p{margin:.7em 0}.markdown-body ul,.markdown-body ol{padding-left:1.5em}.markdown-body li{margin:.25em 0}.markdown-body blockquote{margin:1em 0;padding:8px 15px;border-left:3px solid #c9b696;color:var(--soft);background:#f7f3e9}.markdown-body code{padding:.1em .35em;border:1px solid #e4ddd0;border-radius:4px;background:#f5f1e8;font-family:Consolas,monospace;font-size:.9em}.markdown-body pre{padding:14px 16px;overflow:auto;border:1px solid var(--line);border-radius:8px;background:#f5f1e8}.markdown-body pre code{padding:0;border:0;background:transparent}.markdown-body a{color:var(--brown);text-decoration:underline}.markdown-body table{width:100%;border-collapse:collapse;font-size:13px}.markdown-body th,.markdown-body td{padding:7px 9px;border:1px solid var(--line);text-align:left}.markdown-body th{background:#f7f3e9}.markdown-body hr{border:0;border-top:1px dashed var(--line);margin:1.5em 0}.markdown-body img{max-width:100%;height:auto;border:1px solid var(--line);border-radius:7px}.markdown-body u{text-underline-offset:3px;text-decoration-thickness:1.5px}.mark-ink{color:#2c4f68}.mark-rust{color:#9b5548}.mark-olive{color:#5e7359}.mark-mauve{color:#716381}.callout{margin:1em 0;border:1px solid var(--line);border-left:3px solid #9aa9b4;border-radius:8px;background:#fbf8f1;overflow:hidden}.callout--warning{border-left-color:#b9814b}.callout--tip{border-left-color:#789070}.callout__summary{display:flex;align-items:center;gap:8px;padding:8px 12px;cursor:pointer;list-style:none;color:var(--soft);font-size:12px}.callout__summary::-webkit-details-marker{display:none}.callout__tag{font-family:Consolas,monospace;font-size:9px;letter-spacing:.08em;color:var(--brown)}.callout__title{flex:1;font-weight:700;color:var(--ink)}.callout__chevron{width:7px;height:7px;border-right:1.5px solid currentColor;border-bottom:1.5px solid currentColor;transform:rotate(45deg);transition:transform 150ms ease}.callout[open] .callout__chevron{transform:rotate(-135deg)}.callout__body{padding:0 14px 11px;border-top:1px dashed var(--line)}.callout__body>*:first-child{margin-top:.7em}.math-display{display:block;overflow-x:auto;margin:.8em 0;text-align:center}.math-inline{display:inline}.katex{font-size:1.04em}.katex-display{overflow-x:auto;overflow-y:hidden;padding:2px 0}.math-fallback{display:inline-block;padding:0 4px;border:1px dashed #cec4b3;border-radius:4px;background:#fbf8f1;color:#6f5b45;font-family:Consolas,monospace;font-size:.88em}.math-fallback--display{display:block;padding:8px;white-space:pre-wrap}
.footer{margin-top:36px;padding-top:15px;border-top:1px dashed var(--line);color:var(--faint);font-size:10px;display:flex;justify-content:space-between;gap:20px}
@media(max-width:640px){.sheet{width:calc(100% - 24px);margin:14px auto;padding:28px 20px;border-radius:12px}.sheet h1{font-size:26px}.footer{flex-direction:column;gap:4px}}
@media print{html,body{background:#fff}.sheet{width:auto;margin:0;padding:0;border:0;box-shadow:none}.footer{color:#777}}
</style>
</head>
<body>
<main class="sheet">
<p class="eyebrow">ASTER · PERSONAL KNOWLEDGE BASE</p>
<h1>${T.escapeHtml(snapshot.title)}</h1>
<div class="meta"><span>导出于 ${T.escapeHtml(exportedAt)}</span>${tags}</div>
<div class="rule"></div>
<article class="markdown-body">${rendered}</article>
<footer class="footer"><span>由「一页工作台 · Aster 知识库」导出</span><span>Markdown + LaTeX</span></footer>
</main>
</body>
</html>`;
      T.downloadFile(`${T.safeFilename(snapshot.title, 'Aster-note')}.html`, documentHtml, 'text/html;charset=utf-8');
      T.toast(
        embeddedCss ? '独立 HTML 已导出，公式样式与字体已内嵌。' : 'HTML 已导出；公式样式将按需从 CDN 加载。',
        { duration: 3800 }
      );
    } finally {
      htmlExportBusy = false;
      if (els.exportHtmlBtn) els.exportHtmlBtn.disabled = !state.activeId;
    }
  }


  /* ------------------------------------------------------------------------
     事件绑定和启动
     ------------------------------------------------------------------------ */
  function bindEvents() {
    els.newNoteBtn?.addEventListener('click', () => createNote());
    els.sampleNoteBtn?.addEventListener('click', () => createNote({ sample: true }));
    T.$$('[data-action="new-note"]').forEach((button) => {
      button.addEventListener('click', () => createNote());
    });
    T.$$('[data-action="load-sample"]').forEach((button) => {
      button.addEventListener('click', () => createNote({ sample: true }));
    });

    els.noteList?.addEventListener('click', (event) => {
      const item = event.target.closest('[data-note-id]');
      if (!item) return;
      hideContextMenu();
      selectNote(item.dataset.noteId);
    });

    els.tagFilters?.addEventListener('click', (event) => {
      const button = event.target.closest('[data-tag]');
      if (!button) return;
      state.activeTag = button.dataset.tag || '';
      renderSidebar();
    });

    els.searchScopeToggle?.addEventListener('click', (event) => {
      const button = event.target.closest('[data-search-scope]');
      if (!button) return;
      state.searchScope = button.dataset.searchScope === 'all' ? 'all' : 'folder';
      renderSidebar();
    });

    els.noteSearch?.addEventListener('input', () => {
      state.search = els.noteSearch.value;
      renderSidebar();
    });

    els.noteTitle?.addEventListener('input', markDirty);
    els.noteTitle?.addEventListener('blur', () => {
      if (!activeNote()) return;
      if (!els.noteTitle.value.trim()) {
        els.noteTitle.value = '未命名笔记';
        markDirty();
      }
    });
    els.noteTags?.addEventListener('input', () => {
      renderTagChips(normalizeTags(els.noteTags.value));
      markDirty();
    });
    els.noteFolder?.addEventListener('input', markDirty);
    els.noteFolder?.addEventListener('blur', () => {
      if (!activeNote()) return;
      const normalized = normalizeFolder(els.noteFolder.value);
      if (els.noteFolder.value !== normalized) els.noteFolder.value = normalized;
      if (normalized) rememberFolder(normalized);
      markDirty();
    });
    els.markdownInput?.addEventListener('input', () => {
      markDirty();
      schedulePreviewRefresh();
      if (window.NotesMindmap && typeof window.NotesMindmap.scheduleRefresh === 'function') {
        window.NotesMindmap.scheduleRefresh();
      }
    });

    els.libraryToggle?.addEventListener('click', () => {
      if (els.notesApp?.classList.contains('sidebar-open')) closeSidebar();
      else openSidebar();
    });
    els.notesScrim?.addEventListener('click', closeSidebar);

    document.addEventListener('keydown', (event) => {
      if (event.key !== 'Escape' || event.defaultPrevented) return;
      if (document.querySelector('dialog[open]')) return;
      if (state.previewFullscreen) {
        event.preventDefault();
        setPreviewFullscreen(false);
        return;
      }
      if (els.inlineDeleteBar && !els.inlineDeleteBar.hidden) {
        event.preventDefault();
        hideDeleteConfirmation(true);
        return;
      }
      if (els.noteContextMenu && !els.noteContextMenu.hidden) {
        event.preventDefault();
        hideContextMenu();
        return;
      }
      if (els.cheatSheet?.open) {
        event.preventDefault();
        els.cheatSheet.open = false;
        els.cheatSheet.querySelector('summary')?.focus({ preventScroll: true });
        return;
      }
      if (els.mindmapView?.classList.contains('has-selection')) {
        event.preventDefault();
        window.NotesMindmap?.closeDetail?.();
        return;
      }
      if (els.notesApp?.classList.contains('sidebar-open')) {
        event.preventDefault();
        closeSidebar();
      }
    });

    els.editorTab?.addEventListener('click', () => setPane('editor'));
    els.previewTab?.addEventListener('click', () => setPane('preview'));
    els.mindmapTab?.addEventListener('click', () => setPane('mindmap'));

    T.$$('[data-insert]').forEach((button) => {
      button.addEventListener('click', () => {
        insertLatexTemplate(button.dataset.insert);
        const menu = button.closest('details[data-menu]');
        if (menu) menu.open = false;
      });
    });
    T.$$('[data-format]').forEach((button) => {
      button.addEventListener('click', () => applyFormat(button.dataset.format));
    });
    T.$$('[data-color]').forEach((button) => {
      button.addEventListener('click', () => applyColor(button.dataset.color));
    });
    els.focusCheatBtn?.addEventListener('click', openCheatSheet);

    els.deleteNoteBtn?.addEventListener('click', showDeleteConfirmation);
    els.inlineDeleteConfirm?.addEventListener('click', deleteCurrentNote);
    els.inlineDeleteCancel?.addEventListener('click', () => hideDeleteConfirmation(true));
    els.importNoteBtn?.addEventListener('click', importLocalFile);
    els.importNoteFile?.addEventListener('change', handleImportFile);
    els.previewFullscreenBtn?.addEventListener('click', togglePreviewFullscreen);
    els.exportMarkdownBtn?.addEventListener('click', exportMarkdown);
    els.exportHtmlBtn?.addEventListener('click', exportHtml);

    document.addEventListener('click', (event) => {
      const aiLink = event.target.closest('[data-ai-platform]');
      if (aiLink) handleAiLink(event, aiLink);
    });

    bindFolderEvents();
    bindNoteDrag();
    bindContextMenu();
    bindScrollSync();

    document.addEventListener('keydown', (event) => {
      if (!(event.ctrlKey || event.metaKey)) return;
      const key = event.key.toLowerCase();
      if (key === 's') {
        if (!state.activeId) return;
        event.preventDefault();
        flushSave().then(() => T.toast('笔记已保存。', { type: 'info', duration: 1600 }));
      } else if (key === 'n') {
        event.preventDefault();
        createNote();
      }
    });

    document.addEventListener('visibilitychange', () => {
      if (document.hidden && state.dirty) flushSave();
    });
    window.addEventListener('pagehide', () => {
      if (state.dirty) flushSave();
    });
  }

  async function init() {
    cacheElements();
    loadFolderState();
    bindEvents();
    updateRendererStatus();

    try {
      const rawNotes = await T.db.getAll('notes');
      state.notes = rawNotes.map(normalizeNote).filter(Boolean);
      ensureNoteOrder();
      sortNotes();
    } catch (error) {
      console.error(error);
      T.toast('Aster 知识库打开失败，请检查浏览器是否允许 IndexedDB。', { type: 'error', duration: 5000 });
      state.notes = [];
    }

    const params = new URLSearchParams(window.location.search);
    const requestedId = params.get('note') || '';
    const requested = requestedId ? findNote(requestedId) : null;

    if (state.notes.length) {
      const initial = requested || state.notes[0];
      state.activeId = initial.id;
      updateEditorAvailability(true);
      populateEditor(initial);
    } else {
      updateEditorAvailability(false);
      clearEditorAfterDelete();
    }
    renderSidebar();
    loadRendererLibraries();

    if (params.get('new') === '1') {
      history.replaceState({}, '', window.location.pathname);
      await createNote();
    }
  }

  // 供 notes-mindmap.js 复用同一套 Markdown + 公式渲染，避免第二套安全边界。
  window.NotesMindmapBridge = {
    renderMarkdown: renderMarkdownToHtml,
    escapeHtml: T.escapeHtml,
    getActiveNote: () => activeNote()
  };

  // 供 common.js 命令面板调用；只暴露页面内已有能力的轻量入口。
  window.AsterActions = {
    newNote: () => createNote(),
    save: () => flushSave().then(() => T.toast('笔记已保存。', { type: 'info', duration: 1600 })),
    openNote: (id) => selectNote(id),
    importFile: importLocalFile,
    toggleFullscreen: togglePreviewFullscreen,
    deleteCurrent: showDeleteConfirmation
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init, { once: true });
  } else {
    init();
  }
})();
