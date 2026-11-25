#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");
const vm = require("vm");
const assert = require("assert");

const ROOT = path.resolve(__dirname, "..");
const SCRIPT_RESPONSE = path.join(ROOT, "scripts", "spotify-premium.js");
const SCRIPT_REQUEST = path.join(ROOT, "scripts", "spotify-request.js");
const SCRIPT_AUDIO = path.join(ROOT, "scripts", "spotify-audio-level.js");
const MODULE_FILE = path.join(ROOT, "spotify-vn-v26.module");

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

function readVarint(buf, st) {
  let value = 0;
  let shift = 0;
  while (st.i < buf.length) {
    const b = buf[st.i++];
    value += (b & 0x7f) * Math.pow(2, shift);
    if (!(b & 0x80)) return value;
    shift += 7;
  }
  throw new Error("varint hỏng");
}

function decode(buf) {
  const out = [];
  const st = { i: 0 };
  while (st.i < buf.length) {
    const key = readVarint(buf, st);
    const no = Math.floor(key / 8);
    const wire = key % 8;
    if (wire === 0) out.push({ no, w: 0, v: readVarint(buf, st) });
    else if (wire === 2) {
      const len = readVarint(buf, st);
      if (st.i + len > buf.length) throw new Error("độ dài vượt buffer");
      out.push({ no, w: 2, p: buf.subarray(st.i, st.i + len) });
      st.i += len;
    } else if (wire === 5) {
      out.push({ no, w: 5, p: buf.subarray(st.i, st.i + 4) });
      st.i += 4;
    } else if (wire === 1) {
      out.push({ no, w: 1, p: buf.subarray(st.i, st.i + 8) });
      st.i += 8;
    } else throw new Error("wire type lạ: " + wire);
  }
  return out;
}
const pick = (fields, no) => fields.filter((f) => f.no === no);
const one = (fields, no) => pick(fields, no)[0] || null;

function gframe(flag, payload) {
  const h = Buffer.alloc(5);
  h[0] = flag;
  h.writeUInt32BE(payload.length, 1);
  return Buffer.concat([h, payload]);
}

function gframes(buf) {
  const out = [];
  let i = 0;
  while (i + 5 <= buf.length) {
    const flag = buf[i];
    const len = buf.readUInt32BE(i + 1);
    out.push({ flag, payload: buf.subarray(i + 5, i + 5 + len) });
    i += 5 + len;
  }
  return out;
}

function runResponse(
  body,
  url,
  { status = 200, withTextCodec = false, via = "body", statusKey = "status", argument = undefined } = {}
) {
  let captured = null;
  const resp = { headers: {} };
  resp[statusKey] = status;
  if (via === "bytes") resp.bodyBytes = body ? new Uint8Array(body) : undefined;
  else if (via === "string") resp.body = typeof body === "string" ? body : Buffer.from(body).toString("utf8");
  else resp.body = body ? new Uint8Array(body) : undefined;
  const sandbox = {
    $request: { url, method: "GET", headers: {} },
    $response: resp,
    $done: (o) => {
      captured = o || {};
    },
    console: { log: () => {} },
  };
  if (argument !== undefined) {
    sandbox.$argument = typeof argument === "string" ? argument : JSON.stringify(argument);
  }
  if (withTextCodec) {
    sandbox.TextEncoder = TextEncoder;
    sandbox.TextDecoder = TextDecoder;
  }
  vm.createContext(sandbox);
  vm.runInContext(fs.readFileSync(SCRIPT_RESPONSE, "utf8"), sandbox, {
    filename: "spotify-premium.js",
  });
  return captured;
}

function runRequest(url, headers) {
  let captured = null;
  const sandbox = {
    $request: { url, method: "GET", headers },
    $done: (o) => {
      captured = o || {};
    },
    console: { log: () => {} },
  };
  vm.createContext(sandbox);
  vm.runInContext(fs.readFileSync(SCRIPT_REQUEST, "utf8"), sandbox, {
    filename: "spotify-request.js",
  });
  return captured;
}

const URL_BADGE =
  "https://gae2-spclient.spotify.com/pam-view-service/spotify.pam.v2.PamViewService/GetYourPremiumBadge";
const URL_PLANROW =
  "https://gae2-spclient.spotify.com/pam-view-service/v1/GetPremiumPlanRow?locale=vi";
const URL_SETTINGS =
  "https://gae2-spclient.spotify.com/playback-settings/spotify.playback_settings.v1.PlaybackSettingsService/GetAllStoredContentValues";
const URL_CAPS =
  "https://gae2-spclient.spotify.com/device-capabilities/v1/capabilities?device_type=smartphone";
const URL_FORTUNE =
  "https://gae2-spclient.spotify.com/net-fortune/v2/fortune?bandwidth=7250555&request_type=interactive";
