/***************************************************************
 * MeiTuCapture.js — Bắt gói tin Meitu & Wink + Nổi Banner + Bơm zcap= vào log .db
 *
 * Cơ chế (giống hệt capture.js + drip.js của Spotify):
 *   1) Pha http-response:
 *      - Đọc JSON từ các host API Meitu (tool.xiuxiu.meitu.com, api.account.meitu.com,
 *        api-sub.meitu.com, h5.xiuxiu.meitu.com, api.xiuxiu.meitu.com, ...).
 *      - Tìm toàn bộ key liên quan VIP / user / sub / expire / trial / login.
 *      - NỔI THÔNG BÁO (banner) trực tiếp trên màn hình iPhone để biết ngay MITM đã ăn.
 *      - Lưu nguyên URL + status + flags + body (720B đầu, base64url) vào meitucap_buf.
 *      - Luôn trả $done({}) để không làm hỏng response gốc.
 *   2) Pha http-request:
 *      - Bơm từng mẩu từ meitucap_buf vào tham số &zcap=0001.<base64url> của request
 *        kế tiếp (kể cả http://itunes.apple.com/lookup?bundleId=com.meitu.mtxx...)
 *        để dữ liệu nằm gọn trong file proxy-*.db xuất từ Shadowrocket.
 ***************************************************************/

