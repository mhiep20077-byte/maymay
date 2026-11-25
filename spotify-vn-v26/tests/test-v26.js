#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");
const vm = require("vm");
const assert = require("assert");

const ROOT = path.resolve(__dirname, "..");
const SCRIPT_RESPONSE = path.join(ROOT, "scripts", "spotify-premium.js");
const SCRIPT_REQUEST = path.join(ROOT, "scripts", "spotify-request.js");

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
const URL_PLAN =
  "https://gae2-spclient.spotify.com/pam-view-service/spotify.pam.v2.PamViewService/GetPlanOverview";
const URL_SHOW_PLAN =
  "https://gae2-spclient.spotify.com/pam-view-service/spotify.pam.v2.PamViewService/GetShowValuePlanOverview";
const URL_PLANROW =
  "https://gae2-spclient.spotify.com/pam-view-service/v1/GetPremiumPlanRow?locale=vi";
const URL_SETTINGS =
  "https://gae2-spclient.spotify.com/playback-settings/spotify.playbacksettings.PlaybackSettingsService/GetDeviceSettings";
const URL_CAPS =
  "https://gae2-spclient.spotify.com/device-capabilities/v1/capabilities?device_type=smartphone";
const URL_FORTUNE =
  "https://gae2-spclient.spotify.com/net-fortune/v2/fortune?bandwidth=7250555&request_type=interactive";
const URL_NEBULA =
  "https://gae2-spclient.spotify.com/nebula/v1/configuration/attributes";
const URL_RC =
  "https://gae2-spclient.spotify.com/remote-config-resolver/v3/configuration";

console.log("\n=== TEST V2.6.1: GETYOURPREMIUMBADGE (GIỮ NGUYÊN TOCAM) ===\n");

test("GetYourPremiumBadge (exact 23B hex từ Ảnh 14): 0a0a'Individual'10021a07'#1ED760' -> 'ToCam' + 2 + '#1ED760'", () => {
  const realHex23B = Buffer.from("0a0a496e646976696475616c10021a0723314544373630", "hex");
  assert.strictEqual(realHex23B.length, 23);
  const out = runResponse(realHex23B, URL_BADGE);
  assert.ok(out && out.body);
  const fields = decode(Buffer.from(out.body));
  assert.strictEqual(one(fields, 1).p.toString("utf8"), "ToCam");
  assert.strictEqual(one(fields, 2).v, 2);
  assert.strictEqual(one(fields, 3).p.toString("utf8"), "#1ED760");
});

test("GetYourPremiumBadge trên Free ('Spotify Free' + '#535353') -> 'ToCam' + '#1ED760'", () => {
  const freeBadge = cat(fStr(1, "Spotify Free"), fVarint(2, 0), fStr(3, "#535353"));
  const out = runResponse(freeBadge, URL_BADGE);
  assert.ok(out && out.body);
  const fields = decode(Buffer.from(out.body));
  assert.strictEqual(one(fields, 1).p.toString("utf8"), "ToCam");
  assert.strictEqual(one(fields, 2).v, 1);
  assert.strictEqual(one(fields, 3).p.toString("utf8"), "#1ED760");
});

console.log("\n=== TEST V2.6.1: GETPLANOVERVIEW & GETSHOWVALUEPLANOVERVIEW (SỬA LỖI TRỐNG THẺ) ===\n");

test("GetPlanOverview (Ảnh 4 & Ảnh 10): điền đủ Field 3='Premium Individual', Field 4='Individual', Field 5='#1ED760' và GIỮ NGUYÊN varint 0 của component khác", () => {
  // Mô phỏng GetPlanOverview trên nick Free:
  // Submessage 1 (PlanCard): field 1 varint = 1 (FREE), field 3 = "Spotify Free", field 6 = "1 tài khoản Free"
  // Submessage 2 (Other UI Card): field 1 varint = 0 (component_type = 0), field 2 = "Premium" (logo brand!)
  const planCard = cat(fVarint(1, 1), fStr(3, "Spotify Free"), fStr(6, "1 tài khoản Free"));
  const otherCard = cat(fVarint(1, 0), fStr(2, "Premium"), fStr(3, "#FFFFFF"));
  const body = cat(fBytes(1, planCard), fBytes(2, otherCard));
  const out = runResponse(body, URL_PLAN);
  assert.ok(out && out.body, "không patch GetPlanOverview");
  const root = decode(Buffer.from(out.body));
  const c1 = decode(one(root, 1).p);
  assert.strictEqual(one(c1, 1).v, 2, "tier 1 (FREE) phải lên 2 (INDIVIDUAL)");
  assert.strictEqual(one(c1, 3).p.toString("utf8"), "Premium Individual");
  assert.strictEqual(one(c1, 4).p.toString("utf8"), "Individual", "phải bù Field 4 = Individual");
  assert.strictEqual(one(c1, 5).p.toString("utf8"), "#1ED760", "phải bù Field 5 = #1ED760");
  assert.strictEqual(one(c1, 6).p.toString("utf8"), "1 tài khoản Premium");

  const c2 = decode(one(root, 2).p);
  assert.strictEqual(one(c2, 1).v, 0, "TUYỆT ĐỐI KHÔNG được đổi varint 0 của component UI khác thành 1!");
  assert.strictEqual(one(c2, 2).p.toString("utf8"), "Premium", "chuỗi 'Premium' không được bị parse() nhầm thành protobuf hay đổi thành ToCam!");
  assert.strictEqual(one(c2, 3).p.toString("utf8"), "#FFFFFF", "màu trắng #FFFFFF không được bị đổi thành #1ED760!");
});

