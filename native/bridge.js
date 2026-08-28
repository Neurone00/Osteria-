/**
 * Native Bluetooth bridge — the fifth Osteria transport, and the only one that
 * lets two phones play with no network at all.
 *
 * A browser page can only ever be a BLE *central*, so two web pages can't pair
 * directly. Wrapped in the Capacitor APK we're no longer just a page: the host
 * becomes a real BLE *peripheral* (via cordova-plugin-ble-peripheral) and the
 * guest a central (via @capacitor-community/bluetooth-le). They meet on the same
 * Osteria GATT service the other transports use and sync the room over one
 * notify+write characteristic, the JSON fragmented into short [id,total,index]
 * frames because a BLE payload is MTU-capped.
 *
 * This file is bundled by native/prepare-android.mjs into android-www/ and loaded
 * ONLY inside the APK. It attaches window.OsteriaNative; App.jsx feature-detects
 * that global and never imports anything itself, so the web artifact is untouched.
 *
 * Same contract as every other transport: hand it JSON, adopt whatever comes back.
 *   window.OsteriaNative = {
 *     available,                       // true inside the app
 *     host(name, {onMessage,onStatus}) // become the peripheral, advertise
 *     guest(name, {onMessage,onStatus})// scan + connect as central
 *     send(obj), close()
 *   }
 */
import { BleClient, numbersToDataView } from "@capacitor-community/bluetooth-le";
import { App } from "@capacitor/app";
import { Filesystem, Directory } from "@capacitor/filesystem";

const SERVICE = "6f737465-7269-6161-0000-000000000001"; // must match BT_SERVICE in App.jsx
const CHAR = "6f737465-7269-6161-0000-000000000002"; //   and BT_CHAR

// The GitHub repo the in-app updater checks for a newer signed APK.
const UPDATE_REPO = "Neurone00/Osteria-";

// Payload bytes per frame. Android negotiates a 512-byte MTU on connect (the
// central plugin requests it), so 160 is comfortable; drop it toward ~17 if a
// device ever refuses the larger MTU and long values get truncated.
const FRAME = 160;

// cordova-plugin-ble-peripheral takes the raw Android bitmasks.
const PROP = { READ: 0x02, WRITE_NO_RESPONSE: 0x04, WRITE: 0x08, NOTIFY: 0x10 };
const PERM = { READABLE: 0x01, WRITEABLE: 0x10 };

// Android 12+ gates advertising/scanning behind runtime permissions the peripheral
// plugin never asks for. Request them up front; on older Android the manifest entries
// suffice and the plugin (cordova-plugin-android-permissions) may be absent, so a
// missing plugin resolves quietly and we let the native call surface any real denial.
const ANDROID_BT_PERMS = [
  "android.permission.BLUETOOTH_ADVERTISE",
  "android.permission.BLUETOOTH_CONNECT",
  "android.permission.BLUETOOTH_SCAN",
];
function permsPlugin() {
  return (typeof window !== "undefined" && window.cordova && window.cordova.plugins && window.cordova.plugins.permissions) || null;
}
// Is one runtime permission held? (checkPermission takes a single permission.)
function hasPerm(p) {
  return new Promise((resolve) => {
    const perms = permsPlugin();
    if (!perms || !perms.checkPermission) return resolve(true); // pre-Android-12: install-time
    perms.checkPermission(p, (s) => resolve(!!(s && s.hasPermission)), () => resolve(false));
  });
}
async function hasAllBt() {
  for (const p of ANDROID_BT_PERMS) if (!(await hasPerm(p))) return false;
  return true;
}
// Ensure the whole Nearby-devices group — SCAN, CONNECT and *ADVERTISE*. Checking
// only CONNECT was the bug: the BLE plugin grants CONNECT on its own, so a
// CONNECT-only check passed and ADVERTISE was never requested, and advertising then
// failed with "Need BLUETOOTH_ADVERTISE". So verify every one, request the group if
// any is missing, and re-verify. Returns true only when all are actually granted.
async function ensureBtPermissions() {
  const perms = permsPlugin();
  if (!perms || !perms.requestPermissions) return true; // pre-Android-12
  if (await hasAllBt()) return true;
  await new Promise((resolve) => {
    try { perms.requestPermissions(ANDROID_BT_PERMS, () => resolve(), () => resolve()); } catch { resolve(); }
  });
  return await hasAllBt();
}

