const CACHE = 'basu-student-v1';
self.addEventListener('install', e => { self.skipWaiting(); });
self.addEventListener('activate', e => { e.waitUntil(clients.claim()); });
self.addEventListener('fetch', e => {
  if(e.request.method !== 'GET') return;
  e.respondWith(fetch(e.request).catch(() => caches.match(e.request)));
});

// Background push handler
self.addEventListener('push', e => {
  if(!e.data) return;
  let data = {};
  try { data = e.data.json(); } catch(err) { data = { notification: { title: 'BASU Classes', body: e.data.text() } }; }
  const title = data.notification?.title || data.title || 'BASU Classes';
  const options = {
    body: data.notification?.body || data.body || '',
    icon: '/icon-192.png',
    badge: '/icon-192.png',
    tag: 'basu-notif',
    vibrate: [200, 100, 200],
    data: { url: 'https://basu-nxt-air-schedule.web.app' }
  };
  e.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener('notificationclick', e => {
  e.notification.close();
  e.waitUntil(clients.openWindow(e.notification.data?.url || 'https://basu-nxt-air-schedule.web.app'));
});