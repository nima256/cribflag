(() => {
  'use strict';

  if (window.__CRIB_PERF_DEBUG__) return;
  window.__CRIB_PERF_DEBUG__ = true;

  const TEST_DURATION_MS = 12000;
  const metrics = {
    startedAt: 0,
    frameTimes: [],
    longTasks: [],
    layoutShifts: [],
    events: [],
    scrollEvents: 0
  };
  const observers = [];
  let running = false;
  let lastFrame = 0;
  let scrollActiveUntil = 0;
  let finishTimer = 0;

  const round = (value, digits = 1) => Number(Number(value || 0).toFixed(digits));
  const percentile = (values, p) => {
    if (!values.length) return 0;
    const sorted = [...values].sort((a, b) => a - b);
    return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))];
  };
  const safePath = value => {
    try {
      const url = new URL(value, location.href);
      return `${url.pathname}${url.search}`;
    } catch {
      return String(value || '').slice(0, 180);
    }
  };

  function observe(type, callback, options = { buffered: true }) {
    if (!window.PerformanceObserver?.supportedEntryTypes?.includes(type)) return;
    try {
      const observer = new PerformanceObserver(list => callback(list.getEntries()));
      observer.observe({ type, ...options });
      observers.push(observer);
    } catch {}
  }

  observe('longtask', entries => {
    if (!running) return;
    for (const entry of entries) metrics.longTasks.push(round(entry.duration));
  });

  observe('layout-shift', entries => {
    if (!running) return;
    for (const entry of entries) {
      if (!entry.hadRecentInput) metrics.layoutShifts.push(round(entry.value, 4));
    }
  });

  observe('event', entries => {
    if (!running) return;
    for (const entry of entries) {
      if (entry.duration >= 40) metrics.events.push({ name: entry.name, duration: round(entry.duration) });
    }
  }, { buffered: true, durationThreshold: 40 });

  addEventListener('scroll', () => {
    // اگر کاربر فراموش کرد دکمه شروع را بزند، اولین اسکرول تست را خودکار آغاز می‌کند.
    if (!running && !metrics.startedAt) start();
    if (!running) return;
    metrics.scrollEvents += 1;
    scrollActiveUntil = performance.now() + 180;
  }, { passive: true });

  function sampleFrames(now) {
    if (lastFrame && running && now <= scrollActiveUntil) {
      metrics.frameTimes.push(now - lastFrame);
      if (metrics.frameTimes.length > 5000) metrics.frameTimes.shift();
    }
    lastFrame = now;
    requestAnimationFrame(sampleFrames);
  }
  requestAnimationFrame(sampleFrames);

  function isVisiblyRendered(node, style = getComputedStyle(node)) {
    if (style.display === 'none' || style.visibility === 'hidden' || Number(style.opacity) <= 0.01) return false;
    const rect = node.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0 && node.getClientRects().length > 0;
  }

  function expensiveLayers() {
    const found = [];
    const nodes = [...document.querySelectorAll('body *')].slice(0, 3000);
    for (const node of nodes) {
      const style = getComputedStyle(node);
      if (!isVisiblyRendered(node, style)) continue;
      const position = style.position;
      const backdrop = style.backdropFilter || style.webkitBackdropFilter || 'none';
      const filter = style.filter || 'none';
      if ((position === 'fixed' || position === 'sticky') && (backdrop !== 'none' || filter !== 'none')) {
        found.push({
          selector: describeNode(node),
          position,
          backdropFilter: backdrop,
          filter
        });
      }
      if (found.length >= 20) break;
    }
    return found;
  }

  function describeNode(node) {
    const id = node.id ? `#${node.id}` : '';
    const classes = [...node.classList].slice(0, 3).map(name => `.${name}`).join('');
    return `${node.tagName.toLowerCase()}${id}${classes}`;
  }

  function resourceReport() {
    return performance.getEntriesByType('resource')
      .map(entry => ({
        name: safePath(entry.name),
        type: entry.initiatorType,
        duration: round(entry.duration),
        transferKB: round((entry.transferSize || 0) / 1024),
        decodedKB: round((entry.decodedBodySize || 0) / 1024)
      }))
      .sort((a, b) => b.duration - a.duration)
      .slice(0, 15);
  }

  function imageReport() {
    const images = [...document.images];
    const dpr = devicePixelRatio || 1;
    const rows = images.map(image => {
      const width = image.naturalWidth || 0;
      const height = image.naturalHeight || 0;
      const rect = image.getBoundingClientRect();
      const targetPixels = Math.max(1, rect.width * dpr * rect.height * dpr);
      return {
        src: safePath(image.currentSrc || image.src),
        width,
        height,
        renderedWidth: round(rect.width),
        renderedHeight: round(rect.height),
        megapixels: round((width * height) / 1_000_000, 2),
        decodedMB: round((width * height * 4) / 1024 / 1024),
        pixelOversize: round((width * height) / targetPixels, 1),
        complete: image.complete
      };
    });
    return {
      count: rows.length,
      incomplete: rows.filter(row => !row.complete).length,
      estimatedDecodedMB: round(rows.reduce((sum, row) => sum + row.decodedMB, 0)),
      largest: rows.sort((a, b) => b.megapixels - a.megapixels).slice(0, 10)
    };
  }

  function gpuReport() {
    try {
      const canvas = document.createElement('canvas');
      const gl = canvas.getContext('webgl', { powerPreference: 'high-performance' })
        || canvas.getContext('experimental-webgl');
      if (!gl) return { webgl: false, renderer: null, vendor: null };
      const debug = gl.getExtension('WEBGL_debug_renderer_info');
      return {
        webgl: true,
        renderer: debug ? gl.getParameter(debug.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER),
        vendor: debug ? gl.getParameter(debug.UNMASKED_VENDOR_WEBGL) : gl.getParameter(gl.VENDOR)
      };
    } catch {
      return { webgl: false, renderer: null, vendor: null };
    }
  }

  function navigationReport() {
    const nav = performance.getEntriesByType('navigation')[0];
    if (!nav) return null;
    return {
      ttfbMs: round(nav.responseStart),
      responseMs: round(nav.responseEnd - nav.responseStart),
      domContentLoadedMs: round(nav.domContentLoadedEventEnd),
      loadMs: round(nav.loadEventEnd || performance.now()),
      transferKB: round((nav.transferSize || 0) / 1024),
      decodedKB: round((nav.decodedBodySize || 0) / 1024),
      serverTiming: (nav.serverTiming || []).map(item => ({ name: item.name, duration: round(item.duration), description: item.description }))
    };
  }

  function buildReport() {
    const frames = metrics.frameTimes.filter(value => Number.isFinite(value) && value > 0);
    const longTaskTotal = metrics.longTasks.reduce((sum, value) => sum + value, 0);
    const layoutShiftTotal = metrics.layoutShifts.reduce((sum, value) => sum + value, 0);
    const memory = performance.memory ? {
      usedMB: round(performance.memory.usedJSHeapSize / 1024 / 1024),
      totalMB: round(performance.memory.totalJSHeapSize / 1024 / 1024),
      limitMB: round(performance.memory.jsHeapSizeLimit / 1024 / 1024)
    } : null;

    return {
      generatedAt: new Date().toISOString(),
      page: `${location.pathname}${location.search}`,
      viewport: `${innerWidth}x${innerHeight}@${devicePixelRatio || 1}`,
      device: {
        userAgent: navigator.userAgent,
        hardwareConcurrency: navigator.hardwareConcurrency || null,
        deviceMemoryGB: navigator.deviceMemory || null,
        connection: navigator.connection ? {
          effectiveType: navigator.connection.effectiveType,
          downlinkMbps: navigator.connection.downlink,
          saveData: navigator.connection.saveData
        } : null,
        gpu: gpuReport(),
        memory
      },
      navigation: navigationReport(),
      scrollTest: {
        valid: metrics.scrollEvents > 0 && frames.length > 0,
        durationMs: metrics.startedAt ? Math.max(0, Math.round(performance.now() - metrics.startedAt)) : 0,
        scrollEvents: metrics.scrollEvents,
        sampledFrames: frames.length,
        estimatedFps: frames.length ? round(1000 / (frames.reduce((sum, value) => sum + value, 0) / frames.length)) : 0,
        p95FrameMs: round(percentile(frames, .95)),
        maxFrameMs: round(Math.max(0, ...frames)),
        framesOver33ms: frames.filter(value => value > 33.4).length,
        framesOver50ms: frames.filter(value => value > 50).length,
        longTaskCount: metrics.longTasks.length,
        longTaskTotalMs: round(longTaskTotal),
        longestTasksMs: [...metrics.longTasks].sort((a, b) => b - a).slice(0, 10),
        slowEvents: metrics.events.slice(0, 20),
        cumulativeLayoutShift: round(layoutShiftTotal, 4)
      },
      dom: {
        elements: document.getElementsByTagName('*').length,
        productCards: document.querySelectorAll('.product-card,.ready-card').length,
        fixedElements: [...document.querySelectorAll('body *')].filter(node => { const style = getComputedStyle(node); return style.position === 'fixed' && isVisiblyRendered(node, style); }).length,
        stickyElements: [...document.querySelectorAll('body *')].filter(node => { const style = getComputedStyle(node); return style.position === 'sticky' && isVisiblyRendered(node, style); }).length,
        expensiveFixedOrStickyLayers: expensiveLayers()
      },
      images: imageReport(),
      slowestResources: resourceReport(),
      consoleErrorsNote: 'خطاهای Console را جداگانه هم ارسال کنید؛ این ابزار محتوای Console را ضبط نمی‌کند.'
    };
  }

  const panel = document.createElement('section');
  panel.setAttribute('dir', 'rtl');
  panel.style.cssText = 'position:fixed;right:12px;bottom:12px;z-index:2147483647;width:min(360px,calc(100vw - 24px));padding:12px;border:1px solid #cbd5e1;border-radius:16px;background:#fff;color:#0f172a;box-shadow:0 18px 60px rgba(15,23,42,.24);font:13px/1.7 system-ui,sans-serif;text-align:right';
  panel.innerHTML = '<strong style="display:block;font-size:14px">عیب‌یاب عملکرد Crib Flag</strong><p data-perf-status style="margin:5px 0 10px;color:#475569">شروع را بزن، بعد ۱۲ ثانیه صفحه را بالا و پایین اسکرول کن.</p><div style="display:flex;gap:7px;flex-wrap:wrap"><button data-perf-start type="button" style="border:0;border-radius:10px;padding:8px 12px;background:#1457ff;color:#fff;font-weight:800;cursor:pointer">شروع تست</button><button data-perf-report type="button" style="border:1px solid #cbd5e1;border-radius:10px;padding:8px 12px;background:#f8fafc;color:#0f172a;font-weight:800;cursor:pointer">نمایش گزارش</button><button data-perf-close type="button" style="margin-right:auto;border:0;background:transparent;font-size:20px;cursor:pointer">×</button></div>';
  document.body.append(panel);

  const status = panel.querySelector('[data-perf-status]');
  const startButton = panel.querySelector('[data-perf-start]');

  function reset() {
    metrics.startedAt = performance.now();
    metrics.frameTimes.length = 0;
    metrics.longTasks.length = 0;
    metrics.layoutShifts.length = 0;
    metrics.events.length = 0;
    metrics.scrollEvents = 0;
    scrollActiveUntil = 0;
  }

  function finish() {
    running = false;
    clearTimeout(finishTimer);
    startButton.disabled = false;
    startButton.textContent = 'تکرار تست';
    status.textContent = 'تست تمام شد. «نمایش گزارش» را بزن و متن را برای بررسی بفرست.';
  }

  function start() {
    reset();
    running = true;
    startButton.disabled = true;
    startButton.textContent = 'در حال ثبت…';
    const endAt = Date.now() + TEST_DURATION_MS;
    status.textContent = 'الان صفحه را چند بار با سرعت معمول بالا و پایین اسکرول کن.';
    const tick = () => {
      if (!running) return;
      const seconds = Math.max(0, Math.ceil((endAt - Date.now()) / 1000));
      status.textContent = `در حال ثبت؛ ${seconds} ثانیه مانده. صفحه را اسکرول کن.`;
      if (seconds <= 0) return finish();
      finishTimer = setTimeout(tick, 500);
    };
    tick();
  }

  function showReport() {
    if (running) finish();
    const reportText = JSON.stringify(buildReport(), null, 2);
    const modal = document.createElement('div');
    modal.setAttribute('dir', 'ltr');
    modal.style.cssText = 'position:fixed;inset:0;z-index:2147483647;display:grid;place-items:center;padding:16px;background:rgba(15,23,42,.72)';
    const box = document.createElement('div');
    box.style.cssText = 'width:min(900px,100%);height:min(82vh,760px);display:grid;grid-template-rows:auto 1fr auto;gap:10px;padding:14px;border-radius:16px;background:#fff';
    const title = document.createElement('strong');
    title.textContent = 'Crib Flag performance report';
    const area = document.createElement('textarea');
    area.readOnly = true;
    area.value = reportText;
    area.style.cssText = 'width:100%;height:100%;resize:none;border:1px solid #cbd5e1;border-radius:10px;padding:10px;font:12px/1.5 ui-monospace,monospace;direction:ltr;text-align:left';
    const actions = document.createElement('div');
    actions.style.cssText = 'display:flex;gap:8px;justify-content:flex-end';
    const copy = document.createElement('button');
    copy.textContent = 'Copy report';
    const close = document.createElement('button');
    close.textContent = 'Close';
    for (const button of [copy, close]) button.style.cssText = 'border:1px solid #cbd5e1;border-radius:9px;padding:8px 12px;background:#f8fafc;font-weight:700;cursor:pointer';
    copy.addEventListener('click', async () => {
      try {
        await navigator.clipboard.writeText(reportText);
        copy.textContent = 'Copied';
      } catch {
        area.focus();
        area.select();
        document.execCommand('copy');
        copy.textContent = 'Copied';
      }
    });
    close.addEventListener('click', () => modal.remove());
    modal.addEventListener('click', event => { if (event.target === modal) modal.remove(); });
    actions.append(copy, close);
    box.append(title, area, actions);
    modal.append(box);
    document.body.append(modal);
  }

  startButton.addEventListener('click', start);
  panel.querySelector('[data-perf-report]').addEventListener('click', showReport);
  panel.querySelector('[data-perf-close]').addEventListener('click', () => panel.remove());
})();
