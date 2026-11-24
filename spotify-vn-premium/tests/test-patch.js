#!/usr/bin/env node
// ============================================================================
// spotify-vn-premium / tests/test-patch.js
// Test offline: không cần mạng, không cần Spotify, không cần tài khoản.
//
// Cách làm: dựng protobuf giả đúng layout thật (BootstrapMessage / CustomizeMessage
// / UcsResponse), chạy script trong sandbox giả lập Shadowrocket (chỉ có
// $request / $response / $done, KHÔNG có TextEncoder), rồi decode kết quả ra
// kiểm tra từng field.
//
//   node tests/test-patch.js
// ============================================================================

"use strict";

const fs = require("fs");
const path = require("path");
const vm = require("vm");
const assert = require("assert");

const ROOT = path.resolve(__dirname, "..");
const SCRIPT_RESPONSE = path.join(ROOT, "scripts", "spotify-premium.js");
const SCRIPT_REQUEST = path.join(ROOT, "scripts", "spotify-request.js");
const MODULE_FILE = path.join(ROOT, "spotify-vn-premium.module");

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

// ------------------------------------------------------------------ protobuf

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

// ------------------------------------------------------- dựng protobuf giả

function assigned(scope, name, valueBytes) {
  const f = [fStr(1, scope), fStr(2, name)];
  if (valueBytes) f.push(fBytes(3, valueBytes));
  return fBytes(1, cat(...f)); // AssignedValue
}
const boolOn = Buffer.from([0x08, 0x01]); // BoolValue{1:true}
const boolOff = Buffer.alloc(0); // BoolValue{} => false

function attr(key, value) {
  const inner = typeof value === "string" ? fStr(4, value) : fVarint(2, value ? 1 : 0);
  return fBytes(1, cat(fStr(1, key), fBytes(2, inner)));
}

function buildUcs({ withResolve = true, attrs = true } = {}) {
  const parts = [];
  if (withResolve) {
    // UcsResponse.1 = ResolveResponse.1 = ResolveConfiguration{3: AssignedValue*}
    const config = cat(
      assigned("ios-feature-settings", "crossfade_enabled", boolOff),
      assigned("", "enable_ads", null),
      assigned("", "enable_free_on_demand_experiment", null),
      assigned("", "playback_timeout_action", null)
    );
    parts.push(fBytes(1, fBytes(1, config)));
  }
  if (attrs) {
    // UcsResponse.3 = AccountAttributesResponse{1: entry{1:key, 2:AccountAttribute}}
    parts.push(
      fBytes(
        3,
        cat(
          attr("catalogue", "free"),
          attr("type", "free"),
          attr("player-license", "free"),
          attr("payment-state", "ok"),
          attr("ads", true),
          attr("khong-lien-quan", "giu-nguyen")
        )
      )
    );
  }
  parts.push(fVarint(7, 12345)); // field lạ — phải sống sót
  return cat(...parts);
}

// BootstrapMessage 2 { 1 { 1 CustomizeMessage { 1 UcsResponse } } }
const buildBootstrap = () => fBytes(2, fBytes(1, fBytes(1, fBytes(1, buildUcs()))));
// CustomizeMessage { 1: UcsResponse }
const buildCustomize = () => fBytes(1, buildUcs());

// ------------------------------------------------------------------ sandbox

