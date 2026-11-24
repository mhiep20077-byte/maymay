// ============================================================================
// spotify-vn-premium / scripts/drip.js
// Build: 2026-11-24 · v1.0.0 · type: http-request
//
// VI SAO CÓ FILE NÀY:
//   File log .db xuất từ Shadowrocket chỉ có CỘT URL + UA, KHÔNG có body.
//   Đó là lý do mấy lần trước chỉ thấy "storage-resolve/.../2/<hash>" mà
//   không biết server trả gì bên trong.
//
//   Cách chữa không cần server riêng: script này lấy dữ liệu capture.js đã gom,
//   cắt từng mẩu ~900 ký tự, base64url rồi gắn vào query của một request
//   Spotify thật đang đi ra. Spotify bỏ qua tham số lạ; Shadowrocket ghi
//   nguyên URL vào log .db.
//
//   => Mày cứ xuất log như mọi lần, tao bóc ra payload thật.
//
// Định dạng:  &zcap=<4 chữ số>.<base64url của chunk>
// ============================================================================

(function () {
  "use strict";

  function store(key, val, write) {
    try {
      if (!write) return $persistentStore.read(key);
      $persistentStore.write(String(val), key);
      return val;
    } catch (e) {
      return null;
    }
  }

  var B64C = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
  function b64url(str) {
    var out = "", i, b0, b1, b2;
    for (i = 0; i < str.length; i += 3) {
      b0 = str.charCodeAt(i) & 0xff;
      b1 = i + 1 < str.length ? str.charCodeAt(i + 1) & 0xff : 0;
      b2 = i + 2 < str.length ? str.charCodeAt(i + 2) & 0xff : 0;
      out +=
        B64C.charAt(b0 >> 2) +
        B64C.charAt(((b0 & 3) << 4) | (b1 >> 4)) +
        (i + 1 < str.length ? B64C.charAt(((b1 & 15) << 2) | (b2 >> 6)) : "") +
        (i + 2 < str.length ? B64C.charAt(b2 & 63) : "");
    }
    return out.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  }

  var RAW = 660; // ký tự gốc mỗi mẩu -> ~880 ký tự base64, vừa mọi giới hạn URL

  var buf = store("spotcap_buf") || "";
  if (buf.length < 30) {
    $done({});
    return;
  }

  var url = ($request && $request.url) || "";
  // Không bao giờ gắn vào request tải nhạc / upload / gRPC nặng.
  if (/storage-resolve|audio-akp|spotifycdn\.com|playback-settings|pam-view-service|user-customization|bootstrap/i.test(url)) {
    $done({});
    return;
  }
  if (url.length > 1500) {
    $done({});
    return;
  }

  var chunk = buf.slice(0, RAW);
  var rest = buf.slice(RAW);

  var seq = Number(store("spotcap_seq") || 0) + 1;
  var pad = ("0000" + seq).slice(-4);
  var payload = b64url(chunk);

  store("spotcap_buf", rest, true);
  store("spotcap_seq", seq, true);

  var out = url + (url.indexOf("?") < 0 ? "?" : "&") + "zcap=" + pad + "." + payload;

  if (seq === 1) {
    try {
      $notification.post("[spot-vn] BẮT ĐẦU GỬI DỮ LIỆU", "zcap 0001", "Dữ liệu nằm trong log .db — xuất log gửi tao.");
    } catch (e) {}
  }

  $done({ url: out });
})();
