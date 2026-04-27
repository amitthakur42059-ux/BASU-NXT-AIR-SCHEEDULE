const functions = require("firebase-functions");
const admin = require("firebase-admin");
const https = require("https");
admin.initializeApp();

const db = admin.database();

// OneSignal config
const OS_APP_ID = "228f183d-3c5e-41bd-aade-8f62c7db7c96";
const OS_API_KEY = "os_v2_app_ekhrqpj4lza33kw6r5rmpw34sz7ag7f4ar3ulnmiyxp426ydm4kceuojro2nsdhqqb7z7beothfx3f2cnoluqpr4c4nerxphqyjde3i";

// Travel times
const TRAVEL_T = {
  39:25,42:22,45:20,47:18,49:16,73:14,76:12,77:12,78:11,
  99:8,104:18,105:19,107:20,116:22,
  shatabdi:15,elite:12,antriksh:12,jalvayu:18,supreme:8,sunworld:20,silicon:12
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

function fmtTime12(mins) {
  const h = Math.floor(mins / 60) % 24, m = mins % 60;
  const p = h >= 12 ? "PM" : "AM", hh = h % 12 || 12;
  return `${hh}:${String(m).padStart(2,"0")} ${p}`;
}

const DAYS = ["Sunday","Monday","Tuesday","Wednesday","Thursday","Friday","Saturday"];
const DAY_SHORT = {Sunday:"Sun",Monday:"Mon",Tuesday:"Tue",Wednesday:"Wed",Thursday:"Thu",Friday:"Fri",Saturday:"Sat"};

function getStudentSlotsOnDay(slots, student, day) {
  const all = slots[student.batch + "||" + day] || [];
  const enr = Array.isArray(student.subjects) ? student.subjects : (student.subjects||"").split(",").map(s=>s.trim());
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

// Send OneSignal notification via REST API
function sendOSNotification(payload) {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify(payload);
    const options = {
      hostname: "api.onesignal.com",
      port: 443,
      path: "/notifications",
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Key ${OS_API_KEY}`,
      }
    };
    const req = https.request(options, res => {
      let body = "";
      res.on("data", d => body += d);
      res.on("end", () => resolve(JSON.parse(body)));
    });
    req.on("error", reject);
    req.write(data);
    req.end();
  });
}

// ── PICKUP ALERT (every 1 min) ──
exports.pickupAlert = functions.pubsub
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
      db.ref("osTokens").once("value"),
    ]);

    const transport = transSnap.val();
    const slots = slotsSnap.val() || {};
    const tokens = tokensSnap.val() || {};
    if (!transport || !transport.students) return null;

    for (const stu of transport.students) {
      const token = tokens[stu.id];
      if (!token) continue;

      const daySlots = getStudentSlotsOnDay(slots, stu, dayShort);
      if (!daySlots.length) continue;

      const sorted = [...daySlots].sort((a, b) => a.start.localeCompare(b.start));
      const firstSlot = sorted[0];
      const trav = getTrav(stu.pickup, stu.travelTime);
      const arrBASU = toMins(firstSlot.start) - 5;
      const pickupMins = arrBASU - trav;
      const diff = pickupMins - nowMins;

      let msg = null;
      if (diff === 15) msg = `🚌 बस ${fmtTime12(String(Math.floor(pickupMins/60)).padStart(2,'0')+':'+String(pickupMins%60).padStart(2,'0'))} पर आएगी — तैयार रहें!`;
      else if (diff === 5) msg = `🚌 बस 5 मिनट में आ रही है! ${stu.pickup||''} पर आ जाएं`;
      else if (diff === 0) msg = `🚨 बस अभी आपके stop पर है! जल्दी आएं!`;

      if (!msg) continue;

      await sendOSNotification({
        app_id: OS_APP_ID,
        include_aliases: { external_id: [stu.id] },
        target_channel: "push",
        headings: { en: "BASU CABS — Bus Alert 🚌" },
        contents: { en: msg },
        android_channel_id: "basu_bus",
        priority: 10,
        ttl: 300,
      });
      console.log(`Pickup alert sent to ${stu.name}`);
    }
    return null;
  });

// ── DROP ALERT (every 1 min) ──
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
      db.ref("osTokens").once("value"),
    ]);

    const transport = transSnap.val();
    const slots = slotsSnap.val() || {};
    const tokens = tokensSnap.val() || {};
    if (!transport || !transport.students) return null;

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

      if (diff !== 10) continue;

      const dropTimeStr = fmtTime12(String(Math.floor(dropMins/60)).padStart(2,'0')+':'+String(dropMins%60).padStart(2,'0'));

      await sendOSNotification({
        app_id: OS_APP_ID,
        include_aliases: { external_id: [stu.id] },
        target_channel: "push",
        headings: { en: "BASU CABS — Drop Alert 🏠" },
        contents: { en: `🏠 बस ${dropTimeStr} पर आपके stop पर पहुंचेगी। तैयार रहें!` },
        priority: 10,
        ttl: 300,
      });
    }
    return null;
  });

// ── SCHEDULE UPDATE ALERT ──
exports.scheduleUpdateAlert = functions.database
  .ref("/schedule/slots")
  .onWrite(async () => {
    const tokensSnap = await db.ref("osTokens").once("value");
    const tokens = tokensSnap.val() || {};
    const studentIds = Object.keys(tokens);
    if (!studentIds.length) return null;

    await sendOSNotification({
      app_id: OS_APP_ID,
      include_aliases: { external_id: studentIds },
      target_channel: "push",
      headings: { en: "BASU CABS — Schedule Update 📅" },
      contents: { en: "टाइमटेबल अपडेट हुआ है! नया शेड्यूल देखने के लिए ऐप खोलें।" },
      url: "https://basu-nxt-air-schedule.web.app",
      priority: 5,
    });
    console.log(`Schedule update sent to ${studentIds.length} students`);
    return null;
  });

// ── DRIVER OFFLINE CHECK (every 5 min) ──
exports.driverOfflineCheck = functions.pubsub
  .schedule("every 5 minutes")
  .timeZone("Asia/Kolkata")
  .onRun(async () => {
    const now = new Date();
    const nowMins = now.getHours() * 60 + now.getMinutes();
    if (nowMins < 15 * 60 || nowMins > 21 * 60) return null;

    const [transSnap, locSnap, tokensSnap] = await Promise.all([
      db.ref("transport").once("value"),
      db.ref("driverLoc").once("value"),
      db.ref("osTokens").once("value"),
    ]);

    const transport = transSnap.val();
    const locs = locSnap.val() || {};
    const tokens = tokensSnap.val() || {};
    if (!transport || !transport.routes) return null;

    const staleRoutes = [];
    for (const route of transport.routes) {
      const loc = locs[route.route] || locs[encodeURIComponent(route.route)];
      if (!loc || !loc.ts) { staleRoutes.push(route.route); continue; }
      const diffMins = (now - new Date(loc.ts)) / 60000;
      if (diffMins > 5) staleRoutes.push(route.route);
    }

    if (!staleRoutes.length) return null;

    const affectedIds = (transport.students || [])
      .filter(s => staleRoutes.includes(s.route) && tokens[s.id])
      .map(s => s.id);

    if (!affectedIds.length) return null;

    await sendOSNotification({
      app_id: OS_APP_ID,
      include_aliases: { external_id: affectedIds },
      target_channel: "push",
      headings: { en: "BASU CABS ⚠️" },
      contents: { en: "बस की live location अभी available नहीं है। Driver से संपर्क करें।" },
      priority: 5,
    });
    return null;
  });