const URL_NEBULA =
  "https://gae2-spclient.spotify.com/nebula/v1/configuration/attributes";
const URL_RC =
  "https://gae2-spclient.spotify.com/remote-config-resolver/v3/configuration";

console.log("\n=== TEST V2.6: GETYOURPREMIUMBADGE & PAM ===\n");

test("GetYourPremiumBadge proto (23B model): 'Spotify Free' + xam '#535353' + varint 0 -> 'ToCam' + '#1ED760' + varint 1", () => {
  // Mô phỏng đúng gói GetYourPremiumBadge trên tài khoản Free
  const freeBadge = cat(fVarint(1, 0), fStr(2, "Spotify Free"), fStr(3, "#535353"));
  const out = runResponse(freeBadge, URL_BADGE);
  assert.ok(out && out.body, "không patch được GetYourPremiumBadge");
  const fields = decode(Buffer.from(out.body));
  assert.strictEqual(one(fields, 1).v, 1, "varint 0 chưa nâng lên 1");
  assert.strictEqual(one(fields, 2).p.toString("utf8"), "ToCam", "chữ chưa thành ToCam");
  assert.strictEqual(one(fields, 3).p.toString("utf8"), "#1ED760", "màu xám chưa thành #1ED760");
});

test("GetYourPremiumBadge proto: 'Free' + xam '#727272' -> 'ToCam' + '#1ED760'", () => {
  const freeBadge = cat(fStr(1, "Free"), fStr(2, "#727272"), fVarint(3, 0));
  const out = runResponse(freeBadge, URL_BADGE);
  assert.ok(out && out.body);
  const fields = decode(Buffer.from(out.body));
  assert.strictEqual(one(fields, 1).p.toString("utf8"), "ToCam");
  assert.strictEqual(one(fields, 2).p.toString("utf8"), "#1ED760");
  assert.strictEqual(one(fields, 3).v, 1);
});

test("GetYourPremiumBadge proto (23B Premium thật): 'Individual' + '#1ED760' -> đổi chữ sang 'ToCam' giữ '#1ED760'", () => {
  const realPrem23B = cat(fVarint(1, 1), fStr(2, "Individual"), fStr(3, "#1ED760"));
  assert.strictEqual(realPrem23B.length, 23, "gói mẫu phải đúng 23B như ảnh");
  const out = runResponse(realPrem23B, URL_BADGE);
  assert.ok(out && out.body);
  const fields = decode(Buffer.from(out.body));
  assert.strictEqual(one(fields, 1).v, 1);
  assert.strictEqual(one(fields, 2).p.toString("utf8"), "ToCam");
  assert.strictEqual(one(fields, 3).p.toString("utf8"), "#1ED760");
});

test("GetYourPremiumBadge proto: chỉ có chữ 'Spotify Free' (server omit field màu) -> tự thêm field màu '#1ED760'", () => {
  const freeNoColor = cat(fVarint(1, 0), fStr(2, "Spotify Free"));
  const out = runResponse(freeNoColor, URL_BADGE);
  assert.ok(out && out.body);
  const fields = decode(Buffer.from(out.body));
  assert.strictEqual(one(fields, 1).v, 1);
  assert.strictEqual(one(fields, 2).p.toString("utf8"), "ToCam");
  assert.strictEqual(one(fields, 3).p.toString("utf8"), "#1ED760");
});

test("GetYourPremiumBadge proto: body rỗng 0 byte trên Free -> tự dựng gói chuẩn ToCam + #1ED760", () => {
  const out = runResponse(Buffer.alloc(0), URL_BADGE);
  assert.ok(out && out.body && out.body.length > 0, "không dựng badge khi body rỗng");
  const fields = decode(Buffer.from(out.body));
  assert.strictEqual(one(fields, 1).v, 1);
  assert.strictEqual(one(fields, 2).p.toString("utf8"), "ToCam");
  assert.strictEqual(one(fields, 3).p.toString("utf8"), "#1ED760");
});

console.log("\n=== TEST V2.6: PLAYBACK-SETTINGS & CHẤT LƯỢNG RẤT CAO ===\n");

test("playback-settings gRPC: cặp {1: 'audio.streaming_quality', 2: submessage{1: 2}} KHÔNG bị đè hỏng thành wire-type 6", () => {
  const subVal = fVarint(1, 2); // enum NORMAL = 2
  const entry = cat(fStr(1, "audio.streaming_quality"), fBytes(2, subVal));
  const body = gframe(0x00, fBytes(1, entry));
  const out = runResponse(body, URL_SETTINGS);
  assert.ok(out && out.body, "không patch submessage quality");
  const fr = gframes(Buffer.from(out.body));
  const decodedRoot = decode(fr[0].payload);
  const decodedEntry = decode(one(decodedRoot, 1).p);
  const decodedVal = decode(one(decodedEntry, 2).p); // phải parse được như protobuf hợp lệ!
  assert.strictEqual(one(decodedVal, 1).v, 4, "enum NORMAL=2 phải nâng lên VERY_HIGH=4 mà giữ nguyên cấu trúc submessage");
});

