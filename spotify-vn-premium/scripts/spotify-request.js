// ============================================================================
// spotify-vn-premium / scripts/spotify-request.js
// Build: 2026-11-24 · v1.1.0 · type: http-request
//
// Việc duy nhất: dọn request TRƯỚC khi Spotify trả lời, để script sửa
// protobuf (spotify-premium.js) luôn nhận được body thật.
//
//   1. Bỏ If-None-Match / If-Modified-Since  -> server không trả 304
//      (304 không có body => http-response script bỏ qua => patch mất sạch,
//       đây là lý do "lúc được lúc không" của các module cũ).
//   2. Ép Cache-Control: no-cache            -> tránh cache của proxy/hệ thống.
//   3. Ép Accept-Encoding: identity          -> body về dạng thô, không gzip,
//      protobuf đọc được ngay. (Nếu mày muốn giữ gzip thì đổi cờ bên dưới.)
//
// Không đụng tới token, cookie, hay bất kỳ header xác thực nào.
// ============================================================================

(function () {
  "use strict";

  var STRIP_IDENTITY = true; // đặt false nếu mày muốn giữ nguyên Accept-Encoding

  var url = ($request && $request.url) || "";
  var headers = ($request && $request.headers) || {};

  // Chỉ xử lý đúng các endpoint mà script response sẽ patch.
  // v2.0.0: bắt theo path, host nào của spotify.com cũng được — client mới
  // gọi qua shard (gae2-spclient.spotify.com), không phải spclient.wg nữa.
  var isTarget =
    /^https:\/\/[a-z0-9.-]*spotify\.com(?::443)?\/(?:bootstrap|user-customization-service|nebula|remote-config-resolver|pam-view-service|playback-settings|clientrestrictions)/i.test(
      url
    );

  // v2.2: PAM / playback-settings / clientrestrictions đi qua gRPC. Ép
  // Accept-Encoding: identity trên các endpoint này có thể làm hỏng khung
  // gRPC, nên chỉ bỏ header điều kiện, giữ nguyên encoding.
  var isGrpcish = /(?:pam-view-service|playback-settings|clientrestrictions)/i.test(url);

  if (!isTarget) {
    $done({});
    return;
  }

  var out = {};
  var dropped = [];

  for (var k in headers) {
    if (!Object.prototype.hasOwnProperty.call(headers, k)) continue;
    var lk = k.toLowerCase();
    // 3 header điều kiện/cache: bỏ hết, giữ nguyên phần còn lại.
    if (
      lk === "if-none-match" ||
      lk === "if-modified-since" ||
      (STRIP_IDENTITY && !isGrpcish && lk === "accept-encoding")
    ) {
      dropped.push(lk);
      continue;
    }
    out[k] = headers[k];
  }

  out["Cache-Control"] = "no-cache";
  out["Pragma"] = "no-cache";
  if (STRIP_IDENTITY && !isGrpcish) out["Accept-Encoding"] = "identity";

  if (dropped.length) console.log("[spotify-vn] request cleaned: " + dropped.join(", "));

  $done({ headers: out });
})();
