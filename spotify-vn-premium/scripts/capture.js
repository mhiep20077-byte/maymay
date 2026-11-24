// ============================================================================
// spotify-vn-premium / scripts/capture.js
// Build: 2026-11-24 · v1.0.0 · type: http-response
//
// Khác scripts/debug.js ở một điểm quyết định: file này BẬT THÔNG BÁO của
// Shadowrocket ($notify / $notification.post), nên mở app ra là thấy banner
// "[spot-vn] pam-view-service" ngay trên màn hình, không phải vào tab Log.
//
// Nó KHÔNG sửa gì — $done({}) = trả nguyên bản. Chỉ đọc rồi kêu.
//
// Cách dùng:
//   1. Bật spotify-vn-capture.module (tắt module chính cho khỏi lẫn).
//   2. Mở Spotify -> Cài đặt -> Chất lượng nội dung, bấm vào dòng "Rất cao".
//      Rồi mở trang Tài khoản. Mỗi response khớp pattern sẽ nổi 1 thông báo.
//   3. Giữ thông báo (hoặc mở tab Log lọc "spot-vn-dbg") -> gửi lại cho tao.
//
// Tùy chỉnh qua $argument:
//   {"notify":true,"max_body":180,"dedupe_sec":45,"only":"quality,premium,pam"}
//   notify=false  -> chỉ ghi log, không nổi banner
//   dedupe_sec    -> cùng một payload y hệt trong khoảng này thì không kêu lại
//   only          -> chỉ bắt URL khớp chữ này (rỗng = bắt hết pattern)
// ============================================================================