// Pull a human-readable string out of whatever a plugin rejects with, so the UI can
// show *why* it failed instead of a generic message — vital while this is unproven.
function errText(e) {
  if (!e) return "errore sconosciuto";
  return e.message || e.errorMessage || (typeof e === "string" ? e : JSON.stringify(e));
}

// Ensure the radio is on, prompting once. Returns true only when it's actually on —
// openGattServer also returns null when Bluetooth is off, so this gates the host too.
async function bluetoothOn() {
  try {
    await BleClient.initialize();
    if (await BleClient.isEnabled()) return true;
    await BleClient.requestEnable();
    return await BleClient.isEnabled();
  } catch { return false; }
}

const te = new TextEncoder();
const td = new TextDecoder();

// Reassemble incoming [id,total,index]+payload frames per message id, then hand
// the decoded object up. One partial message per id at a time is all we need —
// play is turn-based and one writer at a time.
function makeInbox(onObject) {
  const inbox = {};
  return (u8) => {
    if (!u8 || u8.length < 3) return;
    const id = u8[0], total = u8[1], idx = u8[2];
    const slot = inbox[id] || (inbox[id] = { total, parts: [] });
    slot.parts[idx] = u8.subarray(3);
    if (slot.parts.filter(Boolean).length !== slot.total) return;
    delete inbox[id];
    let len = 0;
    for (const p of slot.parts) len += p.length;
    const joined = new Uint8Array(len);
    let o = 0;
    for (const p of slot.parts) { joined.set(p, o); o += p.length; }
    let obj;
    try { obj = JSON.parse(td.decode(joined)); } catch { return; }
    onObject(obj);
  };
}

let seq = 0;
let sendRaw = null; // (Uint8Array frame) => Promise, set once a role is live
let teardown = null; // () => void, tears the radio down on close

function frameUp(obj) {
  const bytes = te.encode(JSON.stringify(obj));
  const total = Math.max(1, Math.ceil(bytes.length / FRAME));
  const id = (seq = (seq + 1) & 0xff);
  const out = [];
  for (let i = 0; i < total; i++) {
    const slice = bytes.subarray(i * FRAME, (i + 1) * FRAME);
    const frame = new Uint8Array(3 + slice.length);
    frame[0] = id; frame[1] = total; frame[2] = i;
    frame.set(slice, 3);
    out.push(frame);
  }
  return out;
}

async function send(obj) {
  if (!sendRaw) return;
  for (const frame of frameUp(obj)) {
    try { await sendRaw(frame); } catch { return; }
  }
}

