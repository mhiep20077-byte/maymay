/***************************************************************
 * MeiTuVIP.v6.js  —  Meitu VIP L2 subscription JSON rewrite (narrow)
 *
 * Nguyen tac an toan (8 lop):
 *   1) Chi chay tren host trong ALLOW_HOSTS (mac dinh: api-sub.meitu.com)
 *   2) Loai tru path xu ly anh/tai nguyen lieu (/beautify, /process, /material, /upload, /download, /cdn)
 *      de khong lam hong upload, export va tab template
 *   3) Chi xu ly HTTP 200, bo qua binary/HTML qua Content-Type, body <= MAX_BODY
 *   4) Body khong phai JSON object/array -> $done({}) giu nguyen ban
 *   5) JSON parse fail -> $done({}) giu nguyen ban
 *   6) Khong tim thay field VIP nao -> $done({}) giu nguyen ban
 *   7) Giu nguyen kieu du lieu (int / bool / string) theo payload thuc te
 *   8) Bat ky exception nao -> $done({}) giu nguyen ban
 *
 * Pattern Shadowrocket:
 *   ^https?://api-sub\.meitu\.com/
 ***************************************************************/

var DRY = false;                                  // true = chi in log, khong sua
var ALLOW_HOSTS = ['api-sub.meitu.com'];          // [VERIFIED] chi MITM & patch host subscription
var MAX_BODY = 300000;                            // 300KB, vuot qua thi pass-through
var MAX_CHANGE = 40;                              // toi da 40 field / response
var VIP_DISPLAY_NAME = 'Minh Hiệp VIP';           // [VERIFIED] chi ghi khi object co field VIP

var NOW = Math.floor(Date.now() / 1000);
var TEN_YEARS = 315360000;

// Khong bao gio dung vao path xu ly anh/upload/tai nguyen lieu de tranh loi ket noi mang
var RX_EXCLUDE_PATH = /\/(beautify|process|material|upload|download|cdn)\b/i;

/* --- nhan dien ten field --- */
// is_expire / is_expired / isExpired [VERIFIED]
var RX_EXPIRE_FLAG = /^is_?expired?$/i;

// expire_days / expireDays [VERIFIED] (so am = long-lived)
var RX_EXPIRE_DAYS = /^expire_?days?$/i;

// is_vip / isVip / vip / vipStatus / svip_flag / member / is_member / subscriber / paid ...
var RX_BOOL = /^(is_?)?(vip|svip|member|premium|gold|paid|subscri(ber|bed))(_?(status|flag|valid|active|enabled))?$/i;

// vip_type / vipType / vip_level / memberType / user_level / privilege_level ... [VERIFIED]
var RX_NUM = /^((vip|svip|member|premium)_?(type|level|status|grade)|user_?level|privilege_?level)$/i;

// valid_time / expire_time / expireTime / expire_at / vipEndTime / validTo / deadline ... [VERIFIED]
var RX_TIME = /^(valid_?(time|to|until|end)|expire_?(time|at|date)|expired_?(time|at|date)|end_?(time|at|date)|vip_?end(_?(time|at|date))?|deadline|due_?date)$/i;

// remaining_days / leftDays / days_left / valid_days ...
var RX_DAYS = /^(remaining_?days?|left_?days?|valid_?days?|rest_?days?|remain_?days?|days_?left)$/i;

var changed = [];

function touch(path, before, after) {
  if (changed.length < MAX_CHANGE) {
    changed.push(path + ': ' + JSON.stringify(before) + ' -> ' + JSON.stringify(after));
  }
}

