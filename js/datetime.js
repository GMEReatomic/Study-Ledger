/* ==========================================================================
   时间显示 · 模拟指针与数字时钟同步
   ========================================================================== */
(function () {
  'use strict';

  const T = window.Toolbox;
  const els = {};

  function cacheElements() {
    [
      'hourHand', 'minuteHand', 'secondHand', 'clockDate', 'clockWeekday',
      'clockHoursMinutes', 'clockSeconds', 'clockTimezone', 'clockDayOfYear',
      'clockWeekOfYear', 'clockPageNumber'
    ].forEach((id) => {
      els[id] = document.getElementById(id);
    });
  }

  function rotateHand(node, angle) {
    if (node) node.setAttribute('transform', `rotate(${angle} 110 110)`);
  }

  function updateClock() {
    const now = new Date();
    const hours = now.getHours();
    const minutes = now.getMinutes();
    const seconds = now.getSeconds();
    const milliseconds = now.getMilliseconds();

    if (els.clockHoursMinutes) {
      els.clockHoursMinutes.textContent = `${T.pad2(hours)}:${T.pad2(minutes)}`;
    }
    if (els.clockSeconds) {
      els.clockSeconds.textContent = `:${T.pad2(seconds)}`;
    }
    if (els.clockDate) els.clockDate.textContent = T.formatDate(now);
    if (els.clockWeekday) els.clockWeekday.textContent = T.formatWeekday(now);
    if (els.clockDayOfYear) els.clockDayOfYear.textContent = `第 ${T.getDayOfYear(now)} 天`;
    if (els.clockWeekOfYear) els.clockWeekOfYear.textContent = `第 ${T.getWeekNumber(now)} 周`;
    if (els.clockPageNumber) {
      els.clockPageNumber.textContent = String(T.getDayOfYear(now)).padStart(3, '0');
    }
    if (els.clockTimezone) {
      try {
        const zone = Intl.DateTimeFormat().resolvedOptions().timeZone || '本地时区';
        els.clockTimezone.textContent = zone;
      } catch (error) {
        els.clockTimezone.textContent = '本地时区';
      }
    }

    // 秒针带毫秒，秒与秒之间移动更平滑；每秒刷新一次即可。
    const secondAngle = (seconds + milliseconds / 1000) * 6;
    const minuteAngle = minutes * 6 + seconds * 0.1;
    const hourAngle = (hours % 12) * 30 + minutes * 0.5 + seconds / 120;
    rotateHand(els.secondHand, secondAngle);
    rotateHand(els.minuteHand, minuteAngle);
    rotateHand(els.hourHand, hourAngle);
  }

  function init() {
    cacheElements();
    updateClock();
    let timer = 0;
    const tick = () => {
      updateClock();
      // 对齐到下一整秒，避免长时间运行后产生可见漂移。
      const delay = 1000 - (Date.now() % 1000);
      timer = window.setTimeout(tick, delay);
    };
    tick();
    document.addEventListener('visibilitychange', () => {
      if (!document.hidden) updateClock();
    });
    window.addEventListener('pagehide', () => window.clearTimeout(timer), { once: true });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init, { once: true });
  } else {
    init();
  }
})();
