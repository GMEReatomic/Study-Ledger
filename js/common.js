/* ==========================================================================
   一页工作台 · 公共脚本
   - 共用工具函数、页眉时钟、菜单、天气、IndexedDB 与 Web Crypto 封装
   - 所有页面共享，避免各页重复实现基础能力
   ========================================================================== */
(function (global) {
  'use strict';

  const DB_NAME = 'toolboxDB';
  const DB_VERSION = 2;
  const PBKDF2_ITERATIONS = 100000;
  const WEATHER_TIMEOUT = 12000;

  const STORAGE_KEYS = Object.freeze({
    tasks: 'toolbox.tasks.v1',
    weatherPlace: 'toolbox.weatherPlace.v1',
    weatherCache: 'toolbox.weatherCache.v1',
    emailMemo: 'toolbox.emailMemo.v1',
    randomLast: 'toolbox.randomLast.v1',
    theme: 'toolbox.theme.v1',
    dailyQuote: 'toolbox.dailyQuote.v1'
  });

  const THEMES = Object.freeze([
    { id: 'paper', label: '纸张', note: '米白手账', color: '#faf8f2' },
    { id: 'kraft', label: '牛皮纸', note: '暖褐手账', color: '#efe3cd' },
    { id: 'gray', label: '浅灰', note: '现代工作区', color: '#eef0f1' },
    { id: 'dark', label: '夜间', note: '深灰知识库', color: '#22272a' }
  ]);
  const THEME_IDS = new Set(THEMES.map((theme) => theme.id));

  const DEFAULT_PLACE = Object.freeze({
    name: '上海',
    admin1: '上海市',
    country: '中国',
    latitude: 31.2304,
    longitude: 121.4737,
    source: 'default'
  });

  const WEEKDAYS = ['星期日', '星期一', '星期二', '星期三', '星期四', '星期五', '星期六'];
  const WIND_DIRECTIONS = ['北', '东北', '东', '东南', '南', '西南', '西', '西北'];

  /* ------------------------------------------------------------------------
     基础工具
     ------------------------------------------------------------------------ */
  const $ = (selector, root = document) => root.querySelector(selector);
  const $$ = (selector, root = document) => Array.from(root.querySelectorAll(selector));

  /** 将任意值安全地放进 HTML 文本或属性中。所有用户输入渲染前都必须经过这里。 */
  function escapeHtml(value) {
    return String(value == null ? '' : value).replace(/[&<>"']/g, (char) => {
      return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char];
    });
  }

  function pad2(value) {
    return String(value).padStart(2, '0');
  }

  function formatDate(date = new Date()) {
    return `${date.getFullYear()}年${date.getMonth() + 1}月${date.getDate()}日`;
  }

  function formatDateShort(date = new Date()) {
    return `${date.getFullYear()}.${pad2(date.getMonth() + 1)}.${pad2(date.getDate())}`;
  }

  function formatTime(date = new Date(), withSeconds = true) {
    const base = `${pad2(date.getHours())}:${pad2(date.getMinutes())}`;
    return withSeconds ? `${base}:${pad2(date.getSeconds())}` : base;
  }

  function formatWeekday(date = new Date()) {
    return WEEKDAYS[date.getDay()];
  }

  function formatDateTime(date = new Date()) {
    return `${formatDate(date)} ${formatWeekday(date)} ${formatTime(date)}`;
  }

  function formatDateISO(date = new Date()) {
    return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`;
  }

  function formatStamp(date = new Date()) {
    return `${formatDateISO(date).replaceAll('-', '')}-${pad2(date.getHours())}${pad2(date.getMinutes())}`;
  }

  function getDayOfYear(date = new Date()) {
    const start = new Date(date.getFullYear(), 0, 0);
    const diff = date - start + (start.getTimezoneOffset() - date.getTimezoneOffset()) * 60000;
    return Math.floor(diff / 86400000);
  }

  /** ISO 周数，用于手账页眉的“第 n 周”。 */
  function getWeekNumber(date = new Date()) {
    const target = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
    const dayNumber = target.getUTCDay() || 7;
    target.setUTCDate(target.getUTCDate() + 4 - dayNumber);
    const yearStart = new Date(Date.UTC(target.getUTCFullYear(), 0, 1));
    return Math.ceil(((target - yearStart) / 86400000 + 1) / 7);
  }

  function greetingForHour(hour = new Date().getHours()) {
    if (hour < 5) return '夜深了';
    if (hour < 9) return '早上好';
    if (hour < 12) return '上午好';
    if (hour < 14) return '中午好';
    if (hour < 18) return '下午好';
    return '晚上好';
  }

  function debounce(fn, wait = 200) {
    let timer = 0;
    return function debounced(...args) {
      clearTimeout(timer);
      timer = setTimeout(() => fn.apply(this, args), wait);
    };
  }

  function throttle(fn, wait = 100) {
    let last = 0;
    let timer = 0;
    return function throttled(...args) {
      const now = Date.now();
      const remaining = wait - (now - last);
      if (remaining <= 0) {
        clearTimeout(timer);
        timer = 0;
        last = now;
        fn.apply(this, args);
      } else if (!timer) {
        timer = setTimeout(() => {
          last = Date.now();
          timer = 0;
          fn.apply(this, args);
        }, remaining);
      }
    };
  }

  function uid() {
    if (global.crypto && typeof global.crypto.randomUUID === 'function') {
      return global.crypto.randomUUID();
    }
    const random = Math.random().toString(36).slice(2, 10);
    return `tb-${Date.now().toString(36)}-${random}`;
  }

  function truncate(value, max = 90) {
    const text = String(value == null ? '' : value).replace(/\s+/g, ' ').trim();
    return text.length > max ? `${text.slice(0, max)}…` : text;
  }

  function escapeRegExp(value) {
    return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  function safeFilename(value, fallback = 'untitled') {
    const name = String(value || '')
      .replace(/[\\/:*?"<>|]+/g, '-')
      .replace(/\s+/g, '-')
      .replace(/-+/g, '-')
      .replace(/^-|-$/g, '')
      .slice(0, 64);
    return name || fallback;
  }

  /** 只允许 http(s) / mailto 或站内相对地址，避免 javascript: 等协议注入。 */
  function safeUrl(value, options = {}) {
    const { allowRelative = false } = options;
    const raw = String(value == null ? '' : value).trim();
    if (!raw) return '';
    if (allowRelative && /^(\.{0,2}\/|#|\?)/.test(raw)) return raw;
    // 不允许相对地址时，必须显式带 http(s) / mailto 协议，避免把域名误解析成站内路径。
    if (!allowRelative && !/^(https?:|mailto:)/i.test(raw)) return '';
    try {
      const url = new URL(raw, global.location.href);
      if (['http:', 'https:', 'mailto:'].includes(url.protocol)) return url.href;
    } catch (error) {
      // 无效地址按空值处理
    }
    return '';
  }

  function isPlainObject(value) {
    return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
  }

  function iconMarkup(name, extraClass = '') {
    return `<svg class="icon ${extraClass}" aria-hidden="true" focusable="false"><use href="assets/icons.svg#icon-${name}"></use></svg>`;
  }

  /* ------------------------------------------------------------------------
     主题：只切换 <html data-theme>，颜色与纹理全部由 CSS 变量承载
     ------------------------------------------------------------------------ */
  function getStoredTheme() {
    const saved = storageGet(STORAGE_KEYS.theme, 'paper');
    return THEME_IDS.has(saved) ? saved : 'paper';
  }

  function updateThemeDock(themeId) {
    const dock = $('#themeDock');
    if (!dock) return;
    const meta = THEMES.find((theme) => theme.id === themeId) || THEMES[0];
    const label = $('[data-theme-label]', dock);
    if (label) label.textContent = meta.label;
    const summary = $('summary', dock);
    if (summary) {
      summary.title = `切换界面主题（当前：${meta.label}）`;
      // Aster V2 turns this global control into an icon-only button on its page;
      // other pages keep the visible "主题 · 当前主题" capsule.
      summary.dataset.tooltip = summary.title;
    }
    $$('[data-theme-choice]', dock).forEach((button) => {
      const active = button.dataset.themeChoice === themeId;
      button.classList.toggle('is-active', active);
      button.setAttribute('aria-pressed', String(active));
    });
  }

  function applyTheme(themeId, options = {}) {
    const next = THEME_IDS.has(themeId) ? themeId : 'paper';
    document.documentElement.dataset.theme = next;
    const themeMeta = THEMES.find((theme) => theme.id === next) || THEMES[0];
    const themeColor = $('meta[name="theme-color"]');
    if (themeColor) themeColor.setAttribute('content', themeMeta.color);
    updateThemeDock(next);
    if (options.persist) {
      storageSet(STORAGE_KEYS.theme, next);
    }
    document.dispatchEvent(new CustomEvent('toolbox:themechange', { detail: { theme: next } }));
    return next;
  }

  function setTheme(themeId, options = {}) {
    const next = applyTheme(themeId, { persist: true });
    if (options.toast) {
      const theme = THEMES.find((item) => item.id === next);
      toast(`主题已切换为${theme ? theme.label : next}。`, { type: 'info', duration: 1600 });
    }
    return next;
  }

  function createThemeDock() {
    if ($('#themeDock') || !document.body) return;
    const dock = document.createElement('details');
    dock.className = 'theme-dock';
    dock.id = 'themeDock';
    dock.dataset.menu = 'theme';
    dock.innerHTML = `
      <summary aria-label="切换界面主题" title="切换界面主题">
        ${iconMarkup('palette')}
        <span class="theme-dock__text">主题</span>
        <span class="theme-dock__sep" aria-hidden="true">·</span>
        <span class="theme-dock__current" data-theme-label>纸张</span>
        <svg class="icon icon--tiny theme-dock__chevron" aria-hidden="true" focusable="false"><use href="assets/icons.svg#icon-chevron-down"></use></svg>
      </summary>
      <div class="theme-dock__panel">
        <p class="theme-dock__eyebrow">THEME / 主题</p>
        ${THEMES.map((theme) => `
          <button class="theme-choice" type="button" data-theme-choice="${theme.id}" aria-pressed="false">
            <span class="theme-choice__swatch" style="--swatch:${theme.color}"></span>
            <span><strong>${theme.label}</strong><small>${theme.note}</small></span>
          </button>
        `).join('')}
      </div>
    `;
    const host = $('#themeDockMount') || $('.meta-tools') || $('.page-meta');
    if (host) host.appendChild(dock);
    else document.body.appendChild(dock);
    dock.addEventListener('click', (event) => {
      const button = event.target.closest('[data-theme-choice]');
      if (!button) return;
      setTheme(button.dataset.themeChoice, { toast: true });
      dock.open = false;
      const summary = $('summary', dock);
      if (summary) summary.focus();
    });
    updateThemeDock(getStoredTheme());
  }

  /* ------------------------------------------------------------------------
     全局 Esc / 命令面板
     ------------------------------------------------------------------------ */
  function isEditableTarget(target) {
    if (!(target instanceof Element)) return false;
    return Boolean(target.closest('input, textarea, select, [contenteditable="true"], [contenteditable=""]'));
  }

  function hasBlockingOverlay() {
    return Boolean(document.querySelector(
      'dialog[open], .preview-pane.is-fullscreen, #inlineDeleteBar:not([hidden]), '
      + '#noteContextMenu:not([hidden]), #cheatSheet[open], .notes-app.sidebar-open, .mindmap-view.has-selection'
    ));
  }

  function initEscapeHome() {
    document.addEventListener('keydown', (event) => {
      if (event.key !== 'Escape' || event.defaultPrevented || event.isComposing) return;
      if (isEditableTarget(document.activeElement)) return;
      if (hasBlockingOverlay()) return;
      if (/\/(index\.html)?$/.test(global.location.pathname)) return;
      global.location.href = 'index.html';
    });
  }

  const PAGE_COMMANDS = [
    { id: 'page-home', label: '返回主页', desc: '一页工作台 · 今日手账', icon: 'book', href: 'index.html', keywords: 'home 首页 主页' },
    { id: 'page-aster', label: '打开 Aster 知识库', desc: 'Markdown · LaTeX · 思维导图', icon: 'note', href: 'notes.html', keywords: 'aster 笔记 知识库 notes' },
    { id: 'page-password', label: '打开密码保险箱', desc: '本地加密 · PBKDF2 / AES-GCM', icon: 'lock', href: 'password.html', keywords: 'password 密码 保险箱' },
    { id: 'page-resources', label: '打开学习网站导航', desc: 'OI Wiki · 自定义学习入口', icon: 'globe', href: 'resources.html', keywords: 'resources 学习 网站 导航' },
    { id: 'page-weather', label: '打开天气温度', desc: 'Open-Meteo · 当前地点', icon: 'cloud-sun', href: 'weather.html', keywords: 'weather 天气 温度' },
    { id: 'page-datetime', label: '打开时间显示', desc: '日期、时钟与倒计时', icon: 'clock', href: 'datetime.html', keywords: 'time 时间 日期' },
    { id: 'page-random', label: '打开随机站点', desc: '从学习签筒抽一个入口', icon: 'shuffle', href: 'random.html', keywords: 'random 随机 站点' },
    { id: 'page-external', label: '打开外部工具', desc: '微信文件助手、文档转换等', icon: 'external', href: 'external.html', keywords: 'external 外部 工具' }
  ];

  let commandPalette = null;
  let commandNotes = [];
  let commandItems = [];
  let commandIndex = 0;
  let commandNotesLoading = false;

  function asterActions() {
    return global.AsterActions && typeof global.AsterActions === 'object' ? global.AsterActions : null;
  }

  function buildCommandItems() {
    const items = PAGE_COMMANDS.map((command) => ({
      ...command,
      keywords: `${command.label} ${command.desc} ${command.keywords || ''}`.toLowerCase(),
      run: () => { global.location.href = command.href; }
    }));

    const aster = asterActions();
    if (aster) {
      items.unshift(
        { id: 'aster-new', label: 'Aster · 新建笔记', desc: 'Ctrl+N', icon: 'plus', keywords: 'aster 新建 笔记 new', run: () => aster.newNote() },
        { id: 'aster-save', label: 'Aster · 保存当前笔记', desc: 'Ctrl+S', icon: 'save', keywords: 'aster 保存 save', run: () => aster.save() },
        { id: 'aster-import', label: 'Aster · 导入 Markdown / 文本', desc: '选择本地 .md / .txt', icon: 'upload', keywords: 'aster 导入 import 文件', run: () => aster.importFile() },
        { id: 'aster-fullscreen', label: 'Aster · 预览全屏', desc: 'Esc 退出', icon: 'maximize', keywords: 'aster 预览 全屏 preview fullscreen', run: () => aster.toggleFullscreen() }
      );
    } else {
      items.unshift({
        id: 'aster-new-global',
        label: '新建 Aster 笔记',
        desc: '打开知识库并新建一页',
        icon: 'plus',
        keywords: 'aster 新建 笔记 new',
        run: () => { global.location.href = 'notes.html?new=1'; }
      });
    }

    THEMES.forEach((theme) => {
      items.push({
        id: `theme-${theme.id}`,
        label: `切换主题 · ${theme.label}`,
        desc: theme.note,
        icon: theme.id === 'dark' ? 'moon' : theme.id === 'gray' ? 'layers' : 'sun',
        keywords: `theme 主题 ${theme.label} ${theme.note}`.toLowerCase(),
        run: () => setTheme(theme.id, { toast: true })
      });
    });

    commandNotes.forEach((note) => {
      items.push({
        id: `note-${note.id}`,
        label: note.title,
        desc: `Aster · ${note.folder || '未分类'}`,
        icon: 'note',
        keywords: `${note.title} ${note.folder || ''} ${note.tags.join(' ')} ${note.content}`.toLowerCase(),
        run: () => {
          const asterApi = asterActions();
          if (asterApi && typeof asterApi.openNote === 'function') asterApi.openNote(note.id);
          else global.location.href = `notes.html?note=${encodeURIComponent(note.id)}`;
        }
      });
    });

    return items;
  }

  function loadPaletteNotes() {
    if (commandNotesLoading) return Promise.resolve();
    commandNotesLoading = true;
    return getAllRecords('notes').then((rows) => {
      commandNotes = rows
        .slice()
        .sort((a, b) => Date.parse(b.updatedAt || '') - Date.parse(a.updatedAt || ''))
        .slice(0, 80)
        .map((note) => ({
          id: String(note.id || ''),
          title: String(note.title || '未命名笔记').slice(0, 100),
          folder: String(note.folder || '').slice(0, 80),
          tags: Array.isArray(note.tags) ? note.tags.map(String).slice(0, 8) : [],
          content: String(note.content || '').slice(0, 1200)
        })).filter((note) => note.id);
      if (commandPalette) renderCommandList(commandPalette.input.value);
    }).catch(() => {
      commandNotes = [];
    }).finally(() => {
      commandNotesLoading = false;
    });
  }

  function renderCommandList(query = '') {
    if (!commandPalette) return;
    const needle = String(query || '').trim().toLowerCase();
    commandItems = buildCommandItems().filter((item) => !needle || item.keywords.includes(needle));
    commandIndex = Math.min(commandIndex, Math.max(0, commandItems.length - 1));
    const list = commandPalette.list;
    if (!commandItems.length) {
      list.innerHTML = `<p class="command-empty">${iconMarkup('search')}没有匹配的命令或笔记。</p>`;
      commandPalette.input.removeAttribute('aria-activedescendant');
      return;
    }
    list.innerHTML = commandItems.map((item, index) => `
      <button class="command-item${index === commandIndex ? ' is-active' : ''}" id="commandItem${index}" type="button" role="option"
              aria-selected="${index === commandIndex ? 'true' : 'false'}" data-command-index="${index}">
        <span class="command-item__icon">${iconMarkup(item.icon)}</span>
        <span class="command-item__copy"><strong>${escapeHtml(item.label)}</strong><small>${escapeHtml(item.desc)}</small></span>
        ${index === commandIndex ? '<kbd>Enter</kbd>' : ''}
      </button>
    `).join('');
    commandPalette.input.setAttribute('aria-activedescendant', `commandItem${commandIndex}`);
    const active = list.querySelector('.command-item.is-active');
    if (active) active.scrollIntoView({ block: 'nearest' });
  }

  function moveCommand(delta) {
    if (!commandItems.length) return;
    commandIndex = (commandIndex + delta + commandItems.length) % commandItems.length;
    renderCommandList(commandPalette.input.value);
  }

  function runCommand(index) {
    const item = commandItems[index];
    if (!item || !commandPalette) return;
    const dialog = commandPalette.dialog;
    dialog.close();
    commandPalette.input.value = '';
    global.setTimeout(() => {
      try { item.run(); } catch (error) { console.error('命令执行失败', error); toast('命令执行失败。', { type: 'error' }); }
    }, 10);
  }

  function ensureCommandPalette() {
    if (commandPalette) return commandPalette;
    const dialog = document.createElement('dialog');
    dialog.className = 'command-palette';
    dialog.id = 'commandPalette';
    dialog.setAttribute('aria-label', '命令面板');
    dialog.innerHTML = `
      <div class="command-palette__panel">
        <div class="command-palette__search">
          ${iconMarkup('search')}
          <input id="commandInput" type="text" placeholder="搜索笔记、页面或命令…" autocomplete="off"
                 role="combobox" aria-expanded="true" aria-controls="commandList" aria-autocomplete="list">
          <kbd>Esc</kbd>
        </div>
        <div class="command-palette__list" id="commandList" role="listbox" aria-label="可用命令"></div>
        <div class="command-palette__foot"><span>↑↓ 选择</span><span>Enter 执行</span><span>Ctrl K 打开</span></div>
      </div>
    `;
    document.body.appendChild(dialog);
    const input = $('#commandInput', dialog);
    const list = $('#commandList', dialog);
    commandPalette = { dialog, input, list };
    input.addEventListener('input', () => {
      commandIndex = 0;
      renderCommandList(input.value);
    });
    input.addEventListener('keydown', (event) => {
      if (event.key === 'ArrowDown') { event.preventDefault(); moveCommand(1); }
      else if (event.key === 'ArrowUp') { event.preventDefault(); moveCommand(-1); }
      else if (event.key === 'Enter') { event.preventDefault(); runCommand(commandIndex); }
    });
    list.addEventListener('click', (event) => {
      const item = event.target.closest('[data-command-index]');
      if (item) runCommand(Number(item.dataset.commandIndex));
    });
    dialog.addEventListener('click', (event) => {
      if (event.target === dialog) dialog.close();
    });
    dialog.addEventListener('close', () => {
      input.value = '';
      commandIndex = 0;
    });
    return commandPalette;
  }

  function openCommandPalette() {
    const palette = ensureCommandPalette();
    if (palette.dialog.open) return;
    palette.input.value = '';
    commandIndex = 0;
    renderCommandList('');
    palette.dialog.showModal();
    window.setTimeout(() => palette.input.focus(), 20);
    loadPaletteNotes();
  }

  function initCommandPalette() {
    ensureCommandPalette();
    document.addEventListener('keydown', (event) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        openCommandPalette();
      }
    });
    document.addEventListener('toolbox:themechange', () => {
      if (commandPalette && commandPalette.dialog.open) renderCommandList(commandPalette.input.value);
    });
  }

  /* ------------------------------------------------------------------------
     localStorage 封装（浏览器禁用存储时安静降级）
     ------------------------------------------------------------------------ */
  function storageGet(key, fallback = null) {
    try {
      const raw = global.localStorage.getItem(key);
      return raw === null ? fallback : raw;
    } catch (error) {
      return fallback;
    }
  }

  function storageSet(key, value) {
    try {
      global.localStorage.setItem(key, value);
      return true;
    } catch (error) {
      return false;
    }
  }

  function storageGetJSON(key, fallback = null) {
    const raw = storageGet(key, null);
    if (raw === null) return fallback;
    try {
      return JSON.parse(raw);
    } catch (error) {
      return fallback;
    }
  }

  function storageSetJSON(key, value) {
    try {
      return storageSet(key, JSON.stringify(value));
    } catch (error) {
      return false;
    }
  }

  function storageRemove(key) {
    try {
      global.localStorage.removeItem(key);
    } catch (error) {
      // ignore
    }
  }

  /* ------------------------------------------------------------------------
     实时时钟
     ------------------------------------------------------------------------ */
  function updateClocks() {
    const now = new Date();
    $$('[data-clock-time]').forEach((node) => {
      node.textContent = formatTime(now);
      node.setAttribute('datetime', now.toISOString());
    });
    $$('[data-clock-date]').forEach((node) => {
      node.textContent = formatDate(now);
    });
    $$('[data-clock-date-short]').forEach((node) => {
      node.textContent = formatDateShort(now);
    });
    $$('[data-clock-weekday]').forEach((node) => {
      node.textContent = formatWeekday(now);
    });
    $$('[data-clock-full]').forEach((node) => {
      node.textContent = `${formatDate(now)} · ${formatWeekday(now)}`;
    });
    $$('[data-clock-hour]').forEach((node) => {
      node.textContent = pad2(now.getHours());
    });
    $$('[data-clock-greeting]').forEach((node) => {
      node.textContent = greetingForHour(now.getHours());
    });
  }

  function initClock() {
    if (!$$('[data-clock-time],[data-clock-date],[data-clock-weekday],[data-clock-full],[data-clock-hour],[data-clock-greeting]').length) {
      return;
    }
    updateClocks();
    global.setInterval(updateClocks, 1000);
    document.addEventListener('visibilitychange', () => {
      if (!document.hidden) updateClocks();
    });
  }

  /* ------------------------------------------------------------------------
     原生 <details> 下拉菜单：互斥展开、点外部关闭、Esc 关闭
     ------------------------------------------------------------------------ */
  function initMenuDetails() {
    const menus = $$('details[data-menu]');
    if (!menus.length) return;

    const closeMenu = (menu, restoreFocus = false) => {
      if (!menu.open) return;
      menu.open = false;
      if (restoreFocus) {
        const summary = $('summary', menu);
        if (summary) summary.focus();
      }
    };

    menus.forEach((menu) => {
      menu.addEventListener('toggle', () => {
        if (!menu.open) return;
        menus.forEach((other) => {
          if (other !== menu) closeMenu(other);
        });
      });
      menu.addEventListener('click', (event) => {
        if (event.target.closest('a,button[data-close-menu]')) closeMenu(menu);
      });
      const summary = $('summary', menu);
      if (summary) {
        summary.setAttribute('aria-haspopup', 'true');
      }
    });

    document.addEventListener('click', (event) => {
      menus.forEach((menu) => {
        if (menu.open && !menu.contains(event.target)) closeMenu(menu);
      });
    });

    document.addEventListener('keydown', (event) => {
      if (event.key !== 'Escape') return;
      const openMenu = menus.find((menu) => menu.open);
      if (openMenu) {
        event.preventDefault();
        closeMenu(openMenu, true);
      }
    });
  }

  /* ------------------------------------------------------------------------
     Toast / 确认对话框 / 剪贴板 / 文件下载
     ------------------------------------------------------------------------ */
  let toastRegion = null;

  function ensureToastRegion() {
    if (toastRegion && document.body.contains(toastRegion)) return toastRegion;
    toastRegion = document.createElement('div');
    toastRegion.className = 'toast-region';
    toastRegion.setAttribute('aria-live', 'polite');
    toastRegion.setAttribute('aria-atomic', 'false');
    document.body.appendChild(toastRegion);
    return toastRegion;
  }

  function toast(message, options = {}) {
    const type = options.type || 'success';
    const duration = Number.isFinite(options.duration) ? options.duration : 3200;
    const region = ensureToastRegion();
    const node = document.createElement('div');
    node.className = `toast toast--${type}`;
    node.setAttribute('role', 'status');

    const iconName = type === 'error' ? 'alert' : type === 'info' ? 'book' : 'check-circle';
    const icon = document.createElement('span');
    icon.className = 'toast__icon';
    icon.innerHTML = iconMarkup(iconName);

    const text = document.createElement('span');
    text.className = 'toast__text';
    text.textContent = String(message == null ? '' : message);

    node.append(icon, text);
    region.appendChild(node);

    requestAnimationFrame(() => node.classList.add('is-visible'));

    global.setTimeout(() => {
      node.classList.remove('is-visible');
      global.setTimeout(() => node.remove(), 220);
    }, duration);
  }

  /** Promise 版确认对话框，避免使用刺眼的浏览器原生 confirm。 */
  function confirmDialog(options = {}) {
    return new Promise((resolve) => {
      const title = options.title || '请确认';
      const message = options.message || '';
      const confirmText = options.confirmText || '确认';
      const cancelText = options.cancelText || '取消';
      const danger = Boolean(options.danger);

      const dialog = document.createElement('dialog');
      dialog.className = 'app-dialog confirm-dialog';

      const form = document.createElement('form');
      form.method = 'dialog';
      form.className = 'dialog__form';

      const eyebrow = document.createElement('p');
      eyebrow.className = 'eyebrow dialog__eyebrow';
      eyebrow.textContent = 'PLEASE CONFIRM';

      const heading = document.createElement('h2');
      heading.className = 'dialog__title';
      heading.textContent = title;

      const description = document.createElement('p');
      description.className = 'dialog__message';
      description.textContent = message;

      const actions = document.createElement('div');
      actions.className = 'dialog__actions';

      const cancel = document.createElement('button');
      cancel.type = 'button';
      cancel.className = 'btn btn--ghost';
      cancel.textContent = cancelText;

      const confirm = document.createElement('button');
      confirm.type = 'button';
      confirm.className = `btn ${danger ? 'btn--danger' : 'btn--primary'}`;
      confirm.textContent = confirmText;

      actions.append(cancel, confirm);
      form.append(eyebrow, heading, description, actions);
      dialog.appendChild(form);
      document.body.appendChild(dialog);

      const finish = (result) => {
        if (dialog.open) dialog.close();
        dialog.remove();
        resolve(result);
      };

      cancel.addEventListener('click', () => finish(false));
      confirm.addEventListener('click', () => finish(true));
      dialog.addEventListener('cancel', (event) => {
        event.preventDefault();
        finish(false);
      });
      dialog.addEventListener('click', (event) => {
        if (event.target === dialog) finish(false);
      });

      dialog.showModal();
      global.setTimeout(() => cancel.focus(), 30);
    });
  }

  async function copyText(text) {
    const value = String(text == null ? '' : text);
    if (!value) throw new Error('没有可复制的内容');
    if (navigator.clipboard && global.isSecureContext) {
      try {
        await navigator.clipboard.writeText(value);
        return true;
      } catch (error) {
        // 某些浏览器会拒绝权限，继续尝试兼容方案
      }
    }
    const helper = document.createElement('textarea');
    helper.value = value;
    helper.setAttribute('readonly', '');
    helper.style.position = 'fixed';
    helper.style.left = '-9999px';
    helper.style.top = '0';
    document.body.appendChild(helper);
    helper.select();
    let copied = false;
    try {
      copied = document.execCommand('copy');
    } finally {
      helper.remove();
    }
    if (!copied) throw new Error('复制失败，请手动选择内容');
    return true;
  }

  function downloadFile(filename, content, mime = 'text/plain;charset=utf-8') {
    const blob = content instanceof Blob ? content : new Blob([content], { type: mime });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    link.rel = 'noopener';
    document.body.appendChild(link);
    link.click();
    link.remove();
    global.setTimeout(() => URL.revokeObjectURL(url), 1500);
  }

  function readFileAsText(file) {
    return new Promise((resolve, reject) => {
      if (!file) {
        reject(new Error('没有选择文件'));
        return;
      }
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result || ''));
      reader.onerror = () => reject(new Error('文件读取失败'));
      reader.readAsText(file, 'utf-8');
    });
  }

  /* ------------------------------------------------------------------------
     IndexedDB：toolboxDB v2（vault / meta / notes）
     ------------------------------------------------------------------------ */
  let dbPromise = null;

  function openDB() {
    if (dbPromise) return dbPromise;
    dbPromise = new Promise((resolve, reject) => {
      if (!('indexedDB' in global)) {
        reject(new Error('当前浏览器不支持 IndexedDB'));
        return;
      }
      const request = global.indexedDB.open(DB_NAME, DB_VERSION);

      request.onupgradeneeded = () => {
        const db = request.result;

        if (!db.objectStoreNames.contains('vault')) {
          db.createObjectStore('vault', { keyPath: 'id' });
        }
        if (!db.objectStoreNames.contains('meta')) {
          db.createObjectStore('meta', { keyPath: 'key' });
        }

        let notesStore;
        if (!db.objectStoreNames.contains('notes')) {
          notesStore = db.createObjectStore('notes', { keyPath: 'id' });
        } else {
          notesStore = request.transaction.objectStore('notes');
        }
        if (!notesStore.indexNames.contains('updatedAt')) {
          notesStore.createIndex('updatedAt', 'updatedAt');
        }
        if (!notesStore.indexNames.contains('tags')) {
          notesStore.createIndex('tags', 'tags', { multiEntry: true });
        }
      };

      request.onsuccess = () => {
        const db = request.result;
        db.onversionchange = () => db.close();
        resolve(db);
      };
      request.onerror = () => {
        dbPromise = null;
        reject(request.error || new Error('IndexedDB 打开失败'));
      };
      request.onblocked = () => {
        reject(new Error('数据库升级被其他标签页阻塞，请关闭其他页面后重试'));
      };
    });
    return dbPromise;
  }

  function idbRequest(request) {
    return new Promise((resolve, reject) => {
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error || new Error('数据库请求失败'));
    });
  }

  async function getRecord(storeName, key) {
    const db = await openDB();
    return idbRequest(db.transaction(storeName, 'readonly').objectStore(storeName).get(key));
  }

  async function getAllRecords(storeName) {
    const db = await openDB();
    return idbRequest(db.transaction(storeName, 'readonly').objectStore(storeName).getAll());
  }

  async function putRecord(storeName, value) {
    const db = await openDB();
    return idbRequest(db.transaction(storeName, 'readwrite').objectStore(storeName).put(value));
  }

  async function deleteRecord(storeName, key) {
    const db = await openDB();
    return idbRequest(db.transaction(storeName, 'readwrite').objectStore(storeName).delete(key));
  }

  async function clearStore(storeName) {
    const db = await openDB();
    return idbRequest(db.transaction(storeName, 'readwrite').objectStore(storeName).clear());
  }

  async function countRecords(storeName) {
    const db = await openDB();
    return idbRequest(db.transaction(storeName, 'readonly').objectStore(storeName).count());
  }

  /* ------------------------------------------------------------------------
     Web Crypto：PBKDF2 -> AES-GCM 256
     ------------------------------------------------------------------------ */
  function cryptoAvailable() {
    return Boolean(global.crypto && global.crypto.subtle && global.crypto.getRandomValues);
  }

  function assertCrypto() {
    if (!cryptoAvailable()) {
      throw new Error('Web Crypto 不可用。请通过 localhost 或 HTTPS 打开本站。');
    }
  }

  function bytesToBase64(bytes) {
    let binary = '';
    const chunk = 0x8000;
    for (let i = 0; i < bytes.length; i += chunk) {
      binary += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk));
    }
    return btoa(binary);
  }

  function base64ToBytes(base64) {
    const binary = atob(String(base64));
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i += 1) {
      bytes[i] = binary.charCodeAt(i);
    }
    return bytes;
  }

  function createSalt() {
    assertCrypto();
    return bytesToBase64(global.crypto.getRandomValues(new Uint8Array(16)));
  }

  async function deriveKey(password, saltBase64, iterations = PBKDF2_ITERATIONS) {
    assertCrypto();
    if (!password) throw new Error('主密码不能为空');
    const encoder = new TextEncoder();
    const material = await global.crypto.subtle.importKey(
      'raw',
      encoder.encode(password),
      { name: 'PBKDF2' },
      false,
      ['deriveKey']
    );
    return global.crypto.subtle.deriveKey(
      {
        name: 'PBKDF2',
        salt: base64ToBytes(saltBase64),
        iterations,
        hash: 'SHA-256'
      },
      material,
      { name: 'AES-GCM', length: 256 },
      false,
      ['encrypt', 'decrypt']
    );
  }

  async function encryptJSON(value, key) {
    assertCrypto();
    const iv = global.crypto.getRandomValues(new Uint8Array(12));
    const encoded = new TextEncoder().encode(JSON.stringify(value));
    const ciphertext = await global.crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, encoded);
    return {
      iv: bytesToBase64(iv),
      data: bytesToBase64(new Uint8Array(ciphertext))
    };
  }

  async function decryptJSON(payload, key) {
    assertCrypto();
    if (!payload || !payload.iv || !payload.data) {
      throw new Error('密文格式不完整');
    }
    const plaintext = await global.crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: base64ToBytes(payload.iv) },
      key,
      base64ToBytes(payload.data)
    );
    return JSON.parse(new TextDecoder().decode(plaintext));
  }

  function randomInt(maxExclusive) {
    assertCrypto();
    const max = Number(maxExclusive);
    if (!Number.isSafeInteger(max) || max <= 0 || max > 0xffffffff) {
      throw new Error('随机范围不合法');
    }
    const limit = Math.floor(0x100000000 / max) * max;
    const buffer = new Uint32Array(1);
    do {
      global.crypto.getRandomValues(buffer);
    } while (buffer[0] >= limit);
    return buffer[0] % max;
  }

  function shuffleInPlace(items) {
    for (let i = items.length - 1; i > 0; i -= 1) {
      const j = randomInt(i + 1);
      [items[i], items[j]] = [items[j], items[i]];
    }
    return items;
  }

  /**
   * 生成随机密码，使用 crypto.getRandomValues。
   * 每个选中的字符组至少出现一次，再安全洗牌。
   */
  function generatePassword(options = {}) {
    assertCrypto();
    const length = Math.min(128, Math.max(4, Number(options.length) || 20));
    const groups = [];
    if (options.lower !== false) groups.push('abcdefghijkmnopqrstuvwxyz');
    if (options.upper) groups.push('ABCDEFGHJKLMNPQRSTUVWXYZ');
    if (options.digits !== false) groups.push('23456789');
    if (options.symbols) groups.push('!@#$%^&*()-_=+[]{};:,.?');

    const pools = groups.length ? groups : ['abcdefghijkmnopqrstuvwxyz23456789'];
    const all = pools.join('');
    const chars = [];

    pools.forEach((pool) => {
      if (chars.length < length) chars.push(pool[randomInt(pool.length)]);
    });
    while (chars.length < length) {
      chars.push(all[randomInt(all.length)]);
    }
    return shuffleInPlace(chars).slice(0, length).join('');
  }

  /* ------------------------------------------------------------------------
     天气：Open-Meteo（免费、无需 API Key）
     ------------------------------------------------------------------------ */
  const WEATHER_CODE_MAP = Object.freeze({
    0: { label: '晴朗', icon: 'sun' },
    1: { label: '大致晴朗', icon: 'cloud-sun' },
    2: { label: '局部多云', icon: 'cloud-sun' },
    3: { label: '阴天', icon: 'cloud' },
    45: { label: '有雾', icon: 'cloud-fog' },
    48: { label: '雾凇', icon: 'cloud-fog' },
    51: { label: '轻微毛毛雨', icon: 'cloud-drizzle' },
    53: { label: '毛毛雨', icon: 'cloud-drizzle' },
    55: { label: '较强毛毛雨', icon: 'cloud-drizzle' },
    56: { label: '冻毛毛雨', icon: 'cloud-drizzle' },
    57: { label: '强冻毛毛雨', icon: 'cloud-drizzle' },
    61: { label: '小雨', icon: 'cloud-rain' },
    63: { label: '中雨', icon: 'cloud-rain' },
    65: { label: '大雨', icon: 'cloud-rain' },
    66: { label: '冻雨', icon: 'cloud-rain' },
    67: { label: '强冻雨', icon: 'cloud-rain' },
    71: { label: '小雪', icon: 'cloud-snow' },
    73: { label: '中雪', icon: 'cloud-snow' },
    75: { label: '大雪', icon: 'cloud-snow' },
    77: { label: '米雪', icon: 'cloud-snow' },
    80: { label: '小阵雨', icon: 'cloud-rain' },
    81: { label: '中阵雨', icon: 'cloud-rain' },
    82: { label: '强阵雨', icon: 'cloud-rain' },
    85: { label: '小阵雪', icon: 'cloud-snow' },
    86: { label: '大阵雪', icon: 'cloud-snow' },
    95: { label: '雷雨', icon: 'cloud-lightning' },
    96: { label: '雷雨伴冰雹', icon: 'cloud-lightning' },
    99: { label: '强雷雨伴冰雹', icon: 'cloud-lightning' }
  });

  function describeWeatherCode(code, isDay = true) {
    const entry = WEATHER_CODE_MAP[code] || { label: '天气未知', icon: 'cloud' };
    if (code === 0 && !isDay) return { label: '晴朗夜间', icon: 'moon' };
    if ((code === 1 || code === 2) && !isDay) return { ...entry, icon: 'cloud' };
    return entry;
  }

  function windDirectionName(degrees) {
    const value = Number(degrees);
    if (!Number.isFinite(value)) return '风向未知';
    const index = Math.round(((value % 360) + 360) % 360 / 45) % 8;
    return `${WIND_DIRECTIONS[index]}风`;
  }

  function windLevel(speedKmh) {
    const value = Math.max(0, Number(speedKmh) || 0);
    const thresholds = [1, 6, 12, 20, 29, 39, 50, 62, 75, 89, 103, 118];
    const index = thresholds.findIndex((limit) => value < limit);
    return index === -1 ? 12 : index;
  }

  function normalizePlace(place) {
    if (!isPlainObject(place)) return null;
    const latitude = Number(place.latitude);
    const longitude = Number(place.longitude);
    if (!Number.isFinite(latitude) || latitude < -90 || latitude > 90) return null;
    if (!Number.isFinite(longitude) || longitude < -180 || longitude > 180) return null;
    const name = String(place.name || '').trim().slice(0, 60);
    if (!name) return null;
    return {
      name,
      admin1: String(place.admin1 || '').trim().slice(0, 60),
      country: String(place.country || '').trim().slice(0, 60),
      latitude,
      longitude,
      timezone: String(place.timezone || '').trim().slice(0, 80),
      source: place.source || 'manual'
    };
  }

  function getSavedWeatherPlace() {
    return normalizePlace(storageGetJSON(STORAGE_KEYS.weatherPlace, null)) || { ...DEFAULT_PLACE };
  }

  function saveWeatherPlace(place) {
    const normalized = normalizePlace(place);
    if (!normalized) throw new Error('地点坐标不合法');
    storageSetJSON(STORAGE_KEYS.weatherPlace, normalized);
    return normalized;
  }

  async function fetchJSON(url, options = {}) {
    const controller = new AbortController();
    const timeout = Number(options.timeout) || WEATHER_TIMEOUT;
    const timeoutId = global.setTimeout(() => controller.abort(), timeout);
    const externalSignal = options.signal;

    const abortFromOutside = () => controller.abort();
    if (externalSignal) {
      if (externalSignal.aborted) controller.abort();
      else externalSignal.addEventListener('abort', abortFromOutside, { once: true });
    }

    try {
      const response = await fetch(url, {
        method: 'GET',
        mode: 'cors',
        cache: 'no-store',
        signal: controller.signal,
        headers: { Accept: 'application/json' }
      });
      if (!response.ok) {
        throw new Error(`网络请求失败（HTTP ${response.status}）`);
      }
      return await response.json();
    } catch (error) {
      if (error.name === 'AbortError') {
        throw new Error('请求超时，请检查网络后重试');
      }
      throw error;
    } finally {
      clearTimeout(timeoutId);
      if (externalSignal) externalSignal.removeEventListener('abort', abortFromOutside);
    }
  }

  async function searchPlaces(query, options = {}) {
    const keyword = String(query || '').trim();
    if (!keyword) return [];
    const url = new URL('https://geocoding-api.open-meteo.com/v1/search');
    url.searchParams.set('name', keyword.slice(0, 60));
    url.searchParams.set('count', '6');
    url.searchParams.set('language', 'zh');
    url.searchParams.set('format', 'json');
    const data = await fetchJSON(url.toString(), options);
    return (Array.isArray(data.results) ? data.results : [])
      .map((item) => normalizePlace({ ...item, source: 'search' }))
      .filter(Boolean);
  }

  async function fetchCurrentWeather(place, options = {}) {
    const normalized = normalizePlace(place);
    if (!normalized) throw new Error('地点坐标不合法');

    const url = new URL('https://api.open-meteo.com/v1/forecast');
    url.searchParams.set('latitude', String(normalized.latitude));
    url.searchParams.set('longitude', String(normalized.longitude));
    url.searchParams.set(
      'current',
      'temperature_2m,relative_humidity_2m,apparent_temperature,is_day,weather_code,wind_speed_10m,wind_direction_10m'
    );
    url.searchParams.set('wind_speed_unit', 'kmh');
    url.searchParams.set('timezone', 'auto');

    const data = await fetchJSON(url.toString(), options);
    const current = data && data.current;
    if (!current || !Number.isFinite(Number(current.temperature_2m))) {
      throw new Error('天气数据格式异常，请稍后重试');
    }

    const weatherCode = Number(current.weather_code);
    const isDay = Number(current.is_day) !== 0;
    const description = describeWeatherCode(weatherCode, isDay);
    const speed = Number(current.wind_speed_10m) || 0;

    return {
      place: normalized,
      temperature: Number(current.temperature_2m),
      apparentTemperature: Number(current.apparent_temperature),
      humidity: Number(current.relative_humidity_2m),
      weatherCode,
      weatherLabel: description.label,
      icon: description.icon,
      isDay,
      windSpeed: speed,
      windDegrees: Number(current.wind_direction_10m),
      windDirection: windDirectionName(current.wind_direction_10m),
      windLevel: windLevel(speed),
      observedAt: current.time || '',
      timezone: data.timezone || normalized.timezone || '',
      fetchedAt: Date.now()
    };
  }

  function getCachedWeather() {
    const cache = storageGetJSON(STORAGE_KEYS.weatherCache, null);
    return isPlainObject(cache) && isPlainObject(cache.data) ? cache : null;
  }

  function cacheWeather(weather) {
    storageSetJSON(STORAGE_KEYS.weatherCache, {
      cachedAt: Date.now(),
      data: weather
    });
  }

  function sameCoordinate(a, b) {
    if (!a || !b) return false;
    return Math.abs(Number(a.latitude) - Number(b.latitude)) < 0.02
      && Math.abs(Number(a.longitude) - Number(b.longitude)) < 0.02;
  }

  function headerWeatherMarkup(weather) {
    const temperature = Math.round(Number(weather.temperature));
    const label = escapeHtml(weather.weatherLabel || '天气');
    const wind = `${escapeHtml(weather.windDirection || '风向未知')} ${Number(weather.windLevel) || 0}级`;
    const humidity = Number.isFinite(Number(weather.humidity)) ? `湿度 ${Math.round(Number(weather.humidity))}%` : '湿度 —';
    return `
      <span class="meta-weather__icon">${iconMarkup(weather.icon || 'cloud')}</span>
      <span class="meta-weather__temp">${temperature}°</span>
      <span class="meta-weather__detail">${label}<span class="meta-weather__sep">·</span>${wind}<span class="meta-weather__sep">·</span>${humidity}</span>
      <span class="meta-weather__hint">${iconMarkup('arrow-up-right', 'icon--tiny')}</span>
    `;
  }

  async function initHeaderWeather() {
    const target = $('[data-header-weather]');
    if (!target) return;

    const place = getSavedWeatherPlace();
    const cached = getCachedWeather();
    if (cached && sameCoordinate(cached.data.place, place)) {
      target.innerHTML = headerWeatherMarkup(cached.data);
      target.setAttribute('aria-label', `查看${place.name}天气详情（缓存）`);
    }

    target.classList.add('is-loading');
    try {
      const weather = await fetchCurrentWeather(place);
      cacheWeather(weather);
      target.innerHTML = headerWeatherMarkup(weather);
      target.setAttribute('aria-label', `查看${place.name}天气详情：${weather.weatherLabel}，${Math.round(weather.temperature)}度`);
    } catch (error) {
      if (!cached || !sameCoordinate(cached.data.place, place)) {
        target.innerHTML = `
          <span class="meta-weather__icon">${iconMarkup('alert')}</span>
          <span class="meta-weather__detail">天气暂不可用</span>
          <span class="meta-weather__hint">${iconMarkup('arrow-up-right', 'icon--tiny')}</span>
        `;
      }
    } finally {
      target.classList.remove('is-loading');
    }
  }

  function getBrowserPosition(options = {}) {
    return new Promise((resolve, reject) => {
      if (!navigator.geolocation) {
        reject(new Error('当前浏览器不支持定位'));
        return;
      }
      navigator.geolocation.getCurrentPosition(
        (position) => resolve({
          latitude: position.coords.latitude,
          longitude: position.coords.longitude,
          accuracy: position.coords.accuracy
        }),
        (error) => reject(error),
        {
          enableHighAccuracy: false,
          timeout: Number(options.timeout) || 12000,
          maximumAge: Number(options.maximumAge) || 300000
        }
      );
    });
  }

  function geolocationErrorMessage(error) {
    if (!error) return '定位失败，请手动输入城市。';
    if (error.code === 1) return '定位权限被拒绝。你仍可在下方手动输入城市。';
    if (error.code === 2) return '暂时无法获取位置，请检查系统定位服务。';
    if (error.code === 3) return '定位超时，请重试或手动输入城市。';
    return error.message || '定位失败，请手动输入城市。';
  }

  /* ------------------------------------------------------------------------
     外部链接、年份、Service Worker
     ------------------------------------------------------------------------ */
  function initExternalLinkSafety() {
    $$('a[target="_blank"]').forEach((link) => {
      const rel = new Set((link.getAttribute('rel') || '').split(/\s+/).filter(Boolean));
      rel.add('noopener');
      rel.add('noreferrer');
      link.setAttribute('rel', Array.from(rel).join(' '));
    });
  }

  function initYears() {
    $$('[data-current-year]').forEach((node) => {
      node.textContent = String(new Date().getFullYear());
    });
  }

  function registerServiceWorker() {
    if (!('serviceWorker' in navigator)) return;
    if (!/^https?:$/.test(global.location.protocol)) return;
    global.addEventListener('load', () => {
      navigator.serviceWorker.register('./sw.js').catch(() => {
        // 本地纯静态预览时即使注册失败也不影响主功能
      });
    });
  }

  /* ------------------------------------------------------------------------
     初始化
     ------------------------------------------------------------------------ */
  function initSite() {
    document.documentElement.classList.add('js');
    applyTheme(getStoredTheme());
    createThemeDock();
    initMenuDetails();
    initCommandPalette();
    initEscapeHome();
    initClock();
    initHeaderWeather();
    initExternalLinkSafety();
    initYears();
    registerServiceWorker();
    document.documentElement.classList.add('is-ready');
  }

  // 尽早写入主题，减少刷新时的明暗闪烁；完整主题控件在 DOM 就绪后挂载。
  applyTheme(getStoredTheme());

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initSite, { once: true });
  } else {
    initSite();
  }

  global.Toolbox = {
    version: '1.0.0',
    DB_NAME,
    DB_VERSION,
    PBKDF2_ITERATIONS,
    STORAGE_KEYS,
    DEFAULT_PLACE,
    $,
    $$,
    escapeHtml,
    escapeRegExp,
    isPlainObject,
    truncate,
    safeFilename,
    safeUrl,
    uid,
    debounce,
    throttle,
    formatDate,
    formatDateShort,
    formatDateISO,
    formatStamp,
    formatTime,
    formatWeekday,
    formatDateTime,
    getDayOfYear,
    getWeekNumber,
    greetingForHour,
    pad2,
    iconMarkup,
    theme: {
      list: () => THEMES.map((theme) => ({ ...theme })),
      get: getStoredTheme,
      set: setTheme,
      apply: applyTheme
    },
    openCommandPalette,
    toast,
    confirmDialog,
    copyText,
    downloadFile,
    readFileAsText,
    storageGet,
    storageSet,
    storageRemove,
    storageGetJSON,
    storageSetJSON,
    db: {
      open: openDB,
      get: getRecord,
      getAll: getAllRecords,
      put: putRecord,
      delete: deleteRecord,
      clear: clearStore,
      count: countRecords
    },
    crypto: {
      available: cryptoAvailable,
      assert: assertCrypto,
      bytesToBase64,
      base64ToBytes,
      createSalt,
      deriveKey,
      encryptJSON,
      decryptJSON,
      randomInt,
      generatePassword
    },
    weather: {
      codes: WEATHER_CODE_MAP,
      describeCode: describeWeatherCode,
      windDirectionName,
      windLevel,
      normalizePlace,
      getSavedPlace: getSavedWeatherPlace,
      savePlace: saveWeatherPlace,
      searchPlaces,
      fetchCurrent: fetchCurrentWeather,
      getCache: getCachedWeather,
      cache: cacheWeather,
      sameCoordinate,
      getBrowserPosition,
      geolocationErrorMessage,
      headerMarkup: headerWeatherMarkup
    }
  };
})(window);