function walk(node, path, depth) {
  if (!node || typeof node !== 'object' || depth > 10) return;
  if (changed.length >= MAX_CHANGE) return;

  var k, v, i, lk, n, sec;

  if (Array.isArray(node)) {
    for (i = 0; i < Math.min(node.length, 30); i++) {
      walk(node[i], path + '[' + i + ']', depth + 1);
    }
    return;
  }

  var objHasVipKey = false;

  for (k in node) {
    if (!Object.prototype.hasOwnProperty.call(node, k)) continue;
    v = node[k];
    lk = String(k);

    if (v !== null && typeof v === 'object') {
      walk(v, path + '.' + lk, depth + 1);
      continue;
    }
    if (v === null) continue;

    /* 1) is_expire / is_expired -> 0 / false [VERIFIED] */
    if (RX_EXPIRE_FLAG.test(lk)) {
      objHasVipKey = true;
      if (typeof v === 'number' && v !== 0) {
        touch(path + '.' + lk, v, 0);
        if (!DRY) node[k] = 0;
      } else if (typeof v === 'boolean' && v === true) {
        touch(path + '.' + lk, v, false);
        if (!DRY) node[k] = false;
      } else if (typeof v === 'string' && (v === '1' || v === 'true')) {
        var repExp = v === 'true' ? 'false' : '0';
        touch(path + '.' + lk, v, repExp);
        if (!DRY) node[k] = repExp;
      }
      continue;
    }

    /* 2) expire_days -> -999 (long-lived) [VERIFIED] */
    if (RX_EXPIRE_DAYS.test(lk)) {
      objHasVipKey = true;
      if (typeof v === 'number' && v >= 0) {
        touch(path + '.' + lk, v, -999);
        if (!DRY) node[k] = -999;
      } else if (typeof v === 'string' && /^\d+$/.test(v)) {
        touch(path + '.' + lk, v, '-999');
        if (!DRY) node[k] = '-999';
      }
      continue;
    }

    /* 3) boolean co VIP -> true */
    if (typeof v === 'boolean' && RX_BOOL.test(lk)) {
      objHasVipKey = true;
      if (v === false) {
        touch(path + '.' + lk, v, true);
        if (!DRY) node[k] = true;
      }
      continue;
    }

    /* 4) so cap VIP (vip_type, ...) = 0 -> 1 [VERIFIED] */
    if (typeof v === 'number' && RX_NUM.test(lk)) {
      objHasVipKey = true;
      if (v <= 0) {
        touch(path + '.' + lk, v, 1);
        if (!DRY) node[k] = 1;
      }
      continue;
    }

    /* 5) string so cap VIP "0" -> "1" */
    if (typeof v === 'string' && RX_NUM.test(lk) && /^-?\d+$/.test(v)) {
      objHasVipKey = true;
      n = parseInt(v, 10);
      if (n <= 0) {
        touch(path + '.' + lk, v, '1');
        if (!DRY) node[k] = '1';
      }
      continue;
    }

    /* 6) timestamp het han (valid_time, expire_time, ...) -> +10 nam [VERIFIED] */
    if (typeof v === 'number' && RX_TIME.test(lk)) {
      objHasVipKey = true;
      if (v === 0) {
        var nv0 = NOW + TEN_YEARS;
        touch(path + '.' + lk, v, nv0);
        if (!DRY) node[k] = nv0;
      } else if (v > 1000000000) {
        sec = v > 1e12 ? Math.floor(v / 1000) : v;
        if (sec < NOW + 86400) {
          var nv = (v > 1e12) ? (NOW + TEN_YEARS) * 1000 : (NOW + TEN_YEARS);
          touch(path + '.' + lk, v, nv);
          if (!DRY) node[k] = nv;
        }
      }
      continue;
    }

    /* 7) timestamp het han dang string ("0" hoac 10/13 chu so) */
    if (typeof v === 'string' && RX_TIME.test(lk)) {
      objHasVipKey = true;
      if (v === '0' || /^\d{10}$/.test(v)) {
        if (v === '0' || parseInt(v, 10) < NOW + 86400) {
          var sv = String(NOW + TEN_YEARS);
          touch(path + '.' + lk, v, sv);
          if (!DRY) node[k] = sv;
        }
      } else if (/^\d{13}$/.test(v)) {
        if (Math.floor(parseInt(v, 10) / 1000) < NOW + 86400) {
          var svMs = String((NOW + TEN_YEARS) * 1000);
          touch(path + '.' + lk, v, svMs);
          if (!DRY) node[k] = svMs;
        }
      }
      continue;
    }

    /* 8) so ngay con lai -> 3650 */
    if (typeof v === 'number' && RX_DAYS.test(lk)) {
      objHasVipKey = true;
      if (v < 365) {
        touch(path + '.' + lk, v, 3650);
        if (!DRY) node[k] = 3650;
      }
      continue;
    }

    /* 9) string co VIP gia ("0"/"false"/"") -> "1" */
    if (typeof v === 'string' && RX_BOOL.test(lk)) {
      objHasVipKey = true;
      if (v === '0' || v === 'false' || v === '') {
        var repBool = v === 'false' ? 'true' : '1';
        touch(path + '.' + lk, v, repBool);
        if (!DRY) node[k] = repBool;
      }
    }
  }

  // Chi doi screen_name khi chinh object nay da xac nhan la payload VIP [VERIFIED]
  if (
    objHasVipKey &&
    Object.prototype.hasOwnProperty.call(node, 'screen_name') &&
    typeof node.screen_name === 'string' &&
    node.screen_name !== VIP_DISPLAY_NAME
  ) {
    touch(path + '.screen_name', node.screen_name, VIP_DISPLAY_NAME);
    if (!DRY) node.screen_name = VIP_DISPLAY_NAME;
  }
}

function pass() {
  $done({});
}

function run() {
  var url = ($request && $request.url) || '';
  var host = '';

  try {
    host = url.split('://')[1].split('/')[0].split(':')[0].toLowerCase();
  } catch (e) {
    pass(); return;
  }

  if (ALLOW_HOSTS.indexOf(host) < 0) { pass(); return; }
  if (RX_EXCLUDE_PATH.test(url)) { pass(); return; }

  var resp = $response || {};
  var st = Number(resp.statusCode || resp.status || 0);
  if (st && st !== 200) { pass(); return; }

  var headers = resp.headers || {};
  var ct = String(headers['Content-Type'] || headers['content-type'] || '');
  if (ct && !/json|javascript|text\/plain/i.test(ct)) { pass(); return; }

  var body = (typeof resp.body === 'string') ? resp.body : '';
  if (!body || body.length > MAX_BODY) { pass(); return; }

  var t = body.trim();
  if (t.charAt(0) !== '{' && t.charAt(0) !== '[') { pass(); return; }

  var obj;
  try {
    obj = JSON.parse(t);
  } catch (e) {
    pass(); return;
  }
  if (!obj || typeof obj !== 'object') { pass(); return; }

  changed = [];
  try {
    walk(obj, '$', 0);
  } catch (e) {
    pass(); return;
  }

  if (!changed.length) { pass(); return; }

  console.log('[VIP] ' + url.split('?')[0] + (DRY ? ' [DRY] ' : ' ') + changed.join(' | '));

  if (DRY) { pass(); return; }

  try {
    $done({ body: JSON.stringify(obj) });
  } catch (e) {
    pass();
  }
}

try { run(); } catch (err) { try { $done({}); } catch (e2) {} }
