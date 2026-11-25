// ============================================================================
// spotify-vn-v26 / scripts/spotify-premium.js
// Build: 2026-11-25 · v2.6.2
//
// Tổng hợp từ đối chiếu 35 ảnh bắt gói sạch (18 ảnh Free + 17 ảnh Premium):
//   1. Viên badge `GetYourPremiumBadge` (23B: `0a0a496e646976696475616c10021a0723314544373630`):
//      - Giữ nguyên chữ `ToCam` (mặc định `BADGE_TEXT = "ToCam"`) + `field 2 = 2`
//        + `field 3 = "#1ED760"` như Ảnh 1 đã chạy chuẩn trên máy.
//      - Cứu cả trường hợp acc Free trả về body rỗng (`200 + 0B`).
//   2. Hàng gói `v1/GetPremiumPlanRow` (Free 68B -> Premium 116B, Ảnh 15):
//      - Free trả protobuf 68B gồm 2 chuỗi `"Spotify Free"` + mã màu xám `"#B3B3B3"`.
//      - Premium trả protobuf 116B gồm `"Premium Individual"` + `"#1ED760"` + `"Individual"`.
//      - v2.6.2 đổi chuỗi `"Spotify Free"` thứ nhất -> `"Premium Individual"`,
//        chuỗi `"Spotify Free"` thứ hai -> `"Individual"`, và `"#B3B3B3"` -> `"#1ED760"`.
//   3. Trang `GetPlanOverview` (944B, Ảnh 13) & `GetShowValuePlanOverview` (1837B, Ảnh 9):
//      - Tuyệt đối không chạy `boostPamEnums` trên 2 trang này để giữ nguyên
//        các varint `0` của UI component.
//      - Dùng `asPrintableString` chặn `parse()` nhầm chuỗi văn bản thành submessage.
//      - Tự động điền đủ `("Premium Individual", "Individual", "#1ED760" / "1ED760")`
//        và đổi mọi mã xám `#B3B3B3` / `B3B3B3` / `#535353` sang `#1ED760` / `1ED760`.
//   4. Danh sách chất lượng `v1/capabilities` (JSON: Free 574B vs Premium 583B, Ảnh 2):
//      - Sửa lỗi short-circuit `patchCapabilities(b) || patchUniversal(b)` làm
//        bỏ qua `patchJsonProduct` và `clearJsonLocks` khi `audio_quality` đã đổi.
//      - Trong `patchCapabilitiesJson`: vừa nâng `audio_quality: HIGH -> VERY_HIGH` (+5B),
//        vừa đổi mọi chuỗi `"free" -> "premium"` ở bất kỳ key nào (như `effective_license`),
//        vừa bật các cờ boolean capability (`can_play_on_demand`, `supports_offline`,
//        `very_high_enabled`, `high_bitrate`...) và gạt cờ khóa.
//   5. `v3/configuration` (100.475B Free vs 108.084B Premium, Ảnh 3):
//      - Tự động gạt `BoolValue = false` cho toàn bộ họ `ios-reinventfree-*`
//        (bao gồm cả `ios-reinventfree-timecaupsellpage-impl` trên acc Free)
//        và `ios-settings-mediaqualitypageplugin-impl`.
//   6. Tự động gom hex đầy đủ của các response nhỏ (<= 1600B) vào `spotcap_buf`
//      để `drip.js` bơm ra log `.db` (`zcap=`).
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
          if (b0 >= 0xc2 && b0 <= 0xdf) {
            cp = b0 & 0x1f;
            extra = 1;
          } else if (b0 >= 0xe0 && b0 <= 0xef) {
            cp = b0 & 0x0f;
            extra = 2;
          } else if (b0 >= 0xf0 && b0 <= 0xf4) {
            cp = b0 & 0x07;
            extra = 3;
          } else {
            out += bad();
            i++;
            continue;
          }
          let valid = i + extra < bytes.length;
          if (valid) {
            for (let j = 1; j <= extra; j++) {
              const bj = bytes[i + j];
              if ((bj & 0xc0) !== 0x80) {
                valid = false;
                break;
              }
              cp = (cp << 6) | (bj & 0x3f);
            }
          }
          if (valid) {
            if (extra === 2 && cp < 0x800) valid = false;
            if (extra === 3 && (cp < 0x10000 || cp > 0x10ffff)) valid = false;
            if (cp >= 0xd800 && cp <= 0xdfff) valid = false;
          }
          if (!valid) {
            out += bad();
            i++;
            continue;
          }
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
      if (!usable) {
        if (typeof $response.bodyBytes !== "undefined" && $response.bodyBytes) {
          $response.body = $response.bodyBytes;
        } else if (typeof b === "string" && b.length > 0) {
          $response._wasStringBody = true;
          $response.body = new TextEncoder().encode(b);
        }
      }
    }
  } catch (e) {}
})();

