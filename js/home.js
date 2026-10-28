/* ==========================================================================
   主页 · 今日任务与日期印章
   ========================================================================== */
(function () {
  'use strict';

  const T = window.Toolbox;
  const TASKS_KEY_PREFIX = `${T.STORAGE_KEYS.tasks}.`;
  const MAX_TASKS = 80;
  const QUOTE_KEY = T.STORAGE_KEYS.dailyQuote;
  // 主页大标题使用励志格言，按日期 seed 轮换。
  const homeMottos = [
    '根系扎进岩层，年轮刻向星海',
    '先把今天写成一页，再谈远方',
    '把光留在纸上，把路走成答案',
    '慢一点扎根，快一点生长',
    '一页一页翻过，山也会变矮',
    '今日落笔，明日成林',
    '把难题拆开，星光就会漏进来',
    '先写完这一行，再去想下一页',
    '心里的火，不必等风来',
    '认真过好今天，就是抵达远方',
    '纸页会旧，脚步会新',
    '把根扎深，花自然会开',
    '一日一页，慢慢装订成书',
    '走过山谷，才看得见自己的路',
    '今天写下的一笔，是明天的坐标'
  ];
  // 副标题独立于大标题：更短、更轻，不与格言重复。
  const homeQuoteFallbacks = [
    '光落在纸页上，也落在你手边。',
    '慢一点，把今天读清楚。',
    '先照顾好眼前这一小段时光。',
    '不必追上所有人，跟上自己的呼吸。',
    '把心事折好，放进这一页。',
    '风会经过，字会留下。',
    '今天也允许自己只完成一点点。',
    '一杯水，一页纸，一个安静的下午。',
    '把没想明白的，留给下一行。',
    '你正在成为更笃定的人。',
    '别急，句子会自己找到结尾。',
    '把日子过得有一点光。',
    '先做眼前这一件小事。',
    '留一点空白给晚风。'
  ];

  let tasks = [];
  let dayKey = T.formatDateISO(new Date());

  const els = {};

  function cacheElements() {
    els.form = T.$('#taskForm');
    els.input = T.$('#taskInput');
    els.list = T.$('#taskList');
    els.done = T.$('#taskDone');
    els.total = T.$('#taskTotal');
    els.footnote = T.$('#taskFootnote');
    els.clear = T.$('#clearCompleted');
    els.month = T.$('#homeMonth');
    els.day = T.$('#homeDay');
    els.stampMeta = T.$('#homeStampMeta');
    els.week = T.$('#homeWeek');
    els.title = T.$('#homeTitle');
    els.quote = T.$('#homeQuote');
    els.quoteText = T.$('#homeQuoteText');
  }

  function tasksKeyFor(dateKey = dayKey) {
    return `${TASKS_KEY_PREFIX}${dateKey}`;
  }

  function normalizeTask(item) {
    if (!T.isPlainObject(item)) return null;
    const text = String(item.text || '').trim().slice(0, 120);
    if (!text) return null;
    return {
      id: String(item.id || T.uid()),
      text,
      done: Boolean(item.done),
      createdAt: Number(item.createdAt) || Date.now()
    };
  }

  function loadTasks() {
    const todayKey = tasksKeyFor();
    let stored = T.storageGetJSON(todayKey, null);
    // 兼容旧版单键任务：只有旧数据确实属于今天时才迁移，隔天不残留。
    if (!stored) {
      const legacy = T.storageGetJSON(T.STORAGE_KEYS.tasks, null);
      const savedAt = legacy && legacy.savedAt ? new Date(legacy.savedAt) : null;
      if (legacy && savedAt && T.formatDateISO(savedAt) === dayKey) {
        stored = legacy;
        T.storageSetJSON(todayKey, legacy);
      }
    }
    const items = Array.isArray(stored) ? stored : stored && Array.isArray(stored.items) ? stored.items : [];
    return items.map(normalizeTask).filter(Boolean).slice(0, MAX_TASKS);
  }

  function saveTasks() {
    const ok = T.storageSetJSON(tasksKeyFor(), {
      version: 2,
      date: dayKey,
      savedAt: new Date().toISOString(),
      items: tasks
    });
    if (!ok) {
      T.toast('浏览器本地存储不可用，本次任务可能无法保留。', { type: 'error' });
    }
  }

  function seededIndex(seed, length) {
    let hash = 0;
    const value = `${dayKey}·${seed}`;
    for (let i = 0; i < value.length; i += 1) {
      hash = (hash * 31 + value.charCodeAt(i)) >>> 0;
    }
    return hash % length;
  }

  function updateHomeMotto() {
    if (!els.title || !homeMottos.length) return;
    els.title.textContent = homeMottos[seededIndex('motto', homeMottos.length)];
  }

  function seededQuote() {
    return homeQuoteFallbacks[seededIndex('quote', homeQuoteFallbacks.length)];
  }

  function showQuote(text, author = '') {
    if (!els.quoteText) return;
    const title = els.title ? els.title.textContent.trim() : '';
    let quote = String(text || '').trim();
    let quoteAuthor = author;
    // 避免 API 偶发返回与当日格言完全相同的句子，副标题始终独立。
    if (title && quote === title) {
      quote = homeQuoteFallbacks[seededIndex('quote-fallback', homeQuoteFallbacks.length)];
      quoteAuthor = '';
    }
    els.quoteText.textContent = `「${quote}」${quoteAuthor ? ` — ${quoteAuthor}` : ''}`;
  }

  async function fetchDailyQuote() {
    const cached = T.storageGetJSON(QUOTE_KEY, null);
    const fallback = seededQuote();
    if (cached && cached.date === dayKey && cached.text) {
      showQuote(cached.text, cached.author || '');
      return;
    }

    // 先放当天 seed 的短句，避免网络拖慢首屏；API 成功后替换为服务端句子。
    showQuote(fallback);
    const controller = new AbortController();
    const timer = window.setTimeout(() => controller.abort(), 3000);
    const tryZenQuotes = async () => {
      const response = await fetch('https://zenquotes.io/api/today', { signal: controller.signal, cache: 'no-store' });
      if (!response.ok) throw new Error('ZenQuotes unavailable');
      const data = await response.json();
      const item = Array.isArray(data) ? data[0] : null;
      if (!item || !item.q) throw new Error('ZenQuotes empty');
      return { text: String(item.q).trim(), author: String(item.a || '').trim(), source: 'ZenQuotes' };
    };
    const tryQuoteGarden = async () => {
      const response = await fetch('https://quote-garden.onrender.com/api/v3/quotes/random', { signal: controller.signal, cache: 'no-store' });
      if (!response.ok) throw new Error('Quote Garden unavailable');
      const data = await response.json();
      const item = data && data.data ? data.data[0] : null;
      if (!item || !item.quote) throw new Error('Quote Garden empty');
      return { text: String(item.quote).trim(), author: String(item.author || '').trim(), source: 'Quote Garden' };
    };

    try {
      let quote = null;
      try {
        quote = await tryZenQuotes();
      } catch (error) {
        if (!controller.signal.aborted) quote = await tryQuoteGarden();
      }
      if (!quote) throw new Error('quote unavailable');
      showQuote(quote.text, quote.author);
      T.storageSetJSON(QUOTE_KEY, { date: dayKey, ...quote });
    } catch (error) {
      T.storageSetJSON(QUOTE_KEY, { date: dayKey, text: fallback, author: '', source: 'fallback' });
    } finally {
      window.clearTimeout(timer);
    }
  }

  function updateDateStamp() {
    const now = new Date();
    const month = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'][now.getMonth()];
    const weekday = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'][now.getDay()];
    if (els.month) els.month.textContent = month;
    if (els.day) els.day.textContent = String(now.getDate()).padStart(2, '0');
    if (els.stampMeta) els.stampMeta.textContent = `${now.getFullYear()} · ${weekday}`;
    if (els.week) els.week.textContent = String(T.getWeekNumber(now)).padStart(2, '0');

    const nextDayKey = T.formatDateISO(now);
    if (nextDayKey !== dayKey) {
      dayKey = nextDayKey;
      updateHomeMotto();
      tasks = loadTasks();
      renderTasks();
    }
  }

  function renderTasks() {
    if (!els.list) return;
    const doneCount = tasks.filter((task) => task.done).length;

    if (!tasks.length) {
      els.list.innerHTML = `
        <li class="task-empty">
          <svg class="icon" aria-hidden="true"><use href="assets/icons.svg#icon-pen"></use></svg>
          <span>这里还空着。<br>写下一件小事，让今天有第一行。</span>
        </li>
      `;
    } else {
      els.list.innerHTML = tasks.map((task) => `
        <li class="task-item${task.done ? ' is-done' : ''}" data-id="${T.escapeHtml(task.id)}">
          <input class="task-check" type="checkbox" data-action="toggle" ${task.done ? 'checked' : ''} aria-label="${T.escapeHtml(task.done ? `取消完成：${task.text}` : `完成：${task.text}`)}">
          <span class="task-text">${T.escapeHtml(task.text)}</span>
          <button class="task-delete" type="button" data-action="delete" aria-label="删除任务：${T.escapeHtml(task.text)}" title="删除">
            <svg class="icon" aria-hidden="true"><use href="assets/icons.svg#icon-trash"></use></svg>
          </button>
        </li>
      `).join('');
    }

    if (els.done) els.done.textContent = String(doneCount);
    if (els.total) els.total.textContent = String(tasks.length);

    if (els.footnote) {
      if (!tasks.length) {
        els.footnote.textContent = '今天的纸面还很空，先写第一行。';
      } else if (doneCount === tasks.length) {
        els.footnote.textContent = `全部完成 · 今天的清单可以合上了。`;
      } else {
        els.footnote.textContent = `已完成 ${doneCount} 件 · 还剩 ${tasks.length - doneCount} 件`;
      }
    }

    if (els.clear) els.clear.hidden = doneCount === 0;
  }

  function addTask(text) {
    const value = String(text || '').replace(/\s+/g, ' ').trim().slice(0, 120);
    if (!value) {
      T.toast('先写下一件要做的事。', { type: 'info' });
      els.input?.focus();
      return;
    }
    if (tasks.length >= MAX_TASKS) {
      T.toast(`最多保存 ${MAX_TASKS} 条任务，请先清理一些。`, { type: 'error' });
      return;
    }
    tasks.push({
      id: T.uid(),
      text: value,
      done: false,
      createdAt: Date.now()
    });
    saveTasks();
    renderTasks();
    if (els.input) {
      els.input.value = '';
      els.input.focus();
    }
  }

  function findTask(id) {
    return tasks.find((task) => task.id === id);
  }

  function handleListChange(event) {
    const target = event.target;
    if (!(target instanceof HTMLElement)) return;
    const action = target.dataset.action;
    if (!action) return;
    const item = target.closest('[data-id]');
    if (!item) return;
    const task = findTask(item.dataset.id);
    if (!task) return;

    if (action === 'toggle') {
      task.done = Boolean(target.checked);
      saveTasks();
      renderTasks();
      return;
    }

    if (action === 'delete') {
      tasks = tasks.filter((entry) => entry.id !== task.id);
      saveTasks();
      renderTasks();
      T.toast('已从今日清单中划去。', { type: 'info', duration: 1800 });
    }
  }

  async function clearCompleted() {
    const doneCount = tasks.filter((task) => task.done).length;
    if (!doneCount) return;
    const ok = await T.confirmDialog({
      title: '清空已完成任务？',
      message: `将移除 ${doneCount} 条已经划掉的任务，未完成的会保留。`,
      confirmText: '清空已完成',
      cancelText: '保留',
      danger: true
    });
    if (!ok) return;
    tasks = tasks.filter((task) => !task.done);
    saveTasks();
    renderTasks();
    T.toast('已完成的任务已清空。');
  }

  function initEvents() {
    els.form?.addEventListener('submit', (event) => {
      event.preventDefault();
      addTask(els.input ? els.input.value : '');
    });
    els.list?.addEventListener('change', handleListChange);
    els.list?.addEventListener('click', (event) => {
      const target = event.target.closest('[data-action]');
      if (!target || target.dataset.action !== 'delete') return;
      const item = target.closest('[data-id]');
      if (!item) return;
      const task = findTask(item.dataset.id);
      if (!task) return;
      tasks = tasks.filter((entry) => entry.id !== task.id);
      saveTasks();
      renderTasks();
    });
    els.clear?.addEventListener('click', clearCompleted);
  }

  function init() {
    cacheElements();
    dayKey = T.formatDateISO(new Date());
    updateHomeMotto();
    updateDateStamp();
    tasks = loadTasks();
    renderTasks();
    initEvents();
    fetchDailyQuote();
    window.setInterval(updateDateStamp, 60000);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init, { once: true });
  } else {
    init();
  }
})();
