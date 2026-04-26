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

// Background message — app band ho tab bhi kaam karega
messaging.onBackgroundMessage(payload => {
  console.log('[SW] Background message received:', payload);
  const title = payload.notification?.title || 'BASU Classes';
  const body  = payload.notification?.body  || '';
  const data  = payload.data || {};

  return self.registration.showNotification(title, {
    body,
    icon:  '/student_app/icon-192.png',
    badge: '/student_app/icon-192.png',
    tag:   data.type || 'basu-alert',
    renotify: true,
    requireInteraction: data.alertType === 'now',
    vibrate: data.alertType === 'now' ? [400,100,400,100,400] : [200,100,200],
    silent: false,
    data: { url: '/student_app/', ...data },
    actions: data.type === 'pickup_alert'
      ? [{ action: 'open', title: '🚌 Bus Track Karo' }]
      : [{ action: 'open', title: '📅 App Kholo' }],
  });
});

// Notification pe click karne par app khulo
self.addEventListener('notificationclick', event => {
  event.notification.close();
  const url = event.notification.data?.url || '/student_app/';
  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then(clientList => {
      for (const client of clientList) {
        if (client.url.includes('github.io') && 'focus' in client) {
          return client.focus();
        }
      }
      return clients.openWindow(url);
    })
  );
});

self.addEventListener('install',  () => self.skipWaiting());
self.addEventListener('activate', e => { e.waitUntil(self.clients.claim()); });
self.addEventListener('fetch', e => {
  if (e.request.url.includes('firebaseio.com') || 
      e.request.url.includes('googleapis.com') ||
      e.request.url.includes('gstatic.com')) return;
  e.respondWith(fetch(e.request).catch(() => caches.match(e.request)));
});