// ── host: BLE peripheral ─────────────────────────────────────────────────────
async function host(name, { onMessage, onStatus } = {}) {
  const bp = typeof window !== "undefined" ? window.blePeripheral : null;
  if (!bp) throw new Error("peripheral plugin missing");
  // Gate the peripheral plugin: it opens its GATT server on the FIRST call and never
  // retries, returning null (→ NullPointerException on addService) if Bluetooth is off
  // or CONNECT isn't granted. So confirm both BEFORE we touch it, with clear errors.
  if (!(await bluetoothOn())) throw new Error("attiva il Bluetooth e riprova");
  if (!(await ensureBtPermissions())) throw new Error("concedi il permesso «Dispositivi nelle vicinanze» (Impostazioni ▸ App ▸ Osteria ▸ Autorizzazioni)");
  const inbox = makeInbox((o) => onMessage && onMessage(o));

  // Build the service and start advertising. Each step is awaited so a rejection
  // is caught and re-thrown with context the UI can show.
  try {
    // A central wrote to us: reassemble and deliver.
    await bp.onWriteRequest((req) => {
      const v = req && req.value;
      if (v) inbox(v instanceof Uint8Array ? v : new Uint8Array(v));
    });
    await bp.createService(SERVICE);
    await bp.addCharacteristic(
      SERVICE, CHAR,
      PROP.READ | PROP.WRITE | PROP.WRITE_NO_RESPONSE | PROP.NOTIFY,
      PERM.READABLE | PERM.WRITEABLE
    );
    await bp.publishService(SERVICE);
    await bp.startAdvertising(SERVICE, (name && name.trim()) || "Osteria");
  } catch (e) {
    // Android's AdvertiseCallback rejects with a bare error code; translate the ones
    // we might hit. If the plugin already opened a null GATT server on an earlier tap
    // it stays stuck until the process restarts, so name that escape hatch too.
    const ADV_ERR = { 1: "dati troppo grandi", 2: "troppi advertiser", 3: "già avviato", 4: "errore interno", 5: "non supportato" };
    const t = errText(e);
    const named = ADV_ERR[t] ? ` (${ADV_ERR[t]})` : "";
    throw new Error("advertising — " + t + named + " · chiudi e riapri l'app, poi riprova");
  }

  // Push to the guest by updating the characteristic — subscribed centrals get
  // a notification. setCharacteristicValue wants a plain ArrayBuffer.
  sendRaw = (u8) => bp.setCharacteristicValue(SERVICE, CHAR, u8.slice().buffer);
  teardown = () => { try { bp.stopAdvertising(); } catch {} try { bp.removeAllServices(); } catch {} };
  onStatus && onStatus("waiting"); // advertising; waiting for a guest to write
  return true;
}

// ── guest: BLE central ───────────────────────────────────────────────────────
// Wire the central transport onto an already-chosen host (by deviceId): connect,
// subscribe, and route sends. Shared by the manual "Entra" chooser and Bump's
// automatic scan, so the two paths behave identically once a host is picked.
async function guestConnect(id, name, { onMessage, onStatus } = {}) {
  await BleClient.connect(id, () => onStatus && onStatus("lost"));
  const inbox = makeInbox((o) => onMessage && onMessage(o));
  await BleClient.startNotifications(id, SERVICE, CHAR, (dv) => {
    inbox(new Uint8Array(dv.buffer, dv.byteOffset, dv.byteLength));
  });
  sendRaw = (u8) => BleClient.write(id, SERVICE, CHAR, numbersToDataView(Array.from(u8)));
  teardown = () => { try { BleClient.stopNotifications(id, SERVICE, CHAR); } catch {} try { BleClient.disconnect(id); } catch {} };
  onStatus && onStatus("live");
  return true;
}

async function guest(name, handlers = {}) {
  if (!(await bluetoothOn())) throw new Error("attiva il Bluetooth e riprova");
  if (!(await ensureBtPermissions())) throw new Error("concedi il permesso «Dispositivi nelle vicinanze» (Impostazioni ▸ App ▸ Osteria ▸ Autorizzazioni)");
  await BleClient.initialize({ androidNeverForLocation: true });
  // System chooser filtered to Osteria hosts — the guest taps the host's name.
  let device;
  try {
    device = await BleClient.requestDevice({ services: [SERVICE], optionalServices: [SERVICE] });
  } catch (e) {
    if (/cancel/i.test(errText(e))) throw new Error("annullato");
    throw new Error("ricerca — " + errText(e));
  }
  return guestConnect(device.deviceId, name, handlers);
}

// Silent scan (no system chooser) for an Osteria host that's advertising right now.
// Resolves the first host's deviceId, or null if none appears within `ms`. BLE scan
// needs no location — androidNeverForLocation keeps us off it.
async function scanHost(ms) {
  await BleClient.initialize({ androidNeverForLocation: true });
  return new Promise((resolve) => {
    let found = null, done = false;
    const finish = async () => {
      if (done) return; done = true;
      try { await BleClient.stopLEScan(); } catch {}
      resolve(found);
    };
    BleClient.requestLEScan({ services: [SERVICE] }, (res) => {
      if (!found && res && res.device) { found = res.device.deviceId; finish(); }
    }).catch(() => { done = true; resolve(null); });
    setTimeout(finish, ms);
  });
}