(function () {
  "use strict";

  var opt = {};
  try {
    opt = typeof $argument === "string" ? JSON.parse($argument || "{}") : $argument || {};
  } catch (e) {
    opt = {};
  }
  var flag = function (v, d) {
    return v === undefined || v === null ? d : !(v === false || v === "false" || v === 0 || v === "0");
  };
  var notifyOn = flag(opt.notify, true);
  var maxBody = Number(opt.max_body) > 0 ? Number(opt.max_body) : 180;
  var dedupeSec = Number(opt.dedupe_sec) >= 0 ? Number(opt.dedupe_sec) : 45;
  var only = typeof opt.only === "string" ? opt.only.trim() : "";

  var url = ($request && $request.url) || "";
  if (only && url.toLowerCase().indexOf(only.toLowerCase()) < 0) {
    var anyHit = false;
    var parts = only.split(",");
    for (var pi = 0; pi < parts.length; pi++) {
      var p = parts[pi].trim();
      if (p && url.toLowerCase().indexOf(p.toLowerCase()) >= 0) anyHit = true;
    }
    if (!anyHit) {
      $done({});
      return;
    }
  }

  var status = Number(($response && ($response.status || $response.statusCode)) || 0);

  var body = $response && ($response.bodyBytes || $response.body);
  var bytes = null;
  if (body instanceof ArrayBuffer) bytes = new Uint8Array(body);
  else if (body && ArrayBuffer.isView(body))
    bytes = new Uint8Array(body.buffer, body.byteOffset, body.byteLength);
  else if (typeof body === "string") bytes = new TextEncoder().encode(body);

  var path = url.replace(/^https?:\/\//, "");
  var host = path.split("/")[0] || "";
  var shortPath = path.replace(/^[^/]+/, "").split("?")[0];

  if (!bytes || !bytes.length) {
    if (notifyOn) post("empty", status + "B", shortPath.slice(0, 80) + " · không có body");
    $done({});
    return;
  }

  var len = bytes.length;

  // ---------------------------------------------------------------- bóc gRPC
  function grpcSplit(b) {
    var frames = [];
    var i = 0;
    while (i + 5 <= b.length) {
      var f = b[i];
      if (f !== 0x00 && f !== 0x01 && f !== 0x80 && f !== 0x81) return null;
      var n = ((b[i + 1] << 24) | (b[i + 2] << 16) | (b[i + 3] << 8) | b[i + 4]) >>> 0;
      if (n > b.length - i - 5) return null;
      frames.push({ flag: f, payload: b.subarray(i + 5, i + 5 + n) });
      i += 5 + n;
    }
    if (i !== b.length || !frames.length) return null;
    return frames;
  }

  var frames = grpcSplit(bytes);
  var core = bytes;
  var kind;

  if (frames) {
    var dataFrames = [];
    for (var fi = 0; fi < frames.length; fi++) {
      if (!(frames[fi].flag & 0x80) && !(frames[fi].flag & 0x01)) dataFrames.push(frames[fi]);
    }
    core = (dataFrames[0] || frames[0]).payload;
    kind = "grpc" + (dataFrames.length > 1 ? "×" + dataFrames.length : "");
  } else {
    var b0 = bytes[0] || 0;
    if (b0 === 0x7b || b0 === 0x5b) kind = "json";
    else if (b0 === 0x1f || b0 === 0x78) kind = "gzip";
    else kind = "proto";
  }

  // ------------------------------------------------- chuỗi ASCII trong payload
  function stringsOf(b, max) {
    var out = [];
    var cur = "";
    for (var i = 0; i < b.length && out.length < 40; i++) {
      var c = b[i];
      if (c >= 0x20 && c < 0x7f) {
        cur += String.fromCharCode(c);
        if (cur.length > 60) cur = cur.slice(0, 60);
      } else {
        if (cur.length >= 3) out.push(cur);
        cur = "";
      }
    }
    if (cur.length >= 3) out.push(cur);
    return out;
  }

  function hexOf(b, n) {
    var s = "";
    var m = Math.min(b.length, n);
    for (var i = 0; i < m; i++) s += ("0" + b[i].toString(16)).slice(-2);
    return s;
  }

  var strs = stringsOf(core, 0);

  // Chuỗi nào quyết định "chất lượng" thì đưa lên đầu cho dễ đọc.
  var INTEREST = /quality|bitrate|streaming|premium|free|restrict|lock|tier|product|plan|badge|label|color|colour|level|capab|entitle/i;
  var hot = [];
  var rest = [];
  for (var si = 0; si < strs.length; si++) {
    var sv = strs[si];
    if (INTEREST.test(sv) && hot.length < 10) hot.push(sv);
    else if (rest.length < 8) rest.push(sv);
  }

  // JSON: rút đúng các cặp key=value liên quan, thay vì đổ cả khối.
  var jsonPeek = "";
  var KEY_OF_INTEREST = /quality|bitrate|streaming|premium|free|restrict|lock|tier|product|plan|badge|label|colou?r|level|capab|entitle|ads/i;
  if (kind === "json") {
    try {
      var txt = "";
      var tn = Math.min(core.length, 20000);
      for (var j = 0; j < tn; j++) txt += String.fromCharCode(core[j]);
      var obj = JSON.parse(txt);
      var pairs = [];
      var walkJson = function (node, prefix) {
        if (pairs.length >= 14) return;
        if (node && typeof node === "object") {
          for (var k in node) {
            if (!Object.prototype.hasOwnProperty.call(node, k)) continue;
            var v = node[k];
            var pk = prefix ? prefix + "." + k : k;
            if (v && typeof v === "object") walkJson(v, pk);
            else if (KEY_OF_INTEREST.test(k)) {
              pairs.push(pk + "=" + String(v).slice(0, 40));
            }
          }
        }
      };
      walkJson(obj, "");
      jsonPeek = pairs.join(" ");
    } catch (e) {
      jsonPeek = "";
    }
  }

  var hasFree = /spotify\s*_?\s*free|"free"|free_tier|free-tier|FREE\b/i.test(
    (function () {
      try {
        var t = "";
        var n = Math.min(core.length, 8192);
        for (var i = 0; i < n; i++) t += String.fromCharCode(core[i]);
        return t;
      } catch (e) {
        return "";
      }
    })()
  )
    ? " HAS_FREE"
    : "";

  var line =
    "[spot-vn-dbg] " +
    status +
    " " +
    len +
    "B " +
    kind +
    "/core=" +
    core.length +
    "B" +
    hasFree +
    " " +
    host +
    shortPath.slice(0, 80) +
    " | " +
    hexOf(core, 32) +
    (hot.length ? " | q=" + hot.join("|") : "") +
    (rest.length ? " | s=" + rest.join("|") : "") +
    (jsonPeek ? " >> " + jsonPeek : "");

  try {
    console.log(line);
  } catch (e) {}

  // ------------------------------------------------------------- thông báo
  function post(kindLabel, subtitle, text) {
    var title = "[spot-vn] " + (shortPath.split("/").filter(Boolean).slice(-1)[0] || host);
    var sub = (subtitle ? subtitle + " · " : "") + kindLabel;
    var bodyText = String(text || "").slice(0, maxBody);
    try {
      if (typeof $notify === "function") {
        $notify(title, sub, bodyText);
      } else if (typeof $notification !== "undefined" && $notification && typeof $notification.post === "function") {
        $notification.post(title, sub, bodyText);
      }
    } catch (e) {}
  }

  // Cùng một payload y hệt (mở lại trang) thì đừng kêu lại — tránh 20 banner.
  function hashCode(s) {
    var h = 5381;
    for (var i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0;
    return String(h);
  }

  var summary = (hot.length ? hot.join(" ") : "") + " " + jsonPeek + " " + hexOf(core, 16);
  var sig = hashCode(host + shortPath + "|" + len + "|" + summary);
  var kStore = "spotvn_capture_sig";
  var skipNotify = false;

  if (dedupeSec > 0) {
    try {
      if (typeof $persistentStore !== "undefined" && $persistentStore && $persistentStore.read) {
        var prev = $persistentStore.read(kStore) || "";
        if (prev.indexOf(sig + "@") === 0) {
          var ts = Number(prev.split("@")[1] || 0);
          if (Date.now() - ts < dedupeSec * 1000) skipNotify = true;
        }
        if (!skipNotify && $persistentStore.write) {
          $persistentStore.write(sig + "@" + Date.now(), kStore);
        }
      }
    } catch (e) {}
  }

  if (notifyOn && !skipNotify) {
    var shortTitle = shortPath.length > 46 ? "…" + shortPath.slice(-44) : shortPath;
    var textOut = jsonPeek
      ? jsonPeek
      : hot.length
      ? hot.join(" | ")
      : rest.slice(0, 6).join(" | ");
    post(kind + " " + status + " " + len + "B", shortTitle, (hasFree ? "FREE· " : "") + textOut);
  }

  $done({});
})();
