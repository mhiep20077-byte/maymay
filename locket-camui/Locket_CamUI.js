// ============================================================
// LOCKET CAM-UI  v2.0   (auto-discovery, merge-only)
// Endpoint : firebaseremoteconfig.googleapis.com  (http-response)
// Client   : Shadowrocket / Loon / Quantumult X / Surge
//
// KHÁC BẢN CŨ Ở ĐÂU:
//   Bản cũ hardcode tên key -> server đổi tên / thêm UI mới là mù.
//   Bản này TỰ DÒ: đi hết cây config, gặp key nào thuộc nhóm UI
//   mà đang tắt thì bật. Không cần biết trước tên key.
//
// KHÔNG ĐỤNG catalog filter (camera_filter_config.remote_filters)
// -> Tarot / Gieo quẻ / Photobooth 1x1-2x2 / Digicam... tự chảy về.
// ============================================================

var SCAN_ONLY   = false;   // true = chỉ báo cáo, KHÔNG sửa gì (chạy lần đầu nên để true)
var NOTIFY      = true;    // hiện thông báo kết quả
var BUMP_DUR     = 60;     // kéo mọi duration video/camera lên mức này (giây)
var FORCE_EXPERIMENTS = true; // ép experiment về nhóm cuối (nhóm mới nhất)
var MAX_LIST    = 8;       // số key tối đa in ra noti

// ------------------------------------------------------------
// nhóm nhận diện
// ------------------------------------------------------------
var G = [
  ["cam",    /camera|capture/i],
  ["lens",   /lens|digicam|point_?shoot|film_?stock|35mm|golden/i],
  ["booth",  /booth/i],
  ["tarot",  /tarot|gieo|fortune|divine|oracle/i],
  ["zoom",   /zoom|ultra_?wide|telephoto/i],
  ["timer",  /timer|countdown|delay/i],
  ["vid",    /video/i],
  ["roll",   /roll|history|rewind/i],
  ["filter", /filter|face|smile|effect/i]
];

// key mà value false/disabled mang nghĩa "đang tắt"
var CAN_ON   = /(enable|show|allow|support|has_|can_|is_|visible|active|available|unlock|free|premium|gold|beta|experiment|sheet|button|picker|upload|sound|mic)/i;
var DONT_ON  = /(disable|locked|require|block|deny|hidden_|_hidden|paywall|limit|ban)/i;
// vùng cấm: catalog filter, không đụng vào
var NO_GO    = /(remote_?filters|picker_?filters|camera_filter_config|frames|stickers)/i;
// duration: chỉ nắn trong các nhánh này
var DUR_OK   = /(camera|video|roll|capture|moment|trim|upload)/i;
var DUR_KEY  = /(max_?duration|max_?seconds|max_?length|duration_?max|trim_?max|max_?video)/i;

// ------------------------------------------------------------
function tryParse(s) {
  try { var o = JSON.parse(s); return (o && typeof o === "object") ? o : null; } catch (e) { return null; }
}
function isJSONish(s) {
  var t = s.replace(/^\s+/, "");
  return t.charAt(0) === "{" || t.charAt(0) === "[";
}

var stat = {}, offList = [], changes = [], scanned = 0;

function bump(cat) { stat[cat] = (stat[cat] || 0) + 1; }

function classify(name) {
  for (var i = 0; i < G.length; i++) { if (G[i][1].test(name)) { return G[i][0]; } }
  return null;
}

// thử bật 1 leaf. trả về true nếu đã sửa
function maybeForce(holder, key, parent) {
  var val = holder[key];
  var name = parent ? parent + "." + key : key;
  var cat = classify(key) || classify(parent || "");
  if (cat) { scanned++; bump(cat); }

  // 3 cờ bật nút filter được phép, nhưng tuyệt đối không sờ remote_filters
  var ALLOW_CATALOG = /^(show_filter_button|sheet_enabled|allows_custom_filters|show_face_button)$/;
  if (NO_GO.test(name) || NO_GO.test(parent || "")) {
    if (!(parent === "camera_filter_config" && ALLOW_CATALOG.test(key))) { return false; }
  }

  var t = typeof val;

  // duration -> kéo lên
  if ((t === "number" || (t === "string" && /^\d+$/.test(val))) && DUR_KEY.test(key) && DUR_OK.test(name)) {
    var n = t === "number" ? val : parseInt(val, 10);
    if (n > 0 && n < BUMP_DUR) {
      if (!SCAN_ONLY) { holder[key] = (t === "number") ? BUMP_DUR : String(BUMP_DUR); }
      changes.push(name + ": " + n + "->" + BUMP_DUR);
      return true;
    }
    return false;
  }

  // boolean false
  var isUIFlag = (CAN_ON.test(key) || cat !== null) && !DONT_ON.test(key);
  if (t === "boolean" && val === false && isUIFlag) {
    if (!SCAN_ONLY) { holder[key] = true; }
    changes.push(name + ": false->true");
    return true;
  }

  if (t === "boolean" && val === false) { offList.push(name + "=false"); }

  // string trạng thái
  if (t === "string") {
    var s = val.toLowerCase();
    var map = { "false": "true", "disabled": "enabled", "off": "on", "hidden": "visible", "0": "1" };
    if (map[s] && isUIFlag && s !== "0") {
      if (!SCAN_ONLY) { holder[key] = map[s]; }
      changes.push(name + ": " + s + "->" + map[s]);
      return true;
    }
    if (s === "true" || s === "enabled") { return false; }
    // key đang tắt kiểu chữ khác -> ghi nhận để báo cáo
    if (s === "false" || s === "disabled" || s === "off" || s === "hidden") {
      offList.push(name + "=" + s);
    }
  }
  return false;
}

