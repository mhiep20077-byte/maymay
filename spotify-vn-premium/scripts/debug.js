// ============================================================================
// spotify-vn-premium / scripts/debug.js
// Build: 2026-11-24 · v1.0.0 · type: http-response
//
// Mục đích duy nhất: cho biết MITM có thật sự bắt được request của Spotify
// hay không, và endpoint nào trả về body gì (kiểu + vài byte đầu).
// KHÔNG sửa gì cả — $done({}) = trả nguyên bản.
//
// Dùng kèm spotify-vn-premium-DEBUG.module. Mở Shadowrocket -> tab Log,
// lọc chữ "spot-vn-dbg", copy các dòng gửi lại là đủ để chốt patch chính xác.
// ============================================================================

(function () {
  "use strict";

  var url = ($request && $request.url) || "";
  var status = Number(
    ($response && ($response.status || $response.statusCode)) || 0
  );

  var body = $response && ($response.bodyBytes || $response.body);
  var bytes = null;
  if (body instanceof ArrayBuffer) bytes = new Uint8Array(body);
  else if (body && ArrayBuffer.isView(body))
    bytes = new Uint8Array(body.buffer, body.byteOffset, body.byteLength);
  else if (typeof body === "string") bytes = new Uint8Array([body.length]); // JSON dạng text

  var len = bytes ? bytes.length : 0;
  var hex = "";
  if (bytes) {
    var n = Math.min(len, 12);
    for (var i = 0; i < n; i++) {
      hex += ("0" + bytes[i].toString(16)).slice(-2);
    }
  }

  var kind = "?";
  if (bytes) {
    var b0 = bytes[0] || 0;
    // JSON thường bắt đầu bằng '{' (0x7b) hoặc '[' (0x5b)
    if (b0 === 0x7b || b0 === 0x5b) kind = "json";
    else if (b0 === 0x1f || b0 === 0x78) kind = "gzip";
    else kind = "proto";
  }

  var path = url.replace(/^https?:\/\/[^/]+/, "");
  console.log(
    "[spot-vn-dbg] " +
      status +
      " " +
      len +
      "B " +
      kind +
      " " +
      path.slice(0, 90) +
      " | " +
      hex
  );

  $done({});
})();
