#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");
const vm = require("vm");
const assert = require("assert");

const ROOT = path.resolve(__dirname, "..");
const SCRIPT_RESPONSE = path.join(ROOT, "scripts", "spotify-premium.js");

let pass = 0;
let fail = 0;
const test = (name, fn) => {
  try {
    fn();
    pass++;
    console.log("  PASS  " + name);
  } catch (e) {
    fail++;
    console.log("  FAIL  " + name + "  ->  " + (e && e.message ? e.message : e));
  }
};

function varint(n) {
  const out = [];
  let v = n;
  while (v >= 0x80) {
    out.push((v % 0x80) | 0x80);
    v = Math.floor(v / 0x80);
  }
  out.push(v);
  return Buffer.from(out);
}
const tag = (no, wire) => varint(no * 8 + wire);
const fVarint = (no, v) => Buffer.concat([tag(no, 0), varint(v)]);
const fBytes = (no, p) => Buffer.concat([tag(no, 2), varint(p.length), p]);
const fStr = (no, s) => fBytes(no, Buffer.from(s, "utf8"));
const cat = (...parts) => Buffer.concat(parts);

function runResponseScript(url, bodyBuffer, optArg = {}) {
  let doneResult = null;
  const store = {};
  const sandbox = {
    $request: { url: url },
    $response: {
      status: 200,
      statusCode: 200,
      body: new Uint8Array(bodyBuffer),
    },
    $argument: JSON.stringify(optArg),
    $persistentStore: {
      read: (k) => store[k] || null,
      write: (v, k) => {
        store[k] = String(v);
        return true;
      },
    },
    $done: (res) => {
      doneResult = res;
    },
    console: {
      log: () => {},
      error: () => {},
      warn: () => {},
    },
  };
  const code = fs.readFileSync(SCRIPT_RESPONSE, "utf8");
  vm.createContext(sandbox);
  vm.runInContext(code, sandbox);
  return doneResult;
}

console.log("\n=== TEST SPOTIFY-VN-MIX: PLAYLIST MIX / AUTOMIX UI + TOCAM BADGE ===\n");

// 1. GetYourPremiumBadge
test("Badge: ToCam 18B (#1ED760) trên Free (0B -> 18B)", () => {
  const res = runResponseScript(
    "https://spclient.wg.spotify.com/pam-view-service/v1/GetYourPremiumBadge",
    Buffer.alloc(0)
  );
  assert(res && res.body, "Phải có body trả về");
  const b = Buffer.from(res.body);
  assert.strictEqual(b.length, 18, `Phải đúng 18B (ToCam 5B + #1ED760 9B + varint 2B + tags = 18B), thực tế: ${b.length}B`);
  assert(b.includes(Buffer.from("ToCam", "utf8")), "Phải giữ chữ 'ToCam'");
  assert(b.includes(Buffer.from("#1ED760", "utf8")), "Phải có mã màu #1ED760");
});

// 2. Remote config: cờ Mixing Tools & Transitions
test("v3/configuration: tự động inject các cờ TransitionRowInteractionVariant='EDIT', smart_reorder_enabled=1, playlist_mixing_enabled=1", () => {
  const dummyConfig = cat(
    fBytes(3, cat(
      fBytes(1, cat(fStr(1, "core-playback-setup"), fStr(2, "crossfade_enabled"))),
      fBytes(3, fVarint(1, 0))
    ))
  );
  const res = runResponseScript(
    "https://spclient.wg.spotify.com/remote-config-resolver/v3/configuration",
    dummyConfig
  );
  assert(res && res.body, "Phải có body trả về");
  const b = Buffer.from(res.body);
  assert(b.includes(Buffer.from("TransitionRowInteractionVariant", "utf8")), "Phải có TransitionRowInteractionVariant");
  assert(b.includes(Buffer.from("EDIT", "utf8")), "TransitionRowInteractionVariant phải là EDIT");
  assert(b.includes(Buffer.from("smart_reorder_enabled", "utf8")), "Phải có smart_reorder_enabled");
  assert(b.includes(Buffer.from("playlist_mixing_enabled", "utf8")), "Phải có playlist_mixing_enabled");
});

