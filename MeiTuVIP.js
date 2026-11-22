/***************************************************************
 * MeiTuVIP_v5.js  —  patch quyen VIP Meitu (ban HEP)
 *
 * Nguyen tac an toan (7 lop):
 *   1) Chi chay tren host trong ALLOW_HOSTS (mac dinh: api-sub.meitu.com)
 *   2) Body khong phai JSON  -> tra nguyen ban
 *   3) JSON parse fail       -> tra nguyen ban
 *   4) Khong tim thay field VIP nao -> tra nguyen ban
 *   5) Bat ky exception nao  -> tra nguyen ban
 *   6) Chi xu ly HTTP 200, body < MAX_BODY
 *   7) DRY = true -> chi log, KHONG sua (xem truoc)
 *
 * => Khong bao gio cham CDN anh / video / template
 * => Khong con "loi ket noi mang" nhu ban v1 (max-size=-1 + meitudata.com)
 *
 * Pattern khi add script trong Shadowrocket:
 *   ^https?://api-sub\.meitu\.com/
 ***************************************************************/

var DRY = false;                                  // true = chi in log, khong sua
var ALLOW_HOSTS = ['api-sub.meitu.com'];          // them 'api.meitu.com' neu probe cho thay VIP nam o do
var MAX_BODY = 300000;                            // 300KB, qua thi bo qua
var MAX_CHANGE = 40;                              // toi da 40 field / response

var NOW = Math.floor(Date.now() / 1000);
var TEN_YEARS = 315360000;

/* --- nhan dien ten field --- */
// is_vip / isVip / vip / vipStatus / svip_flag / member / is_member / subscriber / paid ...
var RX_BOOL = /^(is_?)?(vip|svip|member|premium|gold|paid|subscri(ber|bed))(_?(status|flag|valid|active|enabled))?$/i;

// vip_type / vipType / vip_level / memberType / user_level / privilege_level ...
var RX_NUM  = /^((vip|svip|member|premium)_?(type|level|status|grade)|user_?level|privilege_?level)$/i;

// expireTime / expire_at / expiredAt / vipEndTime / endTime / validTo / deadline ...
var RX_TIME = /(expire|expired|deadline|valid_?(to|until|end)|end_?(time|at|date)|vip_?end|due_?date)/i;

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

  for (k in node) {
    if (!Object.prototype.hasOwnProperty.call(node, k)) continue;
    v = node[k];
    lk = String(k);

    // di sau vao object/array
    if (v !== null && typeof v === 'object') {
      walk(v, path + '.' + lk, depth + 1);
      continue;
    }
    if (v === null) continue;

    /* 1) boolean co VIP -> true */
    if (typeof v === 'boolean' && RX_BOOL.test(lk) && v === false) {
      touch(path + '.' + lk, v, true);
      if (!DRY) node[k] = true;
      continue;
    }

    /* 2) so cap VIP = 0 -> 1 */
    if (typeof v === 'number' && RX_NUM.test(lk) && v <= 0) {
      touch(path + '.' + lk, v, 1);
      if (!DRY) node[k] = 1;
      continue;
    }

    /* 3) string so cap VIP "0" -> "1" */
    if (typeof v === 'string' && RX_NUM.test(lk) && /^-?\d+$/.test(v)) {
      n = parseInt(v, 10);
      if (n <= 0) {
        touch(path + '.' + lk, v, '1');
        if (!DRY) node[k] = '1';
      }
      continue;
    }

    /* 4) timestamp het han (giay) -> +10 nam */
    if (typeof v === 'number' && RX_TIME.test(lk) && v > 1000000000) {
      sec = v > 1e12 ? Math.floor(v / 1000) : v;
      if (sec < NOW + 86400) {
        var nv = (v > 1e12) ? (NOW + TEN_YEARS) * 1000 : (NOW + TEN_YEARS);
        touch(path + '.' + lk, v, nv);
        if (!DRY) node[k] = nv;
      }
      continue;
    }

    /* 5) timestamp het han (string 10 so) */
    if (typeof v === 'string' && RX_TIME.test(lk) && /^\d{10}$/.test(v)) {
      if (parseInt(v, 10) < NOW + 86400) {
        var sv = String(NOW + TEN_YEARS);
        touch(path + '.' + lk, v, sv);
        if (!DRY) node[k] = sv;
      }
      continue;
    }

    /* 6) so ngay con lai -> 3650 */
    if (typeof v === 'number' && RX_DAYS.test(lk) && v < 365) {
      touch(path + '.' + lk, v, 3650);
      if (!DRY) node[k] = 3650;
      continue;
    }

    /* 7) string co VIP gia ("0"/"false"/"") -> "1" */
    if (typeof v === 'string' && RX_BOOL.test(lk) && (v === '0' || v === 'false' || v === '')) {
      touch(path + '.' + lk, v, '1');
      if (!DRY) node[k] = '1';
    }
  }
}

function pass() {
  $done({});
}

function run() {
  var url = $request.url || '';
  var host = '';

  try {
    host = url.split('://')[1].split('/')[0].split(':')[0].toLowerCase();
  } catch (e) {
    pass(); return;
  }

  if (ALLOW_HOSTS.indexOf(host) < 0) { pass(); return; }

  var resp = $response || {};
  var st = resp.statusCode || 0;
  if (st && st !== 200) { pass(); return; }

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
