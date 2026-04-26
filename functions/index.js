// ═══════════════════════════════════════════════════════════
// BASU Classes — Firebase Cloud Functions
// Notifications: Pickup alert + Schedule update alert
// Deploy: firebase deploy --only functions
// ═══════════════════════════════════════════════════════════

const functions = require("firebase-functions");
const admin = require("firebase-admin");
admin.initializeApp();

const db = admin.database();
const messaging = admin.messaging();

// ── TRAVEL TIMES (same as scheduler) ──
const TRAVEL_T = {
  39:25, 42:22, 45:20, 47:18, 49:16, 73:14, 76:12, 77:12, 78:11,
  99:8, 104:18, 105:19, 107:20, 116:22,
  shatabdi:15, elite:12, antriksh:12, jalvayu:18, supreme:8, sunworld:20, silicon:12
};

function getTrav(pickup, override) {
  if (override && parseInt(override) > 0) return parseInt(override);
  if (!pickup) return 15;
  const pl = pickup.toLowerCase();
  const m = pl.match(/sector[- ]*(\d+)/i);
  if (m) { const n = parseInt(m[1]); if (TRAVEL_T[n]) return TRAVEL_T[n]; }
  for (const k in TRAVEL_T) { if (isNaN(Number(k)) && pl.includes(k)) return TRAVEL_T[k]; }
  return 15;
}

function toMins(t) {
  if (!t) return 0;
  const [h, m] = t.split(":").map(Number);
  return h * 60 + m;
}

const DAYS = ["Sunday","Monday","Tuesday","Wednesday","Thursday","Friday","Saturday"];
const DAY_SHORT = {Sunday:"Sun",Monday:"Mon",Tuesday:"Tue",Wednesday:"Wed",Thursday:"Thu",Friday:"Fri",Saturday:"Sat"};

function getStudentSlotsOnDay(slots, student, day) {
  const all = slots[student.batch + "||" + day] || [];
  const enr = student.subjects || [];
  return all.filter(sl => {
    if (sl.isSpecial) return !!sl.includeTransport;
    if (sl.isTest) {
      if (!enr.includes("TEST")) return false;
      const ts = sl.testSubjects || [];
      return !ts.length || enr.some(s => ts.includes(s));
    }
    if (!enr.length) return true;
    if (enr.includes(sl.subj)) return true;
    if (sl.subj === "Physics / Chemistry" && (enr.includes("Physics") || enr.includes("Chemistry"))) return true;
    return false;
  });
}

function fmtTime12(t) {
  if (!t) return "—";
  const [h, m] = t.split(":").map(Number);
  const p = h >= 12 ? "PM" : "AM", hh = h % 12 || 12;
  return `${hh}:${String(m).padStart(2, "0")} ${p}`;
}

