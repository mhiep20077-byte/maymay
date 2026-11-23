// ============================================================================
// spotify-vn-premium / optional/spotify-ipad.js
// Build: 2026-11-24 · v1.0.0 · type: http-request
//
// TÙY CHỌN — không bắt buộc. Đổi platform=iphone -> platform=ipad trên vài
// endpoint trả danh sách track của album/artist. Mục đích: acc free xem được
// danh sách track đầy đủ (một số build chỉ trả list rút gọn cho iPhone).
//
// Đây là trick CŨ, không phải điều kiện để module chính chạy. Bật lên nếu
// mày thấy album/artist chỉ hiện vài bài. Nếu app lỗi thì tắt đi.
// ============================================================================

(function () {
  "use strict";

  var url = ($request && $request.url) || "";
  var before = url;

  url = url.replace(/com:443/g, "com");
  url = url.replace(/platform=iphone/g, "platform=ipad");
  url = url.replace(/platform%3Diphone/g, "platform%3Dipad");

  if (url !== before) {
    console.log("[spotify-vn/ipad] " + url);
    $done({ url: url });
    return;
  }
  $done({});
})();
