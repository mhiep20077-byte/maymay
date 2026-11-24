// ============================================================
// LOCKET CATALOG PROBE  v1.0   (http-response, chỉ đọc)
// Mục đích: tìm xem app lấy "mẫu" (Tarot / Gieo quẻ / Photobooth
// 1x1-2x2 / Lenses / Film stock) từ endpoint nào, và đếm được
// mẫu MỚI mà máy mình chưa từng thấy.
// KHÔNG sửa body. KHÔNG đụng gì cả.
// ============================================================

var NOTIFY = true;
var KEY_SEEN = "locket_catalog_seen";
var COOLDOWN_H = 6;                 // giờ, chống spam noti
var PAT = /tarot|gieo|fortune|oracle|photobooth|booth|digicam|lens|phim|golden|35mm|point_?shoot|film_?stock/i;
var PATH_OK = /(filter|frame|lens|config|catalog|booth|tarot|effect|moment|camera|feed|store|shop)/i;

function tryParse(s) {
  try { var o = JSON.parse(s); return (o && typeof o === "object") ? o : null; } catch (e) { return null; }
}

var url = "";
try { url = $request.url || ""; } catch (e) {}

if (!PATH_OK.test(url)) { $done({}); } else {

  var body = $response.body;
  if (!body || body.length > 2500000) { $done({}); } else {

    var root = tryParse(body);
    if (!root) { $done({}); } else {

      var items = {}, total = 0;

      // tìm mọi object có (id|key|slug) + (name|title)
      (function walk(n, d) {
        if (!n || d > 8) { return; }
        if (Array.isArray(n)) {
          for (var i = 0; i < n.length; i++) { walk(n[i], d + 1); }
          return;
        }
        if (typeof n !== "object") { return; }
        var id = n.id || n.key || n.slug || n.filter_id || n.frame_id;
        var nm = n.name || n.title || n.label || n.display_name;
        if (id && typeof nm === "string" && nm.length) {
          total++;
          var tag = String(id) + "|" + nm;
          if (PAT.test(nm) || PAT.test(String(id))) { items[tag] = 1; }
        }
        for (var k in n) {
          if (Object.prototype.hasOwnProperty.call(n, k) && n[k] && typeof n[k] === "object") {
            walk(n[k], d + 1);
          }
        }
      })(root, 0);

      var seen = {};
      try { seen = JSON.parse($persistentStore.read(KEY_SEEN) || "{}"); } catch (e2) { seen = {}; }
      var fresh = [];
      for (var t in items) {
        if (Object.prototype.hasOwnProperty.call(items, t) && !seen[t]) { fresh.push(t); }
        seen[t] = 1;
      }

      var last = 0;
      try { last = parseInt($persistentStore.read("locket_catalog_ts") || "0", 10); } catch (e3) { last = 0; }
      var now = Date.now();
      var cool = (now - last) < COOLDOWN_H * 3600 * 1000;

      if (NOTIFY && fresh.length && !cool && typeof $notification !== "undefined") {
        var host = url.replace(/^https?:\/\//, "").split("/")[0];
        var sample = fresh.slice(0, 3).map(function (x) { return x.split("|")[1]; }).join(", ");
        $notification.post(
          "Locket Catalog · +" + fresh.length + " mẫu mới",
          host + " · " + total + " item",
          sample + (fresh.length > 3 ? " ..." : "")
        );
        try { $persistentStore.write(String(now), "locket_catalog_ts"); } catch (e4) {}
      }

      try { $persistentStore.write(JSON.stringify(seen), KEY_SEEN); } catch (e5) {}
      try { $persistentStore.write(JSON.stringify({ u: url, t: total, m: Object.keys(items).length }), "locket_catalog_last"); } catch (e6) {}

      $done({});
    }
  }
}
