/* ==========================================================================
   随机站点 · 从学习 / 开发站点中抽取一个目的地
   ========================================================================== */
(function () {
  'use strict';

  const T = window.Toolbox;

  const SITES = [
    { name: 'OI Wiki', url: 'https://oi-wiki.org/', description: '算法竞赛与计算机科学的知识库，适合从复杂度、图论一路翻到数据结构。' },
    { name: 'Hello 算法', url: 'https://www.hello-algo.com/', description: '用动画和图解讲数据结构与算法，适合把抽象概念重新看一遍。' },
    { name: 'CS 自学指南', url: 'https://csdiy.wiki/', description: '一份计算机课程与自学路线索引，适合想系统补课的时候。' },
    { name: 'MDN Web Docs', url: 'https://developer.mozilla.org/zh-CN/', description: 'Web 平台最可靠的中文参考之一，查 API 与浏览器行为时很好用。' },
    { name: 'VisuAlgo', url: 'https://visualgo.net/zh', description: '把排序、图、树等算法动起来看，适合验证自己的理解。' },
    { name: '代码随想录', url: 'https://programmercarl.com/', description: '成体系的算法题解与刷题路线，适合按专题慢慢推进。' },
    { name: 'LeetCode 中文站', url: 'https://leetcode.cn/', description: '从每日一题开始，把今天想到的解法真正写出来。' },
    { name: '洛谷', url: 'https://www.luogu.com.cn/', description: '中文算法竞赛题库与讨论区，适合找题、看题解、练手感。' },
    { name: 'Codeforces', url: 'https://codeforces.com/', description: '国际算法竞赛平台，适合挑战限时思维与实现。' },
    { name: 'AtCoder', url: 'https://atcoder.jp/', description: '题目质量稳定的竞赛平台，可以从入门赛开始。' },
    { name: 'Project Euler', url: 'https://projecteuler.net/', description: '用编程解决数学问题，适合在纸上推完之后再写代码。' },
    { name: 'Desmos', url: 'https://www.desmos.com/calculator', description: '在线函数图像工具，适合把公式和曲线放在一起看。' },
    { name: 'WolframAlpha', url: 'https://www.wolframalpha.com/', description: '计算与知识搜索引擎，适合验证积分、方程和数值结果。' },
    { name: '阮一峰 ES6 教程', url: 'https://es6.ruanyifeng.com/', description: '中文 JavaScript 语法参考，适合系统回顾现代 JS。' },
    { name: 'Roadmap.sh', url: 'https://roadmap.sh/', description: '开发者学习路线图，适合看看下一段路还可以补什么。' },
    { name: 'CSS-Tricks', url: 'https://css-tricks.com/', description: 'CSS 技巧和属性解释，适合把手账页面再打磨一点。' },
    { name: '中国大学 MOOC', url: 'https://www.icourse163.org/', description: '国内高校课程平台，适合找一门课从头跟一遍。' },
    { name: '30 seconds of code', url: 'https://www.30secondsofcode.org/', description: '短小的代码片段与思路，适合在碎片时间补充工具库。' }
  ];

  const state = {
    drawing: false,
    countdownTimer: 0,
    spinTimer: 0,
    target: null,
    seconds: 0
  };

  const els = {};

  function cacheElements() {
    [
      'randomStatus', 'randomSiteCount', 'randomResult', 'randomName',
      'randomDescription', 'randomUrl', 'randomCountdown', 'randomCountdownText',
      'cancelJumpBtn', 'drawBtn', 'drawBtnLabel'
    ].forEach((id) => {
      els[id] = document.getElementById(id);
    });
  }

  function secureRandomIndex(length) {
    if (length <= 0) return 0;
    try {
      if (T.crypto.available()) return T.crypto.randomInt(length);
    } catch (error) {
      // 极少数浏览器在非安全上下文中没有随机源，退回 Math.random。
    }
    return Math.floor(Math.random() * length);
  }

  function chooseIndex() {
    let last = null;
    try {
      last = Number(T.storageGetJSON(T.STORAGE_KEYS.randomLast, null));
    } catch (error) {
      last = null;
    }
    let index = secureRandomIndex(SITES.length);
    if (SITES.length > 1 && index === last) {
      index = (index + 1 + secureRandomIndex(SITES.length - 1)) % SITES.length;
    }
    return index;
  }

  function setDrawing(drawing) {
    state.drawing = drawing;
    if (els.drawBtn) els.drawBtn.disabled = drawing;
    if (els.randomResult) els.randomResult.classList.toggle('is-drawing', drawing);
  }

  function cancelCountdown() {
    window.clearInterval(state.countdownTimer);
    state.countdownTimer = 0;
    if (els.randomCountdown) els.randomCountdown.hidden = true;
  }

  function resetCountdownUI() {
    cancelCountdown();
    if (els.drawBtnLabel) els.drawBtnLabel.textContent = '抽一个站点';
  }

  function renderResult(site) {
    if (els.randomName) els.randomName.textContent = site.name;
    if (els.randomDescription) els.randomDescription.textContent = site.description;
    if (els.randomUrl) els.randomUrl.textContent = site.url;
  }

  function startCountdown(site) {
    cancelCountdown();
    state.target = site;
    state.seconds = 3;
    if (els.randomCountdown) els.randomCountdown.hidden = false;
    if (els.randomCountdownText) els.randomCountdownText.textContent = `${state.seconds} 秒后离开本页`;
    if (els.drawBtnLabel) els.drawBtnLabel.textContent = '再抽一个';

    state.countdownTimer = window.setInterval(() => {
      state.seconds -= 1;
      if (state.seconds <= 0) {
        window.clearInterval(state.countdownTimer);
        state.countdownTimer = 0;
        if (els.randomCountdownText) els.randomCountdownText.textContent = '正在打开…';
        // 使用同一标签页，符合“随机跳转”的行为。
        window.location.assign(site.url);
        return;
      }
      if (els.randomCountdownText) els.randomCountdownText.textContent = `${state.seconds} 秒后离开本页`;
    }, 1000);
  }

  function drawSite() {
    cancelCountdown();
    if (state.drawing) return;
    setDrawing(true);
    if (els.drawBtnLabel) els.drawBtnLabel.textContent = '摇签中…';
    if (els.randomStatus) els.randomStatus.textContent = '正在摇签 · 听纸页翻动的声音';
    if (els.randomUrl) els.randomUrl.textContent = '';

    let ticks = 0;
    const previewSites = [];
    state.spinTimer = window.setInterval(() => {
      const index = secureRandomIndex(SITES.length);
      previewSites.push(SITES[index].name);
      if (els.randomName) els.randomName.textContent = SITES[index].name;
      if (els.randomDescription) els.randomDescription.textContent = '正在从签筒里拿出一页…';
      ticks += 1;
      if (ticks > 20) {
        window.clearInterval(state.spinTimer);
        state.spinTimer = 0;
      }
    }, 65);

    window.setTimeout(() => {
      window.clearInterval(state.spinTimer);
      state.spinTimer = 0;
      const index = chooseIndex();
      const site = SITES[index];
      state.target = site;
      setDrawing(false);
      renderResult(site);
      T.storageSetJSON(T.STORAGE_KEYS.randomLast, index);
      if (els.randomStatus) {
        els.randomStatus.textContent = `抽到「${site.name}」 · 共 ${SITES.length} 个站点`;
      }
      if (els.drawBtnLabel) els.drawBtnLabel.textContent = '再抽一个';
      startCountdown(site);
      T.toast(`抽到「${site.name}」，3 秒后前往。`, { type: 'info', duration: 2200 });
    }, 1050);
  }

  function cancelJump() {
    if (!state.target) return;
    cancelCountdown();
    if (els.randomStatus) els.randomStatus.textContent = `已停在这里 · 「${state.target.name}」`;
    if (els.drawBtnLabel) els.drawBtnLabel.textContent = '再抽一个';
    T.toast('已取消跳转，你可以继续留在这页。', { type: 'info', duration: 1800 });
  }

  function init() {
    cacheElements();
    if (els.randomSiteCount) els.randomSiteCount.textContent = String(SITES.length);
    els.drawBtn?.addEventListener('click', drawSite);
    els.cancelJumpBtn?.addEventListener('click', cancelJump);
    window.addEventListener('pagehide', () => {
      window.clearInterval(state.countdownTimer);
      window.clearInterval(state.spinTimer);
    }, { once: true });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init, { once: true });
  } else {
    init();
  }
})();