// ═══════════════════════════════════════════════════════════
// FUNCTION 1: Pickup Alert — runs every minute via cron
// Sends push notification 15 min before student's pickup time
// ═══════════════════════════════════════════════════════════
exports.pickupAlert = functions.pubsub
  .schedule("every 1 minutes")
  .timeZone("Asia/Kolkata")
  .onRun(async () => {
    const now = new Date();
    const dayName = DAYS[now.getDay()];
    const dayShort = DAY_SHORT[dayName];
    const nowMins = now.getHours() * 60 + now.getMinutes();

    // Load transport + slots + FCM tokens
    const [transSnap, slotsSnap, tokensSnap] = await Promise.all([
      db.ref("transport").once("value"),
      db.ref("schedule/slots").once("value"),
      db.ref("fcmTokens").once("value"),
    ]);

    const transport = transSnap.val();
    const slots = slotsSnap.val() || {};
    const tokens = tokensSnap.val() || {};

    if (!transport || !transport.students) return null;

    const messages = [];

    for (const stu of transport.students) {
      const token = tokens[stu.id];
      if (!token) continue; // student hasn't enabled notifications

      const daySlots = getStudentSlotsOnDay(slots, stu, dayShort);
      if (!daySlots.length) continue;

      const sorted = [...daySlots].sort((a, b) => a.start.localeCompare(b.start));
      const firstSlot = sorted[0];
      const trav = getTrav(stu.pickup, stu.travelTime);
      const arrBASU = toMins(firstSlot.start) - 5;
      const pickupMins = arrBASU - trav;

      // Alert windows: 15 min before and 5 min before pickup
      const diff = pickupMins - nowMins;

      let alertType = null;
      if (diff === 15) alertType = "15min";
      else if (diff === 5) alertType = "5min";
      else if (diff === 0) alertType = "now";

      if (!alertType) continue;

      const pickupTimeStr = fmtTime12(
        `${Math.floor(pickupMins / 60).toString().padStart(2, "0")}:${String(pickupMins % 60).padStart(2, "0")}`
      );

      const msgBody = {
        "15min": `बस ${pickupTimeStr} पर आएगी — 15 मिनट में तैयार रहें! 🚌`,
        "5min":  `बस 5 मिनट में आ रही है! ${stu.pickup} पर आ जाएं 📍`,
        "now":   `🚨 बस अभी आपके stop पर है! जल्दी आएं!`,
      }[alertType];

      messages.push({
        token,
        notification: {
          title: `BASU Classes — Bus Alert 🚌`,
          body: msgBody,
        },
        data: {
          type: "pickup_alert",
          studentId: stu.id,
          route: stu.route || "",
          pickupTime: pickupTimeStr,
          alertType,
        },
        android: {
          notification: {
            channelId: "basu_bus",
            priority: "high",
            sound: "default",
            icon: "ic_notification",
          },
          priority: "high",
        },
        apns: {
          payload: { aps: { sound: "default", badge: 1 } },
        },
        webpush: {
          notification: {
            icon: "/icon-192.png",
            badge: "/icon-192.png",
            vibrate: [200, 100, 200],
            requireInteraction: alertType === "now",
          },
          fcmOptions: { link: "/" },
        },
      });
    }

    if (!messages.length) return null;

    // Send in batches of 500 (FCM limit)
    for (let i = 0; i < messages.length; i += 500) {
      const batch = messages.slice(i, i + 500);
      const res = await messaging.sendEach(batch);
      console.log(`Sent ${res.successCount}/${batch.length} pickup alerts`);

      // Remove invalid tokens
      res.responses.forEach((r, idx) => {
        if (!r.success && r.error?.code === "messaging/registration-token-not-registered") {
          const stuId = batch[idx].data?.studentId;
          if (stuId) db.ref(`fcmTokens/${stuId}`).remove();
        }
      });
    }

    return null;
  });

// ═══════════════════════════════════════════════════════════
// FUNCTION 2: Drop Alert — same cron, checks drop time
// ═══════════════════════════════════════════════════════════
exports.dropAlert = functions.pubsub
  .schedule("every 1 minutes")
  .timeZone("Asia/Kolkata")
  .onRun(async () => {
    const now = new Date();
    const dayName = DAYS[now.getDay()];
    const dayShort = DAY_SHORT[dayName];
    const nowMins = now.getHours() * 60 + now.getMinutes();

    const [transSnap, slotsSnap, tokensSnap] = await Promise.all([
      db.ref("transport").once("value"),
      db.ref("schedule/slots").once("value"),
      db.ref("fcmTokens").once("value"),
    ]);

    const transport = transSnap.val();
    const slots = slotsSnap.val() || {};
    const tokens = tokensSnap.val() || {};
    if (!transport || !transport.students) return null;

    const messages = [];

    for (const stu of transport.students) {
      const token = tokens[stu.id];
      if (!token) continue;

      const daySlots = getStudentSlotsOnDay(slots, stu, dayShort);
      if (!daySlots.length) continue;

      const sorted = [...daySlots].sort((a, b) => a.start.localeCompare(b.start));
      const lastSlot = sorted[sorted.length - 1];
      const trav = getTrav(stu.pickup, stu.travelTime);
      const dropMins = toMins(lastSlot.end) + 10 + trav;
      const diff = dropMins - nowMins;

      if (diff !== 10) continue; // Alert 10 min before drop

      const dropTimeStr = fmtTime12(
        `${Math.floor(dropMins / 60).toString().padStart(2, "0")}:${String(dropMins % 60).padStart(2, "0")}`
      );

      messages.push({
        token,
        notification: {
          title: "BASU Classes — Drop Alert 🏠",
          body: `बस ${dropTimeStr} पर आपके stop पर पहुंचेगी। तैयार रहें!`,
        },
        data: { type: "drop_alert", studentId: stu.id, dropTime: dropTimeStr },
        android: { notification: { channelId: "basu_bus", priority: "high", sound: "default" }, priority: "high" },
        apns: { payload: { aps: { sound: "default" } } },
        webpush: { notification: { icon: "/icon-192.png" }, fcmOptions: { link: "/" } },
      });
    }

    if (!messages.length) return null;
    const res = await messaging.sendEach(messages);
    console.log(`Drop alerts sent: ${res.successCount}/${messages.length}`);
    return null;
  });

