/***************************************************************
 * MeiTuXiuXiu.js — Mở khóa VIP Meitu XiuXiu (bản sạch, không làm rối)
 * Nguồn gốc logic: @duyvinh09 / R·E — viết lại sạch & sửa lỗi mất kết nối mạng
 *
 * Khắc phục lỗi mạng:
 *   - Loại bỏ code làm rối jsjiami (window / setInterval / debugger gây crash JSC).
 *   - Chỉ xử lý HTTP 200 + JSON hợp lệ, bỏ qua path xử lý ảnh/AI/CDN.
 *   - Bọc try/catch toàn bộ, mọi nhánh không hợp lệ trả $done({}) nguyên bản.
 *   - Không ép avatar_url http:// hay ghi số id vượt MAX_SAFE_INTEGER.
 ***************************************************************/

(() => {
  "use strict";

  const VIP_DISPLAY_NAME = "Minh Hiệp VIP";
  const MAX_BODY = 524288; // 512 KB
  const NOW = Math.floor(Date.now() / 1000);
  const EXPIRE_SEC = 1893430861; // 2030-01-01
  const VALID_SEC = Math.min(NOW, 1642348800);

  const RX_EXCLUDE_PATH = /\/(beautify|process|material|upload|download|cdn|static|image|video|ai\/render)\b/i;

  function pass() {
    $done({});
  }

  function isPlainObject(v) {
    return !!v && typeof v === "object" && !Array.isArray(v);
  }

  function patchSubOrUserDetail(data, isUserDetail) {
    data.valid_time = VALID_SEC;
    data.is_expire = 0;
    data.old_vip_type = 4;
    if ("sub_type" in data || isUserDetail) data.sub_type = 8;
    data.expire_days = -999;
    data.renew = 1;
    data.exchange_vip = 0;
    data.invalid_time = EXPIRE_SEC;
    if (isUserDetail) {
      data.show_auto_renew = 0;
    }
    if (typeof data.screen_name === "string" && data.screen_name) {
      data.screen_name = VIP_DISPLAY_NAME;
    }
  }

  function patchVipShow(data) {
    data.valid_time = VALID_SEC;
    data.is_expire = 0;
    data.vip_type = 101;
    data.old_vip_type = 4;
    data.sub_type = 3;
    data.sub_biz_type = 1;
    data.sub_name = "VIP Năm";
    data.expire_days = -999;
    data.invalid_time = EXPIRE_SEC;
    data.in_valid_time = EXPIRE_SEC;
    data.create_time = VALID_SEC;
    data.s = 1;
    data.renew = 2;
    data.is_valid_user = 1;
    data.platform = 2;
    if (!data.id_str) data.id_str = "6888888888888888888";
    if (!data.gid) data.gid = 2500000000;
    if (typeof data.screen_name === "string" && data.screen_name) {
      data.screen_name = VIP_DISPLAY_NAME;
    }
  }

  function patchPromptQuery(node) {
    if (Array.isArray(node)) {
      for (let i = 0; i < node.length; i++) patchPromptQuery(node[i]);
      return;
    }
    if (!isPlainObject(node)) return;
    for (const k of Object.keys(node)) {
      const v = node[k];
      if (v && typeof v === "object") {
        patchPromptQuery(v);
        continue;
      }
      if (k === "home_prompt") node[k] = "Gói VIP của bạn có hiệu lực đến 2030/01/01.";
      else if (k === "home_btn_prompt") node[k] = "Xem ngay";
      else if (k === "beautify_btn_prompt") node[k] = "";
      else if (k === "beautify_prompt") node[k] = "";
    }
  }

  function patchFallbackVipKeys(node, depth) {
    if (!node || typeof node !== "object" || depth > 8) return false;
    if (Array.isArray(node)) {
      let any = false;
      for (let i = 0; i < Math.min(node.length, 30); i++) {
        if (patchFallbackVipKeys(node[i], depth + 1)) any = true;
      }
      return any;
    }
    let changed = false;
    for (const k of Object.keys(node)) {
      const v = node[k];
      if (v && typeof v === "object") {
        if (patchFallbackVipKeys(v, depth + 1)) changed = true;
        continue;
      }
      if (k === "vip_type" && typeof v === "number" && v <= 0) {
        node[k] = 1;
        changed = true;
      } else if (k === "is_expire" && typeof v === "number" && v !== 0) {
        node[k] = 0;
        changed = true;
      } else if (k === "expire_days" && typeof v === "number" && v >= 0) {
        node[k] = -999;
        changed = true;
      } else if ((k === "valid_time" || k === "invalid_time") && typeof v === "number" && v === 0) {
        node[k] = EXPIRE_SEC;
        changed = true;
      } else if (/^(is_?)?(vip|svip|member|premium)(_?(status|flag|valid|active))?$/i.test(k) && v === false) {
        node[k] = true;
        changed = true;
      }
    }
    return changed;
  }

  function run() {
    const url = ($request && $request.url) || "";
    if (!url || RX_EXCLUDE_PATH.test(url)) return pass();

    const resp = $response || {};
    const status = Number(resp.statusCode || resp.status || 0);
    if (status && status !== 200) return pass();

    const headers = resp.headers || {};
    const ct = String(headers["Content-Type"] || headers["content-type"] || "");
    if (ct && !/json|javascript|text\/plain/i.test(ct)) return pass();

    const body = typeof resp.body === "string" ? resp.body : "";
    if (!body || body.length > MAX_BODY) return pass();

    const trimmed = body.trim();
    if (!trimmed.startsWith("{") && !trimmed.startsWith("[")) return pass();

    let obj;
    try {
      obj = JSON.parse(trimmed);
    } catch (e) {
      return pass();
    }
    if (!obj || typeof obj !== "object") return pass();

    let matched = false;

    if (url.includes("/v1/h5/vip/sub_detail.json") && isPlainObject(obj.data)) {
      patchSubOrUserDetail(obj.data, false);
      matched = true;
    } else if (url.includes("/v1/h5/vip/user_detail.json") && isPlainObject(obj.data)) {
      patchSubOrUserDetail(obj.data, true);
      matched = true;
    } else if (url.includes("/v1/vip/vip_show.json") && isPlainObject(obj.data)) {
      patchVipShow(obj.data);
      matched = true;
    } else if (url.includes("/v1/user/show.json") && isPlainObject(obj.data)) {
      obj.data.free_trial = 1;
      obj.data.vip_type = 1;
      if (typeof obj.data.screen_name === "string" && obj.data.screen_name) {
        obj.data.screen_name = VIP_DISPLAY_NAME;
      }
      matched = true;
    } else if (url.includes("/v1/vip/prompt/query.json")) {
      patchPromptQuery(obj);
      matched = true;
    } else if (url.includes("/v1/account/verify_credentials.json") && isPlainObject(obj.data)) {
      obj.data.vip_type = 1;
      obj.data.free_trial = 1;
      if (typeof obj.data.screen_name === "string" && obj.data.screen_name) {
        obj.data.screen_name = VIP_DISPLAY_NAME;
      }
      matched = true;
    } else if (/^https?:\/\/api-sub\.meitu\.com\//i.test(url)) {
      matched = patchFallbackVipKeys(obj, 0);
    }

    if (!matched) return pass();

    console.log("[MeituVIP] patched " + url.split("?")[0]);
    $done({ body: JSON.stringify(obj) });
  }

  try {
    run();
  } catch (e) {
    pass();
  }
})();
