/* ==========================================================================
   笔记思维导图
   - 从当前 Markdown 的标题与有序/无序列表生成只读树
   - 轻量 SVG 连线 + HTML 节点，不引入框架或拖拽编辑器
   - 点击节点复用 notes.js 的 Markdown + KaTeX 渲染，展示对应笔记段落
   ========================================================================== */
(function () {
  'use strict';

  const T = window.Toolbox;

  const NODE_WIDTH = 198;
  const NODE_HEIGHT = 44;
  const X_GAP = 236;
  const ROW_GAP = 62;
  const PAD_X = 22;
  const PAD_Y = 22;
  const MAX_NODES = 320;
  const MAX_DETAIL_CHARS = 30000;
  const AI_TITLE_PATTERN = /(^|[\s·:：-])(AI|人工智能|解答|回答|题解)([\s·:：-]|$)/i;

  const state = {
    tree: null,
    nodeMap: new Map(),
    collapsed: new Set(),
    selectedKey: '',
    sourceSignature: '',
    sourceLines: [],
    refreshTimer: 0,
    truncated: false,
    initialized: false,
    dragKey: ''
  };

  const els = {};

  function cacheElements() {
    [
      'notesApp', 'noteTitle', 'markdownInput', 'mindmapView', 'mindmapStatus',
      'mindmapCanvasWrap', 'mindmapCanvas', 'mindmapLinks', 'mindmapNodes',
      'mindmapExpandAllBtn', 'mindmapCollapseAllBtn', 'mindmapDetail',
      'mindmapDetailEmpty', 'mindmapDetailBodyWrap', 'mindmapDetailKind',
      'mindmapDetailTitle', 'mindmapDetailHint', 'mindmapDetailContent',
      'mindmapDetailCloseBtn', 'mindmapNodeEditor', 'mindmapNodeTitleInput',
      'mindmapSaveNodeBtn', 'mindmapAddChildBtn', 'mindmapDeleteNodeBtn'
    ].forEach((id) => {
      els[id] = document.getElementById(id);
    });
  }

  function isVisible() {
    return els.notesApp && els.notesApp.dataset.pane === 'mindmap';
  }

  /* ------------------------------------------------------------------------
     大纲解析
     ------------------------------------------------------------------------ */
  function plainNodeTitle(raw) {
    let text = String(raw || '');
    text = text.replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1');
    text = text.replace(/\[([^\]]+)\]\([^)]*\)/g, '$1');
    text = text.replace(/`([^`]*)`/g, '$1');
    text = text.replace(/\$\$([\s\S]*?)\$\$/g, '[公式]');
    text = text.replace(/\$([^$\n]+)\$/g, '[公式]');
    text = text.replace(/[*_~]{1,3}/g, '');
    text = text.replace(/<[^>]+>/g, '');
    text = text.replace(/^\s*\[[ xX]\]\s*/, '');
    text = text.replace(/\s+/g, ' ').trim();
    return text || '未命名节点';
  }

  function hashString(value) {
    let hash = 2166136261;
    for (let i = 0; i < value.length; i += 1) {
      hash ^= value.charCodeAt(i);
      hash = Math.imul(hash, 16777619);
    }
    return (hash >>> 0).toString(36);
  }

  function decorateNode(node, parentKey, depth, siblingIndex) {
    node.depth = depth;
    // 根节点固定为 mm-root；一级标题也必须拥有各自的唯一 key，
    // 否则多个一级标题会互相覆盖折叠状态。
    node.key = `mm-${hashString(`${parentKey}|${siblingIndex}|${node.type}|${node.title}`)}`;
    state.nodeMap.set(node.key, node);
    node.children.forEach((child, index) => {
      decorateNode(child, node.key, depth + 1, index);
    });
  }

  function parseOutline(source, noteTitle) {
    const lines = String(source || '').replace(/\r\n?/g, '\n').split('\n');
    const root = {
      key: 'mm-root',
      depth: 0,
      type: 'root',
      title: String(noteTitle || '').trim() || '当前笔记',
      rawTitle: String(noteTitle || '').trim() || '当前笔记',
      level: 0,
      lineStart: -1,
      lineEnd: lines.length,
      content: String(source || ''),
      bodyText: String(source || ''),
      introText: '',
      children: [],
      parent: null
    };

    const headingStack = [];
    const listStack = [];
    const allNodes = [];
    let inFence = false;
    let fenceChar = '';
    let fenceLength = 0;
    let truncated = false;

    for (let index = 0; index < lines.length; index += 1) {
      const line = lines[index];
      const fenceMatch = line.match(/^\s{0,3}(`{3,}|~{3,})(.*)$/);

      if (fenceMatch) {
        if (!inFence) {
          inFence = true;
          fenceChar = fenceMatch[1][0];
          fenceLength = fenceMatch[1].length;
        } else if (
          fenceMatch[1][0] === fenceChar
          && fenceMatch[1].length >= fenceLength
          && !fenceMatch[2].trim()
        ) {
          inFence = false;
          fenceChar = '';
          fenceLength = 0;
        }
        continue;
      }
      if (inFence) continue;

      const headingMatch = line.match(/^( {0,3})(#{1,6})\s+(.+?)\s*#*\s*$/);
      if (headingMatch) {
        if (allNodes.length >= MAX_NODES) {
          truncated = true;
          continue;
        }
        const level = headingMatch[2].length;
        const title = plainNodeTitle(headingMatch[3]);
        while (headingStack.length && headingStack[headingStack.length - 1].level >= level) {
          headingStack.pop();
        }
        const parent = headingStack[headingStack.length - 1] || root;
        const node = {
          type: 'heading',
          title,
          rawTitle: headingMatch[3].trim(),
          level,
          lineStart: index,
          lineEnd: lines.length,
          content: '',
          bodyText: '',
          children: [],
          parent
        };
        parent.children.push(node);
        headingStack.push(node);
        listStack.length = 0;
        allNodes.push(node);
        continue;
      }

      const listMatch = line.match(/^(\s*)([-*+]|\d+[.)])\s+(.+)$/);
      if (listMatch) {
        if (allNodes.length >= MAX_NODES) {
          truncated = true;
          continue;
        }
        const indent = listMatch[1].replace(/\t/g, '    ').length;
        while (listStack.length && listStack[listStack.length - 1].indent >= indent) {
          listStack.pop();
        }
        const parent = listStack.length
          ? listStack[listStack.length - 1].node
          : (headingStack[headingStack.length - 1] || root);
        const node = {
          type: 'list',
          title: plainNodeTitle(listMatch[3]),
          rawTitle: listMatch[3].trim(),
          level: 0,
          indent,
          marker: listMatch[2],
          ordered: /^\d/.test(listMatch[2]),
          lineStart: index,
          lineEnd: lines.length,
          content: '',
          bodyText: '',
          children: [],
          parent
        };
        parent.children.push(node);
        listStack.push({ indent, node });
        allNodes.push(node);
      }
    }

    const ordered = [...allNodes].sort((a, b) => a.lineStart - b.lineStart);
    ordered.forEach((node) => {
      const next = ordered.find((candidate) => {
        if (candidate.lineStart <= node.lineStart) return false;
        if (node.type === 'heading') {
          return candidate.type === 'heading' && candidate.level <= node.level;
        }
        return candidate.type === 'heading'
          || (candidate.type === 'list' && candidate.indent <= node.indent);
      });
      node.lineEnd = next ? next.lineStart : lines.length;
      const from = node.type === 'heading' ? node.lineStart + 1 : node.lineStart;
      const rawContent = lines.slice(from, node.lineEnd).join('\n').trim();
      node.content = rawContent.slice(0, MAX_DETAIL_CHARS);
      node.contentTruncated = rawContent.length > MAX_DETAIL_CHARS;
      const firstChildStart = node.children.length ? node.children[0].lineStart : node.lineEnd;
      node.bodyText = lines.slice(node.lineStart + 1, firstChildStart).join('\n');
    });

    state.sourceLines = lines;
    root.introText = lines.slice(0, root.children[0] ? root.children[0].lineStart : lines.length).join('\n');
    root.bodyText = root.introText;
    state.nodeMap.set(root.key, root);
    root.children.forEach((child, index) => {
      decorateNode(child, root.key, 1, index);
    });
    state.tree = root;
    state.truncated = truncated;

    // 清理已经被删除节点的折叠状态，避免 Set 无限增长。
    const existingKeys = new Set(state.nodeMap.keys());
    Array.from(state.collapsed).forEach((key) => {
      if (!existingKeys.has(key)) state.collapsed.delete(key);
    });
    if (state.selectedKey && !existingKeys.has(state.selectedKey)) {
      state.selectedKey = '';
    }

    return root;
  }

  /* ------------------------------------------------------------------------
     布局与绘制
     ------------------------------------------------------------------------ */
  function visibleChildren(node) {
    if (!node.children.length || state.collapsed.has(node.key)) return [];
    return node.children;
  }

  function layoutTree(root) {
    const visible = [];
    const counters = { row: 0, maxDepth: 0 };

    function walk(node, depth) {
      node._x = PAD_X + depth * X_GAP;
      node._depth = depth;
      counters.maxDepth = Math.max(counters.maxDepth, depth);
      const children = visibleChildren(node);
      if (!children.length) {
        node._y = PAD_Y + counters.row * ROW_GAP;
        counters.row += 1;
      } else {
        children.forEach((child) => walk(child, depth + 1));
        node._y = (children[0]._y + children[children.length - 1]._y) / 2;
      }
      visible.push(node);
    }

    walk(root, 0);
    return {
      visible,
      width: Math.max(320, PAD_X * 2 + NODE_WIDTH + counters.maxDepth * X_GAP),
      height: Math.max(300, PAD_Y * 2 + NODE_HEIGHT + Math.max(0, counters.row - 1) * ROW_GAP)
    };
  }

  function selectedLineage() {
    const lineage = new Set();
    if (!state.selectedKey) return lineage;
    let node = state.nodeMap.get(state.selectedKey);
    while (node) {
      lineage.add(node.key);
      node = node.parent;
    }
    return lineage;
  }

  function nodeIsAnswer(node) {
    return node.type !== 'root' && AI_TITLE_PATTERN.test(node.title);
  }

  function nodeKicker(node) {
    if (node.type === 'root') return 'NOTE';
    if (node.type === 'heading') return `H${node.level}`;
    return node.ordered ? 'ORDERED' : 'LIST';
  }

  function nodeMarkup(node) {
    const hasChildren = node.children.length > 0;
    const collapsed = state.collapsed.has(node.key);
    const selected = node.key === state.selectedKey;
    const answer = nodeIsAnswer(node);
    const safeTitle = T.escapeHtml(node.title);
    const toggleAction = collapsed ? '展开' : '折叠';
    const toggleTarget = node.type === 'root' ? `笔记大纲「${safeTitle}」` : `「${safeTitle}」`;
    // 根节点的「笔记标题」箭头就是折叠/展开按钮：带 aria-expanded，
    // 使用原生 button 保证 Enter / Space 可操作，并在重绘后把焦点还给它。
    const toggle = hasChildren
      ? `<button class="mindmap-node__toggle" type="button" data-mindmap-toggle="${node.key}"
                 aria-label="${toggleAction}${toggleTarget}" aria-expanded="${collapsed ? 'false' : 'true'}"
                 title="${toggleAction}${toggleTarget}">
           <svg class="icon" aria-hidden="true" focusable="false"><use href="assets/icons.svg#icon-chevron-down"></use></svg>
         </button>`
      : '';

    const draggable = node.type !== 'root'
      ? 'draggable="true" data-mindmap-drag="true"'
      : '';
    const grip = node.type !== 'root'
      ? `<span class="mindmap-node__grip" title="拖动调整层级">${T.iconMarkup('grip', 'icon--tiny')}</span>`
      : '';
    return `
      <div class="mindmap-node mindmap-node--${node.type}${collapsed ? ' is-collapsed' : ''}${selected ? ' is-selected' : ''}"
           style="left:${Math.round(node._x)}px;top:${Math.round(node._y)}px"
           data-node-key="${node.key}" ${draggable}>
        ${grip}
        <button class="mindmap-node__main" type="button" data-mindmap-select="${node.key}" title="${safeTitle}">
          <span class="mindmap-node__kicker">${nodeKicker(node)}${answer ? '<span class="mindmap-node__badge">解答</span>' : ''}</span>
          <span class="mindmap-node__label">${safeTitle}</span>
        </button>
        ${toggle}
      </div>
    `;
  }

  function renderCanvas(options = {}) {
    if (!els.mindmapCanvas || !state.tree) return;
    const scrollLeft = options.resetScroll ? 0 : els.mindmapCanvasWrap.scrollLeft;
    const scrollTop = options.resetScroll ? 0 : els.mindmapCanvasWrap.scrollTop;
    const layout = layoutTree(state.tree);
    // 视觉位置已经由 _x/_y 决定；这里按层级和纵坐标排序 DOM，
    // 让键盘 Tab 顺序符合“根节点 → 一级分支 → 子节点”的阅读顺序。
    const visibleNodes = layout.visible
      .slice()
      .sort((a, b) => a._depth - b._depth || a._y - b._y);
    const visibleKeys = new Set(visibleNodes.map((node) => node.key));
    const lineage = selectedLineage();

    const paths = [];
    visibleNodes.forEach((node) => {
      if (!node.parent || !visibleKeys.has(node.parent.key)) return;
      const x1 = node.parent._x + NODE_WIDTH;
      const y1 = node.parent._y + NODE_HEIGHT / 2;
      const x2 = node._x;
      const y2 = node._y + NODE_HEIGHT / 2;
      const mid = (x1 + x2) / 2;
      const emphasis = lineage.has(node.key) && lineage.has(node.parent.key);
      paths.push(
        `<path class="${emphasis ? 'is-emphasis' : ''}" d="M${x1} ${y1} C${mid} ${y1}, ${mid} ${y2}, ${x2} ${y2}"></path>`
      );
    });

    els.mindmapCanvas.style.width = `${layout.width}px`;
    els.mindmapCanvas.style.height = `${layout.height}px`;
    els.mindmapLinks.setAttribute('width', String(layout.width));
    els.mindmapLinks.setAttribute('height', String(layout.height));
    els.mindmapLinks.innerHTML = paths.join('');
    els.mindmapNodes.innerHTML = visibleNodes.map(nodeMarkup).join('');
    if (els.mindmapCanvasWrap) {
      els.mindmapCanvasWrap.scrollLeft = scrollLeft;
      els.mindmapCanvasWrap.scrollTop = scrollTop;
    }
  }

  function setStatus() {
    if (!els.mindmapStatus || !state.tree) return;
    const count = state.nodeMap.size;
    if (state.nodeMap.size <= 1) {
      els.mindmapStatus.textContent = '当前笔记还没有标题或列表。写一个 ## 小节，或用 - 知识点 列一行，导图就会长出来。';
      return;
    }
    els.mindmapStatus.textContent = `${count} 个节点 · 可编辑的 Markdown 大纲${state.truncated ? ` · 仅显示前 ${MAX_NODES} 个` : ''} · 点击查看内容，拖拽节点调整层级`;
  }

  function showEmptyDetail() {
    if (els.mindmapView) els.mindmapView.classList.remove('has-selection');
    if (els.mindmapDetailEmpty) els.mindmapDetailEmpty.hidden = false;
    if (els.mindmapDetailBodyWrap) els.mindmapDetailBodyWrap.hidden = true;
    if (els.mindmapDetailKind) els.mindmapDetailKind.textContent = '等待选择';
  }

  function scrollNodeIntoView(node) {
    if (!node || !els.mindmapCanvasWrap) return;
    window.requestAnimationFrame(() => {
      const wrap = els.mindmapCanvasWrap;
      if (!wrap) return;
      const pad = 28;
      let left = wrap.scrollLeft;
      let top = wrap.scrollTop;
      if (node._x - pad < wrap.scrollLeft) {
        left = Math.max(0, node._x - pad);
      } else if (node._x + NODE_WIDTH + pad > wrap.scrollLeft + wrap.clientWidth) {
        left = node._x + NODE_WIDTH + pad - wrap.clientWidth;
      }
      if (node._y - pad < wrap.scrollTop) {
        top = Math.max(0, node._y - pad);
      } else if (node._y + NODE_HEIGHT + pad > wrap.scrollTop + wrap.clientHeight) {
        top = node._y + NODE_HEIGHT + pad - wrap.clientHeight;
      }
      wrap.scrollTo({ left: Math.max(0, left), top: Math.max(0, top), behavior: 'smooth' });
    });
  }

  function renderDetail(node) {
    if (!node) {
      showEmptyDetail();
      return;
    }
    if (els.mindmapDetailEmpty) els.mindmapDetailEmpty.hidden = true;
    if (els.mindmapDetailBodyWrap) els.mindmapDetailBodyWrap.hidden = false;
    if (els.mindmapNodeEditor) {
      els.mindmapNodeEditor.hidden = false;
      const isRoot = node.type === 'root';
      if (els.mindmapNodeTitleInput) {
        els.mindmapNodeTitleInput.value = node.title;
        els.mindmapNodeTitleInput.disabled = isRoot;
      }
      if (els.mindmapSaveNodeBtn) els.mindmapSaveNodeBtn.disabled = isRoot;
      if (els.mindmapDeleteNodeBtn) els.mindmapDeleteNodeBtn.disabled = isRoot;
      if (els.mindmapAddChildBtn) els.mindmapAddChildBtn.disabled = false;
    }
    if (els.mindmapDetailTitle) els.mindmapDetailTitle.textContent = node.title;
    if (els.mindmapDetailKind) {
      const answer = nodeIsAnswer(node);
      els.mindmapDetailKind.textContent = node.type === 'root'
        ? '整篇笔记'
        : node.type === 'heading'
          ? `H${node.level} 章节${answer ? ' · 解答记录' : ''}`
          : `列表条目${answer ? ' · 解答记录' : ''}`;
    }
    if (els.mindmapDetailHint) {
      const line = node.lineStart >= 0 ? `第 ${node.lineStart + 1} 行起` : '整篇笔记';
      els.mindmapDetailHint.textContent = `${line} · ${node.contentTruncated ? '内容较长，已截取展示' : '来自当前笔记'}`;
    }
    if (els.mindmapDetailContent) {
      if (!node.content) {
        els.mindmapDetailContent.innerHTML = '<p class="text-faint">这一节暂时只有标题，还没有正文。</p>';
      } else if (window.NotesMindmapBridge && typeof window.NotesMindmapBridge.renderMarkdown === 'function') {
        els.mindmapDetailContent.innerHTML = window.NotesMindmapBridge.renderMarkdown(node.content);
      } else {
        els.mindmapDetailContent.innerHTML = `<pre>${T.escapeHtml(node.content)}</pre>`;
      }
    }
    if (els.mindmapDetail) els.mindmapDetail.scrollTop = 0;
  }

  function selectNode(key) {
    const node = state.nodeMap.get(key);
    if (!node) return;
    state.selectedKey = key;
    if (els.mindmapView) els.mindmapView.classList.add('has-selection');
    renderCanvas();
    renderDetail(node);
    scrollNodeIntoView(node);
    if (window.matchMedia('(max-width: 760px)').matches) {
      window.setTimeout(() => {
        els.mindmapDetail?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      }, 160);
    }
  }

  function closeDetail() {
    state.selectedKey = '';
    showEmptyDetail();
    renderCanvas({ resetScroll: true });
    window.setTimeout(() => els.mindmapCanvasWrap?.focus({ preventScroll: true }), 40);
  }

  function isNodeInside(key, ancestorKey) {
    let node = state.nodeMap.get(key);
    while (node) {
      if (node.key === ancestorKey) return true;
      node = node.parent;
    }
    return false;
  }

  function toggleNodeCollapse(key) {
    if (!key) return;
    if (state.collapsed.has(key)) {
      state.collapsed.delete(key);
    } else {
      state.collapsed.add(key);
      // 折叠后当前详情对应的节点若被隐藏，同时收起详情，避免留下“看不见的选中态”。
      if (state.selectedKey && isNodeInside(state.selectedKey, key)) {
        state.selectedKey = '';
        showEmptyDetail();
      }
    }
    renderCanvas();
    // renderCanvas 会重建节点 DOM，重绘后把键盘焦点还给同一个箭头。
    window.requestAnimationFrame(() => {
      const nextToggle = els.mindmapNodes?.querySelector(`[data-mindmap-toggle="${key}"]`);
      nextToggle?.focus({ preventScroll: true });
    });
    if (state.selectedKey) {
      renderDetail(state.nodeMap.get(state.selectedKey));
    }
  }

  function setAllCollapsed(collapsed) {
    state.collapsed.clear();
    if (collapsed) {
      state.nodeMap.forEach((node) => {
        if (node.children.length) state.collapsed.add(node.key);
      });
      state.selectedKey = '';
      showEmptyDetail();
    }
    renderCanvas();
    if (state.selectedKey) {
      renderDetail(state.nodeMap.get(state.selectedKey));
    }
  }

  /* ------------------------------------------------------------------------
     可编辑大纲：节点路径 / 序列化 / 增删改 / 拖拽
     ------------------------------------------------------------------------ */
  function nodePath(node) {
    const path = [];
    let current = node;
    while (current && current.parent) {
      const index = current.parent.children.indexOf(current);
      if (index < 0) return null;
      path.unshift(index);
      current = current.parent;
    }
    return path;
  }

  function nodeAtPath(path) {
    let node = state.tree;
    for (const index of path || []) {
      if (!node || !node.children[index]) return null;
      node = node.children[index];
    }
    return node;
  }

  function expandAncestors(node) {
    let parent = node ? node.parent : null;
    while (parent) {
      state.collapsed.delete(parent.key);
      parent = parent.parent;
    }
  }

  function serializeTree(tree) {
    if (!tree) return '';
    const lines = [];
    if (tree.introText) lines.push(...tree.introText.split('\n'));

    const writeNode = (node) => {
      if (node.type === 'heading') {
        if (lines.length && lines[lines.length - 1].trim() !== '') lines.push('');
        lines.push(`${'#'.repeat(Math.max(1, Math.min(6, node.level)))} ${node.rawTitle || node.title}`);
      } else {
        const indent = ' '.repeat(Math.max(0, node.indent || 0));
        const marker = node.marker || (node.ordered ? '1.' : '-');
        lines.push(`${indent}${marker} ${node.rawTitle || node.title}`);
      }
      if (node.bodyText) lines.push(...node.bodyText.split('\n'));
      node.children.forEach(writeNode);
    };

    tree.children.forEach(writeNode);
    let output = lines.join('\n');
    if (!output) return '';
    output = `${output.replace(/\n+$/, '')}\n`;
    return output;
  }

  function syncTreeToMarkdown(selectPath, options = {}) {
    if (!els.markdownInput) return;
    const next = serializeTree(state.tree);
    if (next !== els.markdownInput.value) {
      els.markdownInput.value = next;
      els.markdownInput.dispatchEvent(new Event('input', { bubbles: true }));
    }

    const noteTitle = els.noteTitle ? els.noteTitle.value : '';
    state.nodeMap = new Map();
    parseOutline(els.markdownInput.value, noteTitle);
    state.sourceSignature = `${noteTitle}\u0000${els.markdownInput.value}`;
    const selected = nodeAtPath(selectPath);
    state.selectedKey = selected ? selected.key : '';
    if (selected) {
      expandAncestors(selected);
      if (els.mindmapView) els.mindmapView.classList.add('has-selection');
    } else {
      showEmptyDetail();
    }
    setStatus();
    renderCanvas();
    if (selected) {
      renderDetail(selected);
      scrollNodeIntoView(selected);
      if (options.focusTitle && els.mindmapNodeTitleInput) {
        window.requestAnimationFrame(() => {
          els.mindmapNodeTitleInput.focus();
          els.mindmapNodeTitleInput.select();
        });
      }
    }
    if (options.toast) T.toast(options.toast, { type: 'success', duration: 1800 });
  }

  function renameSelectedNode() {
    const node = state.nodeMap.get(state.selectedKey);
    if (!node || node.type === 'root') return;
    const title = String(els.mindmapNodeTitleInput?.value || '').replace(/\s+/g, ' ').trim().slice(0, 120);
    if (!title) {
      T.toast('节点标题不能为空。', { type: 'info' });
      els.mindmapNodeTitleInput?.focus();
      return;
    }
    if (title === node.title) {
      // 节点内显示的是剥离公式后的纯文本；标题没变时绝不回写，避免把 $...$ 覆盖成 [公式]。
      T.toast('节点标题没有变化。', { type: 'info', duration: 1400 });
      return;
    }
    const path = nodePath(node);
    if (!path) return;
    node.title = title;
    node.rawTitle = title;
    syncTreeToMarkdown(path, { toast: '节点标题已写回大纲。' });
  }

  function addChildNode() {
    const parent = state.nodeMap.get(state.selectedKey) || state.tree;
    if (!parent) return;
    const parentPath = nodePath(parent);
    if (!parentPath) return;

    let type = 'heading';
    let level = 1;
    let indent = 0;
    let marker = '';
    if (parent.type === 'list') {
      type = 'list';
      indent = parent.indent + 2;
      marker = '-';
    } else if (parent.type === 'heading') {
      if (parent.level >= 6) {
        type = 'list';
        marker = '-';
        indent = 0;
      } else {
        level = parent.level + 1;
      }
    }

    const child = {
      type,
      title: '新知识点',
      rawTitle: '新知识点',
      level,
      indent,
      marker,
      ordered: false,
      lineStart: -1,
      lineEnd: -1,
      content: '',
      bodyText: '',
      children: [],
      parent
    };
    parent.children.push(child);
    state.collapsed.delete(parent.key);
    const newPath = [...parentPath, parent.children.length - 1];
    syncTreeToMarkdown(newPath, { focusTitle: true, toast: '已添加子节点，输入标题后按 Enter 保存。' });
  }

  async function deleteSelectedNode() {
    const node = state.nodeMap.get(state.selectedKey);
    if (!node || node.type === 'root') return;
    const ok = await T.confirmDialog({
      title: '删除这个节点？',
      message: `「${node.title}」及其子节点会从 Markdown 大纲中移除，相关正文也会一起删除。此操作无法撤销。`,
      confirmText: '删除节点',
      cancelText: '保留',
      danger: true
    });
    if (!ok) return;
    const parent = node.parent;
    if (!parent) return;
    const index = parent.children.indexOf(node);
    if (index < 0) return;
    parent.children.splice(index, 1);
    const selectPath = nodePath(parent) || [];
    const next = parent.children[Math.min(index, parent.children.length - 1)] || parent;
    const nextPath = next === parent ? selectPath : [...selectPath, parent.children.indexOf(next)];
    syncTreeToMarkdown(nextPath, { toast: '节点已从大纲删除。' });
  }

  function canDropNode(dragKey, targetKey) {
    if (!dragKey || !targetKey || dragKey === targetKey) return false;
    const dragged = state.nodeMap.get(dragKey);
    const target = state.nodeMap.get(targetKey);
    if (!dragged || !target || dragged.type === 'root') return false;
    if (isNodeInside(targetKey, dragKey)) return false;
    if (dragged.type === 'heading') {
      if (target.type === 'root') return true;
      return target.type === 'heading' && target.level < 6;
    }
    return target.type === 'root' || target.type === 'heading' || target.type === 'list';
  }

  function shiftNodeIndent(node, delta) {
    if (node.type === 'list') node.indent = Math.max(0, node.indent + delta);
    node.children.forEach((child) => shiftNodeIndent(child, delta));
  }

  function shiftHeadingLevel(node, delta) {
    if (node.type === 'heading') node.level = Math.min(6, Math.max(1, node.level + delta));
    node.children.forEach((child) => shiftHeadingLevel(child, delta));
  }

  function maxHeadingLevel(node) {
    let max = node.type === 'heading' ? node.level : 0;
    node.children.forEach((child) => { max = Math.max(max, maxHeadingLevel(child)); });
    return max;
  }

  function dropNode(dragKey, targetKey) {
    if (!canDropNode(dragKey, targetKey)) {
      T.toast('这个层级不能这样放置。', { type: 'info', duration: 1600 });
      return;
    }
    const dragged = state.nodeMap.get(dragKey);
    const target = state.nodeMap.get(targetKey);
    let parent = target;
    let newLevel = dragged.level;
    let newIndent = dragged.indent || 0;

    if (dragged.type === 'heading') {
      newLevel = target.type === 'root' ? 1 : target.level + 1;
      const delta = newLevel - dragged.level;
      if (delta > 0 && maxHeadingLevel(dragged) + delta > 6) {
        T.toast('一级标题层级太深，无法放到这里。', { type: 'info' });
        return;
      }
      shiftHeadingLevel(dragged, delta);
    } else {
      if (target.type === 'root') parent = state.tree;
      else parent = target;
      newIndent = target.type === 'list' ? target.indent + 2 : 0;
      shiftNodeIndent(dragged, newIndent - (dragged.indent || 0));
    }

    if (!parent || parent.type === 'list' && dragged.type === 'heading') return;
    const oldParent = dragged.parent;
    if (!oldParent) return;
    const oldIndex = oldParent.children.indexOf(dragged);
    if (oldIndex >= 0) oldParent.children.splice(oldIndex, 1);
    parent.children.push(dragged);
    dragged.parent = parent;
    state.collapsed.delete(parent.key);
    const parentPath = nodePath(parent) || [];
    const newPath = [...parentPath, parent.children.length - 1];
    syncTreeToMarkdown(newPath, { toast: `已把「${dragged.title}」放到「${parent.type === 'root' ? '根节点' : parent.title}」下。` });
  }

  /* ------------------------------------------------------------------------
     刷新与事件
     ------------------------------------------------------------------------ */
  function refresh(options = {}) {
    if (!els.notesApp || els.notesApp.dataset.pane !== 'mindmap') return;
    const source = els.markdownInput ? els.markdownInput.value : '';
    const noteTitle = els.noteTitle ? els.noteTitle.value : '';
    const signature = `${noteTitle}\u0000${source}`;

    if (signature !== state.sourceSignature || !state.tree) {
      state.sourceSignature = signature;
      state.nodeMap = new Map();
      parseOutline(source, noteTitle);
      setStatus();
    }

    if (state.selectedKey && state.nodeMap.has(state.selectedKey)) {
      if (els.mindmapView) els.mindmapView.classList.add('has-selection');
    } else {
      state.selectedKey = '';
      showEmptyDetail();
    }

    renderCanvas({ resetScroll: options.reason === 'pane-shown' || options.reason === 'note-loaded' });
    if (state.selectedKey) {
      const selected = state.nodeMap.get(state.selectedKey);
      renderDetail(selected);
      scrollNodeIntoView(selected);
    }
  }

  function scheduleRefresh() {
    if (!isVisible()) return;
    window.clearTimeout(state.refreshTimer);
    state.refreshTimer = window.setTimeout(() => refresh({ reason: 'typing' }), 220);
  }

  function bindEvents() {
    els.mindmapNodes?.addEventListener('click', (event) => {
      const toggle = event.target.closest('[data-mindmap-toggle]');
      if (toggle) {
        event.preventDefault();
        event.stopPropagation();
        toggleNodeCollapse(toggle.dataset.mindmapToggle);
        return;
      }
      const select = event.target.closest('[data-mindmap-select]');
      if (select) selectNode(select.dataset.mindmapSelect);
    });

    els.mindmapExpandAllBtn?.addEventListener('click', () => setAllCollapsed(false));
    els.mindmapCollapseAllBtn?.addEventListener('click', () => setAllCollapsed(true));
    els.mindmapDetailCloseBtn?.addEventListener('click', closeDetail);
    els.mindmapSaveNodeBtn?.addEventListener('click', renameSelectedNode);
    els.mindmapAddChildBtn?.addEventListener('click', addChildNode);
    els.mindmapDeleteNodeBtn?.addEventListener('click', deleteSelectedNode);
    els.mindmapNodeTitleInput?.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') {
        event.preventDefault();
        renameSelectedNode();
      }
    });

    els.mindmapNodes?.addEventListener('dragstart', (event) => {
      const node = event.target.closest('[data-mindmap-drag="true"]');
      if (!node) return;
      state.dragKey = node.dataset.nodeKey;
      if (event.dataTransfer) {
        event.dataTransfer.effectAllowed = 'move';
        event.dataTransfer.setData('text/plain', state.dragKey);
      }
      node.classList.add('is-dragging');
    });

    els.mindmapNodes?.addEventListener('dragover', (event) => {
      const node = event.target.closest('[data-node-key]');
      if (!node || !state.dragKey) return;
      if (!canDropNode(state.dragKey, node.dataset.nodeKey)) return;
      event.preventDefault();
      if (event.dataTransfer) event.dataTransfer.dropEffect = 'move';
      els.mindmapNodes.querySelectorAll('.is-drop-target').forEach((item) => item.classList.remove('is-drop-target'));
      node.classList.add('is-drop-target');
    });

    els.mindmapNodes?.addEventListener('drop', (event) => {
      const node = event.target.closest('[data-node-key]');
      if (!node || !state.dragKey) return;
      event.preventDefault();
      const dragKey = state.dragKey;
      state.dragKey = '';
      els.mindmapNodes.querySelectorAll('.is-dragging,.is-drop-target').forEach((item) => {
        item.classList.remove('is-dragging', 'is-drop-target');
      });
      dropNode(dragKey, node.dataset.nodeKey);
    });

    els.mindmapNodes?.addEventListener('dragend', () => {
      state.dragKey = '';
      els.mindmapNodes.querySelectorAll('.is-dragging,.is-drop-target').forEach((item) => {
        item.classList.remove('is-dragging', 'is-drop-target');
      });
    });

    // notes.js 已处理输入刷新；这里补上标题变化，确保根节点名称同步。
    els.noteTitle?.addEventListener('input', scheduleRefresh);
  }

  function init() {
    if (state.initialized) return;
    cacheElements();
    if (!els.mindmapView) return;
    state.initialized = true;
    bindEvents();
  }

  window.NotesMindmap = {
    refresh,
    scheduleRefresh,
    closeDetail,
    expandAll: () => setAllCollapsed(false),
    collapseAll: () => setAllCollapsed(true)
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init, { once: true });
  } else {
    init();
  }
})();
