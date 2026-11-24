// ============================================================================
// spotify-vn-premium / scripts/spotify-audio-level.js
// Build: 2026-11-24 · v1.0.0 · type: http-request (chỉ sửa URL, không sửa body)
//
// VI SAO CÓ FILE NÀY (bằng chứng từ log tài khoản Premium thật):
//
//   Tài khoản CÓ Premium gọi:
//     /storage-resolve/v2/files/audio/interactive/2/<file_id>?product=0
//                                        ^
//                                        cấp âm thanh
//   Tài khoản Free gọi cùng endpoint nhưng cấp thấp hơn (0 hoặc 1).
//
//   => Cấp âm thanh nằm ngay trong ĐƯỜNG DẪN, không nằm trong body, nên
//      script sửa response (spotify-premium.js) không bao giờ với tới được.
//      Đó là lý do v2.3/v2.4 sửa chất lượng hoài mà app vẫn phát 96/160.
//
// File này chạy Ở BƯỚC REQUEST: đổi cấp trong URL trước khi request đi, rồi
// trả URL mới cho Shadowrocket. Không đụng header, không đụng token.
//
// Lưu ý thật thà: `?product=0` KHÔNG phải cờ free/premium — log tài khoản
// Premium cũng gửi product=0. Nên đừng đổi tham số đó, đổi là ăn 403.
//
// Tùy chỉnh qua $argument:
//   {"audio_level":2}      cấp muốn ép (mặc định 2 = 320kbps/Ogg)
//   {"audio_level":"keep"} tắt hẳn, không đổi gì
//
// Nếu ép 2 mà bài bị nhảy / "Không thể phát": bài đó không có bản cấp 2 trên
// server -> đặt audio_level=1 (160kbps) hoặc "keep".
// ============================================================================

(function () {
  "use strict";

  var opt = {};
  try {
    opt = typeof $argument === "string" ? JSON.parse($argument || "{}") : $argument || {};
  } catch (e) {
    opt = {};
  }

  var url = ($request && $request.url) || "";
  var raw = opt.audio_level;
  if (raw === false || raw === null || raw === "keep" || raw === "off" || raw === 0 || raw === "0") {
    $done({});
    return;
  }
  var level = parseInt(String(raw === undefined || raw === "" ? 2 : raw), 10);
  if (!(level >= 0 && level <= 4)) level = 2;

  // Chỉ đúng một hình dạng URL, không đoán mò:
  //   /storage-resolve/v2/files/audio/interactive/<cấp>/<file_id>[?query]
  var m = /^(https?:\/\/[^/]+\/storage-resolve\/v2\/files\/audio\/interactive\/)(\d)(\/[^?]*)(\?.*)?$/.exec(
    url
  );
  if (!m) {
    $done({});
    return;
  }

  var cur = parseInt(m[2], 10);
  if (cur === level) {
    $done({});
    return;
  }

  var out = m[1] + level + m[3] + (m[4] || "");
  try {
    console.log("[spotify-vn] audio level " + cur + " -> " + level + " " + m[3].slice(0, 24));
  } catch (e) {}

  // Shadowrocket / Surge: http-request script trả {url} = request đi bằng URL mới.
  $done({ url: out });
})();
