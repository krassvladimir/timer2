(function () {
  'use strict';

  var VERSION = '6.2.6';
  var BUILD_DATE = '2026-08-02';
  var NIGHTLY_RELOAD_HOUR = 3;
  var NIGHTLY_RELOAD_MINUTE = 5;
  var SLOT_MINUTES = 75;
  var SLOT_SECONDS = SLOT_MINUTES * 60;
  var OPEN_MINUTES = 4 * 60;
  var CLOSE_MINUTES = 24 * 60;
  var INTERNET_SYNC_INTERVAL = 60 * 60 * 1000;
  var INTERNET_SYNC_TIMEOUT = 10000;
  var WEATHER_INTERVAL = 10 * 60 * 1000;
  var WEATHER_RETRY_INTERVAL = 30 * 1000;
  var WEATHER_STALE_AFTER = 15 * 60 * 1000;
  var WEATHER_URL = 'https://api.open-meteo.com/v1/forecast?latitude=49.2032&longitude=16.5943&current=temperature_2m,weather_code,is_day&hourly=temperature_2m,weather_code,is_day,precipitation_probability&forecast_days=2&timezone=Europe%2FPrague';

  var slots = [];
  var i;
  for (i = 0; i < 16; i++) {
    slots.push({
      index: i,
      start: OPEN_MINUTES + i * SLOT_MINUTES,
      end: OPEN_MINUTES + (i + 1) * SLOT_MINUTES
    });
  }

  var el = {
    app: document.getElementById('app'),
    logo: document.getElementById('logo'),
    clock: document.getElementById('clock'),
    weatherIcon: document.getElementById('weather-icon'),
    weatherTemp: document.getElementById('weather-temp'),
    weatherDesc: document.getElementById('weather-desc'),
    weatherEnd: document.getElementById('weather-end'),
    overlayWeatherIcon: document.getElementById('overlay-weather-icon'),
    overlayWeatherTemp: document.getElementById('overlay-weather-temp'),
    overlayWeatherDesc: document.getElementById('overlay-weather-desc'),
    overlayClock: document.getElementById('overlay-clock'),
    active: document.getElementById('screen-active'),
    night: document.getElementById('screen-night'),
    between: document.getElementById('screen-between'),
    slotLabel: document.getElementById('slot-label'),
    countdown: document.getElementById('countdown'),
    endTime: document.getElementById('end-time'),
    warn10: document.getElementById('warn10'),
    exitBox: document.getElementById('exit-box'),
    lastMinute: document.getElementById('last-minute'),
    nextStart: document.getElementById('next-start'),
    nextCountdown: document.getElementById('next-countdown'),
    progress: document.getElementById('progress'),
    endedOverlay: document.getElementById('ended-overlay'),
    service: document.getElementById('service-menu'),
    closeService: document.getElementById('close-service'),
    testSound: document.getElementById('test-sound'),
    testNormal: document.getElementById('test-normal'),
    test10: document.getElementById('test-10'),
    test5: document.getElementById('test-5'),
    test1: document.getElementById('test-1'),
    testLast10: document.getElementById('test-last10'),
    testEnded: document.getElementById('test-ended'),
    testNight: document.getElementById('test-night'),
    diagSlot: document.getElementById('diag-slot'),
    diagRemaining: document.getElementById('diag-remaining'),
    diagAudio: document.getElementById('diag-audio'),
    diagOnline: document.getElementById('diag-online'),
    diagWake: document.getElementById('diag-wake'),
    diagSync: document.getElementById('diag-sync'),
    diagWeather: document.getElementById('diag-weather'),
    diagWatchdog: document.getElementById('diag-watchdog'),
    restartApp: document.getElementById('restart-app')
  };

  var state = {
    initialized: false,
    currentSlotId: null,
    previousRemaining: null,
    previousNow: null,
    overlayUntil: 0,
    warningKeys: {},
    logoTapCount: 0,
    lastLogoTap: 0,
    serviceTimer: null,
    wakeLock: null,
    audioContext: null,
    lastAudioError: '',
    previewMode: null,
    previewUntil: 0,
    previewHint: null,
    lastSecondBeepKey: null,
    lastTickWallTime: 0,
    lastTickRawTime: 0,
    lastSyncTime: 0,
    lastNightlyReloadKey: '',
    watchdogHealthy: true,
    clockOffsetMs: 0,
    lastInternetSync: 0,
    internetSyncStatus: 'čekám',
    weatherStatus: 'čekám',
    lastWeatherUpdate: 0,
    weatherRequestRunning: false,
    weatherRetryTimer: null,
    hourlyWeather: null
  };

  function pad(n) {
    return n < 10 ? '0' + n : '' + n;
  }

  function adjustedNowMs() {
    // v6.2.4: odpočet vždy vychází přímo z aktuálního systémového času tabletu.
    // Nepoužíváme síťový offset, který na některých starších Androidech posouval čas.
    return Date.now();
  }

  function adjustedNow() {
    return new Date(adjustedNowMs());
  }

  function syncInternetTime(callback) {
    if (!navigator.onLine) {
      state.internetSyncStatus = 'offline';
      if (callback) callback(false);
      return;
    }

    var xhr;
    try {
      xhr = new XMLHttpRequest();
    } catch (e) {
      state.internetSyncStatus = 'nepodporováno';
      if (callback) callback(false);
      return;
    }

    var started = new Date().getTime();
    var done = false;
    var timeoutId = window.setTimeout(function () {
      if (done) return;
      done = true;
      try { xhr.abort(); } catch (e) {}
      state.internetSyncStatus = 'timeout';
      if (callback) callback(false);
    }, INTERNET_SYNC_TIMEOUT);

    xhr.onreadystatechange = function () {
      if (xhr.readyState !== 4 || done) return;
      done = true;
      window.clearTimeout(timeoutId);

      var finished = new Date().getTime();
      var dateHeader = null;
      try { dateHeader = xhr.getResponseHeader('Date'); } catch (e) {}
      var serverMs = dateHeader ? Date.parse(dateHeader) : NaN;

      if (xhr.status >= 200 && xhr.status < 400 && !isNaN(serverMs)) {
        var midpoint = started + Math.floor((finished - started) / 2);
        var newOffset = serverMs - midpoint;
        if (Math.abs(newOffset) < 5 * 60 * 1000) {
          state.clockOffsetMs = 0;
          state.lastInternetSync = finished;
          state.internetSyncStatus = 'OK (čas zařízení)';
          state.previousNow = null;
          tick();
          if (callback) callback(true);
          return;
        }
      }

      state.internetSyncStatus = 'chyba';
      if (callback) callback(false);
    };

    try {
      var separator = window.location.href.indexOf('?') === -1 ? '?' : '&';
      xhr.open('GET', window.location.href + separator + '_timesync=' + started, true);
      xhr.setRequestHeader('Cache-Control', 'no-cache');
      xhr.send(null);
    } catch (e) {
      done = true;
      window.clearTimeout(timeoutId);
      state.internetSyncStatus = 'chyba';
      if (callback) callback(false);
    }
  }


  function weatherDescription(code) {
    if (code === 0) return 'Jasno';
    if (code === 1) return 'Převážně jasno';
    if (code === 2) return 'Polojasno';
    if (code === 3) return 'Zataženo';
    if (code === 45 || code === 48) return 'Mlha';
    if (code >= 51 && code <= 57) return 'Mrholení';
    if (code >= 61 && code <= 67) return 'Déšť';
    if (code >= 71 && code <= 77) return 'Sněžení';
    if (code >= 80 && code <= 82) return 'Přeháňky';
    if (code >= 85 && code <= 86) return 'Sněhové přeháňky';
    if (code >= 95) return 'Bouřky';
    return 'Aktuální počasí';
  }

  function weatherSymbol(code, isDay) {
    var sun = '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="4"></circle><path d="M12 2v2M12 20v2M4.93 4.93l1.42 1.42M17.65 17.65l1.42 1.42M2 12h2M20 12h2M4.93 19.07l1.42-1.42M17.65 6.35l1.42-1.42"></path></svg>';
    var moon = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M20.2 15.3A8.5 8.5 0 0 1 8.7 3.8 8.5 8.5 0 1 0 20.2 15.3z"></path></svg>';
    var cloud = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 18h10a4 4 0 0 0 .5-7.97A6 6 0 0 0 6.2 8.4 4.8 4.8 0 0 0 7 18z"></path></svg>';
    var partly = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 5V3M3.8 6.8 2.4 5.4M12.2 6.8l1.4-1.4M4.5 11H2.5"></path><circle cx="8" cy="9" r="3"></circle><path d="M8 18h9a4 4 0 0 0 .4-7.98A5.5 5.5 0 0 0 7 11.4 3.8 3.8 0 0 0 8 18z"></path></svg>';
    var rain = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 15h10a4 4 0 0 0 .5-7.97A6 6 0 0 0 6.2 5.4 4.8 4.8 0 0 0 7 15z"></path><path d="M8 18l-1 2M12 18l-1 2M16 18l-1 2"></path></svg>';
    var snow = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 14h10a4 4 0 0 0 .5-7.97A6 6 0 0 0 6.2 4.4 4.8 4.8 0 0 0 7 14z"></path><path d="M8 18h.01M12 20h.01M16 18h.01"></path></svg>';
    var fog = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 8h16M6 12h12M4 16h16"></path></svg>';
    var storm = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 14h10a4 4 0 0 0 .5-7.97A6 6 0 0 0 6.2 4.4 4.8 4.8 0 0 0 7 14z"></path><path d="M13 15l-3 4h3l-2 3"></path></svg>';
    if (code === 0) return isDay ? sun : moon;
    if (code === 1 || code === 2) return partly;
    if (code === 3) return cloud;
    if (code === 45 || code === 48) return fog;
    if ((code >= 51 && code <= 67) || (code >= 80 && code <= 82)) return rain;
    if ((code >= 71 && code <= 77) || (code >= 85 && code <= 86)) return snow;
    if (code >= 95) return storm;
    return cloud;
  }

  function renderWeather(data, fromCache) {
    if (!data || typeof data.temperature !== 'number') return;
    el.weatherTemp.textContent = Math.round(data.temperature) + ' °C';
    el.weatherDesc.innerHTML = '';
    el.weatherIcon.innerHTML = weatherSymbol(data.code, data.isDay !== 0);
    if (el.overlayWeatherTemp) el.overlayWeatherTemp.textContent = Math.round(data.temperature) + ' °C';
    if (el.overlayWeatherDesc) el.overlayWeatherDesc.innerHTML = '';
    if (el.overlayWeatherIcon) el.overlayWeatherIcon.innerHTML = weatherSymbol(data.code, data.isDay !== 0);
    state.weatherStatus = (fromCache ? 'uloženo' : 'online') + ' · Brno · ' + weatherDescription(data.code) + ' · ' + Math.round(data.temperature) + ' °C';
    if (el.diagWeather) el.diagWeather.textContent = state.weatherStatus;
  }

  function parseLocalForecastTime(value) {
    if (!value || typeof value !== 'string') return NaN;
    var parts = value.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/);
    if (!parts) return NaN;
    return new Date(Number(parts[1]), Number(parts[2]) - 1, Number(parts[3]), Number(parts[4]), Number(parts[5]), 0, 0).getTime();
  }

  function forecastForTime(targetMs) {
    var h = state.hourlyWeather;
    if (!h || !h.time || !h.time.length) return null;
    var best = -1;
    var bestDiff = Infinity;
    var i;
    for (i = 0; i < h.time.length; i++) {
      var timeMs = parseLocalForecastTime(h.time[i]);
      if (!isFinite(timeMs)) continue;
      var diff = Math.abs(timeMs - targetMs);
      if (diff < bestDiff) {
        bestDiff = diff;
        best = i;
      }
    }
    if (best < 0) return null;
    var temperature = Number(h.temperature_2m && h.temperature_2m[best]);
    var code = Number(h.weather_code && h.weather_code[best]);
    var isDay = Number(h.is_day && h.is_day[best]);
    var precipitation = Number(h.precipitation_probability && h.precipitation_probability[best]);
    if (!isFinite(temperature) || !isFinite(code)) return null;
    return {
      temperature: temperature,
      code: code,
      isDay: isDay,
      precipitation: isFinite(precipitation) ? precipitation : null
    };
  }

  function updateEndWeather(now, ctx) {
    if (!el.weatherEnd) return;

    /* Posledních 10 minut už předpověď na konec nemá praktický význam. */
    if (!ctx || ctx.kind !== 'active' || !state.hourlyWeather || ctx.remaining <= 10 * 60) {
      el.weatherEnd.className = 'weather-end hidden';
      el.weatherEnd.innerHTML = '';
      return;
    }

    var targetMs = now.getTime() + ctx.remaining * 1000;
    var forecast = forecastForTime(targetMs);
    if (!forecast) {
      el.weatherEnd.className = 'weather-end hidden';
      el.weatherEnd.innerHTML = '';
      return;
    }

    var rain = '';
    if (forecast.precipitation !== null && forecast.precipitation >= 30) {
      rain = ' · ' + Math.round(forecast.precipitation) + ' %';
    }

    el.weatherEnd.className = 'weather-end';
    el.weatherEnd.innerHTML = '<span>↗ ' + ctx.endLabel + '</span> ' + Math.round(forecast.temperature) + ' °C' + rain;
  }

  function hidePublicWeather() {
    if (document.body) document.body.classList.add('weather-unavailable');
  }

  function showPublicWeather() {
    if (document.body) document.body.classList.remove('weather-unavailable');
  }

  function clearStoredWeather() {
    try { localStorage.removeItem('justyou_weather'); } catch (e) {}
  }

  function scheduleWeatherRetry() {
    if (state.weatherRetryTimer) return;
    state.weatherRetryTimer = setTimeout(function () {
      state.weatherRetryTimer = null;
      updateWeather();
    }, WEATHER_RETRY_INTERVAL);
  }

  function parseWeatherResponse(json) {
    if (!json || !json.current) throw new Error('bez dat');
    var temperature = Number(json.current.temperature_2m);
    var code = Number(json.current.weather_code);
    var isDay = Number(json.current.is_day);
    if (!isFinite(temperature) || !isFinite(code)) throw new Error('neplatná data');
    return {
      temperature: temperature,
      code: code,
      isDay: isDay,
      hourly: json.hourly || null
    };
  }

  function requestWeatherWithXHR(url) {
    return new Promise(function (resolve, reject) {
      try {
        var xhr = new XMLHttpRequest();
        xhr.open('GET', url, true);
        xhr.timeout = 15000;
        xhr.setRequestHeader('Accept', 'application/json');
        xhr.onreadystatechange = function () {
          if (xhr.readyState !== 4) return;
          if (xhr.status >= 200 && xhr.status < 300) {
            try { resolve(JSON.parse(xhr.responseText)); }
            catch (e) { reject(e); }
          } else {
            reject(new Error('XHR HTTP ' + xhr.status));
          }
        };
        xhr.onerror = function () { reject(new Error('XHR síťová chyba')); };
        xhr.ontimeout = function () { reject(new Error('XHR timeout')); };
        xhr.send();
      } catch (e) { reject(e); }
    });
  }

  function requestWeather(url) {
    if (window.fetch) {
      return fetch(url, { cache: 'no-store', headers: { 'Accept': 'application/json' } })
        .then(function (response) {
          if (!response.ok) throw new Error('HTTP ' + response.status);
          return response.json();
        })
        .catch(function () {
          return requestWeatherWithXHR(url);
        });
    }
    return requestWeatherWithXHR(url);
  }

  function updateWeather() {
    if (state.weatherRequestRunning) return;

    clearStoredWeather();

    if (!navigator.onLine) {
      hidePublicWeather();
      state.weatherStatus = 'offline · další pokus automaticky';
      if (el.diagWeather) el.diagWeather.textContent = state.weatherStatus;
      scheduleWeatherRetry();
      return;
    }

    state.weatherRequestRunning = true;
    var url = WEATHER_URL + '&_=' + new Date().getTime();

    requestWeather(url)
      .then(function (json) {
        var data = parseWeatherResponse(json);
        state.lastWeatherUpdate = new Date().getTime();
        state.hourlyWeather = data.hourly;
        if (state.weatherRetryTimer) {
          clearTimeout(state.weatherRetryTimer);
          state.weatherRetryTimer = null;
        }
        renderWeather(data, false);
        showPublicWeather();
      })
      .catch(function (error) {
        hidePublicWeather();
        state.weatherStatus = 'nedostupné · další pokus automaticky';
        if (el.diagWeather) el.diagWeather.textContent = state.weatherStatus;
        scheduleWeatherRetry();
      })
      .then(function () {
        state.weatherRequestRunning = false;
      });
  }

  function weatherWatchdog() {
    var now = new Date().getTime();
    if (!state.lastWeatherUpdate || now - state.lastWeatherUpdate > WEATHER_STALE_AFTER) {
      updateWeather();
    }
  }

  function formatClock(d) {
    return pad(d.getHours()) + ':' + pad(d.getMinutes()) + ':' + pad(d.getSeconds());
  }

  function formatDuration(seconds) {
    if (seconds < 0) seconds = 0;
    seconds = Math.floor(seconds);
    var minutes = Math.floor(seconds / 60);
    var secs = seconds % 60;
    return pad(minutes) + ':' + pad(secs);
  }

  function formatActiveRemaining(seconds) {
    if (seconds < 0) seconds = 0;
    seconds = Math.floor(seconds);
    var minutes = Math.floor(seconds / 60);
    var secs = seconds % 60;
    var separator = ':';
    return pad(minutes) + separator + pad(secs);
  }

  function formatMinutes(total) {
    var dayMinutes = total;
    if (dayMinutes >= 1440) dayMinutes -= 1440;
    return pad(Math.floor(dayMinutes / 60)) + ':' + pad(dayMinutes % 60);
  }

  function dayKey(d) {
    return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
  }

  function getContext(now) {
    // Výpočet je vždy od nuly z aktuálního času; nic se neobnovuje z paměti.
    var secondsNow = now.getHours() * 3600 + now.getMinutes() * 60 + now.getSeconds() + now.getMilliseconds() / 1000;
    var openSeconds = OPEN_MINUTES * 60;
    var closeSeconds = CLOSE_MINUTES * 60;

    if (secondsNow < openSeconds) {
      return {
        kind: 'night',
        nextStart: OPEN_MINUTES,
        secondsUntilNext: Math.max(0, Math.ceil(openSeconds - secondsNow))
      };
    }

    if (secondsNow >= openSeconds && secondsNow < closeSeconds) {
      var elapsedFromOpen = secondsNow - openSeconds;
      var idx = Math.floor(elapsedFromOpen / SLOT_SECONDS);
      if (idx >= 0 && idx < slots.length) {
        var slotStartSeconds = openSeconds + idx * SLOT_SECONDS;
        var slotEndSeconds = slotStartSeconds + SLOT_SECONDS;
        return {
          kind: 'active',
          index: idx,
          slot: slots[idx],
          slotId: dayKey(now) + '-' + idx,
          startLabel: formatMinutes(slots[idx].start),
          endLabel: formatMinutes(slots[idx].end),
          remaining: Math.max(0, Math.ceil(slotEndSeconds - secondsNow))
        };
      }
    }

    return {
      kind: 'night',
      nextStart: OPEN_MINUTES,
      secondsUntilNext: Math.max(0, Math.ceil((24 * 3600 - secondsNow) + openSeconds))
    };
  }

  function hideAllScreens() {
    el.active.className = 'screen hidden';
    el.night.className = 'screen hidden';
    el.between.className = 'screen hidden';
  }

  function warningState(remaining) {
    if (remaining <= 60) return 'warn1';
    if (remaining <= 300) return 'warn5';
    if (remaining <= 600) return 'warn10';
    return 'normal';
  }

  function render(now, ctx) {
    el.clock.innerHTML = formatClock(now);
    if (el.overlayClock) el.overlayClock.textContent = formatClock(now);
    el.app.className = 'app';
    hideAllScreens();

    if (ctx.kind === 'night') {
      el.night.className = 'screen';
      el.nextCountdown.innerHTML = formatDuration(ctx.secondsUntilNext);
      el.progress.style.width = '0%';
      el.diagSlot.innerHTML = 'Noční režim';
      el.diagRemaining.innerHTML = formatDuration(ctx.secondsUntilNext);
      return;
    }

    el.active.className = 'screen active-screen';
    el.slotLabel.innerHTML = 'REZERVACE ' + ctx.startLabel + ' – ' + ctx.endLabel;
    el.countdown.textContent = formatActiveRemaining(ctx.remaining);
    if (el.endTime) el.endTime.innerHTML = ctx.endLabel;

    var ws = warningState(ctx.remaining);
    el.warn10.className = 'warn10 hidden';
    el.exitBox.className = 'exit-box hidden';
    el.lastMinute.className = 'last-minute hidden';

    if (ws === 'warn10') {
      el.app.className = 'app state-warn10';
      el.warn10.className = 'warn10';
      el.exitBox.className = 'exit-box';
    } else if (ws === 'warn5') {
      el.app.className = 'app state-warn5';
      el.exitBox.className = 'exit-box';
    } else if (ws === 'warn1') {
      el.app.className = ctx.remaining <= 10 ? 'app state-warn1 state-last10' : 'app state-warn1';
      el.exitBox.className = 'exit-box';
      el.lastMinute.className = 'last-minute';
    }

    var elapsed = SLOT_SECONDS - ctx.remaining;
    var pct = Math.max(0, Math.min(100, (elapsed / SLOT_SECONDS) * 100));
    el.progress.style.width = pct + '%';

    el.diagSlot.innerHTML = ctx.startLabel + '–' + ctx.endLabel;
    el.diagRemaining.innerHTML = formatDuration(ctx.remaining);
  }

  function getAudioContext() {
    var AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return null;
    if (!state.audioContext) {
      try {
        state.audioContext = new AC();
      } catch (e) {
        state.lastAudioError = String(e);
      }
    }
    return state.audioContext;
  }

  function playGong(options) {
    var ac = getAudioContext();
    if (!ac) {
      el.diagAudio.innerHTML = 'nepodporován';
      return;
    }

    options = options || {};
    var repeats = options.repeats || 1;
    var gap = options.gap || 0.72;
    var base = options.base || 392;
    var duration = options.duration || 1.55;
    var level = options.level || 0.98;

    try {
      if (ac.state === 'suspended' && ac.resume) ac.resume();

      var compressor = ac.createDynamicsCompressor();
      compressor.threshold.value = -34;
      compressor.knee.value = 10;
      compressor.ratio.value = 12;
      compressor.attack.value = 0.002;
      compressor.release.value = 0.24;
      compressor.connect(ac.destination);

      var master = ac.createGain();
      master.gain.value = 1.80;
      master.connect(compressor);

      var r, p;
      for (r = 0; r < repeats; r++) {
        var startAt = ac.currentTime + 0.04 + r * (duration + gap);
        var partials = [
          { ratio: 1.00, gain: 1.00, decay: 1.00 },
          { ratio: 1.50, gain: 0.34, decay: 0.86 },
          { ratio: 2.01, gain: 0.52, decay: 0.78 },
          { ratio: 2.72, gain: 0.30, decay: 0.62 },
          { ratio: 3.98, gain: 0.16, decay: 0.48 },
          { ratio: 5.12, gain: 0.08, decay: 0.36 }
        ];

        for (p = 0; p < partials.length; p++) {
          var part = partials[p];
          var osc = ac.createOscillator();
          var gain = ac.createGain();
          osc.type = 'sine';
          osc.frequency.setValueAtTime(base * part.ratio, startAt);
          osc.frequency.exponentialRampToValueAtTime(
            Math.max(40, base * part.ratio * 0.992),
            startAt + duration
          );

          gain.gain.setValueAtTime(0.0001, startAt);
          gain.gain.exponentialRampToValueAtTime(
            Math.max(0.0002, level * part.gain),
            startAt + 0.012
          );
          gain.gain.exponentialRampToValueAtTime(
            0.0001,
            startAt + duration * part.decay
          );

          osc.connect(gain);
          gain.connect(master);
          osc.start(startAt);
          osc.stop(startAt + duration + 0.08);
        }
      }

      el.diagAudio.innerHTML = ac.state || 'aktivní';
    } catch (e) {
      state.lastAudioError = String(e);
      el.diagAudio.innerHTML = 'blokován';
    }
  }

  function playTick() {
    var ac = getAudioContext();
    if (!ac) return;
    try {
      if (ac.state === 'suspended' && ac.resume) ac.resume();
      var osc = ac.createOscillator();
      var gain = ac.createGain();
      osc.type = 'sine';
      osc.frequency.value = 1180;
      gain.gain.setValueAtTime(0.0001, ac.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.72, ac.currentTime + 0.006);
      gain.gain.exponentialRampToValueAtTime(0.0001, ac.currentTime + 0.11);
      osc.connect(gain);
      gain.connect(ac.destination);
      osc.start();
      osc.stop(ac.currentTime + 0.13);
    } catch (e) {}
  }

  function playWarning(kind) {
    if (kind === 'warn10') {
      playGong({ repeats: 1, base: 360, duration: 1.65, level: 1.0 });
    } else if (kind === 'warn5') {
      playGong({ repeats: 2, base: 350, duration: 1.48, gap: 0.38, level: 1.0 });
    } else if (kind === 'warn1') {
      playGong({ repeats: 3, base: 330, duration: 1.42, gap: 0.28, level: 1.0 });
    } else if (kind === 'last10') {
      playTick();
    } else if (kind === 'ended') {
      playGong({ repeats: 1, base: 300, duration: 2.7, level: 1.0 });
    }
  }

  function markWarning(slotId, warning) {
    state.warningKeys[slotId + ':' + warning] = true;
  }

  function isWarningMarked(slotId, warning) {
    return !!state.warningKeys[slotId + ':' + warning];
  }

  function processWarnings(ctx, nowMs, gapMs) {
    if (ctx.kind !== 'active') return;
    if (state.previousRemaining === null || state.currentSlotId !== ctx.slotId) return;
    if (gapMs > 5000) return;

    var thresholds = [
      { key: 'warn10', value: 600 },
      { key: 'warn5', value: 300 },
      { key: 'warn1', value: 60 }
    ];

    var k;
    for (k = 0; k < thresholds.length; k++) {
      var t = thresholds[k];
      if (state.previousRemaining > t.value && ctx.remaining <= t.value && !isWarningMarked(ctx.slotId, t.key)) {
        markWarning(ctx.slotId, t.key);
        playWarning(t.key);
      }
    }
  }

  function processLastTenSeconds(ctx, gapMs) {
    if (ctx.kind !== 'active' || ctx.remaining < 1 || ctx.remaining > 10) {
      state.lastSecondBeepKey = null;
      return;
    }
    if (gapMs > 5000) return;

    var key = ctx.slotId + ':' + ctx.remaining;
    if (state.lastSecondBeepKey !== key) {
      state.lastSecondBeepKey = key;
      playWarning('last10');
    }
  }

  function updateFinalOverlay(ctx) {
    var show = ctx &&
               ctx.kind === 'active' &&
               ctx.remaining >= 1 &&
               ctx.remaining <= 10;

    el.endedOverlay.className = show ? 'overlay' : 'overlay hidden';
  }


  function tick() {
    var previewNow = adjustedNowMs();
    if (state.previewMode) {
      if (previewNow >= state.previewUntil) {
        stopScreenPreview();
      } else {
        renderPreview(state.previewMode);
      }
      return;
    }

    var now = adjustedNow();
    var nowMs = now.getTime();
    state.lastTickWallTime = nowMs;
    state.lastTickRawTime = new Date().getTime();
    state.lastSyncTime = nowMs;
    var ctx = getContext(now);
    var gap = state.previousNow === null ? 0 : nowMs - state.previousNow;

    if (state.initialized) {
      processWarnings(ctx, nowMs, gap);
      processLastTenSeconds(ctx, gap);
      if (gap <= 5000 && state.currentSlotId && ctx.kind === 'active' && state.currentSlotId !== ctx.slotId) {
        playWarning('ended');
      }
    }

    render(now, ctx);
    updateEndWeather(now, ctx);
    updateFinalOverlay(ctx);

    state.initialized = true;
    state.currentSlotId = ctx.kind === 'active' ? ctx.slotId : null;
    state.previousRemaining = ctx.kind === 'active' ? ctx.remaining : null;
    state.previousNow = nowMs;

    el.diagOnline.innerHTML = navigator.onLine === false ? 'offline' : 'online';
    if (el.diagSync) el.diagSync.innerHTML = formatClock(now) + ' | internet: ' + state.internetSyncStatus;
    if (el.diagWatchdog) el.diagWatchdog.innerHTML = state.watchdogHealthy ? 'v pořádku' : 'obnovuji';
    if (el.diagWeather) el.diagWeather.innerHTML = state.weatherStatus;
    checkNightlyReload(now);
  }


  function checkNightlyReload(now) {
    var key = dayKey(now);
    if (now.getHours() === NIGHTLY_RELOAD_HOUR && now.getMinutes() === NIGHTLY_RELOAD_MINUTE) {
      if (state.lastNightlyReloadKey !== key) {
        state.lastNightlyReloadKey = key;
        try { localStorage.setItem('justyou_last_nightly_reload', key); } catch (e) {}
        window.setTimeout(function () { window.location.reload(); }, 250);
      }
    }
  }

  function runWatchdog() {
    var nowMs = new Date().getTime();
    if (state.lastTickRawTime && nowMs - state.lastTickRawTime > 12000) {
      state.watchdogHealthy = false;
      if (el.diagWatchdog) el.diagWatchdog.innerHTML = 'obnovuji';
      try { localStorage.setItem('justyou_watchdog_reload', String(nowMs)); } catch (e) {}
      window.location.reload();
      return;
    }
    state.watchdogHealthy = true;
    if (el.diagWatchdog) el.diagWatchdog.innerHTML = 'v pořádku';
  }

  function forceResync() {
    state.previousNow = null;
    state.previousRemaining = null;
    tick();
  }


  function removePreviewHint() {
    if (state.previewHint && state.previewHint.parentNode) {
      state.previewHint.parentNode.removeChild(state.previewHint);
    }
    state.previewHint = null;
  }

  function showPreviewHint() {
    removePreviewHint();
    var hint = document.createElement('div');
    hint.className = 'preview-hint';
    hint.innerHTML = 'TEST OBRAZOVKY — návrat za 8 sekund';
    document.body.appendChild(hint);
    state.previewHint = hint;
  }

  function renderPreview(mode) {
    var fakeNow = new Date();
    var fakeCtx;

    el.endedOverlay.className = 'overlay hidden';
    el.app.className = 'app';
    hideAllScreens();

    if (mode === 'night') {
      el.night.className = 'screen';
      el.progress.style.width = '0%';
      el.clock.innerHTML = formatClock(fakeNow);
      if (el.overlayClock) el.overlayClock.textContent = formatClock(fakeNow);
      return;
    }

    if (mode === 'ended') {
      el.active.className = 'screen active-screen';
      el.slotLabel.innerHTML = 'REZERVACE 16:30 – 17:45';
      el.countdown.innerHTML = '00:00';
      if (el.endTime) el.endTime.innerHTML = '17:45';
      el.warn10.className = 'warn10 hidden';
      el.exitBox.className = 'exit-box hidden';
      el.lastMinute.className = 'last-minute hidden';
      el.progress.style.width = '100%';
      el.clock.innerHTML = formatClock(fakeNow);
      if (el.overlayClock) el.overlayClock.textContent = formatClock(fakeNow);
      el.endedOverlay.className = 'overlay';
      return;
    }

    fakeCtx = {
      kind: 'active',
      slotId: 'preview',
      startLabel: '16:30',
      endLabel: '17:45',
      remaining: mode === 'warn10' ? 598 :
                 mode === 'warn5' ? 298 :
                 mode === 'last10' ? 9 :
                 mode === 'warn1' ? 58 : 3118
    };

    render(fakeNow, fakeCtx);
  }

  function startScreenPreview(mode) {
    state.previewMode = mode;
    state.previewUntil = new Date().getTime() + 8000;
    el.service.className = 'service preview-hidden';
    renderPreview(mode);
    showPreviewHint();

    if (mode === 'warn10') playWarning('warn10');
    if (mode === 'warn5') playWarning('warn5');
    if (mode === 'warn1') playWarning('warn1');
    if (mode === 'last10') playWarning('last10');
    if (mode === 'ended') playWarning('ended');
  }

  function stopScreenPreview() {
    state.previewMode = null;
    state.previewUntil = 0;
    removePreviewHint();
    el.endedOverlay.className = 'overlay hidden';
    el.service.className = 'service';
    tick();
    resetServiceTimer();
  }

  function requestWakeLock() {
    if (!navigator.wakeLock || !navigator.wakeLock.request) {
      el.diagWake.innerHTML = 'nepodporován';
      return;
    }
    try {
      navigator.wakeLock.request('screen').then(function (lock) {
        state.wakeLock = lock;
        el.diagWake.innerHTML = 'aktivní';
        if (lock.addEventListener) {
          lock.addEventListener('release', function () {
            el.diagWake.innerHTML = 'uvolněn';
          });
        }
      }).catch(function () {
        el.diagWake.innerHTML = 'blokován';
      });
    } catch (e) {
      el.diagWake.innerHTML = 'blokován';
    }
  }

  function openService() {
    el.service.className = 'service';
    resetServiceTimer();
  }

  function closeService() {
    el.service.className = 'service hidden';
    if (state.serviceTimer) {
      clearTimeout(state.serviceTimer);
      state.serviceTimer = null;
    }
  }

  function resetServiceTimer() {
    if (state.serviceTimer) clearTimeout(state.serviceTimer);
    state.serviceTimer = setTimeout(closeService, 60000);
  }

  function logoTap() {
    var now = new Date().getTime();
    if (now - state.lastLogoTap > 1500) state.logoTapCount = 0;
    state.logoTapCount++;
    state.lastLogoTap = now;
    if (state.logoTapCount >= 5) {
      state.logoTapCount = 0;
      openService();
    }
  }

  function preventDefault(e) {
    if (e && e.preventDefault) e.preventDefault();
    return false;
  }

  el.logo.onclick = logoTap;
  el.closeService.onclick = closeService;
  el.testSound.onclick = function () {
    playWarning('ended');
    resetServiceTimer();
  };
  el.testNormal.onclick = function () { startScreenPreview('normal'); };
  el.test10.onclick = function () { startScreenPreview('warn10'); };
  el.test5.onclick = function () { startScreenPreview('warn5'); };
  el.test1.onclick = function () { startScreenPreview('warn1'); };
  el.testLast10.onclick = function () { startScreenPreview('last10'); };
  el.testEnded.onclick = function () { startScreenPreview('ended'); };
  el.testNight.onclick = function () { startScreenPreview('night'); };
  el.service.onclick = resetServiceTimer;
  if (el.restartApp) {
    el.restartApp.onclick = function () { window.location.reload(); };
  }

  document.addEventListener('contextmenu', preventDefault, false);
  document.addEventListener('dragstart', preventDefault, false);
  document.addEventListener('selectstart', preventDefault, false);

  document.addEventListener('visibilitychange', function () {
    if (!document.hidden) {
      tick();
      updateWeather();
      requestWakeLock();
      var ac = getAudioContext();
      if (ac && ac.state === 'suspended' && ac.resume) {
        try { ac.resume(); } catch (e) {}
      }
    }
  }, false);

  window.addEventListener('focus', function () {
    forceResync();
    updateWeather();
    requestWakeLock();
    if (new Date().getTime() - state.lastInternetSync > INTERNET_SYNC_INTERVAL) syncInternetTime();
  }, false);

  window.addEventListener('pageshow', function () {
    forceResync();
    updateWeather();
    requestWakeLock();
    if (new Date().getTime() - state.lastInternetSync > INTERNET_SYNC_INTERVAL) syncInternetTime();
  }, false);

  window.addEventListener('online', function () { syncInternetTime(); updateWeather(); tick(); }, false);
  window.addEventListener('offline', tick, false);

  window.onerror = function (message) {
    try {
      localStorage.setItem('justyou_last_error', String(message));
    } catch (e) {}
    return false;
  };

  // Burn-in protection: tiny, barely visible shift every 3 minutes.
  var shiftIndex = 0;
  var shifts = [[0,0],[1,0],[1,1],[0,1],[-1,1],[-1,0],[-1,-1],[0,-1]];
  setInterval(function () {
    shiftIndex = (shiftIndex + 1) % shifts.length;
    document.getElementById('main').style.transform =
      'translate(' + shifts[shiftIndex][0] + 'px,' + shifts[shiftIndex][1] + 'px)';
  }, 180000);

  if ('serviceWorker' in navigator) {
    window.addEventListener('load', function () {
      try {
        navigator.serviceWorker.register('./sw.js', { scope: './' });
      } catch (e) {}
    });
  }

  tick();
  updateWeather();
  syncInternetTime();
  setInterval(tick, 1000);
  setInterval(syncInternetTime, INTERNET_SYNC_INTERVAL);
  setInterval(updateWeather, WEATHER_INTERVAL);
  setInterval(weatherWatchdog, 60 * 1000);
  setInterval(runWatchdog, 5000);
  requestWakeLock();
}());
