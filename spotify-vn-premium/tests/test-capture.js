// tests/test-capture.js — node tests/test-capture.js
// Chạy không cần Shadowrocket: giả lập $request / $response / $notification /
// $persistentStore rồi nạp scripts/*.js bằng vm.

const fs = require("fs");
const path = require("path");
const vm = require("vm");

const ROOT = path.join(__dirname, "..");
let pass = 0;
let fail = 0;

function ok(name, cond, extra) {
  if (cond) {
    pass++;
    console.log("  PASS " + name);
  } else {
    fail++;
    console.log("  FAIL " + name + (extra ? "  -> " + extra : ""));
  }
}

function makeEnv(opts) {
  const storeData = Object.assign({}, (opts && opts.store) || {});
  const notes = [];
  let doneArgs = [];
  const env = {
    $argument: opts && opts.argument,
    $request: (opts && opts.request) || { url: "", headers: {} },
    $response: opts && opts.response,
    Date,
    Math,
    JSON,
    console: { log() {} },
    encodeURIComponent,
    isFinite,
    Number,
    String,
    ArrayBuffer,
    Uint8Array: global.Uint8Array,
    $persistentStore: {
      read(k) {
        return storeData[k] === undefined ? null : storeData[k];
      },
      write(v, k) {
        storeData[k] = String(v);
        return true;
      },
    },
    $notification: {
      post(t, s, b) {
        notes.push({ t, s, b });
      },
    },
    $done(a) {
      doneArgs.push(a === undefined ? undefined : a);
    },
  };
  env.ArrayBuffer.isView = ArrayBuffer.isView;
  return { env, notes, storeData, getDone: () => doneArgs, reset: () => (doneArgs = []) };
}

function run(script, ctx) {
  const code = fs.readFileSync(path.join(ROOT, "scripts", script), "utf8");
  vm.createContext(ctx);
  vm.runInContext(code, ctx, { timeout: 10000 });
}

function json(s) {
  const b = [];
  for (let i = 0; i < s.length; i++) b.push(s.charCodeAt(i) & 0xff);
  return new Uint8Array(b);
}

// ---------------------------------------------------------------- 1. capture
console.log("\n[capture.js]");
{
  const e = makeEnv({
    response: { status: 200, body: json('{"product":"premium","bitrate":320000,"formats":["OGG_VORBIS_320"]}') },
    request: { url: "https://gae2-spclient.spotify.com/product-state/v1/state" },
  });
  run("capture.js", e.env);
  ok("banner tự kiểm tra hiện lần đầu", e.notes.length === 2 && /CAPTURE ĐÃ CHẠY/.test(e.notes[0].t), JSON.stringify(e.notes));
  const banner = e.notes[1];
  ok("banner có endpoint", /product-state/.test(banner.t), banner && banner.t);
  ok("banner có 320 ✔", /320/.test(banner.b), banner && banner.b);
  ok("banner có premium×", /premium×/.test(banner.b), banner && banner.b);
  ok("không sửa body ($done({}))", JSON.stringify(e.getDone()[0]) === "{}");
  const buf = e.storeData["spotcap_buf"] || "";
  ok("đã gom vào hàng đợi", buf.includes("product-state|200|") && buf.split("|").length >= 6);
}

// ---------------------------------------------------------------- 1b. dedupe
{
  const body = json('{"product":"free","bitrate":160000}');
  const e = makeEnv({ request: { url: "https://gae2-spclient.spotify.com/device-capabilities/v1/capabilities" }, response: { status: 200, body } });
  run("capture.js", e.env);
  const first = e.notes.length;
  e.reset();
  const ctx2 = e.env;
  vm.runInContext(fs.readFileSync(path.join(ROOT, "scripts/capture.js"), "utf8"), ctx2);
  ok("dedupe: cùng nội dung trong 60s không kêu lại", e.notes.length === first, `before=${first} after=${e.notes.length}`);
}

