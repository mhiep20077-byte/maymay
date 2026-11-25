// ============================================================================
// spotify-vn-mix / scripts/spotify-audio-level.js
// Build: 2026-11-25 · v3.0.0 · type: http-request (chi sua URL, co phanh tu lui)
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

  var fallbackOn = !(opt.audio_fallback === false || opt.audio_fallback === "false" || opt.audio_fallback === 0);
  var failLimit = parseInt(String(opt.audio_fail_limit === undefined ? 2 : opt.audio_fail_limit), 10);
  if (!(failLimit >= 1 && failLimit <= 50)) failLimit = 2;
  var cooldownMs = (function () {
    var mn = parseInt(String(opt.audio_cooldown_min === undefined ? 60 : opt.audio_cooldown_min), 10);
    if (!(mn >= 1 && mn <= 1440)) mn = 60;
    return mn * 60000;
  })();

  if (fallbackOn) {
    var st = null;
    try {
      st = $persistentStore.read("spotcap_afail");
    } catch (e) {
      st = null;
    }
    if (st) {
      var parts = String(st).split("|");
      var fails = parseInt(parts[0], 10) || 0;
      var ts = parseInt(parts[1], 10) || 0;
      var now = Date.now();
      if (fails >= failLimit && ts > 0 && now - ts < cooldownMs) {
        try {
          console.log("[spotify-vn] audio fallback ON (" + fails + " loi) -> giu cap goc");
        } catch (e) {}
        $done({});
        return;
      }
      if (ts > 0 && now - ts >= cooldownMs && fails > 0) {
        try {
          $persistentStore.write("0|0", "spotcap_afail");
        } catch (e) {}
      }
    }
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

  $done({ url: out });
})();
