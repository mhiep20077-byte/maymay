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

// 3. User customization / attributes: mixing-tools=true (bool_value field 2=1) & mixing-fx-looping-jogwheel=true
test("user-customization-service: bơm 'mixing-tools'=true (bool_value f2=1) và 'mixing-fx-looping-jogwheel'=true", () => {
  const dummyAttrs = cat(
    fBytes(1, cat(
      fBytes(1, cat(
        fBytes(1, cat(fStr(1, "core-playback-setup"), fStr(2, "crossfade_enabled"))),
        fBytes(3, fVarint(1, 0))
      )),
      fBytes(3, cat(
        fBytes(1, cat(fStr(1, "type"), fBytes(2, cat(fStr(4, "free"))))),
        fBytes(1, cat(fStr(1, "social-session-free-tier"), fBytes(2, cat(fVarint(2, 1)))))
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
  assert(b.includes(Buffer.from("mixing-fx-looping-jogwheel", "utf8")), "Phải có key mixing-fx-looping-jogwheel");
  assert(!b.includes(Buffer.from("social-session-free-tier", "utf8")), "Phải xoá social-session-free-tier");
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

// 6. SelectedListContent (/playlist-v2/v2/playlist/<id>/signals & /diff): bơm quyền can-view-transition & mix-type, không phá permission/base 11B và không khoá cứng khi user tắt mix=false (trừ khi force_mix_on=true)
test("SelectedListContent (/signals & /diff): bơm can-view-transition='true', mix-type='allow-custom', bỏ qua permission/base 11B, và hỗ trợ force_mix_on", () => {
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
  // Mặc định: bơm can-view-transition + mix-type, nhưng giữ mix=false để không bị kẹt nút Phối trên Acc Premium
  const resDefault = runResponseScript(
    "https://spclient.wg.spotify.com/playlist/v2/playlist/4YvPfs7WpoADAovoaFjRPQ/signals",
    signalsOff
  );
  assert(resDefault && resDefault.body, "Phải trả về body đã bơm can-view-transition và mix-type");
  const bDef = Buffer.from(resDefault.body);
  for (const expected of ["can-view-transition", "allow-custom", "Hiệp"]) {
    assert(bDef.includes(Buffer.from(expected, "utf8")), "Phải chứa " + expected);
  }
  assert(bDef.includes(trackSignal88), "Phải giữ nguyên 100% byte signal của từng bài trong f5");

  // Không được đụng vào /playlist-permission/v1/playlist/<id>/permission/base (11B) hoặc podcast-chapters/spotify%3Atrack%3A.../diff (123B)
  const perm11B = Buffer.from("0a0764656661756c741002", "hex");
  const resPerm = runResponseScript(
    "https://spclient.wg.spotify.com/playlist-permission/v1/playlist/7ejDn9p23d5bQEgtQMxzla/permission/base",
    perm11B
  );
  assert(!resPerm || !resPerm.body, "Tuyệt đối không được sửa gói permission/base 11B");

  const podcastChapters123B = cat(
    fBytes(1, rev24),
    fBytes(6, cat(fBytes(1, rev24), fBytes(3, rev24))),
    fVarint(17, 0)
  );
  const resPod = runResponseScript(
    "https://gae2-spclient.spotify.com/playlist/v2/playlist/podcast-chapters/spotify%3Atrack%3A1ApIGNgp1azc0qB61x4GzG/diff",
    podcastChapters123B
  );
  assert(!resPod || !resPod.body, "Tuyệt đối không được sửa gói podcast-chapters/spotify%3Atrack.../diff");

  // 7. Gói /playlist/v2/playlist/<id>/diff (405B chỉ có f1 + f6 + f17=0 + f18 thiếu quyền) -> nâng f17=1, f18=215B đầy đủ, bơm f3.f12 (can-view-transition + mix-type) và bơm f22 (auto + autoplay + mix + jam)
  const diffNoMix = cat(
    fBytes(1, rev24),
    fBytes(6, cat(fBytes(1, rev24), fBytes(3, rev24))),
    fVarint(17, 0),
    fBytes(18, cat(fVarint(1, 1), fVarint(2, 0), fVarint(4, 0), fVarint(5, 1), fVarint(6, 0)))
  );
  const resDiff = runResponseScript(
    "https://spclient.wg.spotify.com/playlist/v2/playlist/7ejDn9p23d5bQEgtQMxzla/diff",
    diffNoMix
  );
  assert(resDiff && resDiff.body, "Phải nâng cấp gói /diff để mở nút Phối (f17=1, f18=215B, f22, f3.f12)");
  const bDiff = Buffer.from(resDiff.body);
  assert(bDiff.includes(Buffer.from("autoplay", "utf8")), "Phải bơm f22 chứa signal descriptor 'auto' & 'autoplay'");
  assert(bDiff.includes(Buffer.from("c16a3e0f", "utf8")), "Phải bơm f22 chứa lens 'mix' (c16a3e0f)");
  assert(bDiff.includes(Buffer.from("can-view-transition", "utf8")), "Phải bơm f3.f12 can-view-transition ngay trên gói /diff kể cả khi thiếu f3");

  // 8. Gói /extended-metadata/v0/extended-metadata (extension_kind = 235: MixabilityTrait 59B & extension_kind = 170: AutoLens 'mix' 66B)
  const extMetaMissing = cat(
    fBytes(2, cat(
      fBytes(1, cat(fVarint(1, 200), fVarint(2, 86400), fVarint(3, 2592000))),
      fVarint(2, 235),
      fBytes(3, cat(
        fBytes(1, cat(fVarint(1, 336))),
        fStr(2, "spotify:playlist:4YvPfs7WpoADAovoaFjRPQ")
      ))
    )),
    fBytes(2, cat(
      fBytes(1, cat(fVarint(1, 200), fVarint(2, 60), fVarint(3, 2592000))),
      fVarint(2, 170),
      fBytes(3, cat(
        fBytes(1, cat(fVarint(1, 304))),
        fStr(2, "spotify:playlist:4YvPfs7WpoADAovoaFjRPQ")
      ))
    ))
  );
  const resExt = runResponseScript(
    "https://spclient.wg.spotify.com/extended-metadata/v0/extended-metadata",
    extMetaMissing
  );
  assert(resExt && resExt.body, "Phải bơm MixabilityTrait (59B) + AutoLens (66B) vào extended-metadata");
  const bExt = Buffer.from(resExt.body);
  assert(bExt.includes(Buffer.from("type.googleapis.com/spotify.traits.v1.MixabilityTrait", "utf8")), "Phải chứa type_url MixabilityTrait");
  assert(bExt.includes(Buffer.from("type.googleapis.com/spotify.autolensextension.v1.AutoLens", "utf8")), "Phải chứa type_url AutoLens");
});

console.log("\n--------------------------------------------------------------");
console.log(`  PASS: ${pass}    FAIL: ${fail}`);
console.log("--------------------------------------------------------------\n");

if (fail > 0) process.exit(1);