// ---------------------------------------------------------------- 1c. binary
{
  const bin = new Uint8Array([0x00, 0x00, 0x00, 0x00, 0x0c, 0x0a, 0x07, 0x70, 0x72, 0x65, 0x6d, 0x69, 0x75, 0x6d]);
  const e = makeEnv({ request: { url: "https://gae2-spclient.spotify.com/pam-view-service/v1/GetPremiumPlanRow" }, response: { status: 200, body: bin } });
  run("capture.js", e.env);
  ok("protobuf nhị phân không làm crash", e.notes.length >= 2);
  ok("quét được chữ premium trong bytes", /premium/.test(e.notes[e.notes.length - 1].b), JSON.stringify(e.notes));
}

// ---------------------------------------------------------------- 2. drip
console.log("\n[drip.js]");
{
  const filler = "A".repeat(2000);
  const e = makeEnv({
    request: { url: "https://gae2-spclient.spotify.com/color-lyrics/v2/track/abc?clientLanguage=vi-VN" },
    store: { spotcap_buf: filler, spotcap_seq: "0" },
  });
  run("drip.js", e.env);
  const out = e.getDone()[0];
  ok("gắn được zcap vào URL", out && /[?&]zcap=0001\./.test(out.url), out && out.url.slice(0, 120));
  ok("base64url an toàn (không +, /, =)", out && !/[+\/=]/.test(out.url.split("zcap=")[1]));
  ok("hàng đợi co lại đúng 660 ký tự", (e.storeData["spotcap_buf"] || "").length === 2000 - 660);
  ok("seq tăng lên 1", e.storeData["spotcap_seq"] === "1");
  ok("banner 'BẮT ĐẦU GỬI' ở mẩu đầu", e.notes.some((n) => /BẮT ĐẦU GỬI/.test(n.t)));
}

{
  const e = makeEnv({
    request: { url: "https://audio-akp.spotifycdn.com/audio/xyz" },
    store: { spotcap_buf: "B".repeat(900), spotcap_seq: "3" },
  });
  run("drip.js", e.env);
  ok("không gắn vào URL tải nhạc", JSON.stringify(e.getDone()[0]) === "{}");
}

{
  const e = makeEnv({ request: { url: "https://gae2-spclient.spotify.com/reachability/check" }, store: { spotcap_buf: "C".repeat(100), spotcap_seq: "9" } });
  run("drip.js", e.env);
  const out = e.getDone()[0];
  ok("buffer nhỏ vẫn gửi (>=30 ký tự)", out && /zcap=0010\./.test(out.url), JSON.stringify(out).slice(0, 120));
}

// ---------------------------------------------------------------- 3. audio level
console.log("\n[spotify-audio-level.js]");
{
  const e = makeEnv({ request: { url: "https://spclient.wg.spotify.com/storage-resolve/v2/files/audio/interactive/1/abc123?product=0" } });
  run("spotify-audio-level.js", e.env);
  ok("interactive 1 -> 2", /\/interactive\/2\//.test(e.getDone()[0].url), JSON.stringify(e.getDone()[0]));
}
{
  const e = makeEnv({ request: { url: "https://spclient.wg.spotify.com/storage-resolve/v2/files/audio/interactive_prefetch/1/abc123?product=0" } });
  run("spotify-audio-level.js", e.env);
  ok("interactive_prefetch 1 -> 2", /interactive_prefetch\/2\//.test(e.getDone()[0].url), JSON.stringify(e.getDone()[0]));
}
{
  const e = makeEnv({ request: { url: "https://spclient.wg.spotify.com/storage-resolve/v2/files/audio/interactive/1/abc123?product=0" }, argument: '{"audio_level":"keep"}' });
  run("spotify-audio-level.js", e.env);
  ok("audio_level=keep tắt hẳn", JSON.stringify(e.getDone()[0]) === "{}");
}

console.log(`\n${pass + fail} test — ${pass} PASS / ${fail} FAIL`);
process.exit(fail ? 1 : 0);
