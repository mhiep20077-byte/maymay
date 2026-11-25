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
  const store = {};
  const resp = { headers: {} };
  resp[statusKey] = status;
  if (via === "bytes") resp.bodyBytes = body ? new Uint8Array(body) : undefined;
  else if (via === "string") resp.body = typeof body === "string" ? body : Buffer.from(body).toString("utf8");
  else resp.body = body ? new Uint8Array(body) : undefined;
  const sandbox = {
    $request: { url, method: "GET", headers: {} },
    $response: resp,
    $persistentStore: {
      read: (k) => (k in store ? store[k] : null),
      write: (v, k) => {
        store[k] = String(v);
        return true;
      },
    },
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
  return { captured, store };
}

const URL_BADGE =
  "https://gae2-spclient.spotify.com/pam-view-service/spotify.pam.v2.PamViewService/GetYourPremiumBadge";
const URL_PLAN =
  "https://gae2-spclient.spotify.com/pam-view-service/spotify.pam.v2.PamViewService/GetPlanOverview";
const URL_SHOW_PLAN =
  "https://gae2-spclient.spotify.com/pam-view-service/spotify.pam.v2.PamViewService/GetShowValuePlanOverview";
const URL_PLANROW =
  "https://gae2-spclient.spotify.com/pam-view-service/v1/GetPremiumPlanRow?locale=vi";
const URL_CAPS =
  "https://gae2-spclient.spotify.com/device-capabilities/v1/capabilities?device_type=smartphone";
const URL_RC =
  "https://gae2-spclient.spotify.com/remote-config-resolver/v3/configuration";

console.log("\n=== TEST V2.6.2: BADGE 23B (TOCAM) & PLANROW 68B->116B (#B3B3B3 -> #1ED760) ===\n");

test("GetYourPremiumBadge: body rỗng 0B trên Free -> dựng đúng 3 field: f1='ToCam', f2=2, f3='#1ED760'", () => {
  const { captured: out } = runResponse(Buffer.alloc(0), URL_BADGE);
  assert.ok(out && out.body && out.body.length > 0);
  const fields = decode(Buffer.from(out.body));
  assert.strictEqual(one(fields, 1).p.toString("utf8"), "ToCam");
  assert.strictEqual(one(fields, 2).v, 2);
  assert.strictEqual(one(fields, 3).p.toString("utf8"), "#1ED760");
});

test("GetPremiumPlanRow proto (Free 68B: 'Spotify Free' + 'Spotify Free' + '#B3B3B3') -> 'Premium Individual' + 'Individual' + '#1ED760'", () => {
  const freePlanRow68B = cat(fStr(1, "Spotify Free"), fStr(2, "#B3B3B3"), fStr(3, "Spotify Free"));
  const { captured: out, store } = runResponse(freePlanRow68B, URL_PLANROW);
  assert.ok(out && out.body);
  const fields = decode(Buffer.from(out.body));
  assert.strictEqual(one(fields, 1).p.toString("utf8"), "Premium Individual");
  assert.strictEqual(one(fields, 2).p.toString("utf8"), "#1ED760");
  assert.strictEqual(one(fields, 3).p.toString("utf8"), "Individual");
  assert.ok(store.spotcap_buf && store.spotcap_buf.indexOf("planrow|200|") === 0, "chưa gom hex vào spotcap_buf");
});

test("GetPlanOverview (944B) & GetShowValuePlanOverview (1837B): điền đủ field chữ to 'Individual' + màu '#1ED760'/'1ED760', giữ nguyên varint 0", () => {
  const planCard = cat(fVarint(1, 1), fStr(3, "Spotify Free"), fStr(6, "1 tài khoản Free"));
  const otherCard = cat(fVarint(1, 0), fStr(2, "Premium"), fStr(3, "#FFFFFF"));
  const { captured: out1 } = runResponse(cat(fBytes(1, planCard), fBytes(2, otherCard)), URL_PLAN);
  assert.ok(out1 && out1.body);
  const r1 = decode(Buffer.from(out1.body));
  const c1 = decode(one(r1, 1).p);
  assert.strictEqual(one(c1, 1).v, 2);
  assert.strictEqual(one(c1, 3).p.toString("utf8"), "Premium Individual");
  assert.strictEqual(one(c1, 4).p.toString("utf8"), "Individual");
  assert.strictEqual(one(c1, 5).p.toString("utf8"), "#1ED760");
  const c2 = decode(one(r1, 2).p);
  assert.strictEqual(one(c2, 1).v, 0);
  assert.strictEqual(one(c2, 2).p.toString("utf8"), "Premium");

  const showCard = cat(fStr(1, "Spotify Free"), fStr(4, "spotify:internal:unboxing:main-hub"));
  const { captured: out2 } = runResponse(cat(fStr(1, "Gói của bạn"), fBytes(2, showCard)), URL_SHOW_PLAN);
  assert.ok(out2 && out2.body);
  const r2 = decode(Buffer.from(out2.body));
  const sc = decode(one(r2, 2).p);
  assert.strictEqual(one(sc, 1).p.toString("utf8"), "Premium Individual");
  assert.strictEqual(one(sc, 2).p.toString("utf8"), "Individual");
  assert.strictEqual(one(sc, 3).p.toString("utf8"), "1ED760");
});

test("v1/capabilities JSON (574B Free -> 583B Premium): sửa cả audio_quality='VERY_HIGH' lẫn effective_license='premium' và can_play_on_demand=true (không bị short-circuit bởi ||)", () => {
  const freeCaps = JSON.stringify({
    audio_quality: "HIGH",
    effective_license: "free",
    can_play_on_demand: false,
    supports_offline: false,
  });
  const { captured: out } = runResponse(Buffer.from(freeCaps), URL_CAPS);
  assert.ok(out && out.body);
  const obj = JSON.parse(Buffer.from(out.body).toString("utf8"));
  assert.strictEqual(obj.audio_quality, "VERY_HIGH");
  assert.strictEqual(obj.effective_license, "premium", "effective_license bị bỏ sót do short-circuit ||");
  assert.strictEqual(obj.can_play_on_demand, true);
  assert.strictEqual(obj.supports_offline, true);
});

test("v3/configuration (100KB Free): tự động gạt BoolValue=false cho ios-reinventfree-timecaupsellpage-impl", () => {
  const ident = cat(fStr(1, "ios-reinventfree-timecaupsellpage-impl"), fStr(2, "is_enabled"));
  const av = fBytes(3, cat(fBytes(1, ident), fBytes(3, fVarint(1, 1))));
  const { captured: out } = runResponse(av, URL_RC);
  assert.ok(out && out.body);
  const avOut = decode(one(decode(Buffer.from(out.body)), 3).p);
  assert.strictEqual(one(avOut, 3).p.length, 0);
});

console.log("\n--------------------------------------------------------------");
console.log("  PASS: " + pass + "    FAIL: " + fail);
console.log("--------------------------------------------------------------\n");
process.exit(fail === 0 ? 0 : 1);
