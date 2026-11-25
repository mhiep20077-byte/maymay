// ============================================================================
// spotify-vn-v26 / scripts/spotify-audio-level.js
// Build: 2026-11-25 · v2.6.0 · type: http-request (chỉ sửa URL, không sửa body)
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
    console.log("[spotify-vn-v26] audio level " + cur + " -> " + level + " " + m[3].slice(0, 24));
  } catch (e) {}

  $done({ url: out });
})();