// đi đệ quy, ghi lại JSON string sau khi sửa
function walk(container, parent) {
  for (var k in container) {
    if (!Object.prototype.hasOwnProperty.call(container, k)) { continue; }
    var v = container[k];

    if (typeof v === "string") {
      if (isJSONish(v)) {
        var p = tryParse(v);
        if (p && !Array.isArray(p)) {
          walk(p, k);
          container[k] = (SCAN_ONLY ? v : JSON.stringify(p));
          continue;
        }
        if (p && Array.isArray(p)) {
          for (var a = 0; a < p.length; a++) {
            if (p[a] && typeof p[a] === "object") { walk(p[a], k); }
          }
          container[k] = (SCAN_ONLY ? v : JSON.stringify(p));
          continue;
        }
      }
      maybeForce(container, k, parent);
    } else if (typeof v === "boolean" || typeof v === "number") {
      maybeForce(container, k, parent);
    } else if (v && typeof v === "object" && !Array.isArray(v)) {
      walk(v, k);
    }
  }
}

// ép experiment về nhóm cuối
function forceExperiments(E) {
  var raw = E.experiments;
  if (!raw) { return 0; }
  var arr = (typeof raw === "string") ? tryParse(raw) : raw;
  if (!arr || !Array.isArray(arr)) { return 0; }
  var hit = 0;
  for (var i = 0; i < arr.length; i++) {
    var ex = arr[i];
    if (!ex || typeof ex !== "object") { continue; }
    if (ex.enabled === false) { ex.enabled = true; hit++; }
    var gs = ex.groups;
    if (gs && Array.isArray(gs) && gs.length > 1) {
      for (var j = 0; j < gs.length; j++) {
        gs[j].weight = (j === gs.length - 1) ? 100 : 0;
      }
      hit++;
    }
  }
  if (hit && !SCAN_ONLY) { E.experiments = JSON.stringify(arr); }
  return hit;
}

// ------------------------------------------------------------
var UA = "";
try { UA = ($request.headers["User-Agent"] || $request.headers["user-agent"] || ""); } catch (e) {}
if (UA.indexOf("Locket") === -1) { $done({}); } else {

  var body = tryParse($response.body);
  if (!body || !body.entries) { $done({}); } else {

    var E = body.entries;

    walk(E, "");
    var exHit = FORCE_EXPERIMENTS ? forceExperiments(E) : 0;

    // ---- báo cáo ----
    var order = ["cam", "lens", "booth", "tarot", "zoom", "timer", "vid", "roll", "filter"];
    var line = [];
    for (var i = 0; i < order.length; i++) {
      line.push(order[i] + (stat[order[i]] || 0));
    }

    if (NOTIFY && typeof $notification !== "undefined") {
      if (SCAN_ONLY) {
        var t1 = "CamUI scan · " + line.join(" ");
        var b1 = scanned + " key UI, " + (offList.length + changes.length) + " đang tắt";
        var samp = offList.concat(changes).slice(0, MAX_LIST).join("\n");
        $notification.post(t1, b1, samp || "không thấy key nào bị tắt");
      } else {
        var t2 = "CamUI · bật " + changes.length + " cờ";
        var b2 = line.join(" ") + (exHit ? " · exp " + exHit : "");
        $notification.post(t2, b2, changes.slice(0, MAX_LIST).join("\n") || "không có gì cần bật");
      }
    }

    // lưu để lần sau so sánh
    try {
      $persistentStore.write(JSON.stringify({
        t: Date.now(), n: scanned, ch: changes.slice(0, 60), off: offList.slice(0, 60), ex: exHit
      }), "locket_camui_last");
    } catch (e) {}

    if (SCAN_ONLY) { $done({}); }
    else { body.state = "UPDATE"; $done({ body: JSON.stringify(body) }); }
  }
}
