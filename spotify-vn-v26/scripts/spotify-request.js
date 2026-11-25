// ============================================================================
// spotify-vn-v26 / scripts/spotify-request.js
// Build: 2026-11-25 · v2.6.0 · type: http-request
//
// Sửa 2 lỗi lớn của bản v2.5 ở bước request:
//   1. Mở rộng `isTarget` khớp toàn bộ các endpoint mà script response cần sửa
//      (v2.5 chỉ có 7 endpoint cũ, bỏ sót device-capabilities, net-fortune,
//       user-profile, product-state, account, attributes, pam-account... khiến
//       các endpoint đó trả 304 hoặc nén gzip).
//   2. Bỏ `isGrpcish` giữ nguyên Accept-Encoding, đồng thời xóa luôn
//      `grpc-accept-encoding` / `accept-encoding` và đặt `identity`.
//      Lý do: khi client gửi `grpc-accept-encoding: gzip`, server gRPC trả về
//      frame nén có `flag = 0x01`, làm `spotify-premium.js` (dòng kiểm tra
//      `if (f.flag & 0x01) continue;`) bỏ qua không patch được `playback-settings`
//      và `pam-view-service`! Ép `identity` là chuẩn gRPC hợp lệ 100%, bắt buộc
//      server trả về frame không nén (`flag = 0x00`).
// ============================================================================

(function () {
  "use strict";

  var STRIP_IDENTITY = true;

  var url = ($request && $request.url) || "";
  var headers = ($request && $request.headers) || {};

  var isTarget =
    /^https:\/\/[a-z0-9.-]*spotify\.com(?::443)?\/(?:bootstrap|user-customization-service|nebula|remote-config-resolver|product-state|product_state|product\/|user-profile|user_profile|profile|account|device-capabilities|login5|subscription|attributes|catalogue|premium|checkout|payment|v3\/login|me(?:\/|\?|$)|pam-view-service|pam-account|playback-settings|spotify\.clientrestrictions|clientrestrictions|GetRestrictedIntegrations|net-fortune|jam_status|connect-group|ondemand-selector|audio-attributes|media-quality|quality|settings|referrals)/i.test(
      url
    );

  if (!isTarget) {
    $done({});
    return;
  }

  var out = {};
  var dropped = [];

  for (var k in headers) {
    if (!Object.prototype.hasOwnProperty.call(headers, k)) continue;
    var lk = k.toLowerCase();
    if (
      lk === "if-none-match" ||
      lk === "if-modified-since" ||
      (STRIP_IDENTITY &&
        (lk === "accept-encoding" || lk === "grpc-accept-encoding" || lk === "x-accept-encoding"))
    ) {
      dropped.push(lk);
      continue;
    }
    out[k] = headers[k];
  }

  out["Cache-Control"] = "no-cache";
  out["Pragma"] = "no-cache";
  if (STRIP_IDENTITY) {
    out["Accept-Encoding"] = "identity";
  }

  if (dropped.length) console.log("[spotify-vn-v26] request cleaned: " + dropped.join(", "));

  $done({ headers: out });
})();
