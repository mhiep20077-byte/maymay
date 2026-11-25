// ============================================================================
// spotify-vn-mix / scripts/spotify-audio-level.js
// Build: 2026-11-25 · v2.8.0 · type: http-request
//
// audio_level: 0 hoặc "keep" = KHÔNG ép cấp 2 (giữ nguyên cap 1 để server trả
// đầy đủ URL stream 160kbps, không bị body rỗng 0B dẫn đến lỗi nhảy/skip bài).
// ============================================================================

(function () {
  "use strict";

  var opt = {};
  try {
    opt = typeof $argument === "string" ? JSON.parse($argument || "{}") : $argument || {};
  } catch (e) {
    opt = {};
  }

  var raw = opt.audio_level;
  if (raw === false || raw === null || raw === "keep" || raw === "off" || raw === 0 || raw === "0") {
    $done({});
    return;
  }

  var level = parseInt(String(raw === undefined || raw === "" ? 0 : raw), 10);
  if (!(level >= 1 && level <= 4)) {
    $done({});
    return;
  }

  var url = ($request && $request.url) || "";
  var m = /^(https?:\/\/[^/]+\/storage-resolve\/v2\/files\/audio\/(?:interactive|interactive_prefetch)\/)(\d)(\/[^?]*)(\?.*)?$/.exec(
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
    console.log("[spotify-vn-mix] audio level " + cur + " -> " + level);
  } catch (e) {}

  $done({ url: out });
})();
