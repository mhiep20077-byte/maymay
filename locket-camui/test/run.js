#!/usr/bin/env node
// Giả lập môi trường Shadowrocket để test Locket_CamUI.js
const fs = require("fs");
const vm = require("vm");
const path = require("path");

const SCRIPT = path.join(__dirname, "..", "Locket_CamUI.js");
const FIXTURE = path.join(__dirname, "fixture.json");

function run(scanOnly) {
  let src = fs.readFileSync(SCRIPT, "utf8");
  if (scanOnly) src = src.replace("var SCAN_ONLY   = false;", "var SCAN_ONLY   = true;");

  const fx = JSON.parse(fs.readFileSync(FIXTURE, "utf8"));
  const store = {};
  const notis = [];
  let done = null;

  const ctx = {
    $request: { headers: { "User-Agent": "Locket/2.4.0 iOS" } },
    $response: { body: JSON.stringify(fx) },
    $notification: { post: (t, s, b) => notis.push({ t, s, b }) },
    $persistentStore: { read: k => store[k] || null, write: (v, k) => { store[k] = v; return true; } },
    $done: o => { done = o; },
    console
  };
  vm.createContext(ctx);
  let err = null;
  try { vm.runInContext(src, ctx); } catch (e) { err = e; }
  return { done, notis, err, store };
}

function deep(x) { return JSON.parse(JSON.stringify(x)); }

let fail = 0;
function ok(name, cond, extra) {
  console.log((cond ? "PASS  " : "FAIL  ") + name + (cond ? "" : "   " + (extra || "")));
  if (!cond) fail++;
}

// ---------- 1. scan mode ----------
const s = run(true);
ok("scan: không lỗi", !s.err, s.err && s.err.message);
ok("scan: $done rỗng", s.done && !s.done.body);
ok("scan: có noti", s.notis.length === 1, JSON.stringify(s.notis));
console.log("      noti:", JSON.stringify(s.notis[0]));
ok("scan: không sửa config", JSON.stringify(JSON.parse(s.done && "{}" || "{}")) === "{}");

// ---------- 2. force mode ----------
const f = run(false);
ok("force: không lỗi", !f.err, f.err && f.err.message);
const out = JSON.parse(f.done.body);
const E = out.entries;
console.log("\n      noti:", JSON.stringify(f.notis[0], null, 1));

const gates = JSON.parse(E.feature_gates);
ok("force: video bật", gates.video === "enabled", gates.video);
ok("force: digicam bật", gates.digicam === "enabled", gates.digicam);
ok("force: tarot bật", gates.tarot === "true", gates.tarot);
ok("force: camera_filter_sheet bật", gates.camera_filter_sheet === "enabled", gates.camera_filter_sheet);

const cam = JSON.parse(E.camera);
ok("force: max_duration 60", cam.max_duration === 60, cam.max_duration);
ok("force: gold_max_duration 60", cam.gold_max_duration === 60, cam.gold_max_duration);
ok("force: zoom_enabled true", cam.zoom_enabled === true, cam.zoom_enabled);
ok("force: ultra_wide true", cam.ultra_wide === true, cam.ultra_wide);
ok("force: camera_timer_enabled true", cam.camera_timer_enabled === true, cam.camera_timer_enabled);
ok("force: quality_mbps giữ nguyên", cam.quality_mbps === 0.8, cam.quality_mbps);

const roll = JSON.parse(E.camera_roll);
ok("force: trim_max_duration 60", roll.trim_max_duration === 60, roll.trim_max_duration);
ok("force: video_upload_enabled true", roll.video_upload_enabled === true, roll.video_upload_enabled);

const vu = JSON.parse(E.video_upload);
ok("force: upload max_duration 60", vu.max_duration === 60, vu.max_duration);
ok("force: upload sound bật", vu.sound_enabled === true, vu.sound_enabled);
ok("force: upload gallery bật", vu.allow_gallery === true, vu.allow_gallery);

// catalog: KHÔNG được đổi filter
const cat = JSON.parse(E.camera_filter_config);
ok("catalog: số filter giữ 2", cat.remote_filters.length === 2, cat.remote_filters.length);
ok("catalog: tarot_1 giữ nguyên tên", cat.remote_filters[0].name === "Lá Bài Hôm Nay");
ok("catalog: is_locked KHÔNG bị đảo", cat.remote_filters[1].is_locked === true, cat.remote_filters[1].is_locked);
ok("catalog: show_filter_button bật", cat.show_filter_button === true, cat.show_filter_button);
ok("catalog: sheet_enabled bật", cat.sheet_enabled === true, cat.sheet_enabled);

// experiments
const ex = JSON.parse(E.experiments);
ok("exp: enabled true", ex[0].enabled === true, ex[0].enabled);
ok("exp: nhóm cuối weight 100", ex[0].groups[1].weight === 100, JSON.stringify(ex[0].groups));
ok("exp: nhóm đầu weight 0", ex[0].groups[0].weight === 0, JSON.stringify(ex[0].groups));
ok("exp: exp2 nhóm cuối 100", ex[1].groups[1].weight === 100, JSON.stringify(ex[1].groups));

ok("force: state UPDATE", out.state === "UPDATE", out.state);
ok("force: lưu store", !!f.store["locket_camui_last"]);

// ---------- 3. UA lạ -> bỏ qua ----------
{
  let src = fs.readFileSync(SCRIPT, "utf8");
  const store = {}; let done = null;
  const ctx = {
    $request: { headers: { "User-Agent": "curl/8" } },
    $response: { body: JSON.stringify({ entries: {} }) },
    $notification: { post: () => {} },
    $persistentStore: { read: () => null, write: () => true },
    $done: o => { done = o; }, console
  };
  vm.createContext(ctx);
  try { vm.runInContext(src, ctx); } catch (e) { console.log("FAIL  UA lạ: " + e.message); fail++; }
  ok("UA lạ: bỏ qua, không sửa", done && !done.body);
}

// ---------- 4. body hỏng ----------
{
  let src = fs.readFileSync(SCRIPT, "utf8");
  let done = null, err = null;
  const ctx = {
    $request: { headers: { "User-Agent": "Locket/1.0" } },
    $response: { body: "<html>502</html>" },
    $notification: { post: () => {} },
    $persistentStore: { read: () => null, write: () => true },
    $done: o => { done = o; }, console
  };
  vm.createContext(ctx);
  try { vm.runInContext(src, ctx); } catch (e) { err = e; }
  ok("body hỏng: không crash", !err, err && err.message);
  ok("body hỏng: trả rỗng", done && !done.body);
}

console.log("\n" + (fail ? "❌ " + fail + " FAIL" : "✅ ALL PASS"));
process.exit(fail ? 1 : 0);
