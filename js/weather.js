/* ==========================================================================
   天气页 · Open-Meteo + 浏览器定位 + 城市搜索
   ========================================================================== */
(function () {
  'use strict';

  const T = window.Toolbox;

  const state = {
    place: null,
    weather: null,
    searchResults: [],
    requestId: 0,
    busy: false
  };

  const els = {};

  function cacheElements() {
    [
      'weatherSearchForm', 'cityInput', 'citySearchBtn', 'locateBtn',
      'currentPlaceLabel', 'weatherSearchHint', 'placeResults', 'weatherStatus',
      'weatherStage', 'weatherLoading', 'weatherContent', 'weatherEmpty',
      'weatherEmptyText', 'weatherSymbol', 'weatherPlace', 'weatherPlaceSource',
      'weatherTemperature', 'weatherCondition', 'weatherDaylightTag', 'weatherFeelsTag', 'weatherUpdated',
      'weatherFeelsLike', 'weatherWindSpeed', 'weatherWindDirection',
      'weatherHumidity', 'weatherObservation', 'refreshWeatherBtn',
      'retryWeatherBtn'
    ].forEach((id) => {
      els[id] = document.getElementById(id);
    });
  }

  function setBusy(button, busy, busyLabel = '处理中…') {
    if (!button) return;
    if (busy) {
      if (!button.dataset.idleHtml) button.dataset.idleHtml = button.innerHTML;
      button.disabled = true;
      button.innerHTML = `<span class="spinner" aria-hidden="true"></span>${T.escapeHtml(busyLabel)}`;
    } else {
      button.disabled = false;
      if (button.dataset.idleHtml) {
        button.innerHTML = button.dataset.idleHtml;
        delete button.dataset.idleHtml;
      }
    }
  }

  function setStatus(message, isError = false) {
    if (!els.weatherStatus) return;
    els.weatherStatus.classList.toggle('is-error', Boolean(isError));
    if (!message) {
      els.weatherStatus.hidden = true;
      els.weatherStatus.textContent = '';
      return;
    }
    els.weatherStatus.hidden = false;
    els.weatherStatus.innerHTML = `${T.iconMarkup(isError ? 'alert' : 'cloud-sun')}<span>${T.escapeHtml(message)}</span>`;
  }

  function placeLabel(place) {
    if (!place) return '未知地点';
    if (place.source === 'geolocation') {
      // 定位成功但无法可靠反查城市时，明确显示经纬度，避免只显示“当前位置”四个字。
      const latitude = Number(place.latitude).toFixed(2);
      const longitude = Number(place.longitude).toFixed(2);
      return `当前定位（${latitude}, ${longitude}）`;
    }
    const admin = String(place.admin1 || '').replace(/(省|市|自治区|特别行政区)$/, '');
    if (admin && admin !== place.name && !place.name.startsWith(admin) && !admin.startsWith(place.name)) {
      return `${place.name} · ${admin}`;
    }
    return place.name;
  }

  function shortPlaceLabel(place) {
    if (!place) return '未知地点';
    if (place.source === 'geolocation') return '当前定位';
    const admin = String(place.admin1 || '').replace(/(省|市|自治区|特别行政区)$/, '');
    if (admin && admin !== place.name && !place.name.startsWith(admin) && !admin.startsWith(place.name)) {
      return `${place.name} · ${admin}`;
    }
    return place.name;
  }

  function placeSourceLabel(place) {
    if (!place) return '未知来源';
    if (place.source === 'geolocation') return '浏览器定位';
    if (place.source === 'search') return '手动搜索';
    if (place.source === 'default') return '默认地点';
    return '已保存地点';
  }

  function updatePlaceLabels() {
    const label = placeLabel(state.place);
    const shortLabel = shortPlaceLabel(state.place);
    if (els.currentPlaceLabel) {
      els.currentPlaceLabel.textContent = shortLabel;
      els.currentPlaceLabel.title = label;
    }
    if (els.weatherPlace) {
      els.weatherPlace.textContent = label;
      const details = state.place?.source === 'geolocation'
        ? `纬度 ${Number(state.place.latitude).toFixed(4)}，经度 ${Number(state.place.longitude).toFixed(4)}`
        : [state.place?.admin1, state.place?.country].filter(Boolean).join(' · ');
      els.weatherPlace.title = details || label;
    }
    if (els.weatherPlaceSource) {
      els.weatherPlaceSource.textContent = placeSourceLabel(state.place);
    }
    if (els.weatherSearchHint) {
      if (state.place?.source === 'geolocation') {
        els.weatherSearchHint.textContent = '定位成功 · 可手动搜索更换';
      } else if (state.place?.source === 'search') {
        els.weatherSearchHint.textContent = '手动搜索地点';
      } else {
        els.weatherSearchHint.textContent = '定位被拒绝时仍可手动搜索';
      }
    }
  }

  function showLoading(show) {
    if (els.weatherLoading) els.weatherLoading.hidden = !show;
    if (els.weatherStage) els.weatherStage.setAttribute('aria-busy', String(show));
  }

  function renderWeather(weather) {
    if (!weather) return;
    const temperature = Math.round(Number(weather.temperature));
    const feelsLike = Math.round(Number(weather.apparentTemperature));
    const humidity = Number.isFinite(Number(weather.humidity)) ? Math.round(Number(weather.humidity)) : null;
    const observedTime = String(weather.observedAt || '').match(/T(\d{2}:\d{2})/);

    if (els.weatherSymbol) {
      els.weatherSymbol.innerHTML = T.iconMarkup(weather.icon || 'cloud');
    }
    if (els.weatherTemperature) els.weatherTemperature.textContent = String(temperature);
    if (els.weatherCondition) els.weatherCondition.textContent = weather.weatherLabel || '天气未知';
    if (els.weatherDaylightTag) els.weatherDaylightTag.textContent = weather.isDay ? '白天' : '夜间';
    if (els.weatherFeelsTag) els.weatherFeelsTag.textContent = `体感 ${Number.isFinite(feelsLike) ? feelsLike : '—'}°`;
    if (els.weatherFeelsLike) els.weatherFeelsLike.textContent = Number.isFinite(feelsLike) ? `${feelsLike} °C` : '—';
    if (els.weatherWindSpeed) els.weatherWindSpeed.textContent = `${Math.round(Number(weather.windSpeed) || 0)} km/h`;
    if (els.weatherWindDirection) els.weatherWindDirection.textContent = `${weather.windDirection || '风向未知'} ${weather.windLevel ?? 0}级`;
    if (els.weatherHumidity) els.weatherHumidity.textContent = humidity === null ? '—' : `${humidity}%`;
    if (els.weatherUpdated) {
      els.weatherUpdated.textContent = `页面更新 ${T.formatTime(new Date(), false)}${observedTime ? ` · 观测 ${observedTime[1]}` : ''}`;
    }
    if (els.weatherObservation) {
      els.weatherObservation.textContent = observedTime ? `观测时间 ${observedTime[1]}` : '数据已在浏览器本地更新';
    }
    updatePlaceLabels();
    if (els.weatherContent) els.weatherContent.hidden = false;
    if (els.weatherEmpty) els.weatherEmpty.hidden = true;
    showLoading(false);
  }

  function renderCachedWeather(weather) {
    state.weather = weather;
    renderWeather(weather);
    setStatus('已显示上次缓存，正在获取最新天气…');
  }

  function showWeatherError(message) {
    showLoading(false);
    if (els.weatherContent) els.weatherContent.hidden = true;
    if (els.weatherEmpty) {
      els.weatherEmpty.hidden = false;
      if (els.weatherEmptyText) els.weatherEmptyText.textContent = message || '检查网络连接，或换一个城市试试。';
    }
    setStatus(message, true);
  }

  async function loadWeather(place, options = {}) {
    const requestId = state.requestId + 1;
    state.requestId = requestId;
    const normalized = T.weather.normalizePlace(place);
    if (!normalized) {
      setStatus('地点坐标不合法，请重新搜索城市。', true);
      return null;
    }

    const hasCurrent = state.weather && T.weather.sameCoordinate(state.weather.place, normalized);
    if (!hasCurrent) {
      if (els.weatherContent) els.weatherContent.hidden = true;
      if (els.weatherEmpty) els.weatherEmpty.hidden = true;
      showLoading(true);
      setStatus('正在获取天气…');
    } else {
      setStatus('正在刷新天气…');
    }

    setBusy(els.refreshWeatherBtn, true, '刷新中…');
    try {
      const weather = await T.weather.fetchCurrent(normalized);
      if (requestId !== state.requestId) return null;
      state.place = weather.place;
      state.weather = weather;
      T.weather.cache(weather);
      if (options.save !== false) {
        T.weather.savePlace(weather.place);
      }
      renderWeather(weather);
      setStatus('');
      if (options.toastOnSuccess) {
        T.toast('天气已更新。', { type: 'info', duration: 1600 });
      }
      return weather;
    } catch (error) {
      if (requestId !== state.requestId) return null;
      const message = error.message || '天气获取失败，请稍后重试。';
      if (hasCurrent) {
        // 有缓存时保留上次结果，不让页面变成空白。
        if (els.weatherContent) els.weatherContent.hidden = false;
        setStatus(`更新失败，正在显示上一次结果：${message}`, true);
      } else {
        showWeatherError(message);
      }
      return null;
    } finally {
      if (requestId === state.requestId) {
        showLoading(false);
        setBusy(els.refreshWeatherBtn, false);
      }
    }
  }

  function hidePlaceResults() {
    if (!els.placeResults) return;
    els.placeResults.hidden = true;
    els.placeResults.innerHTML = '';
    state.searchResults = [];
  }

  function renderPlaceResults(results) {
    if (!els.placeResults) return;
    state.searchResults = results;
    els.placeResults.innerHTML = results.map((place, index) => {
      const detail = [place.admin1, place.country].filter(Boolean).join(' · ') || '地点';
      return `
        <button class="place-result" type="button" data-place-index="${index}">
          <span>
            <strong>${T.escapeHtml(place.name)}</strong>
            <span>${T.escapeHtml(detail)}</span>
          </span>
          <svg class="icon" aria-hidden="true"><use href="assets/icons.svg#icon-arrow-right"></use></svg>
        </button>
      `;
    }).join('');
    els.placeResults.hidden = false;
  }

  async function searchCity(event) {
    event?.preventDefault();
    const query = String(els.cityInput?.value || '').trim();
    hidePlaceResults();
    if (!query) {
      setStatus('先输入一个城市名，再按查找。', true);
      els.cityInput?.focus();
      return;
    }

    setBusy(els.citySearchBtn, true, '查找中…');
    setStatus(`正在查找「${query}」…`);
    try {
      const results = await T.weather.searchPlaces(query);
      if (!results.length) {
        setStatus(`没有找到「${query}」对应的城市，试试更完整的名称。`, true);
        return;
      }
      if (results.length === 1) {
        await choosePlace(results[0]);
      } else {
        renderPlaceResults(results);
        setStatus(`找到 ${results.length} 个地点，请选择一个。`);
      }
    } catch (error) {
      setStatus(error.message || '城市搜索失败，请检查网络后重试。', true);
    } finally {
      setBusy(els.citySearchBtn, false);
    }
  }

  async function choosePlace(place) {
    hidePlaceResults();
    if (els.cityInput) els.cityInput.value = '';
    setStatus('正在获取该地点的天气…');
    const weather = await loadWeather(place, { save: true });
    if (weather) {
      T.toast(`已切换到 ${placeLabel(weather.place)}。`, { type: 'success', duration: 1800 });
      setStatus('');
    }
  }

  async function locateMe() {
    setBusy(els.locateBtn, true, '定位中…');
    setStatus('正在请求定位权限…');
    try {
      const position = await T.weather.getBrowserPosition();
      const place = T.weather.normalizePlace({
        name: '当前位置',
        latitude: position.latitude,
        longitude: position.longitude,
        source: 'geolocation',
        timezone: ''
      });
      if (!place) throw new Error('定位坐标不合法');
      setStatus('已获取位置，正在读取天气…');
      const weather = await loadWeather(place, { save: true });
      if (weather) {
        T.toast(`已切换到${placeLabel(weather.place)}。`, { type: 'success', duration: 2200 });
        setStatus('');
      }
    } catch (error) {
      setStatus(T.weather.geolocationErrorMessage(error), true);
      if (els.cityInput) els.cityInput.focus();
    } finally {
      setBusy(els.locateBtn, false);
    }
  }

  function bindEvents() {
    els.weatherSearchForm?.addEventListener('submit', searchCity);
    els.locateBtn?.addEventListener('click', locateMe);
    els.refreshWeatherBtn?.addEventListener('click', async () => {
      const weather = await loadWeather(state.place, { save: false, toastOnSuccess: true });
      if (!weather) T.toast('刷新失败，使用当前页面上一次的结果。', { type: 'error' });
    });
    els.retryWeatherBtn?.addEventListener('click', async () => {
      const weather = await loadWeather(state.place, { save: false });
      if (!weather) T.toast('仍未能获取天气，请检查网络。', { type: 'error' });
    });
    els.placeResults?.addEventListener('click', (event) => {
      const button = event.target.closest('[data-place-index]');
      if (!button) return;
      const place = state.searchResults[Number(button.dataset.placeIndex)];
      if (place) choosePlace(place);
    });
    els.cityInput?.addEventListener('keydown', (event) => {
      if (event.key === 'Escape') hidePlaceResults();
    });
    document.addEventListener('click', (event) => {
      if (!els.placeResults || els.placeResults.hidden) return;
      if (els.placeResults.contains(event.target) || els.weatherSearchForm?.contains(event.target)) return;
      hidePlaceResults();
    });
  }

  async function init() {
    cacheElements();
    bindEvents();
    state.place = T.weather.getSavedPlace();
    updatePlaceLabels();

    const cache = T.weather.getCache();
    if (cache && T.weather.sameCoordinate(cache.data.place, state.place)) {
      state.weather = cache.data;
      renderCachedWeather(cache.data);
    }

    await loadWeather(state.place, { save: false });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init, { once: true });
  } else {
    init();
  }
})();