test("playback-settings gRPC: cặp {1: 'streaming_quality', 2: submessage{1: 'HIGH'}} -> nâng chuỗi bên trong submessage", () => {
  const subVal = fStr(1, "HIGH");
  const entry = cat(fStr(1, "streaming_quality"), fBytes(2, subVal));
  const body = gframe(0x00, fBytes(1, entry));
  const out = runResponse(body, URL_SETTINGS);
  assert.ok(out && out.body);
  const fr = gframes(Buffer.from(out.body));
  const decodedEntry = decode(one(decode(fr[0].payload), 1).p);
  const decodedVal = decode(one(decodedEntry, 2).p);
  assert.strictEqual(one(decodedVal, 1).p.toString("utf8"), "VERY_HIGH");
});

test("spotify-request.js v2.6: xóa grpc-accept-encoding & accept-encoding trên pam-view-service và playback-settings", () => {
  for (const u of [URL_BADGE, URL_SETTINGS, URL_CAPS, URL_FORTUNE]) {
    const out = runRequest(u, {
      Authorization: "Bearer token",
      "If-None-Match": "W/123",
      "Accept-Encoding": "gzip, deflate, br",
      "grpc-accept-encoding": "gzip,identity",
    });
    assert.ok(out && out.headers, "request không được dọn cho " + u);
    const keys = Object.keys(out.headers).map((k) => k.toLowerCase());
    assert.ok(!keys.includes("if-none-match"), "còn if-none-match trên " + u);
    assert.ok(!keys.includes("grpc-accept-encoding"), "còn grpc-accept-encoding trên " + u);
    assert.strictEqual(out.headers["Accept-Encoding"], "identity");
  }
});

test("Shadowrocket string body: khi $response.body là string JSON (không có bodyBytes) vẫn patch được", () => {
  const jsonStr = JSON.stringify({ badge: { text: "Free", color: "#535353" }, audio: { quality: "HIGH", bitrate: 160 } });
  const out = runResponse(jsonStr, URL_PLANROW, { via: "string" });
  assert.ok(out && out.body, "không patch được string body");
  const parsed = JSON.parse(typeof out.body === "string" ? out.body : Buffer.from(out.body).toString("utf8"));
  assert.strictEqual(parsed.badge.text, "ToCam");
  assert.strictEqual(parsed.badge.color, "#1ED760");
  assert.strictEqual(parsed.audio.quality, "VERY_HIGH");
  assert.strictEqual(parsed.audio.bitrate, 320);
});

test("nebula deep attributes: AccountAttributes bọc trong submessage vẫn được bơm high-bitrate=true và offline=true", () => {
  const attrEntry = fBytes(1, cat(fStr(1, "catalogue"), fBytes(2, fStr(4, "free"))));
  const wrappedNebula = fBytes(1, attrEntry); // bọc ở field 1
  const out = runResponse(wrappedNebula, URL_NEBULA);
  assert.ok(out && out.body, "không patch được wrapped nebula");
  const inner = one(decode(Buffer.from(out.body)), 1).p;
  const map = {};
  for (const e of pick(decode(inner), 1)) {
    const ef = decode(e.p);
    const k = one(ef, 1).p.toString("utf8");
    const vf = decode(one(ef, 2).p);
    const b = one(vf, 2);
    const s = one(vf, 4);
    map[k] = b ? b.v === 1 : s ? s.p.toString("utf8") : null;
  }
  assert.strictEqual(map["catalogue"], "premium");
  assert.strictEqual(map["high-bitrate"], true);
  assert.strictEqual(map["offline"], true);
  assert.strictEqual(map["unlimited-skips"], true);
});

test("remote-config: cờ mới trong ios-settings-mediaqualitypageplugin-impl có chữ upsell/lock tự động gạt về false", () => {
  const ident = cat(fStr(1, "ios-settings-mediaqualitypageplugin-impl"), fStr(2, "very_high_premium_upsell_enabled"));
  const av = fBytes(3, cat(fBytes(1, ident), fBytes(3, fVarint(1, 1))));
  const out = runResponse(av, URL_RC);
  assert.ok(out && out.body);
  const avOut = decode(one(decode(Buffer.from(out.body)), 3).p);
  const boolVal = one(avOut, 3).p;
  assert.strictEqual(boolVal.length, 0, "BoolValue phải bị gạt về rỗng (false)");
});

console.log("\n--------------------------------------------------------------");
console.log("  PASS: " + pass + "    FAIL: " + fail);
console.log("--------------------------------------------------------------\n");
process.exit(fail === 0 ? 0 : 1);
