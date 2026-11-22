/***********************************************
 * Meitu — PROBE (chỉ đọc, KHÔNG sửa gì)
 * Dùng để dò xem bản Meitu mới lấy thông tin VIP từ endpoint nào.
 * Cách dùng: bật module probe, mở app, vào tab "Tôi"/VIP, xem log Shadowrocket.
 * Thấy dòng [PROBE] ... vip_type=... tức là endpoint đó chứa dữ liệu VIP.
 ***********************************************/

var RX_VIP = /(vip|svip|premium|member|privile|entitle|subscri|trial|expire|valid_time|rights)/i;
var MAX_PATHS = 40;

var _paths = [];

function walk(node, path, depth) {
  if (!node || typeof node !== 'object' || depth > 8) return;
  var i, k, v;

  if (Array.isArray(node)) {
    for (i = 0; i < Math.min(node.length, 5); i++) walk(node[i], path + '[' + i + ']', depth + 1);
    return;
  }
  for (k in node) {
    if (!Object.prototype.hasOwnProperty.call(node, k)) continue;
    v = node[k];
    if (v !== null && typeof v === 'object') { walk(v, path + '.' + k, depth + 1); continue; }
    if (RX_VIP.test(k) && _paths.length < MAX_PATHS) {
      var sv = JSON.stringify(v);
      if (sv && sv.length > 80) sv = sv.slice(0, 80) + '…';
      _paths.push(path + '.' + k + '=' + sv);
    }
  }
}

function run() {
  var url = $request.url || '';
  var body = $response.body;
  var head = '';

  try {
    if ($response.headers) {
      var h = $response.headers;
      head = ' [' + (h['Content-Type'] || h['content-type'] || '?') + ']';
    }
  } catch (e) {}

  var info = '[PROBE] ' + url + head + ' len=' + (body ? String(body).length : 0);

  try {
    if (typeof body === 'string') {
      var t = body.trim();
      if (t.charAt(0) === '{' || t.charAt(0) === '[') {
        try {
          var obj = JSON.parse(t);
          _paths = [];
          walk(obj, '$', 0);
          if (_paths.length) info += '\n[PROBE] ' + _paths.join(' | ');
          else info += '  (json nhưng không có field vip)';
        } catch (e) {
          info += '  (json parse fail -> có thể là protobuf/binary)';
        }
      } else {
        info += '  (không phải json: ' + t.slice(0, 40).replace(/\s+/g, ' ') + ')';
      }
    }
  } catch (e) {}

  console.log(info);
  $done({});
}

try { run(); } catch (err) { $done({}); }