// Bump: one button, no roles. Scan briefly for a host; if one is already advertising
// we're the guest and connect to it, otherwise nobody's home so WE become the host.
// So the first phone to tap Bump finds no host → hosts; the second finds it → joins.
// A little jitter on the scan window staggers two near-simultaneous taps so they don't
// both decide "no host" and both start advertising.
async function bump(name, handlers = {}) {
  if (!(await bluetoothOn())) throw new Error("attiva il Bluetooth e riprova");
  if (!(await ensureBtPermissions())) throw new Error("concedi il permesso «Dispositivi nelle vicinanze» (Impostazioni ▸ App ▸ Osteria ▸ Autorizzazioni)");
  const id = await scanHost(1800 + Math.floor(Math.random() * 700));
  if (id) {
    await guestConnect(id, name, handlers);
    return { role: "guest" };
  }
  await host(name, handlers);
  return { role: "host" };
}

function close() {
  const t = teardown;
  sendRaw = null; teardown = null;
  if (t) t();
}

// Called once when the app opens: settle the Nearby-devices permission early so
// the first Ospita tap doesn't open the GATT server a beat before the grant lands
// (which jams the peripheral plugin until an app restart). Silent and best-effort —
// it only prompts for the permission, never for enabling Bluetooth.
async function prewarm() {
  try { await ensureBtPermissions(); } catch {}
}

// ── in-app updater ───────────────────────────────────────────────────────────
// The installed build's versionCode (CI stamps it to the run number, same N that
// appears in the release asset name Osteria-v1.0.N-sha.apk).
async function appBuild() {
  try { const i = await App.getInfo(); return parseInt(i.build, 10) || 0; } catch { return 0; }
}

// Ask GitHub for the latest published APK and whether it's newer than what's installed.
// Returns { current, latest, available, name, url }. Best-effort — any failure (offline,
// rate limit) throws, and the caller just skips the update prompt.
async function checkUpdate() {
  const current = await appBuild();
  const r = await fetch(`https://api.github.com/repos/${UPDATE_REPO}/releases/tags/apk`, {
    headers: { Accept: "application/vnd.github+json" },
  });
  if (!r.ok) throw new Error("controllo aggiornamenti non riuscito");
  const j = await r.json();
  const assets = j.assets || [];
  let best = null;
  for (const a of assets) {
    const m = /v\d+\.\d+\.(\d+)/.exec(a.name || "");
    if (m) { const n = +m[1]; if (!best || n > best.build) best = { build: n, name: a.name, url: a.browser_download_url }; }
  }
  return {
    current,
    latest: best ? best.build : 0,
    available: !!best && best.build > current,
    name: best && best.name,
    url: best && best.url,
  };
}

function blobToB64(blob) {
  return new Promise((resolve, reject) => {
    const fr = new FileReader();
    fr.onerror = () => reject(new Error("lettura file non riuscita"));
    fr.onload = () => resolve(String(fr.result).split(",")[1] || "");
    fr.readAsDataURL(blob);
  });
}

// Download the APK to the app cache and hand it to the system package installer.
// Android shows its own install screen (unavoidable for a sideloaded app); this just
// removes the browser download + find-the-file dance.
async function installUpdate(url, name) {
  const res = await fetch(url);
  if (!res.ok) throw new Error("download non riuscito");
  const b64 = await blobToB64(await res.blob());
  const path = name || "Osteria-update.apk";
  await Filesystem.writeFile({ path, data: b64, directory: Directory.Cache });
  const { uri } = await Filesystem.getUri({ path, directory: Directory.Cache });
  const opener = typeof window !== "undefined" && window.cordova && window.cordova.plugins && window.cordova.plugins.fileOpener2;
  if (!opener || !opener.open) throw new Error("installer non disponibile");
  await new Promise((resolve, reject) => {
    opener.open(uri, "application/vnd.android.package-archive", { success: resolve, error: (e) => reject(new Error(errText(e))) });
  });
  return true;
}

if (typeof window !== "undefined") {
  window.OsteriaNative = { available: true, host, guest, bump, send, close, prewarm, checkUpdate, installUpdate };
}
