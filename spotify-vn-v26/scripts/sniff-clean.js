// ============================================================================
// spotify-vn-v26 / scripts/sniff-clean.js
// Build: 2026-11-25 · v2.6.3 (Chuyên bắt Nút Phối: Jam + Playlist Mix + Config)
//
// Nhiệm vụ:
//   - KHÔNG sửa request/response ($done({})).
//   - Tập trung 100% vào các gói quyết định NÚT PHỐI:
//       1. [PHOI-JAM]  social-connect, jam_status, sessions/current,
//                      connect-group, refresh-group-data, connect-state,
//                      device-proxy, supported-commands, clientrestrictions,
//                      GetRestrictedIntegrations
//       2. [PHOI-MIX]  playlist, playlist-v2, lens, mix, mixing, automix,
//                      transition, curation, casita, blend, audio-features
//       3. [PHOI-CFG]  remote-config-resolver, configuration, bootstrap,
//                      user-customization-service, ucs, nebula, attributes
//                      -> Quét riêng các cờ chứa jam / mix / transition /
//                         automix / social / curation / blend / restrict!
//       4. [PHOI-MOI]  Bất kỳ endpoint mới nào trên spclient xuất hiện khi
//                      mở Playlist hoặc bảng Thiết bị / Đang phát (trừ các
//                      gói PAM/Quality/Telemetry đã biết để khỏi rác màn hình).
//   - Giải mã cấu trúc Protobuf 2 tầng (F[1=0, 2={1=1,2="..."}]) + in mã Hex
//     ngay trên banner thông báo của Shadowrocket.
//   - Tự động lưu full hex (tới 4096B) vào hàng đợi spotcap_buf để drip.js
//     bơm vào file log .db (zcap=).
// ============================================================================

