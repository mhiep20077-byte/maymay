/***************************************************************
 * MeiTuCapture.js — Bắt gói tin Meitu & Wink (chỉ đọc, không sửa)
 *
 * Công dụng:
 *   1) Pha http-request (requires-body=0): ghi [MEITU-REQ] để xác định
 *      request có đi qua MITM hay bị SSL pinning chặn ngay bước TLS.
 *   2) Pha http-response (requires-body=1): ghi [MEITU-CAP] gồm status,
 *      len, các field VIP/user/sub/trial/expire và đoạn JSON mẫu.
 *   3) Luôn trả $done({}) ở mọi nhánh — không bao giờ làm hỏng mạng.
 ***************************************************************/

(() => {
  "use strict";

  const RX_EXCLUDE = /\/(beautify|process|material|upload|download|cdn|static)\b|\.(?:jpg|jpeg|png|webp|gif|mp4|mov|zip|ttf|otf|woff2?|css)(?:$|\?)/i;
  const RX_VIP = /(vip|svip|premium|member|privile|entitle|subscri|trial|expire|valid_?time|invalid_?time|rights|gold|benefit|renew|contract|free_?trial|product|order|pay)/i;
  const MAX_BODY = 524288;
  const MAX_FIELDS = 30;
  const MAX_JSON_PREVIEW = 1200;

  function pass() {
    $done({});
  }

  function safeUrlParts(rawUrl) {
    try {
      const m = String(rawUrl || "").match(/^https?:\/\/([^/?#]+)(\/[^?#]*)?/i);
      return m ? { host: m[1].toLowerCase(), path: m[2] || "/" } : { host: "", path: "" };
    } catch (e) {
      return { host: "", path: "" };
    }
  }

  function storeAppend(line) {
    try {
      if (typeof $persistentStore === "undefined") return;
      let buf = $persistentStore.read("meitu_cap_buf") || "";
      buf += line + "\n";
      if (buf.length > 30000) buf = buf.slice(buf.length - 30000);
      $persistentStore.write(buf, "meitu_cap_buf");
    } catch (e) {}
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
        if (sv && sv.length > 80) sv = sv.slice(0, 80) + "...";
        out.push(path + "." + k + "=" + sv);
      }
    }
  }

  function run() {
    const url = ($request && $request.url) || "";
    if (!url || RX_EXCLUDE.test(url)) return pass();

    const parts = safeUrlParts(url);
    const shortUrl = parts.host + parts.path;

    // Pha http-request: chỉ log nhẹ để tách lỗi pinning vs lỗi server
    if (typeof $response === "undefined" || !$response) {
      const method = ($request && $request.method) || "GET";
      const line = "[MEITU-REQ] " + method + " " + shortUrl;
      console.log(line);
      storeAppend(line);
      return pass();
    }

    // Pha http-response: bắt body JSON + trích field VIP
    const resp = $response;
    const status = Number(resp.statusCode || resp.status || 0);
    const headers = resp.headers || {};
    const ct = String(headers["Content-Type"] || headers["content-type"] || "");
    const body = typeof resp.body === "string" ? resp.body : "";

    let summary = "[MEITU-CAP] " + shortUrl + " st=" + status + " len=" + body.length + (ct ? " ct=" + ct.split(";")[0] : "");

    if (!body) {
      console.log(summary + " (empty)");
      storeAppend(summary + " (empty)");
      return pass();
    }

    if (body.length > MAX_BODY) {
      console.log(summary + " (skip >512KB)");
      return pass();
    }

    if (ct && !/json|javascript|text\/plain/i.test(ct)) {
      console.log(summary + " (non-json)");
      return pass();
    }

    const trimmed = body.trim();
    if (!trimmed.startsWith("{") && !trimmed.startsWith("[")) {
      const head = trimmed.slice(0, 40).replace(/\s+/g, " ");
      console.log(summary + " (raw: " + head + ")");
      storeAppend(summary + " (raw: " + head + ")");
      return pass();
    }

    try {
      const obj = JSON.parse(trimmed);
      const vipFields = [];
      walkVipKeys(obj, "$", 0, vipFields);
      if (vipFields.length) {
        summary += "\n  VIP_KEYS: " + vipFields.join(" | ");
      }
      const preview = trimmed.length > MAX_JSON_PREVIEW ? trimmed.slice(0, MAX_JSON_PREVIEW) + "..." : trimmed;
      summary += "\n  JSON: " + preview;
    } catch (e) {
      summary += " (json-parse-fail)";
    }

    console.log(summary);
    storeAppend(summary);
    pass();
  }

  try {
    run();
  } catch (e) {
    pass();
  }
})();
