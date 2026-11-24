// ============================================================================
// spotify-vn-premium / scripts/spotify-premium.js
// Build: 2026-11-24 · v2.4.0
//
// v2.0.0 — sửa gốc rễ "cài rồi mà không thấy gì":
//   * Client Spotify 9.2.x KHÔNG còn gọi /bootstrap và /user-customization-service
//     trong phiên khởi động nữa. Nó gọi:
//        /remote-config-resolver/v3/configuration   (AssignedValue)
//        /nebula/v1/configuration/attributes        (AccountAttribute)
//     => v1 chỉ bắt 2 endpoint cũ nên patch không bao giờ chạy.
//   * Thêm dispatcher theo URL + chế độ "strict": chỉ sửa khi nhận ra cấu trúc
//     thật (có ít nhất 1 field quen), không nhận ra thì trả NULL và để app chạy
//     nguyên bản. Không bao giờ nhét field lạ vào message lạ.
// ============================================================================
//
// Phần sửa protobuf bên dưới giữ nguyên logic gốc (đã kiểm tra bằng test
// tests/test-patch.js). Chỉ thêm header tương thích host ở trên cùng.
// Chạy: http-response, requires-body + binary-body-mode (xem .module).
// ============================================================================
// ToCam — Shadowrocket adapted build
// Adapted from xzavier-amico/modules (Loon plugin) spotify_premium.js.
// The original rewriting logic below is byte-for-byte unchanged; only a small
// host-compatibility header is prepended, because Shadowrocket's script
// engine differs from Loon/Egern in three places:
//   1. TextEncoder / TextDecoder may be undefined  -> UTF-8 polyfills below.
//   2. The binary body may arrive as $response.bodyBytes instead of
//      $response.body (ArrayBuffer)                 -> normalized before run.
//   3. The status may arrive as $response.statusCode -> mapped to .status.
// Switches keep the Loon plugin defaults (no $argument passed):
//   spoof_premium=true, block_ads=true, unlock_playback=true, verbose_log=false
// ============================================================================

(function () {
  "use strict";

  if (typeof TextEncoder === "undefined") {
    globalThis.TextEncoder = class {
      encode(input) {
        const str = String(input == null ? "" : input);
        const bytes = [];
        for (let i = 0; i < str.length; i++) {
          let cp = str.charCodeAt(i);
          if (cp >= 0xd800 && cp <= 0xdbff && i + 1 < str.length) {
            const lo = str.charCodeAt(i + 1);
            if (lo >= 0xdc00 && lo <= 0xdfff) {
              cp = 0x10000 + ((cp - 0xd800) << 10) + (lo - 0xdc00);
              i++;
            }
          }
          if (cp < 0x80) bytes.push(cp);
          else if (cp < 0x800) bytes.push(0xc0 | (cp >> 6), 0x80 | (cp & 0x3f));
          else if (cp < 0x10000)
            bytes.push(0xe0 | (cp >> 12), 0x80 | ((cp >> 6) & 0x3f), 0x80 | (cp & 0x3f));
          else
            bytes.push(
              0xf0 | (cp >> 18),
              0x80 | ((cp >> 12) & 0x3f),
              0x80 | ((cp >> 6) & 0x3f),
              0x80 | (cp & 0x3f)
            );
        }
        return new Uint8Array(bytes);
      }
    };
  }

  if (typeof TextDecoder === "undefined") {
    globalThis.TextDecoder = class {
      constructor(label, options) {
        this.fatal = !!(options && options.fatal);
      }
      decode(input) {
        let bytes;
        if (input instanceof ArrayBuffer) bytes = new Uint8Array(input);
        else if (ArrayBuffer.isView(input))
          bytes = new Uint8Array(input.buffer, input.byteOffset, input.byteLength);
        else if (input == null) bytes = new Uint8Array(0);
        else bytes = new Uint8Array(input);
        let out = "";
        let i = 0;
        const bad = () => {
          if (this.fatal) throw new Error("invalid utf-8");
          return "\ufffd";
        };
        while (i < bytes.length) {
          const b0 = bytes[i];
          if (b0 < 0x80) {
            out += String.fromCharCode(b0);
            i++;
            continue;
          }
          let cp, extra;
          if (b0 >= 0xc2 && b0 <= 0xdf) { cp = b0 & 0x1f; extra = 1; }
          else if (b0 >= 0xe0 && b0 <= 0xef) { cp = b0 & 0x0f; extra = 2; }
          else if (b0 >= 0xf0 && b0 <= 0xf4) { cp = b0 & 0x07; extra = 3; }
          else { out += bad(); i++; continue; }
          let valid = i + extra < bytes.length;
          if (valid) {
            for (let j = 1; j <= extra; j++) {
              const bj = bytes[i + j];
              if ((bj & 0xc0) !== 0x80) { valid = false; break; }
              cp = (cp << 6) | (bj & 0x3f);
            }
          }
          if (valid) {
            if (extra === 2 && cp < 0x800) valid = false;
            if (extra === 3 && (cp < 0x10000 || cp > 0x10ffff)) valid = false;
            if (cp >= 0xd800 && cp <= 0xdfff) valid = false;
          }
          if (!valid) { out += bad(); i++; continue; }
          if (cp < 0x10000) out += String.fromCharCode(cp);
          else {
            cp -= 0x10000;
            out += String.fromCharCode(0xd800 + (cp >> 10), 0xdc00 + (cp & 0x3ff));
          }
          i += extra + 1;
        }
        return out;
      }
    };
  }

  try {
    if (typeof $response !== "undefined" && $response) {
      if (!$response.status && typeof $response.statusCode !== "undefined") {
        $response.status = $response.statusCode;
      }
      const b = $response.body;
      const usable = !!b && (b instanceof ArrayBuffer || ArrayBuffer.isView(b));
      if (!usable && typeof $response.bodyBytes !== "undefined" && $response.bodyBytes) {
        $response.body = $response.bodyBytes;
      }
    }
  } catch (e) {}
})();

// ==================== original script below (unmodified) ====================

// ToCam — ad-free + shuffle unlock for Loon / Egern.
//
// Spotify answers /bootstrap and /user-customization-service with protobuf that
// carries the account's product state and the remote config flags. This script
// walks the wire format, rewrites the fields that decide "free or premium", and
// writes everything else back untouched. Unknown fields and field order survive,
// and any message we do not rewrite keeps its exact bytes — re-encoding the whole
// body is what made the older script skip tracks after a few seconds.
//
// Layout (field numbers from EeveeSpotify and the spoti.pw AdBlock module):
//   BootstrapMessage 2 { 1 { 1 CustomizeMessage { 1 UcsResponse } } }
//   CustomizeMessage 1 UcsResponse
//   UcsResponse 1 ResolveResponse { 1 ResolveConfiguration { 3 AssignedValue } }
//               3 AccountAttributesResponse { 1 map entry { 1 key, 2 value } }
//   AccountAttribute 2 bool, 3 long, 4 string
//   AssignedValue 1 { 1 scope, 2 name }, 3 BoolValue { 1 }, 5 EnumValue { 1 }

