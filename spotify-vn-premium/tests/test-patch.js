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

function runResponse(body, url, { status = 200, withTextCodec = false, via = "body", statusKey = "status" } = {}) {
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

console.log("\n[7] Module DEBUG\n");

test("module DEBUG + debug.js tồn tại, script-path trỏ đúng file", () => {
  const p = path.join(ROOT, "spotify-vn-premium-DEBUG.module");
  assert.ok(fs.existsSync(p), "thiếu module debug");
  const mod = fs.readFileSync(p, "utf8");
  const sp = mod
    .match(/script-path=([^,\n]+)/)[1]
    .replace(/^__RAW_BASE__\//, "")
    .replace(/^https?:\/\/[^/]+\//, "");
  assert.ok(fs.existsSync(path.join(ROOT, sp)), "debug.js không tồn tại: " + sp);
  assert.ok(fs.statSync(path.join(ROOT, sp)).size > 0);
});

console.log("\n" + "-".repeat(62));
console.log("  PASS: " + pass + "    FAIL: " + fail);
console.log("-".repeat(62) + "\n");
process.exit(fail === 0 ? 0 : 1);