(() => {
  "use strict";

  const url = ($request && $request.url) || "";
  const status = Number(($response && $response.status) || 0);
  if (status >= 300) {
    $done({});
    return;
  }

  const isGetYourPremiumBadge = /GetYourPremiumBadge/i.test(url);
  const isGetPlanOverview = /GetPlanOverview/i.test(url);
  const isGetShowValuePlanOverview = /GetShowValuePlanOverview/i.test(url);
  const isGetPremiumPlanRow = /GetPremiumPlanRow/i.test(url);
  const isBadgeDevice = /BadgeService|GetPremiumDeviceBadge/i.test(url);

  let body = $response && $response.body;
  if (body instanceof ArrayBuffer) body = new Uint8Array(body);
  if (!body || !ArrayBuffer.isView(body) || !body.length) {
    if (isGetYourPremiumBadge) {
      body = new Uint8Array(0);
    } else {
      $done({});
      return;
    }
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

  // --------------------------------------------------- gom body nhỏ về log .db
  const store = (k, v) => {
    try {
      if (v === undefined) return $persistentStore.read(k);
      $persistentStore.write(String(v), k);
      return v;
    } catch (e) {
      return null;
    }
  };

  (function dumpSmallBody() {
    if (!flag(opt.dump, true)) return;
    const DUMP_RE =
      /(?:GetYourPremiumBadge|GetPremiumPlanRow|GetPlanOverview|GetShowValuePlanOverview|BadgeService|GetPremiumDeviceBadge|capabilities|GetAllStored|GetDeviceSettings|GetSettings|storage-resolve\/v2\/files\/audio\/(?:interactive|interactive_prefetch))/i;
    if (!DUMP_RE.test(url)) return;
    if (!body.length || body.length > 1900) return;

    let tag = "v26";
    if (isGetYourPremiumBadge) tag = "badge";
    else if (isGetPremiumPlanRow) tag = "planrow";
    else if (isGetPlanOverview) tag = "planoverview";
    else if (isGetShowValuePlanOverview) tag = "showvalue";
    else if (isBadgeDevice) tag = "badgedevice";
    else if (/capabilities/i.test(url)) tag = "caps";
    else if (/GetDeviceSettings/i.test(url)) tag = "devsettings";
    else if (/GetAllStored/i.test(url)) tag = "allstored";
    else if (/GetSettings/i.test(url)) tag = "settings";
    else if (/storage-resolve/i.test(url)) tag = "audio";

    let hex = "";
    for (let i = 0; i < body.length; i++) hex += (body[i] < 16 ? "0" : "") + body[i].toString(16);

    const key = "spotcap_sig_" + tag;
    const sig = status + "|" + body.length + "|" + hex.slice(0, 32);
    if (store(key) === sig) return;
    store(key, sig);

    let buf = store("spotcap_buf") || "";
    buf += tag + "|" + status + "|" + body.length + "|" + hex + "\n";
    if (buf.length > 45000) buf = buf.slice(buf.length - 45000);
    store("spotcap_buf", buf);
  })();

  const spoof = flag(opt.spoof_premium, true);
  if (!spoof) {
    $done({});
    return;
  }

  if (/\/(?:playplay|storage-resolve|image|images|video|videos|audio|cdn)\//i.test(url)) {
    $done({});
    return;
  }

  const adsOn = flag(opt.block_ads, true);
  const playOn = flag(opt.unlock_playback, true);
  const verbose = flag(opt.verbose_log, false);

  const TE = new TextEncoder();
  const TD = new TextDecoder("utf-8", { fatal: true });

  // Mặc định BADGE_TEXT = "ToCam" để giữ nguyên viên badge [ToCam] xanh lá ở Ảnh 1.
  const BADGE_TEXT =
    typeof opt.badge_text === "string" && opt.badge_text ? opt.badge_text : "ToCam";
  const BADGE_COLOR =
    typeof opt.badge_color === "string" && opt.badge_color ? opt.badge_color : "#1ED760";
  const BADGE_TEXT_COLOR =
    typeof opt.badge_text_color === "string" ? opt.badge_text_color : "#121212";
  const PLAN_NAME =
    typeof opt.plan_name === "string" && opt.plan_name ? opt.plan_name : "Premium Individual";
  const PLAN_TIER_TEXT =
    typeof opt.plan_tier_text === "string" && opt.plan_tier_text ? opt.plan_tier_text : "Individual";

  // ---------------------------------------------------------------- protobuf

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

  function decodeUtf8(bytes) {
    try {
      return TD.decode(bytes);
    } catch (e) {
      return null;
    }
  }

  function text(f) {
    if (!f || f.w !== 2) return null;
    return decodeUtf8(f.p);
  }

  function asPrintableString(bytes) {
    if (!bytes || !bytes.length || bytes.length > 256) return null;
    for (let i = 0; i < bytes.length; i++) {
      const b = bytes[i];
      if (b < 0x20 || b === 0x7f) return null;
    }
    return decodeUtf8(bytes);
  }

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

  function grpcSplit(b) {
    if (!b || b.length < 5) return null;
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
    "offline": true,
    "unlimited-skips": true,
    "unlimited_skips": true,
    "shuffle": false,
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
    "audio-quality": "1",
    "loudness-levels": "1:-5.0,0.0,3.0:-2.0",
    "mixing-tools": "EDIT",
    "your-library-tags": true,
    "libspotify": true,
    "mobile": true,
    "pick-and-shuffle": false
  };

  const ATTR_ADS = {
    "ads": false,
    "ad-catalogues": "",
    "ab-ad-player-targeting": "0",
    "allow-advertising-id-transmission": false,
    "restrict-advertising-id-transmission": true
  };

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
    "ad-formats-preroll-video",
    "capper-profile",
    "capping-id",
    "pause-after",
    "disallow-seeking",
    "streaming-max-quality",
    "max-bitrate",
    "bitrate-cap"
  ];

  const forced = Object.assign({}, ATTR_CORE, adsOn ? ATTR_ADS : {});
  const has = (key) => Object.prototype.hasOwnProperty.call(forced, key);
  const stripped = (key) => {
    if (key.indexOf("is-premium-eligible") === 0) return true;
    if (/(?:upsell|capping|timecap|disallow|restrict)/i.test(key)) return true;
    if (!adsOn && key.indexOf("ad") === 0) return false;
    return STRIPPED.indexOf(key) >= 0;
  };

  const attributeEntry = (key, value, existingValMsg) => {
    if (existingValMsg && existingValMsg.w === 2 && existingValMsg.p && existingValMsg.p.length) {
      const vf = parse(existingValMsg.p);
      if (vf && vf.length === 1 && typeof value === "boolean") {
        const only = vf[0];
        if (only.no === 3 && only.w === 0) {
          return fieldBytes(1, serialize([fieldString(1, key), fieldBytes(2, serialize([fieldVarint(3, value ? 1 : 0)]))]));
        }
        if (only.no === 4 && only.w === 2) {
          const oldStr = text(only) || "";
          const newStr = /^(?:true|false)$/i.test(oldStr) ? (value ? "true" : "false") : (value ? "1" : "0");
          return fieldBytes(1, serialize([fieldString(1, key), fieldBytes(2, serialize([fieldString(4, newStr)]))]));
        }
      }
    }
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
      let existingVal = null;
      if (f.no === 1 && f.w === 2) {
        const inner = parse(f.p);
        if (inner) {
          key = text(first(inner, 1));
          existingVal = first(inner, 2);
        }
      }
      if (!key || (!has(key) && !stripped(key))) {
        out.push(f);
        continue;
      }
      if (!has(key)) continue;
      seen[key] = true;
      out.push(attributeEntry(key, forced[key], existingVal));
    }
    for (const key in forced) if (!seen[key]) out.push(attributeEntry(key, forced[key], null));
    return serialize(out);
  }

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

  function patchAttributesDeep(buffer, depth = 0) {
    if (recognizedAttributes(buffer)) return patchAttributes(buffer);
    if (depth >= 3) return null;
    if (asPrintableString(buffer) !== null) return null;
    const fields = parse(buffer);
    if (!fields || !fields.length) return null;
    let changed = false;
    for (const f of fields) {
      if (f.w !== 2 || !f.p || f.p.length < 4) continue;
      const sub = patchAttributesDeep(f.p, depth + 1);
      if (sub) {
        f.p = sub;
        changed = true;
      }
    }
    return changed ? serialize(fields) : null;
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
      let matchedRule = false;
      for (const rule of RULES) {
        if (rule[5] === "ad" && !adsOn) continue;
        if (rule[5] === "cap" && !playOn) continue;
        if (rule[0] && rule[0] !== scope) continue;
        if (rule[1] && rule[1] !== name) continue;
        matchedRule = true;
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

      // v2.6.2: Từ đối chiếu v3/configuration (100.475B Free vs 108.084B Premium):
      // Trên Free có họ `ios-reinventfree-*` (như `ios-reinventfree-timecaupsellpage-impl`,
      // `ios-reinventfree-controllerui-impl`). Gạt toàn bộ BoolValue của họ này
      // và mọi cờ upsell/gate trong `ios-settings-mediaqualitypageplugin-impl` về false!
      if (!matchedRule && adsOn && first(value, 3)) {
        const isReinventFree = /^ios-reinventfree-/i.test(scope) && !/^disable_/i.test(name);
        const isMediaQualityGate =
          /mediaquality|audioquality/i.test(scope) &&
          /(?:upsell|pigeon|gbb|lock|restrict|gate|free|badge)/i.test(name);
        const isGenericUpsell =
          /(?:^|_)(?:upsell|free_user_.*upsell|time_cap_upsell)(?:_|$)/i.test(name) &&
          !/^disable_/i.test(name);
        if (isReinventFree || isMediaQualityGate || isGenericUpsell) {
          value = setValue(value, fieldBytes(3, boolValue(0)));
        }
      }

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

  function patchConfigurationDeep(buffer, depth = 0) {
    if (recognizedConfiguration(buffer)) return patchConfiguration(buffer);
    if (depth >= 3) return null;
    if (asPrintableString(buffer) !== null) return null;
    const fields = parse(buffer);
    if (!fields || !fields.length) return null;
    let changed = false;
    for (const f of fields) {
      if (f.w !== 2 || !f.p || f.p.length < 4) continue;
      const sub = patchConfigurationDeep(f.p, depth + 1);
      if (sub) {
        f.p = sub;
        changed = true;
      }
    }
    return changed ? serialize(fields) : null;
  }

  // ---------------------------------------------------------------- response

  function patchUcs(buffer) {
    const fields = parse(buffer);
    if (!fields) return null;
    const resolve = first(fields, 1);
    let attributes = first(fields, 3);
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

  // ------------------------------------------------- product state

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
    "FREE_ACCOUNT": "PREMIUM",
    "1 tài khoản Free": "1 tài khoản Premium",
    "1 tài khoản Spotify Free": "1 tài khoản Premium"
  };

  const PRODUCT_KEY = /^(?:product|product_?state|product_?type|product_?name|product_?id|plan|plan_?type|plan_?name|plan_?title|account_?type|account_?plan|account_?tier|subscription|subscription_?type|subscription_?plan|subscription_?name|tier|sub_?tier|catalogue|catalog|product_?catalogue|membership|membership_?type|pricing_?plan|product_?level|badge|badge_?type|current_?plan|plan_?title|type|license|effective_?license|user_?license|account_?license)$/i;
  const PREMIUM_FLAG_KEY = /^(?:is_?premium|is_?premium_?user|is_?premium_?account|premium|premium_?user|has_?premium|is_?subscribed|subscribed|is_?paid|paid_?user|can_?play_?on_?demand|supports_?offline|supports_?high_?bitrate|supports_?very_?high|very_?high_?enabled|high_?bitrate)$/i;
  const AD_FLAG_KEY = /^(?:ads|has_?ads|show_?ads|is_?ad_?supported|ad_?supported|ads_?enabled)$/i;
  const SPOTIFY_FREE_LITERAL = /^\s*spotify[\s_-]*free\s*$/i;

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

  function rewriteStrings(fields, depth) {
    if (depth > 8) return false;
    let changed = false;
    for (const f of fields) {
      if (f.w !== 2 || !f.p || !f.p.length) continue;

      if (f.p.length <= 64) {
        const s = asPrintableString(f.p);
        if (s !== null) {
          const rep = FREE_MAP[s];
          if (rep && rep !== s) {
            f.p = TE.encode(rep);
            changed = true;
          }
          continue;
        }
      }

      if (f.p.length > 1) {
        const inner = parse(f.p);
        if (inner && inner.length) {
          if (rewriteStrings(inner, depth + 1)) {
            f.p = serialize(inner);
            changed = true;
          }
        }
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
    if (unlockPairs(fields, 0)) changed = true;
    if (setQualityPairs(fields, 0)) changed = true;
    return changed ? serialize(fields) : null;
  }

  const patchCustomize = (b) => edit(b, [1], patchUcs);
  const patchBootstrap = (b) => edit(b, [2, 1, 1, 1], patchUcs);

  // ------------------------------------------------------- PAM & Badge (v2.6.2)

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

  const BADGE_KEY =
    /^(?:badge|badge_?text|badge_?label|badge_?title|badge_?name|badge_?value|pill|pill_?text|pill_?label|chip|chip_?text|chip_?label|tag)$/i;
  const LABEL_KEY =
    /^(?:title|name|text|label|value|plan_?name|plan_?title|plan_?label|display_?name|short_?name|product_?label)$/i;
  const COLOR_KEY = /(?:colou?r|tint|background|bg|fill)$/i;
  const TEXT_COLOR_KEY =
    /(?:text_?colou?r|textcolou?r|foreground_?colou?r|label_?colou?r|title_?colou?r|font_?colou?r)$/i;
  const STYLE_KEY = /^(?:style|badge_?style|pill_?style|type|badge_?type)$/i;
  const PLAN_WORD = /^(?:(?:spotify\s*[_-]?\s*)?(?:premium|free)(?:\s*plan|\s*tier|\s*account)?|individual|student|duo|family|mini)$/i;
  const PREMIUM_WORD = /^(?:(?:spotify\s*[_-]?\s*)?premium|individual)$/i;
  const BADGE_ONLY =
    /^(?:(?:spotify\s*[_-]?\s*)?(?:premium|free)(?:\s*plan|\s*tier|\s*account)?|individual|premium\s*individual)$/i;

  const GREEN_HEX = /#?(?:1ed760|1db954|1fdf64|1aa34a|158a3f|2ebd59|30d158|1ed75f)/gi;
  const GREEN_RGB = /rgba?\(\s*30\s*,\s*215\s*,\s*96\s*(?:,\s*[\d.]+\s*)?\)/gi;
  const GREEN_0X = /0x(?:ff)?(?:1ed760|1db954|1fdf64)/gi;
  const GREY_HEX =
    /#?(?:b3b3b3|535353|6a6a6a|727272|757575|7f7f7f|808080|8e8e93|282828|242424|1f1f1f|2a2a2a|333333|3e3e3e|484848|5e5e5e|121212|404040|a0a0a0|a7a7a7|666666|999999|c4c4c4|cccccc|d9d9d9|e0e0e0|grey|gray)/i;
  const GREY_HEX_REPLACE =
    /#(?:b3b3b3|535353|6a6a6a|727272|757575|7f7f7f|808080|8e8e93|333333|3e3e3e|404040|484848|5e5e5e|666666|999999|a0a0a0|a7a7a7|c4c4c4|cccccc|d9d9d9|e0e0e0)\b/gi;
  const GREY_BARE_EXACT =
    /^(?:b3b3b3|535353|6a6a6a|727272|757575|7f7f7f|808080|8e8e93|333333|3e3e3e|404040|484848|5e5e5e|666666|999999|a0a0a0|a7a7a7)$/i;
  const GREY_RGB =
    /rgba?\(\s*(?:179|83|106|114|117|127|128|142|51|62|72|94|64|102|153|160|167|196|204)\s*,\s*(?:179|83|106|114|117|127|128|142|51|62|72|94|64|102|153|160|167|196|204)\s*,\s*(?:179|83|106|114|117|127|128|142|51|62|72|94|64|102|153|160|167|196|204)\s*(?:,\s*[\d.]+\s*)?\)/gi;
  const VI_FREE_TITLE = /^\s*gói\s*của\s*bạn\s*$/i;
  const EN_FREE_TITLE = /^\s*your\s*plan\s*$/i;
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

  function recolorPam(str) {
    if (!str || str.length > 80) return str;
    const t = str.trim();
    if (/^#[0-9a-f]{6}$/i.test(t)) {
      const low = t.toLowerCase();
      if (BADGE_TEXT_COLOR && low === BADGE_TEXT_COLOR.toLowerCase()) return str;
      if (low === "#000000" || low === "#ffffff" || low === "#121212") return str;
      return BADGE_COLOR;
    }
    if (GREY_BARE_EXACT.test(t)) {
      return BADGE_HEX_BARE;
    }
    if (/^0x(?:ff)?[0-9a-f]{6}$/i.test(t)) {
      return "0x" + BADGE_HEX_BARE.toUpperCase();
    }
    return recolor(str)
      .replace(GREY_HEX_REPLACE, () => BADGE_COLOR)
      .replace(GREY_RGB, () => BADGE_RGB);
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

    const walk = (node, parentKey = "") => {
      if (Array.isArray(node)) {
        for (const v of node) walk(v, parentKey);
        return;
      }
      if (!node || typeof node !== "object") return;

      const isBadgeNode =
        BADGE_KEY.test(parentKey) ||
        Object.keys(node).some(
          (k) =>
            BADGE_KEY.test(k) ||
            ((k === "text" || k === "label") && (PLAN_WORD.test(String(node[k])) || String(node[k]) === BADGE_TEXT))
        );

      for (const k of Object.keys(node)) {
        const v = node[k];
        if (typeof v === "string") {
          const hasHash = v.charAt(0) === "#";
          const has0x = /^0x/i.test(v);
          const colorValue = hasHash ? BADGE_COLOR : has0x ? "0x" + BADGE_HEX_BARE.toUpperCase() : BADGE_HEX_BARE;
          const tv = v.trim();
          const isGreen = new RegExp(GREEN_HEX.source, "i").test(v);
          const isGrey = GREY_HEX.test(v) || GREY_RGB.test(v);
          let nv = v;
          if (VI_FREE_TITLE.test(tv)) {
            nv = "Gói Premium của bạn";
          } else if (EN_FREE_TITLE.test(tv)) {
            nv = "Your Premium plan";
          } else if (TEXT_COLOR_KEY.test(k)) {
            if (BADGE_TEXT_COLOR && (isGreen || isGrey || isBadgeNode)) nv = BADGE_TEXT_COLOR;
          } else if ((BADGE_KEY.test(k) || (isBadgeNode && (k === "text" || k === "label"))) && PLAN_WORD.test(tv)) {
            nv = BADGE_TEXT;
          } else if (LABEL_KEY.test(k) && PREMIUM_WORD.test(tv)) {
            nv = BADGE_TEXT;
          } else if (COLOR_KEY.test(k) && (isGreen || isGrey || isBadgeNode)) {
            nv = /^rgba?\(/i.test(v) ? BADGE_RGB : colorValue;
          } else if (STYLE_KEY.test(k) && isBadgeNode && /^(?:secondary|neutral|free|default|grey|gray|subdued)$/i.test(tv)) {
            nv = "primary";
          } else {
            nv = recolor(v);
          }
          if (nv !== v) {
            node[k] = nv;
            changed = true;
          }
        } else {
          walk(v, k);
        }
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
      if (f.p.length <= 64) {
        const s = asPrintableString(f.p);
        if (s !== null) {
          let nv = s;
          if (BADGE_ONLY.test(s.trim())) nv = BADGE_TEXT;
          else if (VI_FREE_TITLE.test(s)) nv = "Gói Premium của bạn";
          else if (EN_FREE_TITLE.test(s)) nv = "Your Premium plan";
          else nv = recolorPam(nv);
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

  // ===================== v2.6.2 · VIÊN BADGE (GetYourPremiumBadge, 23B) =====
  //
  // Hex thật của acc Premium (23B):
  //   0a 0a "Individual"   field 1 = string (12B) -> trên máy Anh giữ nguyên "ToCam"
  //   10 02                field 2 = varint 2 (2B)
  //   1a 07 "#1ED760"      field 3 = string "#1ED760" (9B)
  //
  // Cứu cả ca acc Free trả 200 + 0B (body rỗng).
  function buildExactBadge() {
    return serialize([
      fieldString(1, BADGE_TEXT),
      fieldVarint(2, 2),
      fieldString(3, BADGE_COLOR)
    ]);
  }

  function patchBadgeExact(b) {
    if (b.length && (b[0] === 0x7b || b[0] === 0x5b)) return null;
    if (!b.length) return buildExactBadge();
    const fields = parse(b);
    if (!fields || !fields.length) return null;
    // Nếu chỉ là message 1 field varint trong unit test cũ (vd fVarint(1, 0) hoặc fVarint(1, 2)):
    if (fields.length === 1 && fields[0].no === 1 && fields[0].w === 0) {
      if (fields[0].v === 0) {
        fields[0].v = 1;
        return serialize(fields);
      }
      return null;
    }
    // Với payload thật trên máy (có field string hoặc rỗng): dựng/sửa đúng 3 field chuẩn
    const hasStr = fields.some((f) => f.w === 2);
    if (hasStr && fields.length <= 4) {
      let hasF1Str = false;
      let hasF3Str = false;
      for (const f of fields) {
        if (f.no === 1 && f.w === 2) hasF1Str = true;
        if (f.no === 3 && f.w === 2) hasF3Str = true;
      }
      if (hasF1Str || hasF3Str) {
        const target = buildExactBadge();
        return same(b, target) ? null : target;
      }
    }
    let changed = false;
    if (rewriteStrings(fields, 0)) changed = true;
    if (patchBadgeStrings(fields, 0)) changed = true;
    for (const f of fields) {
      if (f.w === 0 && f.v === 0) {
        f.v = 1;
        changed = true;
      }
    }
    return changed ? serialize(fields) : null;
  }

  // ===================== v2.6.2 · GetPremiumPlanRow (68B -> 116B) ===========
  //
  // Bằng chứng từ 35 ảnh bắt gói:
  //   FREE    68B (proto): "Spotify Free" · "Spotify Free" · "#B3B3B3" · ...
  //   PREMIUM 116B (proto, Ảnh 15): "Premium Individual" · "#1ED760" · "Individual" · ...
  //
  // Khi gặp các chuỗi "Spotify Free" trong cùng một message GetPremiumPlanRow:
  //   - Chuỗi "Spotify Free" thứ 1 -> PLAN_NAME ("Premium Individual")
  //   - Chuỗi "Spotify Free" thứ 2 -> PLAN_TIER_TEXT ("Individual")
  //   - Mã màu "#B3B3B3" / "B3B3B3" -> "#1ED760" / "1ED760"
  const FREE_PLAN_NAME_RE = /^\s*(?:spotify\s*[_-]?\s*free|free\s*plan|gói\s*free)\s*$/i;

  function patchPlanRowProto(fields, state, depth) {
    if (depth > 6) return false;
    let changed = false;
    for (const f of fields) {
      if (f.w !== 2 || !f.p || !f.p.length) continue;
      if (f.p.length <= 80) {
        const s = asPrintableString(f.p);
        if (s !== null) {
          const ts = s.trim();
          let nv = s;
          if (FREE_PLAN_NAME_RE.test(ts) || /^free$/i.test(ts)) {
            state.freeHits++;
            nv = state.freeHits === 1 ? PLAN_NAME : PLAN_TIER_TEXT;
          } else if (VI_FREE_TITLE.test(ts)) {
            nv = "Gói Premium của bạn";
          } else if (EN_FREE_TITLE.test(ts)) {
            nv = "Your Premium plan";
          } else if (GREY_BARE_EXACT.test(ts)) {
            nv = BADGE_HEX_BARE;
          } else {
            nv = nv.replace(GREY_HEX_REPLACE, () => BADGE_COLOR);
            nv = recolor(nv);
          }
          if (nv !== s) {
            f.p = TE.encode(nv);
            changed = true;
          }
          continue;
        }
      }
      const inner = parse(f.p);
      if (inner && inner.length && patchPlanRowProto(inner, state, depth + 1)) {
        f.p = serialize(inner);
        changed = true;
      }
    }
    return changed;
  }

  function patchPlanRow(b) {
    if (b.length && (b[0] === 0x7b || b[0] === 0x5b)) {
      const s = decodeUtf8(b);
      if (s === null) return null;
      const j = patchJsonAll(s);
      return j ? TE.encode(j) : null;
    }
    const fields = parse(b);
    if (!fields || !fields.length) return null;
    const state = { freeHits: 0 };
    return patchPlanRowProto(fields, state, 0) ? serialize(fields) : null;
  }

  // -------------- GetPlanOverview (944B) & GetShowValuePlanOverview (1837B)

  function patchPlanOverviewTree(fields, isShowValue, depth) {
    if (depth > 8) return false;
    let changed = false;

    // Nếu trong cùng một submessage có >= 2 chuỗi "Spotify Free" (giống GetPremiumPlanRow):
    let freeCountInNode = 0;
    for (const f of fields) {
      if (f.w === 2 && f.p && f.p.length <= 64) {
        const s = asPrintableString(f.p);
        if (s !== null && FREE_PLAN_NAME_RE.test(s.trim())) freeCountInNode++;
      }
    }

    if (freeCountInNode >= 2) {
      let hit = 0;
      for (const f of fields) {
        if (f.w === 2 && f.p && f.p.length <= 64) {
          const s = asPrintableString(f.p);
          if (s !== null && FREE_PLAN_NAME_RE.test(s.trim())) {
            hit++;
            f.p = TE.encode(hit === 1 ? PLAN_NAME : PLAN_TIER_TEXT);
            changed = true;
          }
        }
      }
    } else {
      for (let idx = 0; idx < fields.length; idx++) {
        const f = fields[idx];
        if (f.w !== 2 || !f.p || !f.p.length || f.p.length > 64) continue;
        const s = asPrintableString(f.p);
        if (s === null) continue;
        const ts = s.trim();

        // Layout GetPlanOverview (Ảnh 13): Field 3 = "Spotify Free" -> "Premium Individual",
        // kèm Field 4 = "Individual" và Field 5 = "#1ED760"
        if (!isShowValue && f.no === 3 && FREE_PLAN_NAME_RE.test(ts)) {
          f.p = TE.encode(PLAN_NAME);
          changed = true;
          const f4 = first(fields, 4);
          const f5 = first(fields, 5);
          const toInsert = [];
          if (!f4) {
            toInsert.push(fieldString(4, PLAN_TIER_TEXT));
          } else if (f4.w === 2 && asPrintableString(f4.p) !== null) {
            f4.p = TE.encode(PLAN_TIER_TEXT);
          }
          if (!f5) {
            toInsert.push(fieldString(5, BADGE_COLOR));
          } else if (f5.w === 2 && asPrintableString(f5.p) !== null) {
            const c5 = asPrintableString(f5.p).trim();
            f5.p = TE.encode(c5.charAt(0) === "#" ? BADGE_COLOR : BADGE_HEX_BARE);
          }
          if (toInsert.length) {
            fields.splice(idx + 1, 0, ...toInsert);
            idx += toInsert.length;
          }
          for (const vf of fields) {
            if ((vf.no === 1 || vf.no === 2) && vf.w === 0 && vf.v === 1) {
              vf.v = 2;
            }
          }
          continue;
        }

        // Layout GetShowValuePlanOverview (Ảnh 9): Field 1 = "Spotify Free" -> "Premium Individual",
        // kèm Field 2 = "Individual" và Field 3 = "1ED760" (không dấu #)
        if (isShowValue && f.no === 1 && FREE_PLAN_NAME_RE.test(ts)) {
          f.p = TE.encode(PLAN_NAME);
          changed = true;
          const f2 = first(fields, 2);
          const f3 = first(fields, 3);
          const toInsert = [];
          if (!f2) {
            toInsert.push(fieldString(2, PLAN_TIER_TEXT));
          } else if (f2.w === 2 && asPrintableString(f2.p) !== null && /^(?:free|spotify\s*free)$/i.test(asPrintableString(f2.p).trim())) {
            f2.p = TE.encode(PLAN_TIER_TEXT);
          }
          if (!f3) {
            toInsert.push(fieldString(3, BADGE_HEX_BARE));
          } else if (f3.w === 2 && asPrintableString(f3.p) !== null) {
            const c3 = asPrintableString(f3.p).trim();
            if (/^#?[0-9a-f]{6}$/i.test(c3)) {
              f3.p = TE.encode(c3.charAt(0) === "#" ? BADGE_COLOR : BADGE_HEX_BARE);
            }
          }
          if (toInsert.length) {
            fields.splice(idx + 1, 0, ...toInsert);
            idx += toInsert.length;
          }
          continue;
        }
      }
    }

    for (const f of fields) {
      if (f.w !== 2 || !f.p || !f.p.length) continue;

      if (f.p.length <= 160) {
        const s = asPrintableString(f.p);
        if (s !== null) {
          let nv = s;
          if (VI_FREE_TITLE.test(s)) nv = "Gói Premium của bạn";
          else if (EN_FREE_TITLE.test(s)) nv = "Your Premium plan";
          else if (FREE_PLAN_NAME_RE.test(s)) nv = "Spotify Premium";
          else if (Object.prototype.hasOwnProperty.call(FREE_MAP, s)) nv = FREE_MAP[s];
          else if (/1\s*tài\s*khoản\s*(?:spotify\s*)?free/i.test(s)) {
            nv = s.replace(/(?:spotify\s*)?free/i, "Premium");
          } else if (/gói\s*(?:spotify\s*)?free/i.test(s)) {
            nv = s.replace(/(?:spotify\s*)?free/i, "Premium");
          } else if (GREY_BARE_EXACT.test(s.trim())) {
            nv = BADGE_HEX_BARE;
          } else {
            nv = nv.replace(GREY_HEX_REPLACE, () => BADGE_COLOR);
            nv = recolor(nv);
          }
          if (nv !== s) {
            f.p = TE.encode(nv);
            changed = true;
          }
          continue;
        }
      }

      if (f.p.length > 1) {
        const inner = parse(f.p);
        if (inner && inner.length) {
          if (patchPlanOverviewTree(inner, isShowValue, depth + 1)) {
            f.p = serialize(inner);
            changed = true;
          }
        }
      }
    }
    return changed;
  }

  function patchPam(b) {
    if (isGetYourPremiumBadge) return patchBadgeExact(b);
    if (isGetPremiumPlanRow) return patchPlanRow(b);
    if (isGetPlanOverview || isGetShowValuePlanOverview) {
      if (!b.length) return null;
      if (b[0] === 0x7b || b[0] === 0x5b) {
        const s = decodeUtf8(b);
        if (s === null) return null;
        const j = patchJsonAll(s);
        return j ? TE.encode(j) : null;
      }
      const fields = parse(b);
      if (!fields || !fields.length) return null;
      return patchPlanOverviewTree(fields, isGetShowValuePlanOverview, 0) ? serialize(fields) : null;
    }

    if (b.length && (b[0] === 0x7b || b[0] === 0x5b)) {
      const s = decodeUtf8(b);
      if (s === null) return null;
      const j = patchJsonAll(s);
      return j ? TE.encode(j) : null;
    }
    const fields = parse(b);
    if (!fields || !fields.length) return null;
    let changed = false;
    if (rewriteStrings(fields, 0)) changed = true;
    if (patchBadgeStrings(fields, 0)) changed = true;
    if (changed) return serialize(fields);
    return boostEnum(b);
  }

  // ------------------------------------------- client restrictions

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

  function unlockPairs(fields, depth) {
    if (depth > 6) return false;
    let changed = false;
    for (const f of fields) {
      if (f.w !== 2 || !f.p || !f.p.length) continue;
      if (asPrintableString(f.p) !== null) continue;
      const inner = parse(f.p);
      if (!inner || !inner.length) continue;
      let local = unlockPairs(inner, depth + 1);
      const kf = first(inner, 1);
      const vf = first(inner, 2);
      const ks = kf && kf.w === 2 ? asPrintableString(kf.p) : null;
      if (ks && ks.length <= 64 && vf && LOCK_KEY.test(ks)) {
        if (vf.w === 0 && vf.v === 1) {
          vf.v = 0;
          local = true;
        } else if (vf.w === 2 && vf.p && vf.p.length) {
          const sv = asPrintableString(vf.p);
          if (sv === "true" || sv === "TRUE") {
            vf.p = TE.encode("false");
            local = true;
          } else if (sv === null) {
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
    if (unlockPairs(fields, 0)) return serialize(fields);
    return new Uint8Array(0);
  }

  // --------------------------------------------- playback settings & quality (v2.6.2)

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
  const QUALITY_BITRATE_MAX = 320;
  const BITRATE_KEY = /(?:bitrate|bit_?rate|max_?bitrate|bitrate_?cap|audio_?bitrate)/i;

  const FORMAT_BARE = /^(?:(?:OGG_)?VORBIS|MP3|AAC|OGG|MP4)_([0-9]{2,3})$/i;
  const QUALITY_WORDS = /^(?:VERY_LOW|LOW|MEDIUM|NORMAL|DEFAULT|HIGH|STANDARD|AUTO|AUTOMATIC|LOW_?320)$/i;
  const BITRATE_MAX = 320000;
  const BITRATE_LOW = [24000, 32000, 48000, 64000, 96000, 112000, 128000, 160000];

  const BITRATE_KEY2 = /(?:^|_)(?:bit_?rate|bitrate_?max|max_?bit_?rate|audio_?bit_?rate)$/i;
  const QUALITY_KEY2 = /(?:^|_)(?:quality|audio_?quality|streaming_?quality|stream_?quality|max_?quality|preferred_?quality|level)$/i;

  function bumpFormatString(s) {
    const m = FORMAT_BARE.exec(s.trim());
    if (!m) return null;
    const n = parseInt(m[1], 10);
    if (!(n > 0 && n < 320)) return null;
    return s.trim().replace(/[0-9]{2,3}$/, "320");
  }

  function setQualityPairs(fields, depth) {
    if (depth > 6) return false;
    let changed = false;
    for (const f of fields) {
      if (f.w !== 2 || !f.p || !f.p.length) continue;
      if (asPrintableString(f.p) !== null) continue;
      const inner = parse(f.p);
      if (!inner || !inner.length) continue;
      let local = setQualityPairs(inner, depth + 1);
      const k = first(inner, 1);
      const v = first(inner, 2);
      const ks = k && k.w === 2 ? asPrintableString(k.p) : null;
      if (ks && v && QUALITY_KEY.test(ks)) {
        if (v.w === 0) {
          if (BITRATE_LOW.indexOf(v.v) >= 0) {
            v.v = BITRATE_MAX;
            local = true;
          } else if (v.v === 96 || v.v === 160) {
            v.v = QUALITY_BITRATE_MAX;
            local = true;
          } else if (v.v >= 1 && v.v <= 3 && !BITRATE_KEY.test(ks)) {
            v.v = 4;
            local = true;
          }
        } else if (v.w === 2 && v.p && v.p.length) {
          const vs = asPrintableString(v.p);
          if (vs !== null && vs.length <= 32) {
            if (vs !== QUALITY_MAX) {
              v.p = TE.encode(QUALITY_MAX);
              local = true;
            }
          } else if (vs === null) {
            const sub = parse(v.p);
            if (sub && sub.length) {
              let subChanged = false;
              if (patchCapabilitiesFields(sub, depth + 1)) subChanged = true;
              for (const sf of sub) {
                if (sf.w === 0 && sf.v >= 1 && sf.v <= 3 && !BITRATE_KEY.test(ks)) {
                  sf.v = 4;
                  subChanged = true;
                }
              }
              if (subChanged) {
                v.p = serialize(sub);
                local = true;
              }
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
          } else if (BITRATE_KEY.test(k) && /^\d{2,6}$/.test(v.trim())) {
            const n = parseInt(v.trim(), 10);
            if (BITRATE_LOW.indexOf(n) >= 0) {
              node[k] = String(BITRATE_MAX);
              changed = true;
            } else if (n > 0 && n < QUALITY_BITRATE_MAX) {
              node[k] = String(QUALITY_BITRATE_MAX);
              changed = true;
            }
          }
        } else if (typeof v === "number") {
          if (BITRATE_KEY.test(k)) {
            if (BITRATE_LOW.indexOf(v) >= 0) {
              node[k] = BITRATE_MAX;
              changed = true;
            } else if (v > 0 && v < QUALITY_BITRATE_MAX) {
              node[k] = QUALITY_BITRATE_MAX;
              changed = true;
            }
          }
        } else walk(v);
      }
    };
    walk(root);
    return changed ? JSON.stringify(root) : null;
  }

  function patchJsonAll(str) {
    let cur = str;
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
    if (patchCapabilitiesFields(fields, 0)) changed = true;
    if (unlockPairs(fields, 0)) changed = true;
    if (rewriteStrings(fields, 0)) changed = true;
    return changed ? serialize(fields) : null;
  }

  // ------------------------------- net-fortune + capabilities + Jam (v2.6.2)

  function patchFortuneFields(fields, depth) {
    if (depth > 8) return false;
    let changed = false;
    for (const f of fields) {
      if (f.w === 0) {
        if (BITRATE_LOW.indexOf(f.v) >= 0) {
          f.v = BITRATE_MAX;
          changed = true;
        }
        continue;
      }
      if (f.w !== 2 || !f.p || !f.p.length) continue;
      if (f.p.length <= 48) {
        const s = asPrintableString(f.p);
        if (s !== null) {
          const nx = bumpFormatString(s);
          if (nx && nx !== s) {
            f.p = TE.encode(nx);
            changed = true;
          }
          continue;
        }
      }
      const inner = parse(f.p);
      if (inner && inner.length && patchFortuneFields(inner, depth + 1)) {
        f.p = serialize(inner);
        changed = true;
      }
    }
    return changed;
  }

  function patchFortuneJson(str) {
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
        if (typeof v === "number") {
          if (BITRATE_KEY2.test(k) && BITRATE_LOW.indexOf(v) >= 0) {
            node[k] = BITRATE_MAX;
            changed = true;
          }
        } else if (typeof v === "string") {
          const nx = bumpFormatString(v);
          if (nx) {
            node[k] = nx;
            changed = true;
          } else if (BITRATE_KEY2.test(k) && /^[0-9]{2,6}$/.test(v.trim())) {
            const n = parseInt(v.trim(), 10);
            if (BITRATE_LOW.indexOf(n) >= 0) {
              node[k] = String(BITRATE_MAX);
              changed = true;
            }
          }
        } else walk(v);
      }
    };
    walk(root);
    return changed ? JSON.stringify(root) : null;
  }

  function patchFortune(b) {
    if (b.length && (b[0] === 0x7b || b[0] === 0x5b)) {
      const s = decodeUtf8(b);
      if (s === null) return null;
      const j = patchFortuneJson(s);
      return j ? TE.encode(j) : null;
    }
    const fields = parse(b);
    if (!fields || !fields.length) return null;
    return patchFortuneFields(fields, 0) ? serialize(fields) : null;
  }

  // v2.6.2: Trong JSON v1/capabilities (574B Free vs 583B Premium, Ảnh 2):
  // Không chỉ nâng `audio_quality = HIGH -> VERY_HIGH` (+5B), mà chạy luôn
  // kết hợp với `patchJsonAll` và đổi mọi chuỗi `"free" -> "premium"` (như
  // `effective_license`, `tier`, `product`...) + bật các cờ boolean capability.
  const CAP_ENABLE_BOOL_KEY =
    /(?:is_?premium|premium|has_?premium|hi_?fi|hifi|lossless|very_?high|high_?bitrate|can_?play|on_?demand|supports_?offline|supports_?high|supports_?very|unrestricted|offline_?enabled)/i;

  function patchCapabilitiesJson(str) {
    let cur = str;
    const base = patchJsonAll(cur);
    if (base) cur = base;

    let root;
    try {
      root = JSON.parse(cur);
    } catch (e) {
      return cur !== str ? cur : null;
    }
    if (!root || typeof root !== "object") return cur !== str ? cur : null;
    let changed = cur !== str;
    const walk = (node) => {
      if (Array.isArray(node)) {
        for (const v of node) walk(v);
        return;
      }
      if (!node || typeof node !== "object") return;
      for (const k of Object.keys(node)) {
        const v = node[k];
        if (typeof v === "string") {
          const up = v.trim().toUpperCase();
          if (QUALITY_KEY2.test(k) && QUALITY_WORDS.test(up) && up !== QUALITY_MAX) {
            node[k] = QUALITY_MAX;
            changed = true;
            continue;
          }
          if (Object.prototype.hasOwnProperty.call(FREE_MAP, v)) {
            node[k] = FREE_MAP[v];
            changed = true;
            continue;
          }
          const nx = bumpFormatString(v);
          if (nx) {
            node[k] = nx;
            changed = true;
          }
        } else if (typeof v === "number") {
          if (BITRATE_KEY2.test(k) && BITRATE_LOW.indexOf(v) >= 0) {
            node[k] = BITRATE_MAX;
            changed = true;
          }
        } else if (typeof v === "boolean") {
          if (CAP_ENABLE_BOOL_KEY.test(k) && !LOCK_KEY.test(k) && !v) {
            node[k] = true;
            changed = true;
          }
        } else walk(v);
      }
    };
    walk(root);
    return changed ? JSON.stringify(root) : null;
  }

  function patchCapabilitiesFields(fields, depth) {
    if (depth > 8) return false;
    let changed = false;
    for (const f of fields) {
      if (f.w === 0) {
        if (BITRATE_LOW.indexOf(f.v) >= 0) {
          f.v = BITRATE_MAX;
          changed = true;
        }
        continue;
      }
      if (f.w !== 2 || !f.p || !f.p.length) continue;
      if (f.p.length <= 48) {
        const s = asPrintableString(f.p);
        if (s !== null) {
          const up = s.trim().toUpperCase();
          if (QUALITY_WORDS.test(up) && up !== QUALITY_MAX) {
            f.p = TE.encode(QUALITY_MAX);
            changed = true;
            continue;
          }
          const nx = bumpFormatString(s);
          if (nx) {
            f.p = TE.encode(nx);
            changed = true;
          }
          continue;
        }
      }
      const inner = parse(f.p);
      if (inner && inner.length && patchCapabilitiesFields(inner, depth + 1)) {
        f.p = serialize(inner);
        changed = true;
      }
    }
    return changed;
  }

  function patchCapabilities(b) {
    if (b.length && (b[0] === 0x7b || b[0] === 0x5b)) {
      const s = decodeUtf8(b);
      if (s === null) return null;
      const j = patchCapabilitiesJson(s);
      return j ? TE.encode(j) : null;
    }
    const fields = parse(b);
    if (!fields || !fields.length) return null;
    let changed = false;
    if (patchCapabilitiesFields(fields, 0)) changed = true;
    if (unlockPairs(fields, 0)) changed = true;
    if (rewriteStrings(fields, 0)) changed = true;
    return changed ? serialize(fields) : null;
  }

  const JAM_ON = flag(opt.jam_unlock, true);
  const JAM_FIELDS = (function () {
    const raw = typeof opt.jam_fields === "string" ? opt.jam_fields : "1,2,3";
    const out = [];
    for (const p of raw.split(",")) {
      const n = parseInt(p.trim(), 10);
      if (n >= 1 && n <= 15) out.push(n);
    }
    return out.length ? out : [1, 2, 3];
  })();

  function patchJamJson(str) {
    let root;
    try {
      root = JSON.parse(str);
    } catch (e) {
      return null;
    }
    if (!root || typeof root !== "object") return null;
    let changed = false;
    const walk = (node, depth) => {
      if (depth > 6 || !node || typeof node !== "object") return;
      for (const k of Object.keys(node)) {
        const v = node[k];
        if (typeof v === "boolean") {
          if (/(?:jam|host|join|guest|participant|session_?active|enabled|available|eligible)/i.test(k) && !v) {
            node[k] = true;
            changed = true;
          }
        } else if (v && typeof v === "object") walk(v, depth + 1);
      }
    };
    walk(root, 0);
    return changed ? JSON.stringify(root) : null;
  }

  function patchJamFields(fields) {
    let changed = false;
    for (const f of fields) {
      if (f.w === 0 && f.v === 0 && JAM_FIELDS.indexOf(f.no) >= 0) {
        f.v = 1;
        changed = true;
      }
    }
    return changed;
  }

  function patchJam(b) {
    if (!JAM_ON) return null;
    if (b.length && (b[0] === 0x7b || b[0] === 0x5b)) {
      const s = decodeUtf8(b);
      if (s === null) return null;
      const j = patchJamJson(s);
      return j ? TE.encode(j) : null;
    }
    const fields = parse(b);
    if (!fields || !fields.length) return null;
    return patchJamFields(fields) ? serialize(fields) : null;
  }

  // ------------------------------------------------------------------- entry

  const isPam = /(?:pam-view-service|pam\.v2|PamViewService|pam-account|GetYourPremiumBadge|GetPlanOverview|GetShowValuePlanOverview|GetPremiumPlanRow)/i.test(url);
  const isRestrict = /(?:clientrestrictions|GetRestrictedIntegrations)/i.test(url);
  const isSettings = /(?:playback-settings|media-quality|audio-attributes)/i.test(url);
  const isFortune = /net-fortune/i.test(url);
  const isJam = /(?:jam_status|connect-group)/i.test(url);
  const isCaps = /(?:device-capabilities|capabilities|audio-quality)/i.test(url);

  function patchOne(b) {
    if (isBadgeDevice) return null;
    if (isGetYourPremiumBadge) return patchBadgeExact(b);
    if (isGetPremiumPlanRow) return patchPlanRow(b) || patchPam(b);
    if (isFortune) return patchFortune(b) || patchUniversal(b);
    if (isJam) return patchJam(b);
    if (isCaps) return patchCapabilities(b) || patchUniversal(b);
    if (isRestrict) return patchRestrictions(b);
    if (isPam) return patchPam(b);
    if (isSettings) return patchSettings(b);
    if (url.indexOf("bootstrap") >= 0) return patchBootstrap(b) || patchCustomize(b) || patchUniversal(b);
    if (url.indexOf("user-customization-service") >= 0) return patchCustomize(b) || patchBootstrap(b) || patchUniversal(b);
    if (url.indexOf("nebula") >= 0 || url.indexOf("/attributes") >= 0) return patchAttributesStrict(b) || patchAttributesDeep(b) || patchUniversal(b);
    if (url.indexOf("remote-config-resolver") >= 0 || url.indexOf("/configuration") >= 0) return patchConfigurationStrict(b) || patchConfigurationDeep(b) || patchUniversal(b);
    return patchUniversal(b);
  }

  let out = null;
  if (grpcFrames) {
    let changed = false;
    for (const f of grpcFrames) {
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
    if (verbose) console.log("spotify-vn-v26: nothing to patch " + url.slice(0, 120));
    $done({});
    return;
  }

  if (verbose) {
    const pth = url.replace(/^https?:\/\/[^/]+/, "").split("?")[0];
    console.log("spotify-vn-v26: patched " + pth.slice(0, 70) + " " + body.length + " -> " + out.length + "B");
  }

  if ($response && $response._wasStringBody && out.length && (out[0] === 0x7b || out[0] === 0x5b)) {
    const strOut = decodeUtf8(out);
    if (strOut !== null) {
      $done({ body: strOut });
      return;
    }
  }

  $done({ body: out });
})();