// ═══════════════════════════════════════════════════════════
// FUNCTION 3: Schedule Update Alert
// Triggers when admin saves /schedule/slots in Firebase
// ═══════════════════════════════════════════════════════════
exports.scheduleUpdateAlert = functions.database
  .ref("/schedule/slots")
  .onWrite(async (change, context) => {
    // Skip if deleted
    if (!change.after.exists()) return null;

    const [transSnap, tokensSnap] = await Promise.all([
      db.ref("transport").once("value"),
      db.ref("fcmTokens").once("value"),
    ]);

    const transport = transSnap.val();
    const tokens = tokensSnap.val() || {};
    if (!transport || !transport.students) return null;

    const messages = [];
    for (const stu of transport.students) {
      const token = tokens[stu.id];
      if (!token) continue;
      messages.push({
        token,
        notification: {
          title: "BASU Classes — Schedule Update 📅",
          body: "टाइमटेबल अपडेट हुआ है! नया शेड्यूल देखने के लिए ऐप खोलें।",
        },
        data: { type: "schedule_update" },
        android: { notification: { channelId: "basu_schedule", sound: "default" }, priority: "normal" },
        apns: { payload: { aps: { sound: "default" } } },
        webpush: { notification: { icon: "/icon-192.png", badge: "/icon-192.png" }, fcmOptions: { link: "/?tab=today" } },
      });
    }

    if (!messages.length) return null;
    for (let i = 0; i < messages.length; i += 500) {
      const res = await messaging.sendEach(messages.slice(i, i + 500));
      console.log(`Schedule alerts: ${res.successCount} sent`);
    }
    return null;
  });

// ═══════════════════════════════════════════════════════════
// FUNCTION 4: Driver location offline alert
// If driver hasn't sent location in 5 min during class hours
// ═══════════════════════════════════════════════════════════
exports.driverOfflineCheck = functions.pubsub
  .schedule("every 5 minutes")
  .timeZone("Asia/Kolkata")
  .onRun(async () => {
    const now = new Date();
    const nowMins = now.getHours() * 60 + now.getMinutes();
    // Only check between 3 PM and 9 PM (class hours)
    if (nowMins < 15 * 60 || nowMins > 21 * 60) return null;

    const [transSnap, locSnap, tokensSnap] = await Promise.all([
      db.ref("transport").once("value"),
      db.ref("driverLoc").once("value"),
      db.ref("fcmTokens").once("value"),
    ]);

    const transport = transSnap.val();
    const locs = locSnap.val() || {};
    const tokens = tokensSnap.val() || {};
    if (!transport || !transport.routes) return null;

    const staleRoutes = [];
    for (const route of transport.routes) {
      const loc = locs[route.route] || locs[encodeURIComponent(route.route)];
      if (!loc || !loc.ts) { staleRoutes.push(route.route); continue; }
      const lastUpdate = new Date(loc.ts);
      const diffMins = (now - lastUpdate) / 60000;
      if (diffMins > 5) staleRoutes.push(route.route);
    }

    if (!staleRoutes.length) return null;

    const messages = [];
    for (const stu of (transport.students || [])) {
      if (!staleRoutes.includes(stu.route)) continue;
      const token = tokens[stu.id];
      if (!token) continue;
      messages.push({
        token,
        notification: {
          title: "BASU Bus — Location Update ⚠️",
          body: "बस की live location अभी available नहीं है। Driver से संपर्क करें।",
        },
        data: { type: "driver_offline", route: stu.route },
        android: { notification: { channelId: "basu_bus", priority: "normal" } },
        webpush: { notification: { icon: "/icon-192.png" }, fcmOptions: { link: "/" } },
      });
    }

    if (!messages.length) return null;
    const res = await messaging.sendEach(messages);
    console.log(`Offline alerts: ${res.successCount} sent`);
    return null;
  });
