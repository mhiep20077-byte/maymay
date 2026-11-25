// ============================================================================
// spotify-vn-mix / scripts/spotify-audio-err.js
// Build: 2026-11-25 · v3.0.0 · type: http-response (KHONG requires-body)
// ============================================================================

(function () {
  "use strict";

  var url = ($request && $request.url) || "";
  var status = Number(($response && ($response.status || $response.statusCode)) || 0);

  if (!/storage-resolve\/v2\/files\/audio\//i.test(url)) {
    $done({});
    return;
  }
  if (status < 400) {
    $done({});
    return;
  }

  var lv = /\/audio\/interactive(?:_prefetch)?\/(\d+)\//.exec(url);

  try {
    var fails = 0;
    try {
      var st = $persistentStore.read("spotcap_afail");
      if (st) fails = parseInt(String(st).split("|")[0], 10) || 0;
    } catch (e) {
      fails = 0;
    }
    fails += 1;
    if (fails > 100) fails = 100;
    $persistentStore.write(fails + "|" + Date.now(), "spotcap_afail");
  } catch (e) {}

  $done({});
})();