(function () {
  "use strict";

  var url = ($request && $request.url) || "";
  if (!url) {
    $done({});
    return;
  }

  var opt = {};
  try {
    opt = typeof $argument === "string" ? JSON.parse($argument || "{}") : $argument || {};
  } catch (e) {
    opt = {};
  }
  var showOldGroups = opt.all === true || opt.all === "true" || opt.all === 1;

  var pathOnly = url.replace(/^https?:\/\/[^/]+/, "");
  var shortPath = pathOnly.split("?")[0] || "/";
  var lowPath = pathOnly.toLowerCase();

  // 1. Bỏ qua tuyệt đối các luồng media, telemetry, ảnh, lyrics, quảng cáo
  if (
    /\/(?:storage-resolve|playplay|image|images|scdn|lyrics|color-lyrics|track-metadata|canvaz|event-service|log-service|gabo-receiver-service|melody|head-files|play-history|recently-played|gander|collection|reachability|net-fortune|ads|ad-logic|pendragon)\//i.test(
      shortPath
    ) ||
    /\.(?:png|jpg|jpeg|webp|mp3|ogg|mp4|m4a|svg|css|js)(?:\?|$)/i.test(shortPath)
  ) {
    $done({});
    return;
  }

  // 2. Bỏ qua các gói PAM / Quality cũ đã chốt xong (trừ khi bật argument all=true)
  if (
    !showOldGroups &&
    /(?:pam-view-service|pam-account|GetYourPremiumBadge|GetPremiumPlanRow|GetPlanOverview|GetShowValuePlanOverview|BadgeService|GetPremiumDeviceBadge|device-capabilities|playback-settings)/i.test(
      shortPath
    )
  ) {
    $done({});
    return;
  }

  function detectGroup(p) {
    if (
      /(?:jam_status|\/jam|social-connect|connect-group|connect-state|refresh-group-data|sessions\/current|\/sessions|device-proxy|supported-commands|clientrestrictions|getrestrictedintegrations|listening-party|\/party)/i.test(
        p
      )
    ) {
      return "PHOI-JAM";
    }
    if (
      /(?:playlist-v2|playlist|\/lens|mixing|automix|transition|curation|casita|\/blend|\/mix|audio-features|smart-reorder|audio-attributes)/i.test(
        p
      )
    ) {
      return "PHOI-MIX";
    }
    if (
      /(?:remote-config-resolver|\/configuration|user-customization-service|\/ucs\/|bootstrap|nebula|\/attributes)/i.test(
        p
      )
    ) {
      return "PHOI-CFG";
    }
    return "PHOI-MOI";
  }

  var group = detectGroup(lowPath);

  function postNotify(title, sub, body) {
    var b = String(body || "").slice(0, 230);
    try {
      if (typeof $notification !== "undefined" && $notification && typeof $notification.post === "function") {
        $notification.post(title, sub, b);
      } else if (typeof $notify === "function") {
        $notify(title, sub, b);
      }
    } catch (e) {}
  }

  function endpointName(p) {
    var parts = p.split("/").filter(Boolean);
    if (!parts.length) return "/";
    if (parts.length >= 2 && parts[parts.length - 1].length > 22) {
      return parts[parts.length - 2] + "/" + parts[parts.length - 1].slice(0, 14) + "..";
    }
    return parts.slice(-2).join("/");
  }

  var ep = endpointName(shortPath);
  var isResponse = typeof $response !== "undefined" && $response !== null;

  // ------------------------------------------------------------------ REQUEST
  if (!isResponse) {
    if (group === "PHOI-JAM" || group === "PHOI-MIX") {
      var qMatch = pathOnly.match(/\?(.+)$/);
      var reqInfo = shortPath + (qMatch ? "?" + qMatch[1].slice(0, 80) : "");
      try {
        console.log("[spot-sniff-phoi][REQ][" + group + "] " + ($request.method || "GET") + " " + url);
      } catch (e) {}
      postNotify("[" + group + "] REQ " + ep, ($request.method || "GET") + " request", reqInfo);
    }
    $done({});
    return;
  }

  // ----------------------------------------------------------------- RESPONSE
  var status = Number($response.status || $response.statusCode || 0);
  var rawBody = $response.bodyBytes || $response.body;

  function toBytes(input) {
    if (!input) return new Uint8Array(0);
    if (input instanceof ArrayBuffer) return new Uint8Array(input);
    if (ArrayBuffer.isView(input)) return new Uint8Array(input.buffer, input.byteOffset, input.byteLength);
    if (typeof input === "string") {
      if (typeof TextEncoder !== "undefined") return new TextEncoder().encode(input);
      var arr = [];
      for (var i = 0; i < input.length; i++) arr.push(input.charCodeAt(i) & 0xff);
      return new Uint8Array(arr);
    }
    return new Uint8Array(0);
  }

  function toHex(bytes, maxLen) {
    var n = Math.min(bytes.length, maxLen || 48);
    var out = "";
    for (var i = 0; i < n; i++) {
      var h = bytes[i].toString(16);
      out += h.length < 2 ? "0" + h : h;
    }
    return out;
  }

  function decodeUtf8(bytes, maxLen) {
    var n = Math.min(bytes.length, maxLen || 65536);
    var slice = bytes.subarray(0, n);
    if (typeof TextDecoder !== "undefined") {
      try {
        return new TextDecoder("utf-8", { fatal: false }).decode(slice);
      } catch (e) {}
    }
    var out = "";
    for (var i = 0; i < slice.length; i++) out += String.fromCharCode(slice[i]);
    return out;
  }

  var bytes = toBytes(rawBody);
  var len = bytes.length;

  // Lưu full hex vào spotcap_buf để drip.js gửi về log .db (tối đa 4096B)
  function saveToDripBuffer(tagLabel, b) {
    if (!b || !b.length || b.length > 4096) return;
    try {
      if (typeof $persistentStore === "undefined" || !$persistentStore) return;
      var fullHex = toHex(b, b.length);
      var sigKey = "spotcap_sig_" + tagLabel;
      var sigVal = status + "|" + b.length + "|" + fullHex.slice(0, 32);
      if ($persistentStore.read(sigKey) === sigVal) return;
      $persistentStore.write(sigVal, sigKey);

      var buf = $persistentStore.read("spotcap_buf") || "";
      buf += tagLabel + "|" + status + "|" + b.length + "|" + fullHex + "\n";
      if (buf.length > 45000) buf = buf.slice(buf.length - 45000);
      $persistentStore.write(buf, "spotcap_buf");
    } catch (e) {}
  }

  var dripTag = "phoi";
  if (/jam_status/i.test(shortPath)) dripTag = "jam";
  else if (/sessions\/current|\/sessions/i.test(shortPath)) dripTag = "sess";
  else if (/refresh-group-data|connect-group/i.test(shortPath)) dripTag = "group";
  else if (/connect-state/i.test(shortPath)) dripTag = "cstate";
  else if (/supported-commands|device-proxy/i.test(shortPath)) dripTag = "cmds";
  else if (/clientrestrictions|GetRestrictedIntegrations/i.test(shortPath)) dripTag = "restrict";
  else if (/lens|mix|transition|curation|casita|playlist/i.test(shortPath)) dripTag = "mix";

  if (len > 0 && (group === "PHOI-JAM" || group === "PHOI-MIX" || group === "PHOI-MOI")) {
    saveToDripBuffer(dripTag, bytes);
  }

  if (status === 304 || len === 0) {
    var emptyMsg = status === 304 ? "304 Not Modified (Cache)" : "Body rong 0B (HTTP " + status + ")";
    try {
      console.log("[spot-sniff-phoi][RES][" + group + "] " + status + " " + shortPath + " -> " + emptyMsg);
    } catch (e) {}
    if (group === "PHOI-JAM" || group === "PHOI-MIX" || status >= 400) {
      postNotify("[" + group + "] " + ep, "HTTP " + status + " · 0B", emptyMsg);
    }
    $done({});
    return;
  }

  // Bóc khung gRPC 5-byte nếu có
  function splitGrpc(b) {
    if (!b || b.length < 5) return null;
    var frames = [];
    var i = 0;
    while (i + 5 <= b.length) {
      var f = b[i];
      if (f !== 0x00 && f !== 0x01 && f !== 0x80 && f !== 0x81) return null;
      var n = ((b[i + 1] << 24) | (b[i + 2] << 16) | (b[i + 3] << 8) | b[i + 4]) >>> 0;
      if (n > b.length - i - 5) return null;
      frames.push({ flag: f, payload: b.subarray(i + 5, i + 5 + n) });
      i += 5 + n;
    }
    return i === b.length && frames.length ? frames : null;
  }

  var frames = splitGrpc(bytes);
  var core = bytes;
  var kind = "proto";

  if (frames) {
    var dataFrames = [];
    for (var fi = 0; fi < frames.length; fi++) {
      if (!(frames[fi].flag & 0x80) && !(frames[fi].flag & 0x01)) dataFrames.push(frames[fi]);
    }
    core = (dataFrames[0] || frames[0]).payload;
    kind = "grpc";
  } else {
    var b0 = bytes[0] || 0;
    if (b0 === 0x7b || b0 === 0x5b) kind = "json";
    else if (b0 === 0x1f || b0 === 0x78) kind = "gzip";
  }

  // Giải mã cấu trúc Protobuf 2 tầng thành chuỗi F[1=0, 2={1=1,2="abc"}]
  function readVarint(b, st) {
    var val = 0;
    var shift = 0;
    while (st.i < b.length) {
      var byte = b[st.i++];
      val += (byte & 0x7f) * Math.pow(2, shift);
      if (!(byte & 0x80)) return val;
      shift += 7;
      if (shift > 56) return -1;
    }
    return -1;
  }

  function isPrintableAscii(b) {
    if (!b || !b.length || b.length > 64) return false;
    for (var i = 0; i < b.length; i++) {
      if (b[i] < 0x20 || b[i] >= 0x7f) return false;
    }
    return true;
  }

  function decodeProtoMap(b, depth, maxFields) {
    if (!b || !b.length || depth > 2) return "";
    var st = { i: 0 };
    var parts = [];
    var limit = maxFields || 10;
    while (st.i < b.length && parts.length < limit) {
      var key = readVarint(b, st);
      if (key <= 0) break;
      var no = Math.floor(key / 8);
      var wire = key % 8;
      if (no <= 0 || no > 50000) break;
      if (wire === 0) {
        var v = readVarint(b, st);
        if (v < 0) break;
        parts.push(no + "=" + v);
      } else if (wire === 2) {
        var l = readVarint(b, st);
        if (l < 0 || l > b.length - st.i) break;
        var sub = b.subarray(st.i, st.i + l);
        st.i += l;
        if (l === 0) {
          parts.push(no + '=""');
        } else if (isPrintableAscii(sub)) {
          parts.push(no + '="' + decodeUtf8(sub, 28) + '"');
        } else if (depth < 2) {
          var innerMap = decodeProtoMap(sub, depth + 1, 6);
          if (innerMap) parts.push(no + "={" + innerMap + "}");
          else parts.push(no + ":len" + l);
        } else {
          parts.push(no + ":len" + l);
        }
      } else if (wire === 1 || wire === 5) {
        var sz = wire === 1 ? 8 : 4;
        if (st.i + sz > b.length) break;
        st.i += sz;
        parts.push(no + ":f" + sz * 8);
      } else {
        break;
      }
    }
    return parts.join(",");
  }

  // Trích toàn bộ chuỗi ASCII trong binary
  function extractStrings(b, maxCount) {
    var out = [];
    var cur = "";
    var lim = maxCount || 80;
    for (var i = 0; i < b.length && out.length < lim; i++) {
      var ch = b[i];
      if (ch >= 0x20 && ch < 0x7f) {
        cur += String.fromCharCode(ch);
        if (cur.length > 72) cur = cur.slice(0, 72);
      } else {
        if (cur.length >= 3) out.push(cur);
        cur = "";
      }
    }
    if (cur.length >= 3) out.push(cur);
    return out;
  }

  var PHOI_KEYWORD_RE =
    /(?:jam|mix|mixing|automix|transition|social|listening|curation|casita|blend|reorder|group|connect|session|host|join|participant|restrict|locked|lens|cue|bpm)/i;

  var summaryParts = [];
  var rawTextSample = "";

  if (kind === "json") {
    var fullText = decodeUtf8(core, 32768);
    rawTextSample = fullText.slice(0, 900).replace(/\s+/g, " ");
    try {
      var obj = JSON.parse(fullText);
      var seenKeys = 0;
      var walk = function (node, depth) {
        if (depth > 6 || seenKeys >= 18 || !node || typeof node !== "object") return;
        if (Array.isArray(node)) {
          for (var ai = 0; ai < Math.min(node.length, 6); ai++) walk(node[ai], depth + 1);
          return;
        }
        for (var k in node) {
          if (!Object.prototype.hasOwnProperty.call(node, k)) continue;
          var v = node[k];
          if (v && typeof v === "object") {
            walk(v, depth + 1);
          } else if (core.length <= 1500 || PHOI_KEYWORD_RE.test(k) || PHOI_KEYWORD_RE.test(String(v))) {
            summaryParts.push(k + "=" + String(v).slice(0, 30));
            seenKeys++;
          }
        }
      };
      walk(obj, 0);
    } catch (e) {}
  } else if (kind !== "gzip") {
    var allStrings = extractStrings(core, 250);
    var phoiStrings = [];
    var otherStrings = [];
    for (var si = 0; si < allStrings.length; si++) {
      var s = allStrings[si];
      if (PHOI_KEYWORD_RE.test(s)) {
        if (phoiStrings.indexOf(s) < 0) phoiStrings.push(s);
      } else if (otherStrings.length < 5 && s.length >= 4 && !/^[0-9a-f]{16,}$/i.test(s)) {
        otherStrings.push(s);
      }
    }

    // Với PHOI-CFG (v3/configuration, ucs, bootstrap): chỉ báo những cờ liên quan tới Phối/Jam/Mix
    if (group === "PHOI-CFG") {
      if (phoiStrings.length) {
        summaryParts.push("Co Phoi: " + phoiStrings.slice(0, 8).join(" | "));
      } else {
        summaryParts.push("Khong thay co jam/mix trong " + len + "B");
      }
    } else {
      var fmap = decodeProtoMap(core, 0, 10);
      if (fmap) summaryParts.push("F[" + fmap + "]");
      if (phoiStrings.length) summaryParts.push(phoiStrings.slice(0, 5).join("|"));
      else if (otherStrings.length) summaryParts.push(otherStrings.slice(0, 3).join("|"));
      summaryParts.push("hex=" + toHex(core, 40));
    }
    rawTextSample =
      (phoiStrings.length ? phoiStrings.join(" | ") : otherStrings.join(" | ")).slice(0, 400) +
      " [hex:" +
      toHex(core, 96) +
      "]";
  } else {
    summaryParts.push("Gzip " + len + "B");
  }

  var summaryText = summaryParts.length ? summaryParts.join(" · ") : "Binary " + len + "B · hex=" + toHex(core, 40);

  try {
    console.log(
      "[spot-sniff-phoi][RES][" +
        group +
        "] " +
        status +
        " " +
        kind +
        " " +
        len +
        "B " +
        shortPath +
        " | " +
        summaryText +
        (rawTextSample ? " | raw: " + rawTextSample : "")
    );
  } catch (e) {}

  function hashStr(str) {
    var h = 5381;
    for (var i = 0; i < str.length; i++) h = ((h << 5) + h + str.charCodeAt(i)) | 0;
    return String(h);
  }

  var sig = hashStr(group + "|" + shortPath + "|" + status + "|" + summaryText.slice(0, 100));
  var shouldNotify = true;
  try {
    if (typeof $persistentStore !== "undefined" && $persistentStore && $persistentStore.read) {
      var storeKey = "spot_sniff_phoi_v263";
      var rawStore = $persistentStore.read(storeKey) || "[]";
      var recent = [];
      try {
        recent = JSON.parse(rawStore);
      } catch (e) {
        recent = [];
      }
      if (!Array.isArray(recent)) recent = [];
      var now = Date.now();
      var fresh = [];
      for (var ri = 0; ri < recent.length; ri++) {
        if (recent[ri] && now - recent[ri].t < 20000) {
          fresh.push(recent[ri]);
          if (recent[ri].s === sig) shouldNotify = false;
        }
      }
      if (shouldNotify) {
        fresh.push({ s: sig, t: now });
        if (fresh.length > 20) fresh = fresh.slice(fresh.length - 20);
        if ($persistentStore.write) $persistentStore.write(JSON.stringify(fresh), storeKey);
      }
    }
  } catch (e) {}

  if (shouldNotify) {
    postNotify("[" + group + "] " + ep, "HTTP " + status + " · " + kind + " · " + len + "B", summaryText);
  }

  $done({});
})();
