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

const SERVICE = "6f737465-7269-6161-0000-000000000001"; // must match BT_SERVICE in App.jsx
const CHAR = "6f737465-7269-6161-0000-000000000002"; //   and BT_CHAR

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
function requestBtPermissions() {
  return new Promise((resolve) => {
    const perms = typeof window !== "undefined" && window.cordova && window.cordova.plugins && window.cordova.plugins.permissions;
    if (!perms || !perms.requestPermissions) return resolve();
    try { perms.requestPermissions(ANDROID_BT_PERMS, () => resolve(), () => resolve()); } catch { resolve(); }
  });
}

// Pull a human-readable string out of whatever a plugin rejects with, so the UI can
// show *why* it failed instead of a generic message — vital while this is unproven.
function errText(e) {
  if (!e) return "errore sconosciuto";
  return e.message || e.errorMessage || (typeof e === "string" ? e : JSON.stringify(e));
}

// Make sure the radio is on, prompting the user if not. Best-effort — if it throws,
// the advertise/scan call right after will fail with a clearer message.
async function ensureBluetoothOn() {
  try {
    await BleClient.initialize();
    if (!(await BleClient.isEnabled())) await BleClient.requestEnable();
  } catch {}
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
  await requestBtPermissions();
  await ensureBluetoothOn();
  const inbox = makeInbox((o) => onMessage && onMessage(o));

  // Build the service and start advertising. Each step is awaited so a rejection
  // (usually a missing runtime permission or advertising unsupported) is caught and
  // re-thrown with context the UI can show.
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
    throw new Error("advertising — " + errText(e));
  }

  // Push to the guest by updating the characteristic — subscribed centrals get
  // a notification. setCharacteristicValue wants a plain ArrayBuffer.
  sendRaw = (u8) => bp.setCharacteristicValue(SERVICE, CHAR, u8.slice().buffer);
  teardown = () => { try { bp.stopAdvertising(); } catch {} try { bp.removeAllServices(); } catch {} };
  onStatus && onStatus("waiting"); // advertising; waiting for a guest to write
  return true;
}

// ── guest: BLE central ───────────────────────────────────────────────────────
async function guest(name, { onMessage, onStatus } = {}) {
  await requestBtPermissions();
  await BleClient.initialize({ androidNeverForLocation: true });
  try { if (!(await BleClient.isEnabled())) await BleClient.requestEnable(); } catch {}
  // System chooser filtered to Osteria hosts — the guest taps the host's name.
  let device;
  try {
    device = await BleClient.requestDevice({ services: [SERVICE], optionalServices: [SERVICE] });
  } catch (e) {
    if (/cancel/i.test(errText(e))) throw new Error("annullato");
    throw new Error("ricerca — " + errText(e));
  }
  const id = device.deviceId;
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

function close() {
  const t = teardown;
  sendRaw = null; teardown = null;
  if (t) t();
}

if (typeof window !== "undefined") {
  window.OsteriaNative = { available: true, host, guest, send, close };
}