(() => {
  "use strict";

  const RX_EXCLUDE =
    /\/(beautify|process|material|upload|download|cdn|static)\b|\.(?:jpg|jpeg|png|webp|gif|mp4|mov|zip|ttf|otf|woff2?|css|js)(?:$|\?)/i;
  const RX_VIP =
    /(vip|svip|premium|member|privile|entitle|subscri|trial|expire|valid_?time|invalid_?time|rights|gold|benefit|renew|contract|free_?trial|product|order|pay|uid|user_?id|screen_?name|login|token)/i;
  const MAX_BODY = 524288;
  const MAX_FIELDS = 25;
  const CHUNK_RAW = 480;

  const B64C = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

  function b64urlStr(str) {
    let out = "";
    for (let i = 0; i < str.length; i += 3) {
      const b0 = str.charCodeAt(i) & 0xff;
      const b1 = i + 1 < str.length ? str.charCodeAt(i + 1) & 0xff : 0;
      const b2 = i + 2 < str.length ? str.charCodeAt(i + 2) & 0xff : 0;
      out +=
        B64C.charAt(b0 >> 2) +
        B64C.charAt(((b0 & 3) << 4) | (b1 >> 4)) +
        (i + 1 < str.length ? B64C.charAt(((b1 & 15) << 2) | (b2 >> 6)) : "") +
        (i + 2 < str.length ? B64C.charAt(b2 & 63) : "");
    }
    return out.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  }

  function store(key, val, write) {
    try {
      if (typeof $persistentStore === "undefined") return null;
      if (!write) return $persistentStore.read(key);
      $persistentStore.write(String(val), key);
      return val;
    } catch (e) {
      return null;
    }
  }

  function notify(title, sub, body) {
    try {
      if (typeof $notification !== "undefined" && $notification && $notification.post) {
        $notification.post(title, sub || "", body || "");
      } else if (typeof $notify !== "undefined" && $notify) {
        $notify(title, sub || "", body || "");
      }
    } catch (e) {}
  }

  function safeUrlParts(rawUrl) {
    try {
      const m = String(rawUrl || "").match(/^https?:\/\/([^/?#]+)(\/[^?#]*)?/i);
      return m ? { host: m[1].toLowerCase(), path: m[2] || "/" } : { host: "", path: "" };
    } catch (e) {
      return { host: "", path: "" };
    }
  }

  function walkVipKeys(node, path, depth, out) {
    if (!node || typeof node !== "object" || depth > 8 || out.length >= MAX_FIELDS) return;
    if (Array.isArray(node)) {
      for (let i = 0; i < Math.min(node.length, 4) && out.length < MAX_FIELDS; i++) {
        walkVipKeys(node[i], path + "[" + i + "]", depth + 1, out);
      }
      return;
    }
    for (const k of Object.keys(node)) {
      const v = node[k];
      if (v && typeof v === "object") {
        walkVipKeys(v, path + "." + k, depth + 1, out);
        continue;
      }
      if (RX_VIP.test(k) && out.length < MAX_FIELDS) {
        let sv;
        try {
          sv = JSON.stringify(v);
        } catch (e) {
          sv = String(v);
        }
        if (sv && sv.length > 60) sv = sv.slice(0, 60) + "...";
        out.push(path + "." + k + "=" + sv);
      }
    }
  }

  function queueForDrip(ep, status, len, flagStr, pathHint, rawBody) {
    const excerpt = rawBody ? b64urlStr(rawBody.slice(0, 720)) : "";
    const line =
      ep.replace(/\|/g, "/") +
      "|" +
      status +
      "|" +
      len +
      "|" +
      flagStr.replace(/\|/g, "/") +
      "|" +
      pathHint.replace(/\|/g, "/") +
      "|" +
      excerpt +
      "\n";
    let buf = (store("meitucap_buf") || "") + line;
    if (buf.length > 45000) buf = buf.slice(buf.length - 45000);
    store("meitucap_buf", buf, true);
  }

  function runRequestDrip(url, parts) {
    // Banner báo hiệu lần đầu tiên MITM giải mã được 1 request Meitu
    if (!store("meitucap_boot")) {
      store("meitucap_boot", "1", true);
      notify(
        "[Meitu-Cap] ĐÃ BẮT ĐƯỢC KẾT NỐI",
        parts.host + parts.path,
        "MITM đã thông! Mở tab Tôi / VIP rồi xuất file .db gửi lại."
      );
    }

    if (!url || /zcap=|\/(upload|download|beautify|process|material)\b/i.test(url) || url.length > 1500) {
      $done({});
      return;
    }

    const buf = store("meitucap_buf") || "";
    if (!buf || !buf.length) {
      $done({});
      return;
    }

    const chunkRaw = buf.slice(0, CHUNK_RAW);
    const rest = buf.slice(CHUNK_RAW);
    store("meitucap_buf", rest, true);

    const seq = Number(store("meitucap_seq") || "0") + 1;
    store("meitucap_seq", String(seq), true);
    const seqStr = ("0000" + (seq % 10000)).slice(-4);
    const encoded = b64urlStr(chunkRaw);

    const sep = url.indexOf("?") >= 0 ? "&" : "?";
    const newUrl = url + sep + "zcap=" + seqStr + "." + encoded;
    $done({ url: newUrl });
  }

  function runResponseCapture(url, parts) {
    const resp = $response || {};
    const status = Number(resp.statusCode || resp.status || 0);
    const headers = resp.headers || {};
    const ct = String(headers["Content-Type"] || headers["content-type"] || "");
    const body = typeof resp.body === "string" ? resp.body : "";
    const shortUrl = parts.host + parts.path;

    if (!body || body.length > MAX_BODY) {
      queueForDrip(parts.host, status, body ? body.length : 0, "empty_or_large", shortUrl, "");
      $done({});
      return;
    }

    const trimmed = body.trim();
    const vipFields = [];
    if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
      try {
        const obj = JSON.parse(trimmed);
        walkVipKeys(obj, "$", 0, vipFields);
      } catch (e) {
        vipFields.push("json_parse_err");
      }
    } else {
      vipFields.push("non_json:" + (ct.split(";")[0] || "raw"));
    }

    const flagStr = vipFields.length ? vipFields.slice(0, 6).join(", ") : "json_no_vip_key";
    queueForDrip(parts.host, status, body.length, flagStr, shortUrl, trimmed);

    console.log("[MEITU-CAP] " + shortUrl + " st=" + status + " len=" + body.length + " | " + flagStr);

    // Nổi banner khi tìm thấy key VIP/account hoặc tối đa 25 banner/phiên
    const sentN = Number(store("meitucap_noti_n") || "0");
    const dedupeKey = "meitucap_d_" + shortUrl.replace(/[^a-z0-9]/gi, "").slice(-16);
    const now = Date.now();
    const lastAt = Number(store(dedupeKey) || "0");
    if (now - lastAt > 15000 && sentN < 25 && (vipFields.length > 0 || /vip|user|account|sub/i.test(shortUrl))) {
      store(dedupeKey, String(now), true);
      store("meitucap_noti_n", String(sentN + 1), true);
      notify("[Meitu-Cap] " + parts.host, "HTTP " + status + " · " + body.length + "B · " + parts.path, flagStr.slice(0, 160));
    }

    $done({});
  }

  function run() {
    const url = ($request && $request.url) || "";
    if (!url || RX_EXCLUDE.test(url)) {
      $done({});
      return;
    }
    const parts = safeUrlParts(url);
    if (typeof $response === "undefined" || !$response) {
      runRequestDrip(url, parts);
    } else {
      runResponseCapture(url, parts);
    }
  }

  try {
    run();
  } catch (e) {
    $done({});
  }
})();
