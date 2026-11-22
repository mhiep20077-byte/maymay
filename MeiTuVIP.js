/***********************************************
 * Meitu XiuXiu / Wink — VIP Unlock (rewrite v2)
 * Chạy trên: Shadowrocket / Surge / Loon / Quantumult X
 *
 * Khác bản cũ ở 3 điểm:
 *  1. KHÔNG patch mù theo URL. Chỉ sửa body khi JSON thật sự có field VIP.
 *  2. Tự dò field VIP ở MỌI độ sâu (data / data.vip_info / user.info ...),
 *     nên app đổi tên field hay đổi đường dẫn vẫn ăn.
 *  3. Không bao giờ đụng luồng ảnh (beautify / process / material / upload / cdn / video)
 *     -> đây chính là chỗ làm app báo "lỗi kết nối mạng" lúc sửa ảnh.
 *
 * DEBUG = true -> chỉ log, không sửa gì (dùng để dò endpoint trên bản app mới)
 ***********************************************/

var DEBUG = false;
var FORCE_NAME = null;        // vd "Meitu VIP" nếu muốn ép screen_name; null = để nguyên
var FAR_FUTURE = 4102444800;  // 2100-01-01
var LONG_DAYS = 36500;

var SKIP = [
  'beautify', '/process', 'material', 'upload', '/cdn',
  'template', 'sticker', '/im/', '/video', '/img',
  '.jpg', '.jpeg', '.png', '.webp', '.gif', '.mp4', '.heic',
  '/track', '/log', '/stat', '/report', 'analytics', 'advert', 'splash'
];

var RX_VIP    = /(vip|svip|premium|member|privile|entitle|subscri|trial)/i;
var RX_EXPIRE = /expire/i;
var RX_FLAG   = /^(is_?)?(vip|svip|premium|member|paid|pro)$|^vip_?(type|level|status|grade|flag|state|kind|class)$|^is_?(vip|svip|premium|member|paid|pro|valid)$/i;
var RX_DAYS   = /(expire|remain|left)_?(days?|day)$/i;
var RX_TIME   = /(expire|valid_?time|end_?time|deadline|overdue)/i;
var RX_NO_TOUCH = /(price|amount|fee|cost|money|currency|text|desc|title|tips|msg|reason|icon|url|link|img|image|color|name|code|scheme|jump|redirect|pkg)/i;

function skipUrl(u) {
  var s = String(u || '').toLowerCase();
  for (var i = 0; i < SKIP.length; i++) {
    if (s.indexOf(SKIP[i]) >= 0) return true;
  }
  return false;
}

function isNum(v) { return typeof v === 'number' && isFinite(v); }

function patchValue(key, val) {
  var kl = String(key).toLowerCase();
  if (RX_NO_TOUCH.test(kl) && !RX_FLAG.test(kl)) return val;

  if (typeof val === 'boolean') {
    return (RX_FLAG.test(kl) || RX_VIP.test(kl)) ? true : val;
  }

  if (isNum(val)) {
    if (RX_DAYS.test(kl)) return LONG_DAYS;
    if (/^is_?expired?$/i.test(kl) || /^expired$/i.test(kl)) return 0;
    if (RX_EXPIRE.test(kl) || RX_TIME.test(kl)) {
      if (val === 0) return FAR_FUTURE;
      return (val > 1e9) ? FAR_FUTURE : 0;
    }
    if (RX_FLAG.test(kl) || RX_VIP.test(kl)) return (val <= 0) ? 1 : val;
    return val;
  }

  if (typeof val === 'string' && RX_FLAG.test(kl)) {
    var low = val.toLowerCase();
    if (val === '' || val === '0' || low === 'false' || low === 'none' || low === 'null') {
      return (low === 'false' || low === 'none' || low === 'null') ? 'true' : '1';
    }
  }
  return val;
}

var _paths = [];

function walk(node, path, ctx) {
  if (node === null || typeof node !== 'object') return;
  var i, k, v;

  if (Array.isArray(node)) {
    for (i = 0; i < node.length; i++) walk(node[i], path + '[' + i + ']', ctx);
    return;
  }

  for (k in node) {
    if (!Object.prototype.hasOwnProperty.call(node, k)) continue;
    v = node[k];

    if (v !== null && typeof v === 'object') {
      walk(v, path + '.' + k, ctx);
      continue;
    }

    if (DEBUG) {
      if ((RX_VIP.test(k) || RX_EXPIRE.test(k)) && _paths.length < 80) {
        _paths.push(path + '.' + k + '=' + JSON.stringify(v));
      }
      continue;
    }

    if (k === 'screen_name') {
      if (FORCE_NAME && node[k] !== FORCE_NAME) { node[k] = FORCE_NAME; ctx.hit = true; }
      continue;
    }

    var nv = patchValue(k, v);
    if (nv !== v) { node[k] = nv; ctx.hit = true; }
  }
}

function run() {
  var body = $response.body;
  var url = $request.url || '';

  if (!body || skipUrl(url)) { $done({}); return; }

  var obj;
  if (typeof body === 'string') {
    var t = body.trim();
    if (t.charAt(0) !== '{' && t.charAt(0) !== '[') { $done({}); return; }
    try { obj = JSON.parse(t); } catch (e) { $done({}); return; }
  } else if (typeof body === 'object') {
    obj = body;
  } else {
    $done({}); return;
  }

  if (!obj || typeof obj !== 'object') { $done({}); return; }

  if (DEBUG) {
    _paths = [];
    walk(obj, '$', { hit: false });
    console.log('[MeituVIP] ' + url);
    console.log('[MeituVIP] ' + (_paths.length ? _paths.join(' | ') : '(no vip field)'));
    $done({});
    return;
  }

  var ctx = { hit: false };
  walk(obj, '$', ctx);
  if (!ctx.hit) { $done({}); return; }
  $done({ body: JSON.stringify(obj) });
}

try { run(); } catch (err) { $done({}); }
