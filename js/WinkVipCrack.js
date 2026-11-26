/***************************************************************
 * WinkVipCrack.js — Mở khóa VIP Wink (bản sạch, bỏ popup/anti-tamper)
 * Nguồn gốc logic: @duyvinh09 — viết lại sạch & bảo toàn luồng mạng
 *
 * Khắc phục:
 *   - Xóa vòng IIFE kiểm tra chữ ký & gọi alert() gây lỗi/popup.
 *   - Chỉ xử lý HTTP 200 + JSON hợp lệ, lỗi hoặc sai định dạng trả $done({}).
 *   - Giữ lại account_id gốc nếu server có trả về.
 ***************************************************************/

(() => {
  "use strict";

  const MAX_BODY = 524288;

  function pass() {
    $done({});
  }

  function run() {
    const url = ($request && $request.url) || "";
    if (!/api-sub\.meitu\.com\/v2\/user\/vip_info_by_group\.json/i.test(url)) {
      return pass();
    }

    const resp = $response || {};
    const status = Number(resp.statusCode || resp.status || 0);
    if (status && status !== 200) return pass();

    const body = typeof resp.body === "string" ? resp.body : "";
    if (!body || body.length > MAX_BODY) return pass();

    const trimmed = body.trim();
    if (!trimmed.startsWith("{")) return pass();

    let obj;
    try {
      obj = JSON.parse(trimmed);
    } catch (e) {
      return pass();
    }
    if (!obj || typeof obj !== "object") return pass();

    const prev = obj.data && typeof obj.data === "object" && !Array.isArray(obj.data) ? obj.data : {};
    const accountId = prev.account_id ? String(prev.account_id) : "1230010086";

    obj.data = Object.assign({}, prev, {
      active_sub_type: 2,
      account_type: 1,
      sub_type_name: "Gia hạn",
      active_sub_order_id: "7069961436604422668",
      trial_period_invalid_time: "",
      current_order_invalid_time: "32662173600000",
      active_order_id: "7069961436340181123",
      limit_type: 0,
      active_sub_type_name: "Gia hạn",
      use_vip: true,
      have_valid_contract: true,
      derive_type_name: "VIP",
      derive_type: 1,
      in_trial_period: false,
      is_vip: true,
      membership: {
        id: "4",
        display_name: "Wink VIP",
        level: 1,
        level_name: "VIP"
      },
      active_promotion_status_list: [2],
      sub_type: 2,
      account_id: accountId,
      invalid_time: "32662195199000",
      valid_time: "1546992000000",
      active_product_id: "0",
      active_promotion_status: 2,
      show_renew_flag: true
    });

    console.log("[WinkVIP] patched " + url.split("?")[0]);
    $done({ body: JSON.stringify(obj) });
  }

  try {
    run();
  } catch (e) {
    pass();
  }
})();