function runResponse(
  body,
  url,
  { status = 200, withTextCodec = false, via = "body", statusKey = "status", argument = undefined } = {}
) {
  let captured = null;
  const resp = { headers: {} };
  resp[statusKey] = status;
  if (via === "bytes") resp.bodyBytes = body ? new Uint8Array(body) : undefined;
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

// ------------------------------------------------- đọc kết quả cho dễ assert

function ucsFromBootstrap(buf) {
  const l1 = decode(buf);
  const a = one(l1, 2);
  assert.ok(a, "mất field 2 của BootstrapMessage");
  const b = one(decode(a.p), 1);
  assert.ok(b, "mất field 1 cấp 2");
  const c = one(decode(b.p), 1);
  assert.ok(c, "mất CustomizeMessage");
  const d = one(decode(c.p), 1);
  assert.ok(d, "mất UcsResponse");
  return Buffer.from(d.p);
}

const ucsFromCustomize = (buf) => {
  const d = one(decode(buf), 1);
  assert.ok(d, "mất UcsResponse");
  return Buffer.from(d.p);
};

function attrsMap(ucsBuf) {
  const a = one(decode(ucsBuf), 3);
  assert.ok(a, "không thấy field 3 (AccountAttributesResponse)");
  const map = {};
  for (const e of pick(decode(a.p), 1)) {
    const inner = decode(e.p);
    const key = one(inner, 1).p.toString("utf8");
    const val = decode(one(inner, 2).p);
    const b = one(val, 2);
    const s = one(val, 4);
    map[key] = b ? b.v === 1 : s ? s.p.toString("utf8") : null;
  }
  return map;
}

function configMap(ucsBuf) {
  const resolve = one(decode(ucsBuf), 1);
  assert.ok(resolve, "không thấy ResolveResponse");
  const config = one(decode(resolve.p), 1);
  assert.ok(config, "không thấy ResolveConfiguration");
  const map = {};
  for (const av of pick(decode(config.p), 3)) {
    const f = decode(av.p);
    const ident = decode(one(f, 1).p);
    const scope = one(ident, 1).p.toString("utf8");
    const name = one(ident, 2).p.toString("utf8");
    const val = one(f, 3);
    map[(scope || "") + "|" + name] = val && val.p && val.p.length ? decode(val.p) : [];
  }
  return map;
}

// -------------------------------------------------------------------- tests

const URL_BOOT = "https://spclient.wg.spotify.com/bootstrap/v1/bootstrap?market=VN&product=premium";
const URL_UCS = "https://gew1-spclient.spotify.com/user-customization-service/v1/customize";

const bootstrapBody = buildBootstrap();
const outBoot = runResponse(bootstrapBody, URL_BOOT);

console.log("\n[1] Response script — sandbox KHÔNG có TextEncoder (giống Shadowrocket)\n");

test("script chạy được, trả body mới (không chết vì thiếu TextEncoder)", () => {
  assert.ok(outBoot, "$done không được gọi");
  assert.ok(outBoot.body && outBoot.body.length, "không trả body mới");
});

test("bootstrap: catalogue / type / player-license -> premium", () => {
  const a = attrsMap(ucsFromBootstrap(Buffer.from(outBoot.body)));
  assert.strictEqual(a.catalogue, "premium");
  assert.strictEqual(a.type, "premium");
  assert.strictEqual(a["player-license"], "premium");
  assert.strictEqual(a["player-license-v2"], "premium");
  assert.strictEqual(a.unrestricted, true);
});

test("bootstrap: ads = false", () => {
  assert.strictEqual(attrsMap(ucsFromBootstrap(Buffer.from(outBoot.body))).ads, false);
});

test("bootstrap: payment-state bị xoá (nguồn gốc 'rớt về free')", () => {
  const a = attrsMap(ucsFromBootstrap(Buffer.from(outBoot.body)));
  assert.ok(!("payment-state" in a), "payment-state vẫn còn");
});

test("bootstrap: attr không liên quan giữ nguyên", () => {
  assert.strictEqual(
    attrsMap(ucsFromBootstrap(Buffer.from(outBoot.body)))["khong-lien-quan"],
    "giu-nguyen"
  );
});

test("bootstrap: remote config crossfade = bật, rule ad bị xoá", () => {
  const cfg = configMap(ucsFromBootstrap(Buffer.from(outBoot.body)));
  assert.deepStrictEqual(cfg["ios-feature-settings|crossfade_enabled"], [{ no: 1, w: 0, v: 1 }]);
  assert.ok(!("|enable_ads" in cfg), "enable_ads chưa bị xoá");
  assert.ok(!("|enable_free_on_demand_experiment" in cfg), "rule free on-demand chưa bị xoá");
  assert.ok(!("|playback_timeout_action" in cfg), "rule playback_timeout_action chưa bị xoá");
});

test("bootstrap: cấu trúc ngoài còn nguyên (2 và field lạ 99)", () => {
  const body = cat(buildBootstrap(), fVarint(99, 7));
  const out = runResponse(body, URL_BOOT);
  const fields = decode(Buffer.from(out.body));
  assert.ok(one(fields, 2), "mất field 2");
  assert.strictEqual(one(fields, 99).v, 7);
});

test("CustomizeMessage gửi trực tiếp cũng patch được (UCS endpoint)", () => {
  const out = runResponse(buildCustomize(), URL_UCS);
  assert.ok(out && out.body, "không patch được");
  assert.strictEqual(attrsMap(ucsFromCustomize(Buffer.from(out.body))).catalogue, "premium");
});

test("UCS: field lạ 7 giữ nguyên", () => {
  const out = runResponse(buildCustomize(), URL_UCS);
  const ucs = ucsFromCustomize(Buffer.from(out.body));
  assert.strictEqual(one(decode(ucs), 7).v, 12345);
});

test("UCS: chỉ có attributes, không có resolve -> vẫn set premium", () => {
  const body = fBytes(1, buildUcs({ withResolve: false }));
  const out = runResponse(body, URL_UCS);
  assert.ok(out && out.body);
  assert.strictEqual(attrsMap(ucsFromCustomize(Buffer.from(out.body))).catalogue, "premium");
});

console.log("\n[2] Response script — sandbox CÓ TextEncoder (đối chứng)\n");

test("kết quả giống hệt bản không có TextEncoder (byte-for-byte)", () => {
  const a = runResponse(bootstrapBody, URL_BOOT);
  const b = runResponse(bootstrapBody, URL_BOOT, { withTextCodec: true });
  assert.ok(a.body && b.body);
  assert.strictEqual(Buffer.from(a.body).toString("hex"), Buffer.from(b.body).toString("hex"));
});

console.log("\n[2b] Tương thích host Shadowrocket\n");

test("body đi vào qua $response.bodyBytes -> vẫn patch", () => {
  const out = runResponse(bootstrapBody, URL_BOOT, { via: "bytes" });
  assert.ok(out && out.body, "không nhận được bodyBytes");
  assert.strictEqual(attrsMap(ucsFromBootstrap(Buffer.from(out.body))).catalogue, "premium");
});

test("status đi vào qua $response.statusCode -> vẫn nhận 304", () => {
  const out = runResponse(bootstrapBody, URL_BOOT, { status: 304, statusKey: "statusCode" });
  assert.strictEqual(Object.keys(out).length, 0, "304 phải bị bỏ qua");
});

console.log("\n[3] Response script — các case phải bỏ qua (không phá app)\n");

test("304 -> không sửa gì", () => {
  const out = runResponse(bootstrapBody, URL_BOOT, { status: 304 });
  assert.strictEqual(Object.keys(out).length, 0, "trả object rỗng");
});

test("body rác -> không trả body hỏng", () => {
  const out = runResponse(Buffer.from("day khong phai protobuf"), URL_BOOT);
  assert.ok(!out.body, "đã trả body mới cho dữ liệu rác");
});

test("body rỗng -> không crash", () => {
  const out = runResponse(Buffer.alloc(0), URL_BOOT);
  assert.strictEqual(Object.keys(out).length, 0);
});

test("protobuf bị cắt cụt -> bỏ qua, không trả body hỏng", () => {
  const truncated = bootstrapBody.subarray(0, bootstrapBody.length - 7);
  const out = runResponse(truncated, URL_BOOT);
  assert.ok(!out.body, "đã trả body cho dữ liệu cụt");
});

console.log("\n[4] Request script — bỏ header gây 304\n");

const REQ_HEADERS = {
  Authorization: "Bearer abc",
  "if-none-match": 'W/"1234"',
  "If-Modified-Since": "Tue, 01 Jan 2026 00:00:00 GMT",
  "Accept-Encoding": "gzip, deflate, br",
  "User-Agent": "Spotify/9.0.0 iOS",
};

test("bỏ if-none-match / if-modified-since, giữ Authorization", () => {
  const out = runRequest(URL_BOOT, { ...REQ_HEADERS });
  const h = out.headers || {};
  const lower = Object.keys(h).map((k) => k.toLowerCase());
  assert.ok(!lower.includes("if-none-match"), "if-none-match còn");
  assert.ok(!lower.includes("if-modified-since"), "if-modified-since còn");
  assert.strictEqual(h.Authorization, "Bearer abc");
  assert.strictEqual(h["User-Agent"], "Spotify/9.0.0 iOS");
  assert.strictEqual(h["Cache-Control"], "no-cache");
  assert.strictEqual(h["Accept-Encoding"], "identity");
});

test("URL không thuộc 2 endpoint mục tiêu -> không đụng gì", () => {
  const out = runRequest("https://api.spotify.com/v1/me", { ...REQ_HEADERS });
  assert.strictEqual(Object.keys(out).length, 0);
});

console.log("\n[5] Cấu trúc repo / module\n");

test("mọi script-path trong module trỏ tới file có thật, không rỗng", () => {
  const mod = fs.readFileSync(MODULE_FILE, "utf8");
  const paths = [...mod.matchAll(/script-path=([^,\n]+)/g)].map((m) => m[1].trim());
  assert.ok(paths.length >= 2, "module không có đủ 2 script");
  for (const p of paths) {
    // chấp nhận cả lúc chưa set-repo (__RAW_BASE__) và sau khi set-repo (URL thật)
    const rel = p
      .replace(/^__RAW_BASE__\//, "")
      .replace(/^https?:\/\/[^,]+?\/(scripts|optional)\//, "$1/");
    const abs = path.join(ROOT, rel);
    assert.ok(fs.existsSync(abs), "thiếu file: " + rel);
    assert.ok(fs.statSync(abs).size > 0, "file rỗng: " + rel);
  }
});

test("pattern trong module là regex hợp lệ", () => {
  const mod = fs.readFileSync(MODULE_FILE, "utf8");
  const pats = [...mod.matchAll(/pattern=([^,\n]+)/g)].map((m) => m[1].trim());
  assert.ok(pats.length >= 1);
  for (const p of pats) new RegExp(p);
});

test("module chặn QUIC/UDP cho spotify.com", () => {
  assert.ok(/PROTOCOL,UDP/.test(fs.readFileSync(MODULE_FILE, "utf8")), "thiếu rule chặn UDP");
});

test("module patch đúng endpoint của client mới, không đụng metadata/lyrics", () => {
  const mod = fs.readFileSync(MODULE_FILE, "utf8");
  const resp = mod.split("\n").find((l) => l.startsWith("SpotifyVN Response"));
  assert.ok(resp.includes("bootstrap|user-customization-service"), "mất endpoint cũ");
  assert.ok(resp.includes("nebula"), "thiếu nebula (client 9.2.x dùng cái này)");
  assert.ok(resp.includes("remote-config-resolver"), "thiếu remote-config-resolver");
  assert.ok(!/metadata|lyrics|chroma/.test(resp), "pattern response lan sang metadata/lyrics");
});

test("MITM hostname dùng wildcard hợp lệ (không dùng *-spclient)", () => {
  const mod = fs.readFileSync(MODULE_FILE, "utf8");
  const line = mod.split("\n").find((l) => l.startsWith("hostname"));
  assert.ok(line, "thiếu dòng hostname");
  // Shadowrocket/Surge chỉ hiểu wildcard ở ĐẦU nhãn: *.spotify.com.
  // "*-spclient.spotify.com" KHÔNG khớp host nào => MITM im lặng => patch không chạy.
  assert.ok(!/\*-/.test(line), "vẫn còn wildcard giữa nhãn: " + line);
  assert.ok(line.includes("*.spotify.com"), "thiếu *.spotify.com");
  assert.ok(line.includes("%APPEND%"), "thiếu %APPEND% (xoá sạch list cũ của app)");
});

test("pattern trong module khớp đúng URL thật lấy từ log (shard gae2)", () => {
  const mod = fs.readFileSync(MODULE_FILE, "utf8");
  const pats = [...mod.matchAll(/pattern=(\S+?),script-path=/g)].map((m) => new RegExp(m[1]));
  assert.ok(pats.length === 2, "phải có 2 script (request + response)");
  const real = [
    "https://gae2-spclient.spotify.com/remote-config-resolver/v3/configuration",
    "https://gae2-spclient.spotify.com/nebula/v1/configuration/attributes",
    "https://spclient.wg.spotify.com/bootstrap/v1/bootstrap",
    "https://gae2-spclient.spotify.com/user-customization-service/v1/customize",
  ];
  for (const u of real) for (const re of pats) assert.ok(re.test(u), "không khớp: " + u);
  const notOurs = [
    "https://gae2-spclient.spotify.com/playplay/v1/key/abc",
    "https://spclient.wg.spotify.com/metadata/4/track/abc",
    "https://audio-ak-spotify-com.akamaized.net/x",
  ];
  for (const u of notOurs) for (const re of pats) assert.ok(!re.test(u), "bắt nhầm: " + u);
});

console.log("\n[6] v2 — endpoint mới của Spotify 9.2.x\n");

const URL_NEBULA = "https://gae2-spclient.spotify.com/nebula/v1/configuration/attributes";
const URL_RC = "https://gae2-spclient.spotify.com/remote-config-resolver/v3/configuration";

test("nebula: attributes ở gốc message -> catalogue/type = premium", () => {
  const body = cat(
    attr("catalogue", "free"),
    attr("type", "free"),
    attr("payment-state", "ok"),
    attr("khong-lien-quan", "giu-nguyen")
  );
  const out = runResponse(body, URL_NEBULA);
  assert.ok(out && out.body, "không patch nebula");
  const map = {};
  for (const e of pick(decode(Buffer.from(out.body)), 1)) {
    const inner = decode(e.p);
    const key = one(inner, 1).p.toString("utf8");
    const val = decode(one(inner, 2).p);
    const b = one(val, 2);
    const s = one(val, 4);
    map[key] = b ? b.v === 1 : s ? s.p.toString("utf8") : null;
  }
  assert.strictEqual(map.catalogue, "premium");
  assert.strictEqual(map.type, "premium");
  assert.ok(!("payment-state" in map), "payment-state chưa bị xoá");
  assert.strictEqual(map["khong-lien-quan"], "giu-nguyen");
});

test("remote-config: AssignedValue ở gốc -> rule free bị xoá, crossfade bật", () => {
  // Layout thật: ResolveConfiguration { 3: AssignedValue { 1:{1:scope,2:name}, 3:BoolValue } }
  const av = (scope, name, val) => {
    const ident = fBytes(1, cat(fStr(1, scope), fStr(2, name)));
    return fBytes(3, cat(ident, val ? fBytes(3, val) : Buffer.alloc(0)));
  };
  const body = cat(
    av("ios-feature-settings", "crossfade_enabled", boolOff),
    av("", "enable_ads", boolOff),
    av("", "enable_free_on_demand_experiment", boolOff),
    fVarint(7, 99)
  );
  const out = runResponse(body, URL_RC);
  assert.ok(out && out.body, "không patch remote-config");
  const cfg = {};
  for (const e of pick(decode(Buffer.from(out.body)), 3)) {
    const f = decode(e.p);
    const ident = decode(one(f, 1).p);
    const scope = one(ident, 1).p.toString("utf8");
    const name = one(ident, 2).p.toString("utf8");
    cfg[(scope || "") + "|" + name] = one(f, 3);
  }
  assert.ok(cfg["ios-feature-settings|crossfade_enabled"], "crossfade không được set");
  // enable_ads: có trong message -> rule "set-if-present" ghi thành false (value rỗng)
  assert.ok(cfg["|enable_ads"], "enable_ads mất khỏi message");
  assert.strictEqual(cfg["|enable_ads"].p.length, 0, "enable_ads chưa bị tắt");
  assert.ok(!("|enable_free_on_demand_experiment" in cfg), "rule free on-demand chưa bị xoá");
  assert.strictEqual(one(decode(Buffer.from(out.body)), 7).v, 99, "field lạ 7 mất");
});

test("nebula lạ layout -> KHÔNG sửa (guard strict)", () => {
  const body = cat(fBytes(1, cat(fStr(1, "abc"), fBytes(2, fBytes(2, fVarint(1, 1))))));
  const out = runResponse(body, URL_NEBULA.replace("attributes", "other"));
  assert.ok(!out || !out.body, "đã sửa bừa một message lạ");
});

test("remote-config lạ layout -> KHÔNG sửa (guard strict)", () => {
  const body = cat(fBytes(3, fStr(1, "not-an-identifier")));
  const out = runResponse(body, URL_RC);
  assert.ok(!out || !out.body, "đã sửa bừa message lạ");
});

console.log("\n[8] v2.1 — product state quét cấu trúc (trang Tài khoản)\n");

const URL_PS = "https://gae2-spclient.spotify.com/product-state/v1/product_state";
const URL_PROFILE = "https://gae2-spclient.spotify.com/user-profile-view/v1/user";
const URL_LOGIN5 = "https://login5.spotify.com/v3/login";

test("JSON: product=free -> premium (product-state)", () => {
  const body = Buffer.from(JSON.stringify({ product: "free", type: "free", country: "VN", id: "x" }));
  const out = runResponse(body, URL_PS);
  assert.ok(out && out.body, "không patch JSON product-state");
  const obj = JSON.parse(Buffer.from(out.body).toString("utf8"));
  assert.strictEqual(obj.product, "premium", "product chưa đổi");
  assert.strictEqual(obj.type, "premium", "type chưa đổi");
  assert.strictEqual(obj.country, "VN", "field không liên quan bị sửa");
  assert.strictEqual(obj.id, "x", "field không liên quan bị sửa");
});

test("JSON: isPremium=false -> true", () => {
  const body = Buffer.from(JSON.stringify({ account: { isPremium: false, is_premium: false } }));
  const out = runResponse(body, URL_PROFILE);
  assert.ok(out && out.body, "không patch JSON isPremium");
  const obj = JSON.parse(Buffer.from(out.body).toString("utf8"));
  assert.strictEqual(obj.account.isPremium, true);
  assert.strictEqual(obj.account.is_premium, true);
});

test("JSON: plan/subscription/tier = free -> premium", () => {
  const body = Buffer.from(
    JSON.stringify({ plan: "free", subscription: "Free", tier: "FREE", catalogue: "free" })
  );
  const out = runResponse(body, URL_PROFILE);
  assert.ok(out && out.body);
  const obj = JSON.parse(Buffer.from(out.body).toString("utf8"));
  assert.strictEqual(obj.plan, "premium");
  assert.strictEqual(obj.subscription, "Premium");
  assert.strictEqual(obj.tier, "PREMIUM");
  assert.strictEqual(obj.catalogue, "premium");
});

test("JSON: ads=true -> false, không đụng chuỗi 'free' nằm ngoài key product", () => {
  const body = Buffer.from(
    JSON.stringify({ ads: true, product: "free", description: "free trial", name: "free" })
  );
  const out = runResponse(body, URL_PROFILE);
  const obj = JSON.parse(Buffer.from(out.body).toString("utf8"));
  assert.strictEqual(obj.ads, false, "ads chưa tắt");
  assert.strictEqual(obj.product, "premium");
  assert.strictEqual(obj.description, "free trial", "sửa bừa chuỗi ngoài key product");
  assert.strictEqual(obj.name, "free", "sửa bừa name");
});

test("JSON không có gì để sửa -> trả body nguyên, không re-encode", () => {
  const raw = '{ "a" : 1,   "b" : "ok" }';
  const out = runResponse(Buffer.from(raw), URL_PROFILE);
  assert.ok(!out || !out.body, "đã re-encode JSON không cần thiết");
});

test("protobuf: string 'free' -> 'premium' (độ dài đổi, length prefix đúng)", () => {
  const body = cat(fVarint(1, 2), fStr(2, "free"), fStr(3, "VN"), fStr(4, "giu-nguyen"));
  const out = runResponse(body, URL_PS);
  assert.ok(out && out.body, "không patch protobuf string");
  const d = decode(Buffer.from(out.body));
  assert.strictEqual(one(d, 1).v, 2, "field varint bị đụng");
  assert.strictEqual(one(d, 2).p.toString("utf8"), "premium", "string free chưa đổi");
  assert.strictEqual(one(d, 3).p.toString("utf8"), "VN", "field khác bị sửa");
  assert.strictEqual(one(d, 4).p.toString("utf8"), "giu-nguyen", "field khác bị sửa");
});

test("protobuf: FREE/Free đổi giữ đúng kiểu chữ hoa", () => {
  const body = cat(fStr(2, "FREE"), fStr(3, "Free"));
  const out = runResponse(body, URL_PS);
  const d = decode(Buffer.from(out.body));
  assert.strictEqual(one(d, 2).p.toString("utf8"), "PREMIUM");
  assert.strictEqual(one(d, 3).p.toString("utf8"), "Premium");
});

test("protobuf: token/base64 dài không bị đụng", () => {
  const token = "A".repeat(200) + "free"; // base64 dài, có chữ free bên trong
  const body = cat(fStr(1, token), fStr(2, "free"));
  const out = runResponse(body, URL_LOGIN5);
  const d = decode(Buffer.from(out.body));
  assert.strictEqual(one(d, 1).p.toString("utf8"), token, "đã sửa token");
  assert.strictEqual(one(d, 2).p.toString("utf8"), "premium");
});

test("protobuf lồng nhiều tầng: string free sâu bên trong vẫn đổi", () => {
  const inner = cat(fStr(1, "catalogue"), fStr(2, "free"));
  const body = cat(fStr(1, "root"), fBytes(5, fBytes(6, fBytes(7, inner))));
  const out = runResponse(body, URL_PROFILE);
  const d = decode(Buffer.from(out.body));
  const l5 = decode(one(d, 5).p);
  const l6 = decode(one(l5, 6).p);
  const l7 = decode(one(l6, 7).p);
  assert.strictEqual(one(l7, 2).p.toString("utf8"), "premium", "string sâu chưa đổi");
});

test("binary lạ (không JSON, không protobuf) -> không crash, trả nguyên", () => {
  const body = Buffer.from([0xff, 0x00, 0x13, 0x37, 0x66, 0x72, 0x65, 0x65]);
  const out = runResponse(body, URL_PS);
  assert.ok(!out || !out.body, "đã trả body hỏng");
});

test("endpoint media (playplay/storage-resolve) -> script bỏ qua ngay", () => {
  const body = Buffer.from(JSON.stringify({ product: "free" }));
  const out = runResponse(body, "https://gae2-spclient.spotify.com/playplay/v1/key/abc");
  assert.ok(!out || !out.body, "script vẫn chạy trên endpoint media");
});

test("module pattern khớp endpoint product-state / user-profile / login5", () => {
  const mod = fs.readFileSync(MODULE_FILE, "utf8");
  // lấy pattern của script response, bỏ escape về regex JS
  const raw = mod.match(/type=http-response,pattern=([^,]+)/)[1];
  const re = new RegExp(raw, "i");
  const urls = [
    "https://gae2-spclient.spotify.com/product-state/v1/product_state",
    "https://gew1-spclient.spotify.com/user-profile-view/v1/user",
    "https://login5.spotify.com/v3/login",
    "https://gae2-spclient.spotify.com/device-capabilities/v1/capabilities",
    "https://spclient.wg.spotify.com/bootstrap/v1/bootstrap",
    "https://gae2-spclient.spotify.com/nebula/v1/configuration/attributes",
    "https://gae2-spclient.spotify.com/remote-config-resolver/v3/configuration"
  ];
  for (const u of urls) assert.ok(re.test(u), "pattern không khớp: " + u);
  assert.ok(!re.test("https://gae2-spclient.spotify.com/playplay/v1/key/abc"), "pattern bắt nhầm playplay");
});

console.log("\n[7] gRPC — pam-view-service / playback-settings / clientrestrictions\n");

const URL_BADGE =
  "https://gae2-spclient.spotify.com/pam-view-service/spotify.pam.v2.PamViewService/GetYourPremiumBadge";
const URL_PLAN =
  "https://gae2-spclient.spotify.com/pam-view-service/spotify.pam.v2.PamViewService/GetPlanOverview";
const URL_PLANROW = "https://gae2-spclient.spotify.com/pam-view-service/v1/GetPremiumPlanRow?locale=vi";
const URL_RESTRICT =
  "https://spclient.wg.spotify.com/spotify.clientrestrictions.v1.ClientRestrictionsService/GetRestrictedIntegrations";
const URL_SETTINGS =
  "https://gae2-spclient.spotify.com/playback-settings/spotify.playbacksettings.PlaybackSettingsService/GetAllStoredContentValues";

// Khung gRPC: [flag][len 4B BE][payload]
function gframe(flag, payload) {
  const n = payload.length;
  return Buffer.concat([
    Buffer.from([flag, (n >>> 24) & 0xff, (n >>> 16) & 0xff, (n >>> 8) & 0xff, n & 0xff]),
    payload,
  ]);
}
function gframes(buf) {
  const out = [];
  let i = 0;
  while (i + 5 <= buf.length) {
    const flag = buf[i];
    const n = ((buf[i + 1] << 24) | (buf[i + 2] << 16) | (buf[i + 3] << 8) | buf[i + 4]) >>> 0;
    assert.ok(i + 5 + n <= buf.length, "khung gRPC hỏng");
    out.push({ flag, payload: Buffer.from(buf.subarray(i + 5, i + 5 + n)) });
    i += 5 + n;
  }
  assert.strictEqual(i, buf.length, "độ dài khung không khớp");
  return out;
}

test("gRPC: badge enum 0 (free) -> 1, khung giữ đúng", () => {
  const inner = cat(fVarint(1, 0));
  const out = runResponse(gframe(0x00, inner), URL_BADGE);
  assert.ok(out && out.body, "không patch badge");
  const fr = gframes(Buffer.from(out.body));
  assert.strictEqual(fr.length, 1);
  assert.strictEqual(fr[0].flag, 0x00);
  assert.strictEqual(one(decode(fr[0].payload), 1).v, 1, "enum chưa lên premium");
});

test("gRPC: badge trả 2 -> giữ nguyên (không đè badge khác)", () => {
  const out = runResponse(gframe(0x00, cat(fVarint(1, 2))), URL_BADGE);
  assert.ok(!out || !out.body, "sửa bừa badge không phải free");
});

test("gRPC: pam string 'Spotify Free' -> 'ToCam', length prefix đúng", () => {
  const inner = cat(fStr(1, "catalogue"), fStr(2, "Spotify Free"));
  const out = runResponse(gframe(0x00, inner), URL_PLAN);
  assert.ok(out && out.body);
  const fr = gframes(Buffer.from(out.body));
  const fields = decode(fr[0].payload);
  assert.strictEqual(one(fields, 2).p.toString("utf8"), "ToCam");
});

test("gRPC: nhiều khung — trailer 0x80 giữ nguyên từng byte", () => {
  const trailer = Buffer.from("grpc-status: 0\r\n", "utf8");
  const body = Buffer.concat([gframe(0x00, cat(fStr(1, "type"), fStr(2, "free"))), gframe(0x80, trailer)]);
  const out = runResponse(body, URL_PLAN);
  assert.ok(out && out.body);
  const fr = gframes(Buffer.from(out.body));
  assert.strictEqual(fr.length, 2);
  assert.strictEqual(fr[0].payload.toString("utf8").indexOf("premium") >= 0, true);
  assert.strictEqual(fr[1].flag, 0x80);
  assert.ok(fr[1].payload.equals(trailer), "trailer bị đụng");
});

test("gRPC: GetRestrictedIntegrations -> message rỗng (hết khoá Blend/Jam/Mix)", () => {
  const inner = cat(fStr(1, "BLEND"), fStr(1, "JAM"), fBytes(2, cat(fStr(1, "MIX"))));
  const out = runResponse(gframe(0x00, inner), URL_RESTRICT);
  assert.ok(out && out.body, "không patch restrictions");
  const fr = gframes(Buffer.from(out.body));
  assert.strictEqual(fr[0].payload.length, 0, "chưa xoá danh sách khoá");
});

test("gRPC: playback-settings quality NORMAL -> VERY_HIGH", () => {
  const pair = cat(fStr(1, "audio_quality"), fStr(2, "NORMAL"));
  const inner = cat(fBytes(1, pair));
  const out = runResponse(gframe(0x00, inner), URL_SETTINGS);
  assert.ok(out && out.body, "không patch chất lượng");
  const fr = gframes(Buffer.from(out.body));
  const entry = decode(one(decode(fr[0].payload), 1).p);
  assert.strictEqual(one(entry, 1).p.toString("utf8"), "audio_quality");
  assert.strictEqual(one(entry, 2).p.toString("utf8"), "VERY_HIGH");
});

test("gRPC: playback-settings key khác quality -> không đụng", () => {
  const pair = cat(fStr(1, "crossfade_seconds"), fStr(2, "NORMAL"));
  const out = runResponse(gframe(0x00, cat(fBytes(1, pair))), URL_SETTINGS);
  assert.ok(!out || !out.body, "sửa bừa cài đặt không liên quan");
});

test("JSON: GetPremiumPlanRow trả 'Spotify Free' -> 'ToCam'", () => {
  const body = Buffer.from(JSON.stringify({ rows: [{ name: "Spotify Free", price: "0" }] }));
  const out = runResponse(body, URL_PLANROW);
  assert.ok(out && out.body);
  const o = JSON.parse(Buffer.from(out.body).toString("utf8"));
  assert.strictEqual(o.rows[0].name, "ToCam");
});

test("module pattern khớp 3 họ endpoint mới (pam / settings / restrictions)", () => {
  const mod = fs.readFileSync(MODULE_FILE, "utf8");
  const line = mod.split("\n").filter((l) => l.indexOf("type=http-response") >= 0)[0];
  const raw = line.match(/pattern=([^,]+)/)[1];
  const re = new RegExp(raw, "i");
  for (const u of [URL_BADGE, URL_PLAN, URL_PLANROW, URL_SETTINGS, URL_RESTRICT]) {
    assert.ok(re.test(u), "pattern không khớp: " + u);
  }
  assert.ok(!re.test("https://gae2-spclient.spotify.com/playplay/v1/key/abc"), "pattern bắt nhầm playplay");
});

console.log("\n[9] v2.3 — badge ToCam / cam vàng / gạt cờ khoá\n");

test("JSON GetPremiumPlanRow: badge 'Premium' -> 'ToCam'", () => {
  const body = Buffer.from(JSON.stringify({ badge: { text: "Premium", label: "Premium" } }));
  const out = runResponse(body, URL_PLANROW);
  assert.ok(out && out.body, "không đổi nhãn badge");
  const o = JSON.parse(Buffer.from(out.body).toString("utf8"));
  assert.strictEqual(o.badge.text, "ToCam");
  assert.strictEqual(o.badge.label, "ToCam");
});

test("JSON badge: mac dinh giu mau xanh, dat badge_color=#FFA500 thi doi het", () => {
  const body = Buffer.from(
    JSON.stringify({ badge: { text: "Premium", color: "#1ED760", background: "1DB954" } })
  );
  const out = runResponse(body, URL_PLANROW, { argument: { badge_color: "#FFA500" } });
  assert.ok(out && out.body, "không đổi màu");
  const o = JSON.parse(Buffer.from(out.body).toString("utf8"));
  assert.strictEqual(o.badge.color, "#FFA500");
  assert.strictEqual(o.badge.background, "FFA500");
  assert.strictEqual(o.badge.text, "ToCam");
});

test("JSON badge: chuỗi khác (tên gói 'Spotify Free') không bị đổi thành ToCam", () => {
  const body = Buffer.from(JSON.stringify({ rows: [{ name: "Spotify Free" }] }));
  const out = runResponse(body, URL_PLANROW);
  const o = JSON.parse(Buffer.from(out.body).toString("utf8"));
  assert.strictEqual(o.rows[0].name, "ToCam");
});

test("gRPC PAM: string 'Premium' -> 'ToCam'", () => {
  const out = runResponse(gframe(0x00, fStr(1, "Premium")), URL_BADGE);
  assert.ok(out && out.body, "không patch chữ badge");
  const fr = gframes(Buffer.from(out.body));
  assert.strictEqual(one(decode(fr[0].payload), 1).p.toString("utf8"), "ToCam");
});

test("gRPC playback-settings: premium_only=true -> false", () => {
  const pair = cat(fStr(1, "premium_only"), fVarint(2, 1));
  const out = runResponse(gframe(0x00, cat(fBytes(1, pair))), URL_SETTINGS);
  assert.ok(out && out.body, "không gạt cờ khoá");
  const fr = gframes(Buffer.from(out.body));
  const entry = decode(one(decode(fr[0].payload), 1).p);
  assert.strictEqual(one(entry, 1).p.toString("utf8"), "premium_only");
  assert.strictEqual(one(entry, 2).v, 0);
});

test("gRPC restrictions: cặp locked=true -> false (không xoá cả body)", () => {
  const pair = cat(fStr(1, "jam_locked"), fVarint(2, 1));
  const out = runResponse(gframe(0x00, cat(fBytes(1, pair))), URL_RESTRICT);
  assert.ok(out && out.body, "không patch restrictions");
  const fr = gframes(Buffer.from(out.body));
  assert.ok(fr[0].payload.length > 0, "mất dữ liệu restriction");
  const entry = decode(one(decode(fr[0].payload), 1).p);
  assert.strictEqual(one(entry, 2).v, 0);
});

test("JSON restrictions: mảng integration bị khoá -> rỗng", () => {
  const body = Buffer.from(JSON.stringify({ restrictedIntegrations: ["BLEND", "JAM"] }));
  const out = runResponse(body, URL_RESTRICT);
  assert.ok(out && out.body, "không mở khoá JSON");
  const o = JSON.parse(Buffer.from(out.body).toString("utf8"));
  assert.deepStrictEqual(o.restrictedIntegrations, []);
});

console.log("\n[8] Module DEBUG\n");

test("module DEBUG + debug.js tồn tại, script-path trỏ đúng file", () => {
  const p = path.join(ROOT, "spotify-vn-premium-DEBUG.module");
  assert.ok(fs.existsSync(p), "thiếu module debug");
  const mod = fs.readFileSync(p, "utf8");
  const sp = mod
    .match(/script-path=([^,\n]+)/)[1]
    .replace(/^__RAW_BASE__\//, "")
    // sau set-repo thì script-path là URL thật (raw.githubusercontent.com/<user>/<repo>/<branch>/scripts/...)
    .replace(/^https?:\/\/.+\/(scripts|optional)\//, "$1/");
  assert.ok(fs.existsSync(path.join(ROOT, sp)), "debug.js không tồn tại: " + sp);
  assert.ok(fs.statSync(path.join(ROOT, sp)).size > 0);
});


console.log("\n[10] v2.4 - cam vang moi dang mau / chat luong moi endpoint / capture\n");

const SCRIPT_CAPTURE = path.join(ROOT, "scripts", "capture.js");

function runCapture(body, url, arg, opts = {}) {
  const events = [];
  let captured = null;
  const store = Object.assign({}, opts.store || {});
  const sandbox = {
    $request: { url, method: "GET", headers: {} },
    $response: { status: 200, body: new Uint8Array(body), headers: {} },
    $done: (o) => {
      captured = o || {};
    },
    $notify: (title, subtitle, text) => events.push({ title, subtitle, text }),
    $persistentStore: {
      read: (k) => (k in store ? store[k] : null),
      write: (v, k) => {
        store[k] = String(v);
        return true;
      },
    },
    $argument: arg === undefined ? undefined : typeof arg === "string" ? arg : JSON.stringify(arg),
    console: { log: () => {} },
  };
  vm.createContext(sandbox);
  vm.runInContext(fs.readFileSync(SCRIPT_CAPTURE, "utf8"), sandbox, { filename: "capture.js" });
  return { captured, events, store };
}

test("JSON: 'Spotify Premium' trong key plan_name -> 'ToCam'", () => {
  const body = Buffer.from(JSON.stringify({ plan: { plan_name: "Spotify Premium" } }));
  const out = runResponse(body, URL_PLANROW);
  assert.ok(out && out.body, "khong doi nhan plan_name");
  assert.strictEqual(JSON.parse(Buffer.from(out.body).toString("utf8")).plan.plan_name, "ToCam");
});

test("JSON: mac dinh giu NEN XANH LA (rgb(30,215,96)) nhu ban goc", () => {
  const body = Buffer.from(JSON.stringify({ badge: { color: "rgb(30, 215, 96)", label: "Premium" } }));
  const out = runResponse(body, URL_PLANROW);
  const o = JSON.parse(Buffer.from(out.body).toString("utf8"));
  assert.strictEqual(o.badge.color, "rgb(30, 215, 96)");
  assert.strictEqual(o.badge.label, "ToCam");
});

test("JSON: dat badge_color=#FFA500 thi moi dang mau deu thanh cam", () => {
  const arg = { argument: { badge_color: "#FFA500" } };
  const cases = [
    ["rgb(30, 215, 96)", "rgb(255, 165, 0)"],
    ["#1ED760", "#FFA500"],
  ];
  for (const [src, want] of cases) {
    const body = Buffer.from(JSON.stringify({ badge: { color: src } }));
    const out = runResponse(body, URL_PLANROW, arg);
    const o = JSON.parse(Buffer.from(out.body).toString("utf8"));
    assert.strictEqual(o.badge.color, want, src + " -> " + o.badge.color);
  }
});

test("JSON: dang 0x1ED760 + badge_color cam -> 0xFFA500 (giu tien to 0x)", () => {
  const body = Buffer.from(JSON.stringify({ badge: { color: "0x1ED760" } }));
  const out = runResponse(body, URL_PLANROW, { argument: { badge_color: "#FFA500" } });
  const o = JSON.parse(Buffer.from(out.body).toString("utf8"));
  assert.strictEqual(o.badge.color, "0xFFA500");
});

test("JSON: mau chu (text_color) KHONG bi to cam khi khong dat badge_text_color", () => {
  const body = Buffer.from(JSON.stringify({ badge: { text_color: "#1ED760", color: "#1ED760", label: "Premium" } }));
  const out = runResponse(body, URL_PLANROW);
  const o = JSON.parse(Buffer.from(out.body).toString("utf8"));
  assert.strictEqual(o.badge.text_color, "#1ED760", "mau chu bi doi -> chu mat tren nen cam");
  assert.strictEqual(o.badge.color, "#1ED760");
});

test("JSON: dat badge_text_color thi mau chu doi theo", () => {
  const body = Buffer.from(JSON.stringify({ badge: { text_color: "#1ED760" } }));
  const out = runResponse(body, URL_PLANROW, { argument: { badge_text_color: "#1A1A1A" } });
  const o = JSON.parse(Buffer.from(out.body).toString("utf8"));
  assert.strictEqual(o.badge.text_color, "#1A1A1A");
});

test("JSON: bitrate 96 / max_bitrate 160 -> 320", () => {
  const body = Buffer.from(JSON.stringify({ audio: { bitrate: 96, max_bitrate: "160", quality: "HIGH" } }));
  const out = runResponse(body, URL_PROFILE);
  const o = JSON.parse(Buffer.from(out.body).toString("utf8"));
  assert.strictEqual(o.audio.bitrate, 320);
  assert.strictEqual(o.audio.max_bitrate, "320");
  assert.strictEqual(o.audio.quality, "VERY_HIGH");
});

test("endpoint la (user-profile): premium_locked=true -> false, isPremium=false -> true", () => {
  const body = Buffer.from(JSON.stringify({ account: { premium_locked: true, isPremium: false } }));
  const out = runResponse(body, URL_PROFILE);
  const o = JSON.parse(Buffer.from(out.body).toString("utf8"));
  assert.strictEqual(o.account.premium_locked, false, "co khoa chua gat");
  assert.strictEqual(o.account.isPremium, true, "co premium bi gat nguoc");
});

test("playback-settings protobuf: chuoi 'free' -> 'premium' (v2.4 moi co)", () => {
  const out = runResponse(gframe(0x00, cat(fStr(1, "mode"), fStr(2, "free"))), URL_SETTINGS);
  assert.ok(out && out.body, "khong patch chuoi trong playback-settings");
  const d = decode(Buffer.from(out.body).subarray(5));
  assert.strictEqual(one(d, 2).p.toString("utf8"), "premium");
});

test("capture.js: noi thong bao, khong sua body, co ten endpoint", () => {
  const payload = cat(fStr(1, "audio_quality"), fStr(2, "free"), fStr(3, "bitrate=96"));
  const r = runCapture(gframe(0x00, payload), URL_SETTINGS);
  assert.strictEqual(Object.keys(r.captured).length, 0, "capture khong duoc sua body");
  assert.strictEqual(r.events.length, 1, "khong noi thong bao");
  assert.ok(/^\[spot-vn\] .+/.test(r.events[0].title), "tieu de thieu endpoint: " + r.events[0].title);
  assert.ok(/quality|bitrate|free/i.test(r.events[0].text), "noi dung thong bao khong co chuoi can xem");
});

test("capture.js: cung payload trong dedupe_sec -> khong keu lai", () => {
  const body = gframe(0x00, cat(fStr(1, "audio_quality"), fStr(2, "free")));
  const first = runCapture(body, URL_SETTINGS, { dedupe_sec: 300 });
  assert.strictEqual(first.events.length, 1);
  const second = runCapture(body, URL_SETTINGS, { dedupe_sec: 300 }, { store: first.store });
  assert.strictEqual(second.events.length, 0, "keu lai cung payload");
});

test("capture.js: notify=false -> chi log, khong banner", () => {
  const r = runCapture(gframe(0x00, fStr(1, "premium")), URL_BADGE, { notify: false });
  assert.strictEqual(r.events.length, 0);
});

test("module capture: ton tai, script-path tro dung capture.js, hostname hop le", () => {
  const p = path.join(ROOT, "spotify-vn-capture.module");
  assert.ok(fs.existsSync(p), "thieu spotify-vn-capture.module");
  const mod = fs.readFileSync(p, "utf8");
  const sp = mod
    .match(/script-path=([^,\n]+)/)[1]
    .replace(/^__RAW_BASE__\//, "")
    .replace(/^https?:\/\/.+\/(scripts|optional)\//, "$1/");
  assert.strictEqual(sp, "scripts/capture.js");
  assert.ok(fs.existsSync(path.join(ROOT, sp)), "capture.js khong ton tai");
  const line = mod.split("\n").find((l) => l.startsWith("hostname"));
  assert.ok(line && line.includes("*.spotify.com") && line.includes("%APPEND%"));
  assert.ok(!/\*-/.test(line), "wildcard giua nhan: " + line);
});

test("debug.js v1.4: mac dinh khong tu noi thong bao", () => {
  let notified = 0;
  const sandbox = {
    $request: { url: URL_SETTINGS, method: "GET", headers: {} },
    $response: { status: 200, body: new Uint8Array(gframe(0x00, fStr(1, "premium"))) },
    $done: () => {},
    $notify: () => {
      notified++;
    },
    console: { log: () => {} },
  };
  vm.createContext(sandbox);
  vm.runInContext(fs.readFileSync(path.join(ROOT, "scripts", "debug.js"), "utf8"), sandbox, {
    filename: "debug.js",
  });
  assert.strictEqual(notified, 0, "debug.js tu keu khi chua bat notify");
});

console.log("\n" + "-".repeat(62));
console.log("  PASS: " + pass + "    FAIL: " + fail);
console.log("-".repeat(62) + "\n");
process.exit(fail === 0 ? 0 : 1);
