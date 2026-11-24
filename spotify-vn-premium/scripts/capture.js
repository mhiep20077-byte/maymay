// ============================================================================
// spotify-vn-premium / scripts/capture.js
// Build: 2026-11-24 · v2.0.0 · type: http-response · binary-body-mode
//
// MỤC ĐÍCH (đúng cái mày yêu cầu):
//   1) Mỗi response Spotify khớp pattern -> NỔI THÔNG BÁO trên Shadowrocket,
//      in ra endpoint + dung lượng + cờ quality/bitrate/premium tìm thấy trong
//      payload, để mày thấy ngay app đang nhận gì.
//   2) GOM payload thật vào hàng đợi. Một script khác (scripts/drip.js) sẽ
//      bơm từng mẩu vào query của request Spotify kế tiếp, nên dữ liệu nằm
//      luôn trong file log .db mà mày vẫn xuất ra gửi tao -> tao đọc được
//      NGUYÊN BODY (không còn cảnh "log chỉ có URL, body bị nén").
//
// Nó KHÔNG sửa gì: luôn $done({}) -> trả nguyên bản response.
//
// $argument (tuỳ chọn):
//   {"notify":true,"dedupe_sec":60,"feed":true,"max_noti":40}
//   notify=false  -> chỉ gom dữ liệu, không nổi banner
//   feed=false    -> chỉ nổi banner, không gom dữ liệu về log
//   dedupe_sec    -> cùng endpoint + cùng nội dung trong khoảng này thì im
//   max_noti      -> trần số banner mỗi phiên (chống spam 276 cái)
// ============================================================================