(() => {
  "use strict";

  const url = ($request && $request.url) || "";
  const status = Number(($response && $response.status) || 0);
  if (status >= 300) {
    $done({});
    return;
  }

  let body = $response && $response.body;
  if (body instanceof ArrayBuffer) body = new Uint8Array(body);
  if (!body || !ArrayBuffer.isView(body) || !body.length) {
    $done({});
    return;
  }
  if (body.length > 4 * 1024 * 1024) {
    console.log("spotify: body too large " + body.length);
    $done({});
    return;
  }

  let opt = {};
  try {
    opt = typeof $argument === "string" ? JSON.parse($argument || "{}") : $argument || {};
  } catch (e) {
    opt = {};
  }
  const flag = (v, d) => (v === undefined || v === null ? d : !(v === false || v === "false" || v === 0 || v === "0"));

  const spoof = flag(opt.spoof_premium, true);
  if (!spoof) {
    $done({});
    return;
  }

  // Endpoint nhị phân nặng (playplay manifest, storage-resolve, ảnh, media):
  // script không có việc gì ở đây, bỏ qua cho nhẹ.
  if (/\/(?:playplay|storage-resolve|image|images|video|videos|audio|cdn)\//i.test(url)) {
    $done({});
    return;
  }
  const adsOn = flag(opt.block_ads, true);
  const playOn = flag(opt.unlock_playback, true);
  const verbose = flag(opt.verbose_log, false);

  // ---------------------------------------------------------------- protobuf

  const TE = new TextEncoder();
  const TD = new TextDecoder("utf-8", { fatal: true });

  function readVarint(b, s) {
    let value = 0;
    let shift = 0;
    while (s.i < b.length) {
      const byte = b[s.i++];
      value += (byte & 0x7f) * Math.pow(2, shift);
      if (!(byte & 0x80)) return value;
      shift += 7;
      if (shift > 63) throw new Error("varint");
    }
    throw new Error("varint");
  }

  // Returns null when the bytes are not a well-formed message.
  function parse(b) {
    const out = [];
    const s = { i: 0 };
    while (s.i < b.length) {
      let key;
      try {
        key = readVarint(b, s);
      } catch (e) {
        return null;
      }
      const no = Math.floor(key / 8);
      const wire = key % 8;
      if (!no) return null;
      if (wire === 0) {
        let v;
        try {
          v = readVarint(b, s);
        } catch (e) {
          return null;
        }
        out.push({ no: no, w: 0, v: v });
      } else if (wire === 2) {
        let len;
        try {
          len = readVarint(b, s);
        } catch (e) {
          return null;
        }
        if (len > b.length - s.i) return null;
        out.push({ no: no, w: 2, p: b.subarray(s.i, s.i + len) });
        s.i += len;
      } else if (wire === 1 || wire === 5) {
        const size = wire === 1 ? 8 : 4;
        if (s.i + size > b.length) return null;
        out.push({ no: no, w: wire, p: b.subarray(s.i, s.i + size) });
        s.i += size;
      } else {
        return null;
      }
    }
    return out;
  }

  function varintLength(value) {
    let n = 1;
    while (value >= 0x80) {
      n++;
      value = Math.floor(value / 0x80);
    }
    return n;
  }

  function serialize(fields) {
    let size = 0;
    for (const f of fields) {
      size += varintLength(f.no * 8 + f.w);
      if (f.w === 0) size += varintLength(f.v);
      else {
        if (f.w === 2) size += varintLength(f.p.length);
        size += f.p.length;
      }
    }
    const out = new Uint8Array(size);
    let at = 0;
    const put = (value) => {
      while (value >= 0x80) {
        out[at++] = (value % 0x80) | 0x80;
        value = Math.floor(value / 0x80);
      }
      out[at++] = value;
    };
    for (const f of fields) {
      put(f.no * 8 + f.w);
      if (f.w === 0) {
        put(f.v);
        continue;
      }
      if (f.w === 2) put(f.p.length);
      out.set(f.p, at);
      at += f.p.length;
    }
    return out;
  }

  const first = (fields, no) => {
    for (const f of fields) if (f.no === no) return f;
    return null;
  };
  const fieldString = (no, text) => ({ no: no, w: 2, p: TE.encode(text) });
  const fieldBytes = (no, payload) => ({ no: no, w: 2, p: payload });
  const fieldVarint = (no, value) => ({ no: no, w: 0, v: value });

  function text(f) {
    if (!f || f.w !== 2) return null;
    try {
      return TD.decode(f.p);
    } catch (e) {
      return null;
    }
  }

  // Replaces the message at `path` with what `fn` returns; null when the path
  // is missing or anything along it fails to parse.
  function edit(message, path, fn) {
    if (!path.length) return fn(message);
    const fields = parse(message);
    if (!fields) return null;
    const f = first(fields, path[0]);
    if (!f || f.w !== 2) return null;
    const inner = edit(f.p, path.slice(1), fn);
    if (!inner) return null;
    f.p = inner;
    return serialize(fields);
  }

  const same = (a, b) => {
    if (a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
    return true;
  };

  // ------------------------------------------------------------------ gRPC
  //
  // pam-view-service / playback-settings / clientrestrictions KHÔNG trả JSON,
  // cũng không trả protobuf trần — chúng trả gRPC khung 5 byte:
  //     [flag 1B][length 4B big-endian][payload ...]
  // flag 0x00 = data (protobuf), 0x80 = trailer (header text, KHÔNG đụng vào).
  //
  // v2.1 không bóc khung: parse() nhận 5 byte đầu là rác -> trả null -> patch
  // không chạy. Đó là lý do "Gói của bạn: Spotify Free", badge Premium ở
  // trang chất lượng, nút Phối vẫn y nguyên sau khi cài module.
  function grpcSplit(b) {
    if (!b || b.length < 6) return null;
    const frames = [];
    let i = 0;
    while (i + 5 <= b.length) {
      const flag = b[i];
      if (flag !== 0x00 && flag !== 0x01 && flag !== 0x80 && flag !== 0x81) return null;
      const len = ((b[i + 1] << 24) | (b[i + 2] << 16) | (b[i + 3] << 8) | b[i + 4]) >>> 0;
      if (len > b.length - i - 5) return null;
      frames.push({ flag: flag, payload: b.subarray(i + 5, i + 5 + len) });
      i += 5 + len;
    }
    if (i !== b.length || !frames.length) return null;
    return frames;
  }

  function grpcJoin(frames) {
    let size = 0;
    for (const f of frames) size += 5 + f.payload.length;
    const out = new Uint8Array(size);
    let at = 0;
    for (const f of frames) {
      const n = f.payload.length;
      out[at] = f.flag;
      out[at + 1] = (n >>> 24) & 0xff;
      out[at + 2] = (n >>> 16) & 0xff;
      out[at + 3] = (n >>> 8) & 0xff;
      out[at + 4] = n & 0xff;
      out.set(f.payload, at + 5);
      at += 5 + n;
    }
    return out;
  }

  let ctype = "";
  const respHeaders = ($response && ($response.headers || $response.responseHeaders)) || {};
  for (const k in respHeaders) {
    if (!Object.prototype.hasOwnProperty.call(respHeaders, k)) continue;
    if (k.toLowerCase() === "content-type") ctype = String(respHeaders[k]).toLowerCase();
  }
  const grpcFrames = grpcSplit(body);

  const RULES = [
    ["ios-feature-settings","crossfade_enabled",2,1,"","misc"],
    ["ios-feature-settings","automix_enabled",2,1,"","misc"],
    ["core-playback-setup","crossfade_enabled",2,1,"","misc"],
    ["core-automix","automix_enabled",2,1,"","misc"],
    ["ios-feature-settings","use_playback_settings_crossfade",2,0,"","misc"],
    ["ios-feature-settings","use_playback_settings_gapless",2,0,"","misc"],
    ["","enable_common_capping",0,0,"","cap"],
    ["","enable_pns_common_capping",0,0,"","cap"],
    ["","enable_pick_and_shuffle_common_capping",0,0,"","cap"],
    ["","enable_pick_and_shuffle_dynamic_cap",0,0,"","cap"],
    ["","pick_and_shuffle_timecap",0,0,"","cap"],
    ["ios-feature-queue","",0,0,"","cap"],
    ["","enable_free_on_demand_experiment",0,0,"","misc"],
    ["","enable_free_on_demand_context_menu_experiment",0,0,"","misc"],
    ["","enable_mft_plus_queue",0,0,"","cap"],
    ["","enable_mft_plus_extended_queue",0,0,"","cap"],
    ["","enable_playback_timeout_service",1,0,"","cap"],
    ["","enable_playback_timeout_error_ui",1,0,"","cap"],
    ["","playback_timeout_action",3,0,"Nothing","cap"],
    ["","is_remove_from_queue_enabled_for_mft_plus",0,0,"","cap"],
    ["","is_reordering_for_mft_plus_allowed",0,0,"","cap"],
    ["","ads",1,0,"","ad"],
    ["","ad_metadata",0,0,"","ad"],
    ["","ad_slots",0,0,"","ad"],
    ["","enable_ads",1,0,"","ad"],
    ["","enable_audio_ads",1,0,"","ad"],
    ["","enable_display_ads",1,0,"","ad"],
    ["","enable_video_ads",1,0,"","ad"],
    ["","enable_premium_upsell",1,0,"","ad"],
    ["","enable_upsell",1,0,"","ad"],
    ["","show_upsell",1,0,"","ad"],
    ["","show_premium_upsell",1,0,"","ad"],
    ["","enable_campaigns",1,0,"","misc"],
    ["","enable_promotions",1,0,"","ad"],
    ["","enable_search_ad",1,0,"","ad"],
    ["","enable_search_ads",1,0,"","ad"],
    ["","enable_search_banner_ad",1,0,"","ad"],
    ["","enable_search_banner_ads",1,0,"","ad"],
    ["","enable_search_sponsored_ad",1,0,"","ad"],
    ["","enable_search_sponsored_ads",1,0,"","ad"],
    ["","enable_search_upsell",1,0,"","ad"],
    ["","enable_home_ad",1,0,"","ad"],
    ["","enable_home_ads",1,0,"","ad"],
    ["","enable_home_banner_ad",1,0,"","ad"],
    ["","enable_home_banner_ads",1,0,"","ad"],
    ["","enable_home_sponsored_ad",1,0,"","ad"],
    ["","enable_home_sponsored_ads",1,0,"","ad"],
    ["","enable_home_upsell",1,0,"","ad"],
    ["ios-feature-shuffletoggleupsell","is_enabled_pt2",2,0,"","ad"],
    ["ios-feature-shuffletoggleupsell","linear_upsell_new_style_experiment_enabled",2,0,"","ad"],
    ["ios-feature-shuffletoggleupsell","play_modes_upsell_new_style_experiment_enabled",2,0,"","ad"],
    ["ios-jam-freeusershuffleupsellsheetpage-impl","free_user_shuffle_upsell_sheet_enabled",2,0,"","ad"],
    ["ios-jam-freeuserskipupsellpage-impl","free_user_skip_upsell_sheet_enabled",2,0,"","ad"],
    ["ios-jam-freehostedjamsupsell-impl","free_hosted_jams_upsell_enabled",2,0,"","ad"],
    ["ios-reinventfree-contextualupsellpremiumpromo-impl","is_promo_cta_enabled",2,0,"","ad"],
    ["ios-reinventfree-contextualupsellpremiumpromo-impl","show_time_cap_upsell_with_premium_badge",2,0,"","ad"],
    ["ios-reinventfree-controllerui-impl","enable_video_time_cap_upsell",2,0,"","ad"],
    ["ios-reinventfree-controllerui-impl","enable_video_time_cap_upsell_on_search",2,0,"","ad"],
    ["ios-reinventfree-timecappivot-impl","music_video_upsell_enabled",2,0,"","ad"],
    ["ios-settings-mediaqualitypageplugin-impl","is_gbb_upsell_enabled",2,0,"","ad"],
    ["ios-settings-mediaqualitypageplugin-impl","should_show_pigeon_upsell",2,0,"","ad"],
    ["ios-system-listeningparties","preview_ended_upsell_enabled",2,0,"","ad"],
    ["","enable_now_playing_ad",1,0,"","ad"],
    ["","enable_now_playing_ads",1,0,"","ad"],
    ["","enable_now_playing_banner_ad",1,0,"","ad"],
    ["","enable_now_playing_banner_ads",1,0,"","ad"],
    ["","enable_now_playing_sponsored_ad",1,0,"","ad"],
    ["","enable_now_playing_sponsored_ads",1,0,"","ad"],
    ["","enable_now_playing_upsell",1,0,"","ad"],
    ["","enable_artist_ad",1,0,"","ad"],
    ["","enable_artist_ads",1,0,"","ad"],
    ["","enable_artist_banner_ad",1,0,"","ad"],
    ["","enable_artist_banner_ads",1,0,"","ad"],
    ["","enable_artist_sponsored_ad",1,0,"","ad"],
    ["","enable_artist_sponsored_ads",1,0,"","ad"],
    ["","enable_artist_upsell",1,0,"","ad"],
    ["","enable_playlist_ad",1,0,"","ad"],
    ["","enable_playlist_ads",1,0,"","ad"],
    ["","enable_playlist_banner_ad",1,0,"","ad"],
    ["","enable_playlist_banner_ads",1,0,"","ad"],
    ["","enable_playlist_sponsored_ad",1,0,"","ad"],
    ["","enable_playlist_sponsored_ads",1,0,"","ad"],
    ["","enable_playlist_upsell",1,0,"","ad"],
    ["","enable_album_ad",1,0,"","ad"],
    ["","enable_album_ads",1,0,"","ad"],
    ["","enable_album_banner_ad",1,0,"","ad"],
    ["","enable_album_banner_ads",1,0,"","ad"],
    ["","enable_album_sponsored_ad",1,0,"","ad"],
    ["","enable_album_sponsored_ads",1,0,"","ad"],
    ["","enable_album_upsell",1,0,"","ad"],
    ["","enable_library_ad",1,0,"","ad"],
    ["","enable_library_ads",1,0,"","ad"],
    ["","enable_library_banner_ad",1,0,"","ad"],
    ["","enable_library_banner_ads",1,0,"","ad"],
    ["","enable_library_sponsored_ad",1,0,"","ad"],
    ["","enable_library_sponsored_ads",1,0,"","ad"],
    ["","enable_library_upsell",1,0,"","ad"],
    ["","enable_audiobook_ad",1,0,"","ad"],
    ["","enable_audiobook_ads",1,0,"","ad"],
    ["","enable_audiobook_banner_ad",1,0,"","ad"],
    ["","enable_audiobook_banner_ads",1,0,"","ad"],
    ["","enable_audiobook_sponsored_ad",1,0,"","ad"],
    ["","enable_audiobook_sponsored_ads",1,0,"","ad"],
    ["","enable_audiobook_upsell",1,0,"","ad"],
    ["","enable_podcast_ad",1,0,"","ad"],
    ["","enable_podcast_ads",1,0,"","ad"],
    ["","enable_podcast_banner_ad",1,0,"","ad"],
    ["","enable_podcast_banner_ads",1,0,"","ad"],
    ["","enable_podcast_sponsored_ad",1,0,"","ad"],
    ["","enable_podcast_sponsored_ads",1,0,"","ad"],
    ["","enable_podcast_upsell",1,0,"","ad"],
    ["","enable_sponsored_content",1,0,"","ad"],
    ["","enable_sponsored_playlists",1,0,"","ad"],
    ["","enable_sponsored_sessions",1,0,"","ad"],
    ["","enable_sponsored_stories",1,0,"","ad"],
    ["","enable_sponsored_videos",1,0,"","ad"],
    ["","enable_sponsored_artist",1,0,"","ad"],
    ["","enable_sponsored_artists",1,0,"","ad"],
    ["","enable_sponsored_album",1,0,"","ad"],
    ["","enable_sponsored_albums",1,0,"","ad"],
    ["","enable_sponsored_track",1,0,"","ad"],
    ["","enable_sponsored_tracks",1,0,"","ad"],
    ["","enable_sponsored_show",1,0,"","ad"],
    ["","enable_sponsored_shows",1,0,"","ad"],
    ["","enable_sponsored_episode",1,0,"","ad"],
    ["","enable_sponsored_episodes",1,0,"","ad"],
    ["","enable_sponsored_audiobook",1,0,"","ad"],
    ["","enable_sponsored_audiobooks",1,0,"","ad"],
    ["","enable_sponsored_podcast",1,0,"","ad"],
    ["","enable_sponsored_podcasts",1,0,"","ad"],
    ["","enable_sponsored_search",1,0,"","ad"],
    ["","enable_sponsored_search_results",1,0,"","ad"],
    ["","enable_sponsored_search_banner",1,0,"","ad"],
    ["","enable_sponsored_search_banners",1,0,"","ad"],
    ["","enable_sponsored_home",1,0,"","ad"],
    ["","enable_sponsored_home_banner",1,0,"","ad"],
    ["","enable_sponsored_home_banners",1,0,"","ad"],
    ["","enable_sponsored_now_playing",1,0,"","ad"],
    ["","enable_sponsored_now_playing_banner",1,0,"","ad"],
    ["","enable_sponsored_now_playing_banners",1,0,"","ad"],
    ["","enable_sponsored_artist_banner",1,0,"","ad"],
    ["","enable_sponsored_artist_banners",1,0,"","ad"],
    ["","enable_sponsored_playlist_banner",1,0,"","ad"],
    ["","enable_sponsored_playlist_banners",1,0,"","ad"],
    ["","enable_sponsored_album_banner",1,0,"","ad"],
    ["","enable_sponsored_album_banners",1,0,"","ad"],
    ["","enable_sponsored_library_banner",1,0,"","ad"],
    ["","enable_sponsored_library_banners",1,0,"","ad"],
    ["","enable_sponsored_audiobook_banner",1,0,"","ad"],
    ["","enable_sponsored_audiobook_banners",1,0,"","ad"],
    ["","enable_sponsored_podcast_banner",1,0,"","ad"],
    ["","enable_sponsored_podcast_banners",1,0,"","ad"],
    ["","enable_sponsored_search_sponsored_ad",1,0,"","ad"],
    ["","enable_sponsored_search_sponsored_ads",1,0,"","ad"],
    ["","enable_sponsored_home_sponsored_ad",1,0,"","ad"],
    ["","enable_sponsored_home_sponsored_ads",1,0,"","ad"],
    ["","enable_sponsored_now_playing_sponsored_ad",1,0,"","ad"],
    ["","enable_sponsored_now_playing_sponsored_ads",1,0,"","ad"],
    ["","enable_sponsored_artist_sponsored_ad",1,0,"","ad"],
    ["","enable_sponsored_artist_sponsored_ads",1,0,"","ad"],
    ["","enable_sponsored_playlist_sponsored_ad",1,0,"","ad"],
    ["","enable_sponsored_playlist_sponsored_ads",1,0,"","ad"],
    ["","enable_sponsored_album_sponsored_ad",1,0,"","ad"],
    ["","enable_sponsored_album_sponsored_ads",1,0,"","ad"],
    ["","enable_sponsored_library_sponsored_ad",1,0,"","ad"],
    ["","enable_sponsored_library_sponsored_ads",1,0,"","ad"],
    ["","enable_sponsored_audiobook_sponsored_ad",1,0,"","ad"],
    ["","enable_sponsored_audiobook_sponsored_ads",1,0,"","ad"],
    ["","enable_sponsored_podcast_sponsored_ad",1,0,"","ad"],
    ["","enable_sponsored_podcast_sponsored_ads",1,0,"","ad"],
    ["ios-ad-on-app-open","",0,0,"","ad"],
    ["ios-feature-adonappopen","",0,0,"","misc"],
    ["ios-feature-adonappopen","enabled",1,0,"","misc"],
    ["ios-feature-adonappopen","background_refresh_frequency_seconds",1,0,"","misc"],
    ["","is_ad_on_app_open_enabled",1,0,"","ad"],
    ["","ad_on_app_open_enabled",1,0,"","ad"],
    ["","adonappopen_enabled",1,0,"","misc"],
    ["marquee","",0,0,"","ad"],
    ["ios-feature-marquee","",0,0,"","ad"],
    ["leavebehindadsbase","",0,0,"","misc"],
    ["ios-feature-leavebehindadsbase","",0,0,"","misc"],
    ["ios-nowplaying-scroll-impl","unified_leavebehind_npv_scroll_music_enabled",2,0,"","misc"],
    ["ios-nowplaying-scroll-impl","unified_leavebehind_npv_scroll_podcast_enabled",2,0,"","misc"],
    ["ios-feature-embeddedplaylist","use_unified_leavebehind_fetch",2,0,"","misc"],
    ["ios-adsnowplaying-embeddednpv-impl","foreground_enabled",2,0,"","misc"],
    ["ios-adsnowplaying-embeddednpv-impl","music_track_change_enabled",2,0,"","misc"],
    ["ios-adsnowplaying-embeddednpv-impl","enable_ads_on_podcast",2,0,"","ad"],
    ["ios-feature-instreamads","",0,0,"","misc"],
    ["ios-adsembedded-embeddedctaelements-impl","",0,0,"","misc"],
    ["ios-adsnowplaying-embeddednpv-impl","",0,0,"","misc"],
    ["ios-adsplatform-elementimpl","",0,0,"","misc"],
    ["ios-system-adssponsoredcontext","",0,0,"","ad"],
    ["ios-feature-adsbase","enable_ads_connect_state_observer",1,0,"","ad"],
    ["ios-feature-adsbase","enable_minimal_preroll_management",1,0,"","misc"],
    ["ios-feature-adsbase","enable_swift_ads_base_movement_logger",1,0,"","ad"],
    ["ios-feature-adsswift","",0,0,"","misc"],
    ["ios-feature-adsnowplayingui","embedded_npv_video_show_with_canvas",2,0,"","misc"],
    ["ios-feature-adssponsoredcontext","sponsored_context_mismatch_aderror_enabled",1,0,"","ad"],
    ["ios-feature-adssponsoredcontext","sponsored_playlist_v2_enabled",1,0,"","ad"],
    ["ios-feature-adssponsoredcontextnpbattachment","sponsored_npb_slot_fetch_enabled",1,0,"","ad"],
    ["ios-feature-adsidentitytracking","",0,0,"","misc"],
    ["","enable_popups",1,0,"","ad"],
    ["","enable_leave_behind_ads_card_element",1,0,"","ad"],
    ["","music_npv_leavebehinds_enabled",1,0,"","misc"],
    ["","enable_ads_on_podcast",1,0,"","ad"],
    ["","enable_display_element",1,0,"","misc"],
    ["","enable_video_element",1,0,"","misc"],
    ["","is_promo_cta_enabled",1,0,"","ad"],
    ["","show_time_cap_upsell_with_premium_badge",1,0,"","ad"],
    ["","enable_video_time_cap_upsell",1,0,"","ad"],
    ["","enable_video_time_cap_upsell_on_search",1,0,"","ad"],
    ["","music_video_upsell_enabled",1,0,"","ad"],
    ["","is_gbb_upsell_enabled",1,0,"","ad"],
    ["","should_show_pigeon_upsell",1,0,"","ad"],
    ["","disable_suggested_tracks_upsell",1,1,"","ad"],
    ["","is_enabled_pt2",1,0,"","misc"],
    ["","show_skip_button_during_skippable_ads",1,1,"","ad"],
    ["","sponsored_playlist_v2_header_dismissible",1,1,"","ad"],
    ["","use_mock_sponsorship_endpoint",1,0,"","ad"],
    ["","enable_popup",1,0,"","ad"],
    ["","show_popups",1,0,"","ad"],
    ["","show_popup",1,0,"","ad"],
    ["","enable_interstitials",1,0,"","misc"],
    ["","enable_interstitial",1,0,"","ad"],
    ["","enable_overlays",1,0,"","misc"],
    ["","enable_overlay",1,0,"","misc"],
    ["","enable_promotions_on_home",1,0,"","ad"],
    ["","enable_promotions_on_search",1,0,"","ad"],
    ["","enable_search_page_ads",1,0,"","ad"],
    ["","enable_home_page_ads",1,0,"","ad"],
    ["","enable_billboard",1,0,"","ad"],
    ["","enable_billboards",1,0,"","misc"],
    ["","enable_audio_ads_player",1,0,"","ad"],
    ["","enable_display_ads_player",1,0,"","ad"],
    ["","enable_video_ads_player",1,0,"","ad"],
    ["","enable_audio_ads_player_v2",1,0,"","ad"],
    ["","enable_display_ads_player_v2",1,0,"","ad"],
    ["","enable_video_ads_player_v2",1,0,"","ad"],
    ["","enable_sponsored_search_results_v2",1,0,"","ad"],
    ["","enable_sponsored_home_results_v2",1,0,"","ad"],
    ["ios-feature-search","prompted_playlist_merchandizing_enabled",1,0,"","misc"],
    ["","should_nova_scroll_use_scrollsita",0,0,"","misc"],
    ["ios-sociallistening-configuration-impl","premium_gated_start_jam_buttons_enabled",2,1,"","misc"]
  ];

  // -------------------------------------------------------------- attributes

  const yearOn = new Date(Date.now() + 365 * 86400000).toISOString().replace(/\.\d{3}Z$/, "Z");

  const ATTR_CORE = {
    "catalogue": "premium",
    "product": "premium",
    "product-type": "premium",
    "product-state": "premium",
    "is-premium": true,
    "premium": true,
    "blend-enabled": true,
    "enable-blend": "1",
    "financial-product": "pr:premium,tc:0",
    "is-eligible-premium-unboxing": true,
    "name": "Spotify Premium",
    "nft-disabled": "1",
    "on-demand": true,
    "payments-initial-campaign": "default",
    "player-license": "premium",
    "player-license-v2": "premium",
    "product-expiry": yearOn,
    "shuffle-eligible": true,
    "streaming-rules": "",
    "subscription-enddate": yearOn,
    "type": "premium",
    "unrestricted": true,
    "can_use_superbird": true,
    "enable-crossfade-product-state": "1",
    "enable-gapless-product-state": "1",
    "high-bitrate": true,
    "loudness-levels": "1:-5.0,0.0,3.0:-2.0",
    "mixing-tools": "EDIT",
    "your-library-tags": true,
    "libspotify": true,
    "mobile": true,
    "pick-and-shuffle": false
  };

  const ATTR_ADS = {
    "ads": false,
    "ab-ad-player-targeting": "0",
    "allow-advertising-id-transmission": false,
    "restrict-advertising-id-transmission": true
  };

  // Attributes that make the client re-check the state with the server, or
  // offer a trial. Dropping them is what stops the "you are on free" fallback.
  const STRIPPED = [
    "payment-state",
    "last-premium-activation-date",
    "on-demand-trial",
    "on-demand-trial-in-progress",
    "smart-shuffle",
    "at-signal",
    "feature-set-id-masked",
    "strider-key",
    "is-eligible-for-trial",
    "is-eligible-for-upsell",
    "upsell-state",
    "ad-session-persistence",
    "ad-formats-preroll-video"
  ];

  const forced = Object.assign({}, ATTR_CORE, adsOn ? ATTR_ADS : {});
  const has = (key) => Object.prototype.hasOwnProperty.call(forced, key);
  const stripped = (key) => {
    if (key.indexOf("is-premium-eligible") === 0) return true;
    if (!adsOn && key.indexOf("ad") === 0) return false;
    return STRIPPED.indexOf(key) >= 0;
  };

  const attributeEntry = (key, value) => {
    const inner = typeof value === "string" ? fieldString(4, value) : fieldVarint(2, value ? 1 : 0);
    return fieldBytes(1, serialize([fieldString(1, key), fieldBytes(2, serialize([inner]))]));
  };

  function patchAttributes(buffer) {
    const fields = parse(buffer);
    if (!fields) return null;
    const out = [];
    const seen = Object.create(null);
    for (const f of fields) {
      let key = null;
      if (f.no === 1 && f.w === 2) {
        const inner = parse(f.p);
        if (inner) key = text(first(inner, 1));
      }
      if (!key || (!has(key) && !stripped(key))) {
        out.push(f);
        continue;
      }
      if (!has(key)) continue;
      seen[key] = true;
      out.push(attributeEntry(key, forced[key]));
    }
    for (const key in forced) if (!seen[key]) out.push(attributeEntry(key, forced[key]));
    return serialize(out);
  }

  // Strict: chỉ chạy khi buffer đúng layout { 1: entry{ 1: key, 2: value } }
  // và có ít nhất 1 key mà mình hiểu. Endpoint lạ (nebula / remote-config của
  // bản client mới) có thể dùng layout khác -> trả null, không đụng gì.
  function recognizedAttributes(buffer) {
    const fields = parse(buffer);
    if (!fields || !fields.length) return 0;
    let n = 0;
    for (const f of fields) {
      if (f.no !== 1 || f.w !== 2) continue;
      const inner = parse(f.p);
      if (!inner) continue;
      const key = text(first(inner, 1));
      if (key && (has(key) || stripped(key))) n++;
    }
    return n;
  }

  function patchAttributesStrict(buffer) {
    if (!recognizedAttributes(buffer)) return null;
    return patchAttributes(buffer);
  }

  // ------------------------------------------------------------ remote config

  const boolValue = (on) => (on ? serialize([fieldVarint(1, 1)]) : new Uint8Array(0));

  function setValue(value, replacement) {
    const kept = value.filter((f) => f.no < 3 || f.no > 5);
    kept.push(replacement);
    return kept;
  }

  function patchConfiguration(buffer) {
    const fields = parse(buffer);
    if (!fields) return null;
    const out = [];
    const present = Object.create(null);
    for (const f of fields) {
      let value = null;
      if (f.no === 3 && f.w === 2) value = parse(f.p);
      if (!value) {
        out.push(f);
        continue;
      }
      const identifier = first(value, 1);
      const parts = identifier ? parse(identifier.p) : null;
      if (!parts) {
        out.push(f);
        continue;
      }
      const scope = text(first(parts, 1)) || "";
      const name = text(first(parts, 2)) || "";
      let removed = false;
      for (const rule of RULES) {
        if (rule[5] === "ad" && !adsOn) continue;
        if (rule[5] === "cap" && !playOn) continue;
        if (rule[0] && rule[0] !== scope) continue;
        if (rule[1] && rule[1] !== name) continue;
        if (rule[2] === 0) {
          removed = true;
          break;
        }
        if (rule[2] === 1) {
          if (first(value, 3)) value = setValue(value, fieldBytes(3, boolValue(rule[3])));
        } else if (rule[2] === 2) {
          value = setValue(value, fieldBytes(3, boolValue(rule[3])));
        } else {
          value = setValue(value, fieldBytes(5, serialize([fieldString(1, rule[4])])));
        }
      }
      if (removed) continue;
      present[scope + "\u0000" + name] = true;
      f.p = serialize(value);
      out.push(f);
    }
    for (const rule of RULES) {
      if (rule[2] !== 2 || !rule[0] || !rule[1]) continue;
      if (rule[5] === "ad" && !adsOn) continue;
      if (present[rule[0] + "\u0000" + rule[1]]) continue;
      const identifier = serialize([fieldString(1, rule[0]), fieldString(2, rule[1])]);
      out.push(fieldBytes(3, serialize([fieldBytes(1, identifier), fieldBytes(3, boolValue(rule[3]))])));
    }
    return serialize(out);
  }

  // Strict: chỉ chạy khi buffer đúng layout { 3: AssignedValue{1:{1:scope,2:name}} }
  function recognizedConfiguration(buffer) {
    const fields = parse(buffer);
    if (!fields || !fields.length) return 0;
    let n = 0;
    for (const f of fields) {
      if (f.no !== 3 || f.w !== 2) continue;
      const value = parse(f.p);
      if (!value) continue;
      const identifier = first(value, 1);
      const parts = identifier && identifier.w === 2 ? parse(identifier.p) : null;
      if (!parts) continue;
      if (text(first(parts, 1)) !== null && text(first(parts, 2)) !== null) n++;
    }
    return n;
  }

  function patchConfigurationStrict(buffer) {
    if (!recognizedConfiguration(buffer)) return null;
    return patchConfiguration(buffer);
  }

  // ---------------------------------------------------------------- response

  function patchUcs(buffer) {
    const fields = parse(buffer);
    if (!fields) return null;
    const resolve = first(fields, 1);
    let attributes = first(fields, 3);
    // Neither a resolve nor an attributes field means this is not a UCS
    // response at all; leave it alone rather than inventing a field.
    if (!attributes) {
      const inner = resolve && resolve.w === 2 ? parse(resolve.p) : null;
      const configuration = inner ? first(inner, 1) : null;
      if (!configuration || configuration.w !== 2) return null;
      attributes = fieldBytes(3, new Uint8Array(0));
      fields.push(attributes);
    }
    if (resolve && resolve.w === 2) {
      const edited = edit(resolve.p, [1], patchConfiguration);
      if (edited) resolve.p = edited;
    }
    if (attributes.w === 2) {
      const edited = patchAttributes(attributes.p);
      if (edited) attributes.p = edited;
    }
    return serialize(fields);
  }

  // ------------------------------------------------- product state (v2.1.0)
  //
  // "Gói của bạn: Spotify Free" + badge Premium ở trang chất lượng nhạc / nút
  // Tải xuống / nút Phối KHÔNG do 4 endpoint phía trên quyết định. Chúng đọc
  // từ product state mà nhiều endpoint khác trả về, host đổi theo region
  // (gae2-, gew1-, guc3-spclient...) và Spotify đổi tên field giữa các bản.
  //
  // v1 đoán field number -> sai. Lần này làm kiểu "cấu trúc bất khả tri":
  //   1. body là JSON     -> đổi giá trị của key product/plan/tier/subscription
  //   2. body là protobuf -> duyệt cả cây, string ngắn đúng bằng "free" -> "premium"
  //   3. không nhận ra    -> null, app chạy nguyên bản
  //
  // Chốt an toàn: chỉ đụng string <= 64 byte (token/JWT/base64 dài -> bỏ qua),
  // KHÔNG đụng field varint (sửa bừa enum = nhảy bài / crash), sâu tối đa 8.

  const FREE_MAP = {
    free: "premium",
    FREE: "PREMIUM",
    Free: "Premium",
    "free-tier": "premium",
    free_tier: "premium",
    "FREE_TIER": "PREMIUM",
    "Free Tier": "Premium",
    "free tier": "premium",
    "spotify-free": "Spotify Premium",
    spotify_free: "Spotify Premium",
    "Spotify Free": "Spotify Premium",
    "SPOTIFY_FREE": "SPOTIFY_PREMIUM",
    "spotify free": "Spotify Premium",
    "Free account": "Premium account",
    "free_account": "premium",
    "FREE_ACCOUNT": "PREMIUM"
  };

  const PRODUCT_KEY = /^(?:product|product_?state|product_?type|product_?name|product_?id|plan|plan_?type|plan_?name|plan_?title|account_?type|account_?plan|account_?tier|subscription|subscription_?type|subscription_?plan|subscription_?name|tier|sub_?tier|catalogue|catalog|product_?catalogue|membership|membership_?type|pricing_?plan|product_?level|badge|badge_?type|current_?plan|plan_?title|type)$/i;
  const PREMIUM_FLAG_KEY = /^(?:is_?premium|is_?premium_?user|is_?premium_?account|premium|premium_?user|has_?premium|is_?subscribed|subscribed|is_?paid|paid_?user)$/i;
  const AD_FLAG_KEY = /^(?:ads|has_?ads|show_?ads|is_?ad_?supported|ad_?supported|ads_?enabled)$/i;
  const SPOTIFY_FREE_LITERAL = /^\s*spotify[\s_-]*free\s*$/i;

  function decodeUtf8(bytes) {
    try {
      return TD.decode(bytes);
    } catch (e) {
      return null;
    }
  }

  function patchJsonProduct(str) {
    let root;
    try {
      root = JSON.parse(str);
    } catch (e) {
      return null;
    }
    if (!root || typeof root !== "object") return null;
    let changed = false;

    const walk = (node) => {
      if (Array.isArray(node)) {
        for (const v of node) walk(v);
        return;
      }
      if (!node || typeof node !== "object") return;
      for (const k of Object.keys(node)) {
        const v = node[k];
        if (typeof v === "string") {
          if (PRODUCT_KEY.test(k) && Object.prototype.hasOwnProperty.call(FREE_MAP, v)) {
            node[k] = FREE_MAP[v];
            changed = true;
          } else if (SPOTIFY_FREE_LITERAL.test(v)) {
            // "Spotify Free" là tên sản phẩm, không phải enum: đổi ở bất kỳ key nào.
            node[k] = "Spotify Premium";
            changed = true;
          }
        } else if (typeof v === "boolean") {
          if (PREMIUM_FLAG_KEY.test(k) && v === false) {
            node[k] = true;
            changed = true;
          } else if (AD_FLAG_KEY.test(k) && v === true) {
            node[k] = false;
            changed = true;
          }
        } else {
          walk(v);
        }
      }
    };

    walk(root);
    return changed ? JSON.stringify(root) : null;
  }

  // Duyệt cây protobuf, đổi string ngắn "free" -> "premium". Trả true nếu có.
  function rewriteStrings(fields, depth) {
    if (depth > 8) return false;
    let changed = false;
    for (const f of fields) {
      if (f.w !== 2 || !f.p || !f.p.length) continue;

      // Payload có thể là message con -> thử parse trước.
      if (f.p.length > 1) {
        const inner = parse(f.p);
        if (inner && inner.length) {
          if (rewriteStrings(inner, depth + 1)) {
            f.p = serialize(inner);
            changed = true;
          }
          continue;
        }
      }

      if (f.p.length > 64) continue; // token / JWT / base64 dài: không đụng
      const s = decodeUtf8(f.p);
      if (s === null) continue;
      const rep = FREE_MAP[s];
      if (rep && rep !== s) {
        f.p = TE.encode(rep);
        changed = true;
      }
    }
    return changed;
  }

  function patchUniversal(buffer) {
    if (buffer.length && (buffer[0] === 0x7b || buffer[0] === 0x5b)) {
      const s = decodeUtf8(buffer);
      if (s !== null) {
        const out = patchJsonAll(s);
        if (out) return TE.encode(out);
      }
      return null;
    }
    const fields = parse(buffer);
    if (!fields || !fields.length) return null;
    let changed = false;
    if (rewriteStrings(fields, 0)) changed = true;
    // v2.4: mở luôn cờ khoá + nâng chất lượng ở MỌI endpoint Spotify, vì trang
    // "Chất lượng nội dung" không chỉ đọc từ playback-settings.
    if (unlockPairs(fields, 0)) changed = true;
    if (setQualityPairs(fields, 0)) changed = true;
    return changed ? serialize(fields) : null;
  }

  const patchCustomize = (b) => edit(b, [1], patchUcs);
  const patchBootstrap = (b) => edit(b, [2, 1, 1, 1], patchUcs);

  // ------------------------------------------------------- PAM (v2.2.0)
  //
  // Log thật của client 9.2.2 cho thấy state "Free" KHÔNG đi qua product-state
  // (endpoint đó không còn được gọi lần nào). Nó đi qua PAM:
  //   /pam-view-service/spotify.pam.v2.PamViewService/GetYourPremiumBadge  (9 lần)
  //   /pam-view-service/spotify.pam.v2.PamViewService/GetPlanOverview      (2 lần)
  //   /pam-view-service/v1/GetPremiumPlanRow?locale=vi                     (JSON)
  //
  // GetYourPremiumBadge trả về message tí xíu chỉ có enum: 0 = free.
  // Không đoán field number của message lớn, chỉ nâng enum 0 -> 1 khi message
  // toàn varint nhỏ (<= 8) — đúng hình dạng của response badge.
  function boostEnum(b) {
    if (!b.length || b.length > 64) return null;
    const fields = parse(b);
    if (!fields || !fields.length || fields.length > 8) return null;
    for (const f of fields) if (f.w !== 0 || f.v > 8) return null;
    let changed = false;
    for (const f of fields) {
      if (f.v === 0) {
        f.v = 1;
        changed = true;
      }
    }
    return changed ? serialize(fields) : null;
  }

  // ------------------------------------ nhãn + màu viên badge (v2.3.0)
  //
  // Hàng "Gói Premium của bạn" + viên badge bên phải ở trang Tài khoản được vẽ
  // từ JSON của /pam-view-service/v1/GetPremiumPlanRow?locale=vi (REST, không
  // phải gRPC). v2.2 chỉ đổi free -> premium nên viên đó vẫn là chữ "Premium"
  // màu xanh mặc định. v2.3 ghi đè nhãn hiển thị + bảng mã màu xanh Spotify.
  //
  // Đổi được qua $argument:
  //   {"badge_text":"ToCam","badge_color":"#1ED760","badge_text_color":"#121212"}
  // Mặc định v2.4: chữ "ToCam", nền XANH LÁ giống hệt viên Premium gốc trong app
  // (ảnh 3), không phải nền cam như v2.3. Muốn cam: badge_color=#FFA500.
  // badge_text_color bỏ trống = không đụng màu chữ (mặc định của app).
  const BADGE_TEXT =
    typeof opt.badge_text === "string" && opt.badge_text ? opt.badge_text : "ToCam";
  const BADGE_COLOR =
    typeof opt.badge_color === "string" && opt.badge_color ? opt.badge_color : "#1ED760";
  const BADGE_TEXT_COLOR =
    typeof opt.badge_text_color === "string" && opt.badge_text_color ? opt.badge_text_color : "";

  const BADGE_KEY =
    /^(?:badge|badge_?text|badge_?label|badge_?title|badge_?name|badge_?value|pill|pill_?text|pill_?label|chip|chip_?text|chip_?label|tag)$/i;
  const LABEL_KEY =
    /^(?:title|name|text|label|value|plan_?name|plan_?title|plan_?label|display_?name|short_?name|product_?label)$/i;
  const COLOR_KEY = /(?:colou?r|tint|background|bg|fill)$/i;
  // Màu chữ trong viên badge. Chỉ đụng khi người dùng đặt badge_text_color,
  // vì đổi màu chữ lệch tương phản là viên badge thành không đọc được.
  const TEXT_COLOR_KEY =
    /(?:text_?colou?r|textcolou?r|foreground_?colou?r|label_?colou?r|title_?colou?r|font_?colou?r)$/i;
  const PLAN_WORD = /^(?:spotify\s*_?\s*)?(?:premium|free)$/i;
  const PREMIUM_WORD = /^(?:spotify\s*_?\s*)?premium$/i;
  const BADGE_ONLY = /^(?:premium|spotify\s*premium|spotify\s*premium\s*plan)$/i;
  // Các dạng "màu xanh Spotify" gặp trong payload thật. Gồm hex có/không dấu #,
  // rgb()/rgba(), và số nguyên 0x1ED760 hay 0xFF1ED760 dùng trong JSON của iOS.
  const GREEN_HEX = /#?(?:1ed760|1db954|1fdf64|1aa34a|158a3f|2ebd59|30d158|1ed75f)/gi;
  const GREEN_RGB = /rgba?\(\s*30\s*,\s*215\s*,\s*96\s*(?:,\s*[\d.]+\s*)?\)/gi;
  const GREEN_0X = /0x(?:ff)?(?:1ed760|1db954|1fdf64)/gi;
  const BADGE_HEX_BARE = BADGE_COLOR.replace(/^#/, "");

  function hexToRgb(hex) {
    const m = /^#?([0-9a-f]{6})$/i.exec(hex || "");
    if (!m) return null;
    const n = parseInt(m[1], 16);
    return "rgb(" + ((n >> 16) & 255) + ", " + ((n >> 8) & 255) + ", " + (n & 255) + ")";
  }
  const BADGE_RGB = hexToRgb(BADGE_COLOR) || "rgb(30, 215, 96)";

  function recolor(str) {
    if (!str || str.length > 80) return str;
    return str
      .replace(GREEN_HEX, (m) => (m.charAt(0) === "#" ? BADGE_COLOR : BADGE_HEX_BARE))
      .replace(GREEN_0X, () => BADGE_COLOR)
      .replace(GREEN_RGB, () => BADGE_RGB);
  }

  function patchBadgeJson(str) {
    let root;
    try {
      root = JSON.parse(str);
    } catch (e) {
      return null;
    }
    if (!root || typeof root !== "object") return null;
    let changed = false;

    const walk = (node) => {
      if (Array.isArray(node)) {
        for (const v of node) walk(v);
        return;
      }
      if (!node || typeof node !== "object") return;
      for (const k of Object.keys(node)) {
        const v = node[k];
        if (typeof v === "string") {
          const hasHash = v.charAt(0) === "#";
          const has0x = /^0x/i.test(v);
          const colorValue = hasHash ? BADGE_COLOR : has0x ? "0x" + BADGE_HEX_BARE.toUpperCase() : BADGE_HEX_BARE;
          const tv = v.trim();
          const isGreen = new RegExp(GREEN_HEX.source, "i").test(v);
          let nv = v;
          if (TEXT_COLOR_KEY.test(k)) {
            // Màu chữ: chỉ đổi khi người dùng đặt badge_text_color. Không đặt
            // thì để nguyên, vì tô cam cả nền lẫn chữ là viên badge mất chữ.
            if (BADGE_TEXT_COLOR && isGreen) nv = BADGE_TEXT_COLOR;
          } else if (BADGE_KEY.test(k) && PLAN_WORD.test(tv)) nv = BADGE_TEXT;
          else if (LABEL_KEY.test(k) && PREMIUM_WORD.test(tv)) nv = BADGE_TEXT;
          else if (COLOR_KEY.test(k) && isGreen) nv = colorValue;
          else nv = recolor(v);
          if (nv !== v) {
            node[k] = nv;
            changed = true;
          }
        } else walk(v);
      }
    };

    walk(root);
    return changed ? JSON.stringify(root) : null;
  }

  function patchBadgeStrings(fields, depth) {
    if (depth > 8) return false;
    let changed = false;
    for (const f of fields) {
      if (f.w !== 2 || !f.p || !f.p.length) continue;
      // Coi đây là chuỗi hiển thị trước (nhãn / mã màu): toàn ký tự in được,
      // ngắn. Tránh trường hợp chuỗi ASCII tình cờ parse ra protobuf hợp lệ.
      if (f.p.length <= 64) {
        const s = decodeUtf8(f.p);
        if (s !== null && /^[\x20-\x7e]+$/.test(s)) {
          let nv = BADGE_ONLY.test(s) ? BADGE_TEXT : s;
          nv = recolor(nv);
          if (nv !== s) {
            f.p = TE.encode(nv);
            changed = true;
          }
          continue;
        }
      }
      const inner = parse(f.p);
      if (inner && inner.length) {
        if (patchBadgeStrings(inner, depth + 1)) {
          f.p = serialize(inner);
          changed = true;
        }
      }
    }
    return changed;
  }

  function patchPam(b) {
    if (b.length && (b[0] === 0x7b || b[0] === 0x5b)) {
      const s = decodeUtf8(b);
      if (s === null) return null;
      const j = patchJsonAll(s);
      return j ? TE.encode(j) : null;
    }
    const fields = parse(b);
    if (!fields || !fields.length) return null;
    let changed = false;
    if (patchBadgeStrings(fields, 0)) changed = true;
    if (rewriteStrings(fields, 0)) changed = true;
    if (changed) return serialize(fields);
    return boostEnum(b);
  }

  // ------------------------------------------- client restrictions (v2.2.0)
  //
  // /spotify.clientrestrictions.v1.ClientRestrictionsService/GetRestrictedIntegrations
  // trả danh sách tính năng bị khoá theo tier (Blend / Jam / Mix / social...).
  // Message rỗng = "không khoá gì" -> nút Phối/Jam không còn bị premium chặn.
  // Chỉ làm khi body parse được như protobuf; JSON để nguyên.
  const LOCK_KEY =
    /(?:premium|lock|restrict|requires|requirement|paid|subscriber|upsell|entitle|blocked|disabled|unavailable)/i;
  const LOCK_LIST_KEY = /(?:restrict|locked|blocked|unavailable|disallow|forbidden|integration)/i;

  function clearJsonLocks(str) {
    let root;
    try {
      root = JSON.parse(str);
    } catch (e) {
      return null;
    }
    if (!root || typeof root !== "object") return null;
    let changed = false;

    const walk = (node) => {
      if (Array.isArray(node)) {
        for (const v of node) walk(v);
        return;
      }
      if (!node || typeof node !== "object") return;
      for (const k of Object.keys(node)) {
        const v = node[k];
        if (Array.isArray(v) && LOCK_LIST_KEY.test(k) && v.length) {
          node[k] = [];
          changed = true;
        } else if (typeof v === "boolean" && LOCK_KEY.test(k) && v === true) {
          node[k] = false;
          changed = true;
        } else if (v && typeof v === "object") walk(v);
      }
    };

    walk(root);
    return changed ? JSON.stringify(root) : null;
  }

  // Protobuf dạng cặp { 1: tên_khoá, 2: bool|message } -> gạt khoá premium về
  // false. Chỉ đụng khi tên khoá nói rõ premium/lock/restrict (an toàn).
  function unlockPairs(fields, depth) {
    if (depth > 6) return false;
    let changed = false;
    for (const f of fields) {
      if (f.w !== 2 || !f.p || !f.p.length) continue;
      const inner = parse(f.p);
      if (!inner || !inner.length) continue;
      let local = unlockPairs(inner, depth + 1);
      const kf = first(inner, 1);
      const vf = first(inner, 2);
      const ks = kf ? text(kf) : null;
      if (ks && ks.length <= 64 && vf && LOCK_KEY.test(ks)) {
        if (vf.w === 0 && vf.v === 1) {
          vf.v = 0;
          local = true;
        } else if (vf.w === 2 && vf.p && vf.p.length) {
          const vv = parse(vf.p);
          if (vv && vv.length) {
            let sub = false;
            for (const g of vv) {
              if (g.w === 0 && g.v === 1) {
                g.v = 0;
                sub = true;
              }
            }
            if (sub) {
              vf.p = serialize(vv);
              local = true;
            }
          } else {
            const sv = text(vf);
            if (sv === "true" || sv === "TRUE") {
              vf.p = TE.encode("false");
              local = true;
            }
          }
        }
      }
      if (local) {
        f.p = serialize(inner);
        changed = true;
      }
    }
    return changed;
  }

  function patchRestrictions(b) {
    if (!b.length) return null;
    if (b[0] === 0x7b || b[0] === 0x5b) {
      const s = decodeUtf8(b);
      if (s === null) return null;
      const o = clearJsonLocks(s);
      return o ? TE.encode(o) : null;
    }
    const fields = parse(b);
    if (!fields) return null;
    // Đã có cờ khoá dạng cặp key/bool -> gạt trước; không có gì để gạt thì trả
    // message rỗng = "không khoá integration nào" (Blend / Jam / Mix).
    if (unlockPairs(fields, 0)) return serialize(fields);
    return new Uint8Array(0);
  }

  // --------------------------------------------- playback settings (v2.2.0)
  //
  // /playback-settings/.../GetAllStoredContentValues + GetDeviceSettings chứa
  // mức chất lượng đang lưu; WriteContentValue là app ghi mức mới. Khoá Premium
  // ở trang Chất lượng đọc từ đây. Ép mọi cặp (key chứa quality/bitrate) về
  // VERY_HIGH — cả lúc đọc lẫn lúc ghi, để UI và trình phát khớp nhau.
  const QUALITY_KEY =
    /(?:quality|bitrate|bit_?rate|max_?bitrate|streaming_?level|audio_?format|streaming_?quality|download_?quality|preferred_?quality|audio_?quality)/i;
  const QUALITY_MAX = "VERY_HIGH";
  const QUALITY_VALUES = [
    "AUTOMATIC",
    "LOW",
    "NORMAL",
    "HIGH",
    "VERY_HIGH",
    "MEDIUM",
    "VERY_HIGH_320",
    "EXTREME",
    "LOSSLESS",
    "HIFI"
  ];
  // Trần bitrate trong payload: 96 (thấp) / 160 (bình thường) / 320 (cao nhất).
  // 320 là mức client coi là "Rất cao" nên mọi số nhỏ hơn đều nâng lên 320.
  const QUALITY_BITRATE_MAX = 320;
  const BITRATE_KEY = /(?:bitrate|bit_?rate|max_?bitrate|bitrate_?cap|audio_?bitrate)/i;

  function setQualityPairs(fields, depth) {
    if (depth > 6) return false;
    let changed = false;
    for (const f of fields) {
      if (f.w !== 2 || !f.p || !f.p.length) continue;
      const inner = parse(f.p);
      if (!inner || !inner.length) continue;
      let local = setQualityPairs(inner, depth + 1);
      const k = first(inner, 1);
      const v = first(inner, 2);
      const ks = k ? text(k) : null;
      if (ks && v && v.w === 2 && QUALITY_KEY.test(ks)) {
        const vs = text(v);
        if (vs !== null && vs !== QUALITY_MAX && vs.length <= 32) {
          v.p = TE.encode(QUALITY_MAX);
          local = true;
        }
      }
      if (local) {
        f.p = serialize(inner);
        changed = true;
      }
    }
    return changed;
  }

  function setQualityJson(str) {
    let root;
    try {
      root = JSON.parse(str);
    } catch (e) {
      return null;
    }
    let changed = false;
    const walk = (node) => {
      if (Array.isArray(node)) {
        for (const v of node) walk(v);
        return;
      }
      if (!node || typeof node !== "object") return;
      for (const k of Object.keys(node)) {
        const v = node[k];
        if (typeof v === "string") {
          const up = v.toUpperCase();
          if (QUALITY_KEY.test(k) && QUALITY_VALUES.indexOf(up) >= 0 && up !== QUALITY_MAX) {
            node[k] = QUALITY_MAX;
            changed = true;
          } else if (BITRATE_KEY.test(k) && /^\d{2,4}$/.test(v.trim())) {
            const n = parseInt(v.trim(), 10);
            if (n > 0 && n < QUALITY_BITRATE_MAX) {
              node[k] = String(QUALITY_BITRATE_MAX);
              changed = true;
            }
          }
        } else if (typeof v === "number") {
          if (BITRATE_KEY.test(k) && v > 0 && v < QUALITY_BITRATE_MAX) {
            node[k] = QUALITY_BITRATE_MAX;
            changed = true;
          }
        } else walk(v);
      }
    };
    walk(root);
    return changed ? JSON.stringify(root) : null;
  }

  // v2.4: gộp các bước "làm sạch" JSON vào một chỗ để dùng cho MỌI endpoint
  // Spotify, không chỉ 3 họ đã biết. Thứ tự: nhãn/màu badge -> product ->
  // cờ khoá -> chất lượng. Không nhận ra gì thì trả null (body nguyên bản).
  function patchJsonAll(str) {
    let cur = str;
    // Thứ tự quan trọng: gạt cờ khoá TRƯỚC rồi mới bật cờ premium. Làm ngược
    // thì clearJsonLocks() thấy key "isPremium" khớp chữ "premium" và gạt
    // isPremium=true -> false, xoá luôn công của patchJsonProduct.
    const steps = [patchBadgeJson, clearJsonLocks, patchJsonProduct, setQualityJson];
    for (const fn of steps) {
      const next = fn(cur);
      if (next) cur = next;
    }
    return cur === str ? null : cur;
  }

  function patchSettings(b) {
    if (b.length && (b[0] === 0x7b || b[0] === 0x5b)) {
      const s = decodeUtf8(b);
      if (s === null) return null;
      const j = patchJsonAll(s);
      return j ? TE.encode(j) : null;
    }
    const fields = parse(b);
    if (!fields || !fields.length) return null;
    let changed = false;
    if (setQualityPairs(fields, 0)) changed = true;
    if (unlockPairs(fields, 0)) changed = true;
    if (rewriteStrings(fields, 0)) changed = true;
    return changed ? serialize(fields) : null;
  }

  // ------------------------------------------------------------------- entry

  const isPam = /(?:pam-view-service|pam\.v2|PamViewService|pam-account)/i.test(url);
  const isRestrict = /(?:clientrestrictions|GetRestrictedIntegrations)/i.test(url);
  const isSettings = /playback-settings/i.test(url);

  // Mọi hàm patch đều trả null khi không nhận ra -> $done({}) = body nguyên bản.
  function patchOne(b) {
    if (isRestrict) return patchRestrictions(b);
    if (isPam) return patchPam(b);
    if (isSettings) return patchSettings(b);
    if (url.indexOf("bootstrap") >= 0) return patchBootstrap(b) || patchCustomize(b) || patchUniversal(b);
    if (url.indexOf("user-customization-service") >= 0) return patchCustomize(b) || patchBootstrap(b) || patchUniversal(b);
    if (url.indexOf("nebula") >= 0) return patchAttributesStrict(b) || patchUniversal(b);
    if (url.indexOf("remote-config-resolver") >= 0) return patchConfigurationStrict(b) || patchUniversal(b);
    // product-state / user-profile / account / device-capabilities / login5...
    return patchUniversal(b);
  }

  let out = null;
  if (grpcFrames) {
    let changed = false;
    for (const f of grpcFrames) {
      // 0x80 = trailer (header text), bit 0 = nén -> không đụng, không reframe.
      if (f.flag & 0x80 || f.flag & 0x01) continue;
      const np = patchOne(f.payload);
      if (np && !same(np, f.payload)) {
        f.payload = np;
        changed = true;
      }
    }
    out = changed ? grpcJoin(grpcFrames) : null;
  } else {
    out = patchOne(body);
  }

  if (!out || same(out, body)) {
    if (verbose) console.log("spotify-vn: nothing to patch " + url.slice(0, 120));
    $done({});
    return;
  }

  if (verbose) {
    const pth = url.replace(/^https?:\/\/[^/]+/, "").split("?")[0];
    console.log("spotify-vn: patched " + pth.slice(0, 70) + " " + body.length + " -> " + out.length + "B");
  }
  $done({ body: out });
})();
