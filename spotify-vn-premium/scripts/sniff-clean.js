// ============================================================================
// spotify-vn-premium / scripts/sniff-clean.js
// Build: 2026-11-24 · v1.0.0 · type: http-request + http-response
//
// Module bat goi tin SACH cho Shadowrocket:
//   - KHONG sua request/response ($done({}) 100%).
//   - Chi bat 3 nhom muc tieu:
//       1. [CHAT LUONG]  storage-resolve, net-fortune, device-capabilities,
//                        playback-settings, audio-quality, media-quality...
//       2. [HO SO]       bootstrap, user-customization-service, nebula,
//                        product-state, user-profile, profile, attributes,
//                        subscription, catalogue, premium, login5...
//       3. [QUAN LY GOI] pam-view-service, pam-account, account, plan,
//                        checkout, payment, clientrestrictions,
//                        GetRestrictedIntegrations, GetPremiumPlanRow...
//   - Hien thong bao banner tren Shadowrocket + ghi log [spot-sniff] chi tiet.
// ============================================================================

(function () {
  "use strict";

  var url = ($request && $request.url) || "";
  if (!url) {
    $done({});
    return;
  }

  var pathOnly = url.replace(/^https?:\/\/[^/]+/, "");
  var shortPath = pathOnly.split("?")[0] || "/";
  var lowPath = pathOnly.toLowerCase();

  // Bo qua telemetry / metadata / anh / lyrics (van giu storage-resolve)
  if (
    !/storage-resolve/i.test(shortPath) &&
    (/\/(?:image|scdn|lyrics|color-lyrics|track-metadata|playlist-metadata|canvaz|event-service|log-service|melody|head-files|play-history|recently-played)\//i.test(
      shortPath
    ) ||
      /\.(?:png|jpg|jpeg|webp|mp3|ogg|mp4|m4a|svg|css|js)(?:\?|$)/i.test(shortPath))
  ) {
    $done({});
    return;
  }

  // Phan nhom 3 muc tieu chinh
  function detectGroup(p) {
    if (
      /(?:storage-resolve|net-fortune|device-capabilities|playback|audio|quality|bitrate|ondemand|capability|capabilities|settings)/i.test(
        p
      )
    ) {
      return "CHAT LUONG";
    }
    if (
      /(?:pam|plan|restriction|getrestrictedintegrations|getpremiumplanrow|getplanoverview|getshowvalueplanoverview|badge|account|checkout|payment)/i.test(
        p
      )
    ) {
      return "QUAN LY GOI";
    }
    if (
      /(?:bootstrap|user-customization-service|ucs|resolve|nebula|product|profile|attributes|subscription|catalogue|premium|identity|login5|remote-config|tier|entitlement|\/me(?:\/|\?|$))/i.test(
        p
      )
    ) {
      return "HO SO";
    }
    return "";
  }

  var group = detectGroup(lowPath);
  if (!group) {
    $done({});
    return;
  }

  function postNotify(title, sub, body) {
    var b = String(body || "").slice(0, 220);
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
    if (parts.length >= 2 && parts[parts.length - 1].length > 24) {
      return parts[parts.length - 2] + "/" + parts[parts.length - 1].slice(0, 12) + "..";
    }
    return parts.slice(-2).join("/");
  }

  var ep = endpointName(shortPath);
  var isResponse = typeof $response !== "undefined" && $response !== null;

  // ------------------------------------------------------------------ REQUEST
  if (!isResponse) {
    if (/storage-resolve\/v2\/files\/audio\/interactive\//i.test(lowPath) || /net-fortune/i.test(lowPath)) {
      var levelMatch = pathOnly.match(/\/interactive\/(\d+)\//i);
      var qMatch = pathOnly.match(/\?(.+)$/);
      var reqInfo = (levelMatch ? "cap=" + levelMatch[1] + " " : "") + (qMatch ? qMatch[1].slice(0, 120) : shortPath);
      try {
        console.log("[spot-sniff][REQ][" + group + "] " + url);
      } catch (e) {}
      if (levelMatch) {
        postNotify("[" + group + "] REQ " + ep, "Xin file am thanh", reqInfo);
      }
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

  function decodeUtf8(bytes, maxLen) {
    var n = Math.min(bytes.length, maxLen || 4096);
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

  if (status === 304 || len === 0) {
    var emptyMsg = status === 304 ? "304 Not Modified (App dung cache)" : "Body rong (" + status + ")";
    try {
      console.log("[spot-sniff][RES][" + group + "] " + status + " " + shortPath + " -> " + emptyMsg);
    } catch (e) {}
    postNotify("[" + group + "] " + ep, "HTTP " + status, emptyMsg);
    $done({});
    return;
  }

  // Boc gRPC neu co
  function splitGrpc(b) {
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

  // Phan tich JSON hoac Protobuf/ASCII
  var INTEREST_KEYS =
    /^(?:product|type|catalogue|plan|tier|badge|title|name|label|text|color|tint|bg|background|quality|bitrate|max_?bitrate|audio|stream|download|offline|premium|is_?premium|ads|locked|restricted|can_?join|is_?host|jam|player-license|payment-state)/i;
  var summaryParts = [];
  var rawTextSample = "";

  if (kind === "json") {
    var fullText = decodeUtf8(core, 32768);
    rawTextSample = fullText.slice(0, 600).replace(/\s+/g, " ");
    try {
      var obj = JSON.parse(fullText);
      var seenKeys = 0;
      var walk = function (node, depth) {
        if (depth > 6 || seenKeys >= 12 || !node || typeof node !== "object") return;
        if (Array.isArray(node)) {
          for (var ai = 0; ai < Math.min(node.length, 5); ai++) walk(node[ai], depth + 1);
          return;
        }
        for (var k in node) {
          if (!Object.prototype.hasOwnProperty.call(node, k)) continue;
          var v = node[k];
          if (v && typeof v === "object") {
            walk(v, depth + 1);
          } else if (INTEREST_KEYS.test(k)) {
            summaryParts.push(k + "=" + String(v).slice(0, 32));
            seenKeys++;
            if (seenKeys >= 12) break;
          }
        }
      };
      walk(obj, 0);
    } catch (e) {}
  } else if (kind !== "gzip") {
    // Trich chuoi ASCII co nghia trong protobuf / grpc
    var asciiHits = [];
    var cur = "";
    for (var bi = 0; bi < core.length && asciiHits.length < 30; bi++) {
      var ch = core[bi];
      if (ch >= 0x20 && ch < 0x7f) {
        cur += String.fromCharCode(ch);
        if (cur.length > 64) cur = cur.slice(0, 64);
      } else {
        if (cur.length >= 3) asciiHits.push(cur);
        cur = "";
      }
    }
    if (cur.length >= 3) asciiHits.push(cur);

    var hotWords = [];
    var otherWords = [];
    var HOT_RE =
      /(?:free|premium|very_?high|high|normal|low|320|160|96|vorbis|ogg|flac|bitrate|quality|offline|download|badge|plan|locked|restrict|535353|1ed760|spotify)/i;
    for (var hi = 0; hi < asciiHits.length; hi++) {
      var s = asciiHits[hi];
      if (HOT_RE.test(s)) {
        if (hotWords.indexOf(s) < 0) hotWords.push(s);
      } else if (otherWords.length < 6 && s.length >= 4 && !/^[0-9a-f]{16,}$/i.test(s)) {
        otherWords.push(s);
      }
    }
    summaryParts = hotWords.slice(0, 8).concat(otherWords.slice(0, 3));
    rawTextSample = asciiHits.join(" | ").slice(0, 500);
  } else {
    summaryParts.push("Du lieu nen gzip (" + len + "B)");
  }

  var summaryText = summaryParts.length ? summaryParts.join(" · ") : "Binary " + len + "B (khong co chuoi ro)";

  // Ghi log day du cho Shadowrocket -> Log -> Script
  try {
    console.log(
      "[spot-sniff][RES][" +
        group +
        "] " +
        status +
        " " +
        kind +
        " " +
        len +
        "B " +
        shortPath +
        " | summary: " +
        summaryText +
        (rawTextSample ? " | raw: " + rawTextSample : "")
    );
  } catch (e) {}

  // Dedupe theo danh sach 15 signature gan nhat de khong spam nhung van bat duoc cac endpoint khac nhau
  function hashStr(str) {
    var h = 5381;
    for (var i = 0; i < str.length; i++) h = ((h << 5) + h + str.charCodeAt(i)) | 0;
    return String(h);
  }

  var sig = hashStr(group + "|" + shortPath + "|" + status + "|" + summaryText.slice(0, 80));
  var shouldNotify = true;
  try {
    if (typeof $persistentStore !== "undefined" && $persistentStore && $persistentStore.read) {
      var storeKey = "spot_sniff_recent_v1";
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
        if (recent[ri] && now - recent[ri].t < 30000) {
          fresh.push(recent[ri]);
          if (recent[ri].s === sig) shouldNotify = false;
        }
      }
      if (shouldNotify) {
        fresh.push({ s: sig, t: now });
        if (fresh.length > 15) fresh = fresh.slice(fresh.length - 15);
        if ($persistentStore.write) $persistentStore.write(JSON.stringify(fresh), storeKey);
      }
    }
  } catch (e) {}

  if (shouldNotify) {
    postNotify("[" + group + "] " + ep, "HTTP " + status + " · " + kind + " · " + len + "B", summaryText);
  }

  $done({});
})();