(function () {
  "use strict";

  // ---------------------------------------------------------------- tiện ích
  function readArg() {
    var a = {};
    try {
      var raw = typeof $argument !== "undefined" ? $argument : null;
      if (typeof raw === "string" && raw) a = JSON.parse(raw) || {};
      else if (raw && typeof raw === "object") a = raw;
    } catch (e) {
      a = {};
    }
    return a;
  }
  function num(v, d) {
    var n = Number(v);
    return isFinite(n) ? n : d;
  }
  function bool(v, d) {
    if (v === undefined || v === null || v === "") return d;
    if (v === false || v === 0) return false;
    if (typeof v === "string" && /^(false|0|off|no|keep)$/i.test(v)) return false;
    return true;
  }
  function store(key, val, write) {
    try {
      if (!write) return $persistentStore.read(key);
      $persistentStore.write(String(val), key);
      return val;
    } catch (e) {
      return null;
    }
  }
  function notify(title, sub, body) {
    try {
      if (typeof $notification !== "undefined" && $notification && $notification.post)
        $notification.post(title, sub || "", body || "");
      else if (typeof $notify !== "undefined" && $notify) $notify(title, sub || "", body || "");
    } catch (e) {}
  }

  var B64C = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
  function b64url(bytes) {
    var out = "", i, b0, b1, b2;
    for (i = 0; i < bytes.length; i += 3) {
      b0 = bytes[i];
      b1 = i + 1 < bytes.length ? bytes[i + 1] : 0;
      b2 = i + 2 < bytes.length ? bytes[i + 2] : 0;
      out +=
        B64C.charAt(b0 >> 2) +
        B64C.charAt(((b0 & 3) << 4) | (b1 >> 4)) +
        (i + 1 < bytes.length ? B64C.charAt(((b1 & 15) << 2) | (b2 >> 6)) : "") +
        (i + 2 < bytes.length ? B64C.charAt(b2 & 63) : "");
    }
    return out.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  }

  function toBytes(body) {
    if (!body) return null;
    if (body instanceof ArrayBuffer) return new Uint8Array(body);
    if (ArrayBuffer.isView(body)) return new Uint8Array(body.buffer, body.byteOffset, body.byteLength);
    if (typeof body === "string") {
      var b = new Array(body.length);
      for (var i = 0; i < body.length; i++) b[i] = body.charCodeAt(i) & 0xff;
      return b;
    }
    if (body.length !== undefined) return body;
    return null;
  }

  // Các đoạn ASCII in được >= 4 ký tự, nối bằng '|' — đọc được cả JSON lẫn protobuf.
  function asciiText(bytes, cap) {
    var out = "", run = "", n = Math.min(bytes.length, cap || 60000);
    for (var i = 0; i < n; i++) {
      var c = bytes[i];
      if (c >= 32 && c <= 126) {
        run += String.fromCharCode(c);
      } else {
        if (run.length >= 4) out += run + "|";
        run = "";
      }
      if (out.length > 40000) break;
    }
    if (run.length >= 4) out += run;
    return out;
  }

  function endpointName(url) {
    var p = url.replace(/^https?:\/\//, "").split("?")[0];
    var parts = p.split("/");
    var path = parts.slice(1).join("/");
    if (/net-fortune/.test(p)) return "net-fortune";
    if (/storage-resolve/.test(p)) {
      var m = /\/audio\/([a-z_]+)\/(\d+)\//.exec(p);
      return "audio/" + (m ? m[1].slice(0, 9) + " lvl" + m[2] : "?");
    }
    if (/pam-view-service/.test(p)) return "pam-view";
    if (/pam-account/.test(p)) return "pam-account";
    if (/device-capabilities/.test(p)) return "device-cap";
    if (/playback-settings/.test(p)) return "playback-set";
    if (/user-customization-service/.test(p)) return "bootstrap-ucs";
    if (/clientrestrictions/.test(p)) return "restrictions";
    if (/product-?state/.test(p)) return "product-state";
    if (/user-profile/.test(p)) return "user-profile";
    if (/premium/.test(p)) return "premium/*";
    if (/jam_status|connect-group/.test(p)) return "jam";
    return (parts[parts.length - 1] || path || "?").slice(0, 22);
  }

  // ---------------------------------------------------------------- vào việc
  var opt = readArg();
  var NOTIFY = bool(opt.notify, true);
  var FEED = bool(opt.feed, true);
  var DEDUPE = num(opt.dedupe_sec, 60);
  var MAX_NOTI = num(opt.max_noti, 40);

  var url = ($request && $request.url) || "";
  var status = Number(($response && ($response.status || $response.statusCode)) || 0);
  var body = $response ? ($response.body !== undefined ? $response.body : $response.bodyBytes) : null;
  var bytes = toBytes(body);
  var ep = endpointName(url);

  // Banner tự kiểm tra: chứng minh module đã chạy (chỉ 1 lần / phiên cài).
  if (!store("spotcap_boot")) {
    store("spotcap_boot", "1", true);
    notify("[spot-vn] CAPTURE ĐÃ CHẠY", "Module nạp thành công", "Mở Cài đặt > Chất lượng nội dung, rồi xem banner tiếp theo.");
  }

  if (!bytes || !bytes.length) {
    if (NOTIFY) notify("[spot-vn] " + ep, "HTTP " + status + " · 0B", "Không có body (304/cache?) — mở lại trang đó lần nữa.");
    $done({});
    return;
  }

  var text = /storage-resolve|audio-akp|\.spotifycdn\.com/.test(url) ? "" : asciiText(bytes, 120000);

  // ---------------------------------------------------------------- phân tích
  var has320 = /OGG_VORBIS_320|320000|\b320\b/.test(text);
  var has160 = /OGG_VORBIS_160|160000|\b160\b/.test(text);
  var has96 = /OGG_VORBIS_96|96000|\b96\b/.test(text);
  var premN = (text.match(/premium/gi) || []).length;
  var freeN = (text.match(/[^a-z]free[^a-z]/gi) || []).length;
  var qm = /(VERY[_-]?HIGH|VERYHIGH|HIGH|NORMAL|LOW|AUTOMATIC|AUTO)/.exec(text);
  var pm = /"?(?:product|product_state|product-type)"?\s*[:=]\s*"?([a-z_]{2,14})/i.exec(text);
  var rateM = /(?:bitrate|bit_rate|audio_quality|max_bitrate)"?\s*[:=]\s*"?(\d{2,7})/i.exec(text);
  var lvlM = /\/audio\/([a-z_]+)\/(\d+)\//.exec(url);

  var flags = [];
  if (lvlM) flags.push("URL lvl" + lvlM[2] + "/" + lvlM[1]);
  if (has320) flags.push("320 ✔");
  if (has160) flags.push("160");
  if (has96) flags.push("96");
  if (qm) flags.push("q=" + qm[1]);
  if (rateM) flags.push("bitrate=" + rateM[1]);
  if (pm) flags.push("prod=" + pm[1]);
  if (premN) flags.push("premium×" + premN);
  if (freeN) flags.push("free×" + freeN);
  if (!flags.length) flags.push("không thấy cờ nào");

  var flagStr = flags.join(" ");

  // ---------------------------------------------------------------- gom dữ liệu
  if (FEED) {
    var excerpt = "";
    if (!/storage-resolve|audio-akp|\.spotifycdn\.com/.test(url)) {
      excerpt = b64url(bytes.subarray ? bytes.subarray(0, 720) : bytes.slice(0, 720));
    }
    var line = ep.replace(/\|/g, "/") + "|" + status + "|" + bytes.length + "|" + flagStr.replace(/\|/g, "/") + "|" + (url.split("?")[0].slice(-90)) + "|" + excerpt + "\n";
    var buf = (store("spotcap_buf") || "") + line;
    if (buf.length > 45000) buf = buf.slice(buf.length - 45000);
    store("spotcap_buf", buf, true);
  }

  // ---------------------------------------------------------------- thông báo
  var sentN = num(store("spotcap_noti_n"), 0);
  var dedupeKey = "spotcap_d_" + ep.replace(/[^a-z0-9]/gi, "").slice(0, 12);
  var last = store(dedupeKey) || "";
  var sig = ep + "|" + flags.join(",");
  var now = Date.now();
  var lastSig = last.split("@")[0];
  var lastAt = num(last.split("@")[1], 0);
  var dup = lastSig === sig && now - lastAt < DEDUPE * 1000;

  if (NOTIFY && !dup && sentN < MAX_NOTI) {
    store(dedupeKey, sig + "@" + now, true);
    store("spotcap_noti_n", sentN + 1, true);
    var sub = "HTTP " + status + " · " + bytes.length + "B · " + (ep.indexOf("audio") === 0 ? "" : "gom về log");
    notify("[spot-vn] " + ep, sub, flagStr.slice(0, 160));
  }

  $done({});
})();
