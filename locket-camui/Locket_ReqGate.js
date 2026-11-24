// ============================================================
// LOCKET REQ GATE  v2.0   (http-request)
// Ép app luôn nhận config MỚI, không ăn 304 / cache.
// Đây là điều kiện tiên quyết: config cũ = UI cũ.
// ============================================================

var BUMP_VERSION = "";   // ví dụ "2.6.0". Để "" = không sửa version.
var BUMP_BUILD   = "";   // build number, thường để ""

var h = $request.headers || {};
var kill = [
  "If-None-Match", "if-none-match", "If-Modified-Since", "if-modified-since",
  "ETag", "etag", "Cache-Control", "cache-control", "X-Goog-If-None-Match",
  "X-Goog-If-Modified-Since", "X-Goog-ETag"
];
for (var i = 0; i < kill.length; i++) { delete h[kill[i]]; }
h["Cache-Control"] = "no-cache";
h["Pragma"] = "no-cache";

var out = { headers: h };

if ((BUMP_VERSION || BUMP_BUILD) && $request.body) {
  var b = null;
  try { b = JSON.parse($request.body); } catch (e) { b = null; }
  if (b && typeof b === "object") {
    if (BUMP_VERSION) {
      if (b.app_version !== undefined) { b.app_version = BUMP_VERSION; }
      if (b.appVersion !== undefined) { b.appVersion = BUMP_VERSION; }
    }
    if (BUMP_BUILD) {
      if (b.app_build_version !== undefined) { b.app_build_version = BUMP_BUILD; }
      if (b.appBuildVersion !== undefined) { b.appBuildVersion = BUMP_BUILD; }
    }
    out.body = JSON.stringify(b);
  }
}
$done(out);