// 3. User customization / attributes: mixing-tools=EDIT & playlist-mixing=1
test("user-customization-service: bơm 'mixing-tools'='EDIT' và 'playlist-mixing'='1'", () => {
  const dummyAttrs = cat(
    fBytes(1, cat(
      fBytes(1, cat(
        fBytes(1, cat(fStr(1, "core-playback-setup"), fStr(2, "crossfade_enabled"))),
        fBytes(3, fVarint(1, 0))
      )),
      fBytes(3, cat(
        fBytes(1, cat(fStr(1, "type"), fBytes(2, cat(fStr(4, "free")))))
      ))
    ))
  );
  const res = runResponseScript(
    "https://spclient.wg.spotify.com/user-customization-service/v1/customize",
    dummyAttrs
  );
  assert(res && res.body, "Phải có body trả về");
  const b = Buffer.from(res.body);
  assert(b.includes(Buffer.from("mixing-tools", "utf8")), "Phải có key mixing-tools");
  assert(b.includes(Buffer.from("EDIT", "utf8")), "mixing-tools phải có giá trị EDIT");
  assert(b.includes(Buffer.from("playlist-mixing", "utf8")), "Phải có key playlist-mixing");
});

// 4. GetRestrictedIntegrations: gRPC trả về empty buffer (0B) giải phóng lock MIX
test("GetRestrictedIntegrations: trả về message rỗng (0B) giải phóng khoá MIX / BLEND", () => {
  const lockedIntegrations = cat(
    fStr(1, "BLEND"),
    fStr(1, "JAM"),
    fStr(1, "MIX")
  );
  const res = runResponseScript(
    "https://spclient.wg.spotify.com/spotify.clientrestrictions.v1.RestrictedIntegrationsService/GetRestrictedIntegrations",
    lockedIntegrations
  );
  assert(res && res.body, "Phải có body trả về");
  const b = Buffer.from(res.body);
  assert.strictEqual(b.length, 0, `Phải trả về 0B rỗng để giải phóng khoá, thực tế: ${b.length}B`);
});

// 5. v1/capabilities: JSON patch VERY_HIGH
test("v1/capabilities: audio_quality='VERY_HIGH' và effective_license='premium'", () => {
  const jsonFree = JSON.stringify({
    audio_quality: "HIGH",
    effective_license: "free",
    can_play_on_demand: false
  });
  const res = runResponseScript(
    "https://spclient.wg.spotify.com/device-capabilities/v1/capabilities",
    Buffer.from(jsonFree, "utf8")
  );
  assert(res && res.body, "Phải có body trả về");
  const parsed = JSON.parse(Buffer.from(res.body).toString("utf8"));
  assert.strictEqual(parsed.audio_quality, "VERY_HIGH");
  assert.strictEqual(parsed.effective_license, "premium");
  assert.strictEqual(parsed.can_play_on_demand, true);
});

// 6. SelectedListContent (/playlist-v2/v2/playlist/<id>/signals & /diff): bơm 5 cờ f12 của Nút Phối
test("SelectedListContent (/signals & /diff): ghi đè mix='false' -> 'true' và bơm đủ 5 cờ f12 (can-view-transition, automix.mode, mix, mix-type, automix.queue)", () => {
  const rev24 = Buffer.from("0000000094eab401d0000000000000000000000000000000", "hex");
  const trackSignal88 = Buffer.from("0a1c3331746a6b7631323334353637383930", "hex");
  const signalsOff = cat(
    fBytes(1, rev24),
    fVarint(2, 56),
    fBytes(3, cat(
      fStr(1, "Hiệp"),
      fBytes(12, cat(fStr(1, "mix"), fStr(2, "false")))
    )),
    fBytes(5, cat(
      fVarint(1, 0),
      fVarint(2, 0),
      fBytes(3, cat(fStr(1, "spotify:track:15PnF9NOMz9Sdy17LVMlg9"), fBytes(2, trackSignal88)))
    ))
  );
  const res = runResponseScript(
    "https://spclient.wg.spotify.com/playlist-v2/v2/playlist/4YvPfs7WpoADAovoaFjRPQ/signals",
    signalsOff
  );
  assert(res && res.body, "Phải trả về body đã patch f3.f12");
  const b = Buffer.from(res.body);
  assert(!b.includes(Buffer.from("false", "utf8")), "Không được còn mix=false");
  for (const expected of ["can-view-transition", "automix.mode", "auto", "allow-custom", "automix.queue", "Hiệp"]) {
    assert(b.includes(Buffer.from(expected, "utf8")), "Phải chứa " + expected);
  }
  assert(b.includes(trackSignal88), "Phải giữ nguyên 100% byte signal của từng bài trong f5");
});

console.log("\n--------------------------------------------------------------");
console.log(`  PASS: ${pass}    FAIL: ${fail}`);
console.log("--------------------------------------------------------------\n");

if (fail > 0) process.exit(1);
