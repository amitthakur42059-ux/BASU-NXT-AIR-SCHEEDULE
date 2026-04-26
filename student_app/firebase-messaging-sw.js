// firebase-messaging-sw.js
// Place this in root of student_app folder alongside index.html

importScripts('https://www.gstatic.com/firebasejs/8.10.1/firebase-app.js');
importScripts('https://www.gstatic.com/firebasejs/8.10.1/firebase-messaging.js');

firebase.initializeApp({
  apiKey: "AIzaSyBJFGFCxzadD0CE1ojszYQp4p0H6Sz2ob8",
  authDomain: "basu-nxt-air-schedule.firebaseapp.com",
  projectId: "basu-nxt-air-schedule",
  messagingSenderId: "994754056347",
  appId: "1:994754056347:web:ff9d70a91cdb6a4466f63e"
});

const messaging = firebase.messaging();

// Background message handler
messaging.onBackgroundMessage(payload => {
  const { title, body } = payload.notification || {};
  const data = payload.data || {};

  let icon = '/icon-192.png';
  let badge = '/icon-192.png';
  let vibrate = [200, 100, 200];
  let tag = data.type || 'basu';
  let actions = [];
  let requireInteraction = false;

  if (data.type === 'pickup_alert') {
    if (data.alertType === 'now') { vibrate = [300,100,300,100,300]; requireInteraction = true; }
    actions = [{ action: 'open', title: 'Track Bus 🚌' }];
  } else if (data.type === 'schedule_update') {
    actions = [{ action: 'open', title: 'View Schedule 📅' }];
  } else if (data.type === 'drop_alert') {
    actions = [{ action: 'open', title: 'View Route 🏠' }];
  }

  return self.registration.showNotification(title || 'BASU Classes', {
    body: body || '',
    icon, badge, vibrate, tag, requireInteraction, actions,
    data: { url: '/', ...data },
  });
});

// Notification click handler
self.addEventListener('notificationclick', event => {
  event.notification.close();
  const url = event.notification.data?.url || '/';
  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then(clientList => {
      for (const client of clientList) {
        if (client.url.includes(self.location.origin) && 'focus' in client) {
          return client.focus();
        }
      }
      return clients.openWindow(url);
    })
  );
});

// Cache for offline
const CACHE = 'basu-v1';
self.addEventListener('install', e => { self.skipWaiting(); });
self.addEventListener('activate', e => { self.clients.claim(); });
self.addEventListener('fetch', e => {
  if (e.request.url.includes('firebaseio.com') || e.request.url.includes('googleapis.com')) return;
  e.respondWith(fetch(e.request).catch(() => caches.match(e.request)));
});
