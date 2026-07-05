// Service worker: guaranteed offline caching + rest-timer notifications.
// Bump CACHE version whenever index.html changes to force an update.
const CACHE = 'wt5-v1';
const ASSETS = ['./', './index.html', './manifest.json', './icon-192.png', './icon-512.png'];

self.addEventListener('install', e => {
  self.skipWaiting();
  // Cache each asset individually so one missing file (e.g. an icon)
  // doesn't abort the whole install.
  e.waitUntil(
    caches.open(CACHE).then(c =>
      Promise.allSettled(ASSETS.map(a => c.add(a)))
    )
  );
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

// Stale-while-revalidate: serve from cache instantly (offline guarantee),
// refresh the cache in the background when there's a connection.
self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET') return;
  const url = new URL(e.request.url);
  if (url.origin !== self.location.origin) return; // let YouTube links etc. pass through
  e.respondWith(
    caches.match(e.request, { ignoreSearch: true }).then(hit => {
      const net = fetch(e.request).then(res => {
        if (res && res.ok) {
          const cp = res.clone();
          caches.open(CACHE).then(c => c.put(e.request, cp));
        }
        return res;
      }).catch(() => hit);
      return hit || net;
    })
  );
});

// ── REST-TIMER ALARM ────────────────────────────────────────────────────────
// The page hands us the timer end time. If the page is suspended (screen
// locked) it can't beep, so we show a system notification instead. The page
// schedules this 1.5 s after the real end; if it's still awake it beeps
// itself and sends cancel before we fire.
let alarmTimeout = null;
let alarmResolve = null;

function clearAlarm() {
  if (alarmTimeout) { clearTimeout(alarmTimeout); alarmTimeout = null; }
  if (alarmResolve) { alarmResolve(); alarmResolve = null; }
}

self.addEventListener('message', e => {
  const d = e.data || {};
  if (d.type === 'schedule-rest-alarm') {
    clearAlarm();
    const delay = Math.max(0, (d.fireAt || 0) - Date.now());
    // waitUntil keeps the worker alive until the alarm fires (rest timers
    // are ≤ ~3.5 min, within extendable-event limits on Android Chrome).
    e.waitUntil(new Promise(resolve => {
      alarmResolve = resolve;
      alarmTimeout = setTimeout(() => {
        alarmTimeout = null;
        self.registration.showNotification('Rest over — next set 🏋️', {
          tag: 'rest-timer',
          renotify: true,
          body: 'Timer finished',
          vibrate: [250, 120, 250, 120, 400],
          icon: './icon-192.png',
          badge: './icon-192.png'
        }).catch(() => {}).finally(() => {
          if (alarmResolve) { alarmResolve(); alarmResolve = null; }
        });
      }, delay);
    }));
  }
  if (d.type === 'cancel-rest-alarm') {
    clearAlarm();
    self.registration.getNotifications({ tag: 'rest-timer' })
      .then(ns => ns.forEach(n => n.close()))
      .catch(() => {});
  }
});

self.addEventListener('notificationclick', e => {
  e.notification.close();
  e.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(ws => {
      if (ws.length) return ws[0].focus();
      return self.clients.openWindow('./');
    })
  );
});