test("GetShowValuePlanOverview (Ảnh 3 & Ảnh 15): điền đủ Field 1='Premium Individual', Field 2='Individual', Field 3='1ED760' (không dấu #)", () => {
  const subCard = cat(fStr(1, "Spotify Free"), fStr(4, "spotify:internal:unboxing:main-hub"));
  const body = cat(fStr(1, "Gói của bạn"), fBytes(2, subCard));
  const out = runResponse(body, URL_SHOW_PLAN);
  assert.ok(out && out.body, "không patch GetShowValuePlanOverview");
  const root = decode(Buffer.from(out.body));
  assert.strictEqual(one(root, 1).p.toString("utf8"), "Gói Premium của bạn");
  const card = decode(one(root, 2).p);
  assert.strictEqual(one(card, 1).p.toString("utf8"), "Premium Individual");
  assert.strictEqual(one(card, 2).p.toString("utf8"), "Individual", "phải bù Field 2 = Individual");
  assert.strictEqual(one(card, 3).p.toString("utf8"), "1ED760", "phải bù Field 3 = 1ED760 (không dấu # như Ảnh 15)");
  assert.strictEqual(one(card, 4).p.toString("utf8"), "spotify:internal:unboxing:main-hub");
});

console.log("\n=== TEST V2.6.1: PLAYBACK-SETTINGS & CHẤT LƯỢNG RẤT CAO ===\n");

test("nebula attributes: giữ đúng kiểu field 4 (string '0' -> '1') hoặc field 3 (long 0 -> 1) nếu server gửi kiểu đó cho high-bitrate/offline", () => {
  const e1 = fBytes(1, cat(fStr(1, "high-bitrate"), fBytes(2, fStr(4, "0"))));
  const e2 = fBytes(1, cat(fStr(1, "offline"), fBytes(2, fVarint(3, 0))));
  const e3 = fBytes(1, cat(fStr(1, "streaming-max-quality"), fBytes(2, fStr(4, "160"))));
  const out = runResponse(cat(e1, e2, e3), URL_NEBULA);
  assert.ok(out && out.body);
  const entries = pick(decode(Buffer.from(out.body)), 1);
  const byKey = {};
  for (const e of entries) {
    const inner = decode(e.p);
    const k = one(inner, 1).p.toString("utf8");
    byKey[k] = decode(one(inner, 2).p);
  }
  assert.strictEqual(one(byKey["high-bitrate"], 4).p.toString("utf8"), "1", "phải giữ kiểu string '1' ở field 4");
  assert.strictEqual(one(byKey["offline"], 3).v, 1, "phải giữ kiểu long 1 ở field 3");
  assert.ok(!("streaming-max-quality" in byKey), "streaming-max-quality phải bị xóa");
});

test("playback-settings gRPC: cặp {1: 'audio.streaming_quality', 2: submessage{1: 2}} nâng lên 4 giữ nguyên submessage", () => {
  const subVal = fVarint(1, 2);
  const entry = cat(fStr(1, "audio.streaming_quality"), fBytes(2, subVal));
  const body = gframe(0x00, fBytes(1, entry));
  const out = runResponse(body, URL_SETTINGS);
  assert.ok(out && out.body);
  const fr = gframes(Buffer.from(out.body));
  const decodedEntry = decode(one(decode(fr[0].payload), 1).p);
  const decodedVal = decode(one(decodedEntry, 2).p);
  assert.strictEqual(one(decodedVal, 1).v, 4);
});

test("spotify-request.js v2.6.1: bắt cả v4/login, offline, connect-state, capping-api, identity", () => {
  const urls = [
    "https://login5.spotify.com/v4/login",
    "https://gae2-spclient.spotify.com/offline/v1/devices",
    "https://gae2-spclient.spotify.com/connect-state/v1/devices/abc",
    "https://gae2-spclient.spotify.com/capping-api/spotify.cappingapi.v1.CappingApi/PutConsumption",
    "https://gae2-spclient.spotify.com/identity/v3/user/username/abc",
  ];
  for (const u of urls) {
    const out = runRequest(u, { "If-None-Match": "W/1", "Accept-Encoding": "gzip" });
    assert.ok(out && out.headers, "bỏ sót URL: " + u);
    assert.strictEqual(out.headers["Accept-Encoding"], "identity");
  }
});

console.log("\n--------------------------------------------------------------");
console.log("  PASS: " + pass + "    FAIL: " + fail);
console.log("--------------------------------------------------------------\n");
process.exit(fail === 0 ? 0 : 1);
