// ============================================================================
// spotify-vn-mix / scripts/spotify-request.js
// Build: 2026-11-25 · v2.8.0 · type: http-request
// ============================================================================

(function () {
  "use strict";

  var STRIP_IDENTITY = true;

  var url = ($request && $request.url) || "";
  var headers = ($request && $request.headers) || {};

  var isTarget =
    /^https:\/\/.*spotify\.com(?::443)?\/.*(?:bootstrap|user-customization-service|ucs|nebula|remote-config-resolver|configuration|product-state|product_state|product\/|user-profile|user_profile|profile|account|device-capabilities|capabilities|login5|v3\/login|v4\/login|subscription|attributes|catalogue|premium|premiumdestinationbadge|BadgeService|checkout|payment|me(?:\/|\?|$)|pam-view-service|pam-account|playback-settings|spotify\.clientrestrictions|clientrestrictions|GetRestrictedIntegrations|net-fortune|jam_status|social-connect|connect-group|connect-state|device-proxy|ondemand-selector|offline|capping-api|identity|audio-attributes|media-quality|quality|settings|referrals|playlist-v2|playlist|signals|diff|extended-metadata|casita)/i.test(
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

  if (dropped.length) console.log("[spotify-vn-mix] request cleaned: " + dropped.join(", "));

  $done({ headers: out });
})();
