/**
 * Osteria Bluetooth relay.
 *
 * A browser page can only ever be a BLE *central*, never a peripheral — so two phones
 * cannot pair page-to-page. This little peripheral is the middle they meet on: it
 * advertises the Osteria GATT service and forwards every write it receives to every
 * subscriber, so a state update from one phone reaches the other. It is opaque to the
 * game — it just relays the framed bytes the app already chunks its room state into.
 *
 * Run it on any machine with a Bluetooth adapter (a laptop, a Raspberry Pi):
 *
 *     npm install @abandonware/bleno
 *     node scripts/bt-relay.mjs
 *
 * then, on each phone, open Osteria → Bluetooth → Host / Join and pick "Osteria" in
 * the chooser. No Wi-Fi, no internet, no relay server — just Bluetooth.
 *
 * (macOS/Linux: may need to run with the right BLE permissions, e.g. `sudo`. The UUIDs
 * here are the dash-free form of BT_SERVICE / BT_CHAR in src/App.jsx.)
 */
import bleno from "@abandonware/bleno";

const SERVICE = "6f737465726961610000000000000001";
const CHAR = "6f737465726961610000000000000002";

// Every subscribed central gets a notify callback; a write from one is pushed to all
// of them. A phone receives its own echo too, but the app drops it (same version), so
// no special-casing is needed here.
const subscribers = new Set();

const characteristic = new bleno.Characteristic({
  uuid: CHAR,
  properties: ["write", "writeWithoutResponse", "notify"],
  onWriteRequest(data, offset, withoutResponse, callback) {
    for (const push of subscribers) {
      try { push(data); } catch {}
    }
    if (callback) callback(bleno.Characteristic.RESULT_SUCCESS);
  },
  onSubscribe(maxValueSize, updateValueCallback) {
    subscribers.add(updateValueCallback);
    console.log(`· a phone subscribed (${subscribers.size} on the table)`);
  },
  onUnsubscribe() {
    // bleno doesn't say which one left; with two seats, clearing and letting them
    // re-subscribe on the next connect is simplest and safe.
    subscribers.clear();
    console.log("· a phone left");
  },
});

bleno.on("stateChange", (state) => {
  if (state === "poweredOn") bleno.startAdvertising("Osteria", [SERVICE]);
  else bleno.stopAdvertising();
});

bleno.on("advertisingStart", (err) => {
  if (err) return console.error("advertising failed:", err);
  bleno.setServices([new bleno.PrimaryService({ uuid: SERVICE, characteristics: [characteristic] })], (e) => {
    if (e) return console.error("setServices failed:", e);
    console.log('Osteria BLE relay is live — advertising as "Osteria". Connect two phones.');
  });
});

bleno.on("accept", (addr) => console.log(`· connection from ${addr}`));
bleno.on("disconnect", (addr) => console.log(`· disconnect ${addr}`));
