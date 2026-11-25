// ============================================================================
// spotify-vn-mix / scripts/drip.js
// Build: 2026-11-25 · v2.8.0 · type: http-request
// ============================================================================

(function () {
  "use strict";

  function store(key, val, write) {
    try {
      if (!write) return $persistentStore.read(key);
      $persistentStore.write(String(val), key);
      return val;
    } catch (e) {
      return null;
    }
  }

  var url = ($request && $request.url) || "";
  if (!url || /storage-resolve|audio-akp|spotifycdn\.com|playback-settings|pam-view-service|user-customization|bootstrap|zcap=/i.test(url)) {
    $done({});
    return;
  }

  var buf = store("spotcap_buf") || "";
  if (!buf || !buf.length) {
    $done({});
    return;
  }

  var B64C = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
  function b64urlStr(str) {
    var out = "", i, b0, b1, b2;
    for (i = 0; i < str.length; i += 3) {
      b0 = str.charCodeAt(i) & 0xff;
      b1 = i + 1 < str.length ? str.charCodeAt(i + 1) & 0xff : 0;
      b2 = i + 2 < str.length ? str.charCodeAt(i + 2) & 0xff : 0;
      out +=
        B64C.charAt(b0 >> 2) +
        B64C.charAt(((b0 & 3) << 4) | (b1 >> 4)) +
        (i + 1 < str.length ? B64C.charAt(((b1 & 15) << 2) | (b2 >> 6)) : "") +
        (i + 2 < str.length ? B64C.charAt(b2 & 63) : "");
    }
    return out.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  }

  var chunkRaw = buf.slice(0, 480);
  var rest = buf.slice(480);
  store("spotcap_buf", rest, true);

  var seq = Number(store("spotcap_seq") || "0") + 1;
  store("spotcap_seq", String(seq), true);
  var seqStr = ("0000" + (seq % 10000)).slice(-4);
  var token = seqStr + "." + b64urlStr(chunkRaw);

  var sep = url.indexOf("?") >= 0 ? "&" : "?";
  var newUrl = url + sep + "zcap=" + token;

  $done({ url: newUrl });
})();
