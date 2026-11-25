// ============================================================================
// spotify-vn-v26 / scripts/sniff-clean.js
// Build: 2026-11-25 · v2.6.3 (Chuyen bat NUT PHOI: Jam + Playlist Mix + Proto Tree)
//
// Nang cap v2.6.3:
//   1. Them nhom uu tien [NUT PHOI] bat toan bo:
//      - Jam / Social Listening: social-connect, jam_status, sessions/current,
//        connect-group, refresh-group-data, connect-state, device-proxy,
//        supported-commands, clientrestrictions, GetRestrictedIntegrations.
//      - Playlist Mix / DJ / Transitions: playlist-v2, playlist, mix, automix,
//        transition, curation, smart-reorder, lens, casita.
//   2. Bo chan playlist-metadata khi URL lien quan den playlist/mix/curation.
//   3. Voi goi protobuf/gRPC cua [NUT PHOI], giai ma cay protobuf 3 tang
//      (in ro f1=.. f2={f1=..}) + hex day du len banner va day vao spotcap_buf
//      de drip.js bom vao file .db cua Shadowrocket.
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

  if (
    !/storage-resolve/i.test(shortPath) &&
    (/\/(?:image|scdn|lyrics|color-lyrics|track-metadata|canvaz|event-service|log-service|melody|head-files|play-history|recently-played)\//i.test(
      shortPath
    ) ||
      /\.(?:png|jpg|jpeg|webp|mp3|ogg|mp4|m4a|svg|css|js)(?:\?|$)/i.test(shortPath))
  ) {
    $done({});
    return;
  }

  var opt = {};
  try {
    opt = typeof $argument === "string" ? JSON.parse($argument || "{}") : $argument || {};
  } catch (e) {
    opt = {};
  }
  var showAllGroups = opt.all === true || opt.all === "true" || opt.all === 1;

  function detectGroup(p) {
    if (
      /(?:jam_status|\/jam|social-connect|connect-group|connect-state|device-proxy|supported-commands|sessions\/current|refresh-group-data|clientrestrictions|getrestrictedintegrations|sociallistening|listening-party|playlist|mix|automix|transition|curation|smart-reorder|lens|casita|blend|pathfinder|extended-metadata|audio-features|audio-attributes|context-player|play-session|\/party)/i.test(
        p
      )
    ) {
      return "NUT PHOI";
    }
    if (
      /(?:remote-config-resolver|\/configuration|user-customization-service|\/ucs\/|bootstrap|nebula|\/attributes)/i.test(
        p
      )
    ) {
      return "PHOI-CFG";
    }
    if (!showAllGroups) {
      return "";
    }
    if (
      /(?:storage-resolve|net-fortune|device-capabilities|playback|audio|quality|bitrate|ondemand|capability|capabilities|settings|offline|capping)/i.test(
        p
      )
    ) {
      return "CHAT LUONG";
    }
    if (
      /(?:pam|plan|getpremiumplanrow|getplanoverview|getshowvalueplanoverview|badge|account|checkout|payment)/i.test(
        p
      )
    ) {
      return "QUAN LY GOI";
    }
    return "HO SO";
  }

  var group = detectGroup(lowPath);
  if (!group) {
    $done({});
    return;
  }

  function postNotify(title, sub, body) {
    var b = String(body || "").slice(0, 240);
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

  if (!isResponse) {
    var method = (($request && $request.method) || "GET").toUpperCase();
    if (group === "NUT PHOI") {
      var qIdx = pathOnly.indexOf("?");
      var qStr = qIdx >= 0 ? pathOnly.slice(qIdx + 1, qIdx + 120) : "";
      try {
        console.log("[spot-sniff-v26][REQ][NUT PHOI] " + method + " " + url);
      } catch (e) {}
      if (
        /(?:jam_status|social-connect|connect-group|device-proxy|supported-commands|clientrestrictions|GetRestrictedIntegrations|mix|automix|transition|curation|lens)/i.test(
          lowPath
        )
      ) {
        postNotify("[NUT PHOI] REQ " + ep, method + " " + shortPath.slice(0, 48), qStr || shortPath);
      }
    } else if (
      /storage-resolve\/v2\/files\/audio\/(?:interactive|interactive_prefetch)\//i.test(lowPath) ||
      /net-fortune/i.test(lowPath)
    ) {
      var levelMatch = pathOnly.match(/\/(?:interactive|interactive_prefetch)\/(\d+)\//i);
      var qMatch = pathOnly.match(/\?(.+)$/);
      var reqInfo = (levelMatch ? "cap=" + levelMatch[1] + " " : "") + (qMatch ? qMatch[1].slice(0, 120) : shortPath);
      try {
        console.log("[spot-sniff-v26][REQ][" + group + "] " + url);
      } catch (e) {}
      if (levelMatch) {
        postNotify("[" + group + "] REQ " + ep, "Xin file am thanh", reqInfo);
      }
    }
    $done({});
    return;
  }

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
    var n = Math.min(bytes.length, maxLen || 32);
    var out = "";
    for (var i = 0; i < n; i++) {
      var h = bytes[i].toString(16);
      out += h.length < 2 ? "0" + h : h;
    }
    return out;
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

  // Day hex cua goi [NUT PHOI] (<= 4096B) vao spotcap_buf de drip.js bom ve log .db
  if (group === "NUT PHOI" && len > 0 && len <= 4096) {
    try {
      if (typeof $persistentStore !== "undefined" && $persistentStore && $persistentStore.write) {
        var dTag = "phoi";
        if (/jam_status/i.test(lowPath)) dTag = "jam";
        else if (/sessions\/current/i.test(lowPath)) dTag = "sess";
        else if (/refresh-group-data|connect-group/i.test(lowPath)) dTag = "group";
        else if (/connect-state/i.test(lowPath)) dTag = "cstate";
        else if (/supported-commands|device-proxy/i.test(lowPath)) dTag = "cmds";
        else if (/clientrestrictions|GetRestrictedIntegrations/i.test(lowPath)) dTag = "restrict";
        else if (/mix|automix|transition|curation|lens/i.test(lowPath)) dTag = "mix";
        else if (/playlist/i.test(lowPath)) dTag = "plist";

        var fullHex = toHex(bytes, bytes.length);
        var sigKey = "spotcap_sig_sniff_" + dTag;
        var curSig = status + "|" + len + "|" + fullHex.slice(0, 32);
        if ($persistentStore.read(sigKey) !== curSig) {
          $persistentStore.write(curSig, sigKey);
          var buf = $persistentStore.read("spotcap_buf") || "";
          buf += dTag + "|" + status + "|" + len + "|" + fullHex + "\n";
          if (buf.length > 45000) buf = buf.slice(buf.length - 45000);
          $persistentStore.write(buf, "spotcap_buf");
        }
      }
    } catch (e) {}
  }

  if (status === 304 || len === 0) {
    var emptyMsg = status === 304 ? "304 Not Modified (App dung cache)" : "Body rong (" + status + ")";
    try {
      console.log("[spot-sniff-v26][RES][" + group + "] " + status + " " + shortPath + " -> " + emptyMsg);
    } catch (e) {}
    postNotify("[" + group + "] " + ep, "HTTP " + status, emptyMsg);
    $done({});
    return;
  }

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

  // Giai ma cay protobuf 3 tang cho [NUT PHOI] de thay ro field number + varint/string
  function readVarint(b, st) {
    var val = 0;
    var sh = 0;
    while (st.i < b.length) {
      var byte = b[st.i++];
      val += (byte & 0x7f) * Math.pow(2, sh);
      if (!(byte & 0x80)) return val;
      sh += 7;
      if (sh > 53) return -1;
    }
    return -1;
  }

  function isAsciiPrintable(b) {
    if (!b || !b.length || b.length > 80) return false;
    for (var i = 0; i < b.length; i++) {
      if (b[i] < 0x20 || b[i] >= 0x7f) return false;
    }
    return true;
  }

  function decodeProtoTree(b, depth, maxFields) {
    if (!b || !b.length || depth > 2) return null;
    var st = { i: 0 };
    var parts = [];
    var count = 0;
    var limit = maxFields || 12;
    while (st.i < b.length && count < limit) {
      var key = readVarint(b, st);
      if (key <= 0) return null;
      var no = Math.floor(key / 8);
      var wire = key % 8;
      if (no <= 0 || no > 536870911) return null;
      if (wire === 0) {
        var v = readVarint(b, st);
        if (v < 0) return null;
        parts.push("f" + no + "=" + v);
      } else if (wire === 2) {
        var l = readVarint(b, st);
        if (l < 0 || l > b.length - st.i) return null;
        var sub = b.subarray(st.i, st.i + l);
        st.i += l;
        if (l === 0) {
          parts.push("f" + no + "=\"\"");
        } else if (isAsciiPrintable(sub)) {
          parts.push("f" + no + "=\"" + decodeUtf8(sub, 40) + "\"");
        } else {
          var nested = depth < 2 ? decodeProtoTree(sub, depth + 1, 8) : null;
          if (nested) parts.push("f" + no + "={" + nested + "}");
          else parts.push("f" + no + "=[" + l + "B:" + toHex(sub, 8) + "]");
        }
      } else if (wire === 5 || wire === 1) {
        var sz = wire === 1 ? 8 : 4;
        if (st.i + sz > b.length) return null;
        var fx = b.subarray(st.i, st.i + sz);
        st.i += sz;
        parts.push("f" + no + "=0x" + toHex(fx, sz));
      } else {
        return null;
      }
      count++;
    }
    return parts.length ? parts.join(" ") : null;
  }

  var INTEREST_KEYS =
    /^(?:product|type|catalogue|plan|tier|badge|title|name|label|text|color|tint|bg|background|quality|bitrate|max_?bitrate|audio|stream|download|offline|premium|is_?premium|ads|locked|restricted|can_?join|is_?host|can_?host|jam|jam_?enabled|enable_?jam|social|session|group|command|mix|mixing|automix|transition|curation|smart_?reorder|player-license|payment-state)/i;
  var summaryParts = [];
  var rawTextSample = "";

  if (kind === "json") {
    var fullText = decodeUtf8(core, 32768);
    rawTextSample = fullText.slice(0, 900).replace(/\s+/g, " ");
    var dumpAllJsonKeys =
      group === "NUT PHOI" || core.length <= 1500 || /capabilities|GetPremiumPlanRow/i.test(shortPath);
    try {
      var obj = JSON.parse(fullText);
      var seenKeys = 0;
      var maxKeys = dumpAllJsonKeys ? 30 : 12;
      var walk = function (node, depth) {
        if (depth > 6 || seenKeys >= maxKeys || !node || typeof node !== "object") return;
        if (Array.isArray(node)) {
          for (var ai = 0; ai < Math.min(node.length, 6); ai++) walk(node[ai], depth + 1);
          return;
        }
        for (var k in node) {
          if (!Object.prototype.hasOwnProperty.call(node, k)) continue;
          var v = node[k];
          if (v && typeof v === "object") {
            walk(v, depth + 1);
          } else if (dumpAllJsonKeys || INTEREST_KEYS.test(k)) {
            summaryParts.push(k + "=" + String(v).slice(0, 32));
            seenKeys++;
            if (seenKeys >= maxKeys) break;
          }
        }
      };
      walk(obj, 0);
    } catch (e) {}
  } else if (kind !== "gzip") {
    var treeStr = group === "NUT PHOI" ? decodeProtoTree(core, 0, 16) : null;
    if (treeStr && /(?:\/signals|\/diff|\/playlist)/i.test(shortPath)) {
      var f12Matches = treeStr.match(/f12=\{[^}]+\}/g);
      if (f12Matches && f12Matches.length) {
        treeStr = f12Matches.join(" ") + " | " + treeStr;
      }
    }
    var asciiHits = [];
    var hotWords = [];
    var otherWords = [];
    var PHOI_HOT_RE =
      /(?:jam|social|host|join|session|group|mix|automix|transition|curation|casita|blend|reorder|restrict|locked|lens|cue|bpm)/i;
    var GENERAL_HOT_RE =
      /(?:free|premium|very_?high|high|normal|low|320|160|96|vorbis|ogg|flac|bitrate|quality|offline|download|badge|plan|535353|b3b3b3|1ed760|spotify|tocam|individual)/i;
    var cur = "";
    var scanLimit = Math.min(core.length, 131072);
    for (var bi = 0; bi < scanLimit; bi++) {
      var ch = core[bi];
      if (ch >= 0x20 && ch < 0x7f) {
        cur += String.fromCharCode(ch);
        if (cur.length > 72) cur = cur.slice(0, 72);
      } else {
        if (cur.length >= 3) {
          if (asciiHits.length < 40) asciiHits.push(cur);
          if (PHOI_HOT_RE.test(cur)) {
            if (hotWords.indexOf(cur) < 0 && hotWords.length < 15) hotWords.push(cur);
          } else if (group !== "PHOI-CFG" && GENERAL_HOT_RE.test(cur)) {
            if (hotWords.indexOf(cur) < 0 && hotWords.length < 10) hotWords.push(cur);
          } else if (otherWords.length < 5 && cur.length >= 4 && !/^[0-9a-f]{16,}$/i.test(cur)) {
            otherWords.push(cur);
          }
        }
        cur = "";
      }
    }
    if (cur.length >= 3 && PHOI_HOT_RE.test(cur) && hotWords.indexOf(cur) < 0) {
      hotWords.push(cur);
    }

    if (group === "PHOI-CFG") {
      // Voi configuration/attributes (7388B) va v3/configuration (108084B):
      // Ban nhieu banner lien tiep (moi banner ~210 ky tu) de hien TRON VEN 100%
      // danh sach co Spotify.Feature.* (tu A..Z, khong bi cat o chu L) va cac co mix/transition/curation!
      var allCfgTokens = [];
      var curTok = "";
      for (var ci = 0; ci < core.length; ci++) {
        var cch = core[ci];
        if (cch >= 0x20 && cch < 0x7f) {
          curTok += String.fromCharCode(cch);
          if (curTok.length > 80) curTok = curTok.slice(0, 80);
        } else {
          if (curTok.length >= 3) {
            if (/configuration\/attributes/i.test(shortPath)) {
              if (/^Spotify\.Feature\./.test(curTok)) {
                // Lay them 4 byte hex ngay sau ten feature de biet gia tri enum/bool
                var tailHex = toHex(core.subarray(ci, Math.min(core.length, ci + 6)), 6);
                allCfgTokens.push(curTok.replace(/^Spotify\.Feature\./, "SF.") + "=" + tailHex);
              } else if (PHOI_HOT_RE.test(curTok)) {
                allCfgTokens.push(curTok);
              }
            } else if (PHOI_HOT_RE.test(curTok)) {
              var tailH = toHex(core.subarray(ci, Math.min(core.length, ci + 6)), 6);
              var item = curTok + ":" + tailH;
              if (allCfgTokens.indexOf(item) < 0) allCfgTokens.push(item);
            }
          }
          curTok = "";
        }
      }
      if (allCfgTokens.length) {
        var chunkList = [];
        var curChunk = "";
        for (var ti = 0; ti < allCfgTokens.length && chunkList.length < 8; ti++) {
          var nextStr = curChunk ? curChunk + " · " + allCfgTokens[ti] : allCfgTokens[ti];
          if (nextStr.length > 210) {
            chunkList.push(curChunk);
            curChunk = allCfgTokens[ti];
          } else {
            curChunk = nextStr;
          }
        }
        if (curChunk && chunkList.length < 8) chunkList.push(curChunk);
        for (var bi2 = 0; bi2 < chunkList.length; bi2++) {
          postNotify(
            "[PHOI-CFG " + (bi2 + 1) + "/" + chunkList.length + "] " + ep,
            "HTTP " + status + " · " + len + "B",
            chunkList[bi2]
          );
        }
        $done({});
        return;
      }
      summaryParts.push("Khong thay co jam/mix trong " + len + "B");
    } else {
      if (treeStr) summaryParts.push(treeStr);
      if (hotWords.length) summaryParts.push(hotWords.slice(0, 6).join("|"));
      else if (otherWords.length) summaryParts.push(otherWords.slice(0, 3).join("|"));
      summaryParts.push("hex=" + toHex(core, group === "NUT PHOI" ? 48 : 32));
    }
    rawTextSample =
      (treeStr ? "tree: " + treeStr + " | " : "") +
      (hotWords.length ? hotWords.join(" | ") : asciiHits.join(" | ")).slice(0, 500) +
      " [hex:" +
      toHex(core, 128) +
      "]";
  } else {
    summaryParts.push("Du lieu nen gzip (" + len + "B)");
  }

  var summaryText = summaryParts.length ? summaryParts.join(" · ") : "Binary " + len + "B (hex=" + toHex(core, 24) + ")";

  try {
    console.log(
      "[spot-sniff-v26][RES][" +
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

  function hashStr(str) {
    var h = 5381;
    for (var i = 0; i < str.length; i++) h = ((h << 5) + h + str.charCodeAt(i)) | 0;
    return String(h);
  }

  // Voi NUT PHOI, giam dedupe xuong 8 giay de bam thu nhieu lan van thay banner
  var dedupeWindowMs = group === "NUT PHOI" ? 8000 : 30000;
  var sig = hashStr(group + "|" + shortPath + "|" + status + "|" + summaryText.slice(0, 80));
  var shouldNotify = true;
  try {
    if (typeof $persistentStore !== "undefined" && $persistentStore && $persistentStore.read) {
      var storeKey = "spot_sniff_recent_v26";
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
        if (recent[ri] && now - recent[ri].t < dedupeWindowMs) {
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
