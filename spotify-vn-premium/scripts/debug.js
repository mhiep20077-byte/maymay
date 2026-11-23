// ============================================================================
// spotify-vn-premium / scripts/debug.js
// Build: 2026-11-24 · v1.2.0 · type: http-response
//
// Mục đích duy nhất: in ra log cho biết endpoint nào trả body gì, để chốt
// patch chính xác. KHÔNG sửa gì — $done({}) = trả nguyên bản.
//
// v1.2 thêm nhận dạng KHUNG gRPC (pam-view-service / playback-settings /
// clientrestrictions). Khung: [flag][len 4B][payload]. v1.1 in 12 byte đầu của
// cả khung -> chỉ thấy toàn số khung, không thấy nội dung protobuf bên trong.
// Giờ bóc khung và in 16 byte ĐẦU CỦA PAYLOAD + dấu hiệu có chuỗi free.
//
// Dùng kèm spotify-vn-premium-DEBUG.module. Mở Shadowrocket -> tab Log, lọc
// "spot-vn-dbg", copy các dòng gửi lại là đủ để chốt patch chính xác.
// ============================================================================

(function () {
  "use strict";

  var url = ($request && $request.url) || "";
  var status = Number(($response && ($response.status || $response.statusCode)) || 0);

  var body = $response && ($response.bodyBytes || $response.body);
  var bytes = null;
  if (body instanceof ArrayBuffer) bytes = new Uint8Array(body);
  else if (body && ArrayBuffer.isView(body))
    bytes = new Uint8Array(body.buffer, body.byteOffset, body.byteLength);
  else if (typeof body === "string") bytes = new TextEncoder().encode(body);

  var len = bytes ? bytes.length : 0;
  var path = url.replace(/^https?:\/\/[^/]+/, "");

  if (!bytes || !len) {
    console.log("[spot-vn-dbg] " + status + " 0B empty " + path.slice(0, 100));
    $done({});
    return;
  }

  // --- bóc khung gRPC nếu có ---
  function grpcSplit(b) {
    var frames = [];
    var i = 0;
    while (i + 5 <= b.length) {
      var flag = b[i];
      if (flag !== 0x00 && flag !== 0x01 && flag !== 0x80 && flag !== 0x81) return null;
      var n = ((b[i + 1] << 24) | (b[i + 2] << 16) | (b[i + 3] << 8) | b[i + 4]) >>> 0;
      if (n > b.length - i - 5) return null;
      frames.push({ flag: flag, payload: b.subarray(i + 5, i + 5 + n) });
      i += 5 + n;
    }
    if (i !== b.length || !frames.length) return null;
    return frames;
  }

  var frames = grpcSplit(bytes);
  var kind;
  var core = bytes;

  if (frames) {
    var dataFrame = null;
    for (var fi = 0; fi < frames.length; fi++) {
      if (!(frames[fi].flag & 0x80)) { dataFrame = frames[fi]; break; }
    }
    core = dataFrame ? dataFrame.payload : frames[0].payload;
    kind = "grpc/" + frames.length + "frame/" + (dataFrame ? "data" : "trailer");
  } else {
    var b0 = bytes[0] || 0;
    if (b0 === 0x7b || b0 === 0x5b) kind = "json";
    else if (b0 === 0x1f || b0 === 0x78) kind = "gzip";
    else kind = "proto";
  }

  var hex = "";
  var hn = Math.min(core.length, 16);
  for (var i2 = 0; i2 < hn; i2++) hex += ("0" + core[i2].toString(16)).slice(-2);

  // --- tìm dấu hiệu free / premium trong payload ---
  var txt = "";
  try {
    var tn = Math.min(core.length, 8192);
    for (var j = 0; j < tn; j++) txt += String.fromCharCode(core[j]);
  } catch (e) {
    txt = "";
  }
  var flagFree = /spotify\s*_?\s*free|"free"|free_tier|free-tier/i.test(txt) ? " HAS_FREE" : "";
  var flagPrem = /premium/i.test(txt) ? " HAS_PREMIUM" : "";

  var peek = "";
  if (kind === "json") {
    peek = " >> " + txt.replace(/[A-Za-z0-9_\-]{40,}/g, "<…>").replace(/\s+/g, " ").slice(0, 220);
  }

  console.log(
    "[spot-vn-dbg] " + status + " " + len + "B " + kind + "/core=" + core.length + "B" +
      flagFree + flagPrem + " " + path.slice(0, 90) + " | " + hex + peek
  );

  $done({});
})();
