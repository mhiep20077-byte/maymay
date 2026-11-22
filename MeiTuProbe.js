/***************************************************************
 * MeiTuProbe_v5.js  —  CHI GHI LOG, KHONG SUA GI
 *
 * Muc dich: tim dung endpoint chua du lieu VIP tren Meitu 12.23.5
 * An toan: $done({}) o moi nhanh -> khong bao gio lam hong response
 *
 * Pattern (o regex khi add script trong Shadowrocket):
 *   ^https?://api-sub\.meitu\.com/
 *
 * Xem log o: Shadowrocket -> tab Script / Log, hoac Log -> Script Log
 ***************************************************************/

var RX_VIP = /(vip|svip|premium|member|privile|entitle|subscri|trial|expire|valid_?time|rights|gold|benefit|pay|order)/i;
var MAX_FIELDS = 25;
var MAX_BODY = 400000;

function walk(node, path, depth, out) {
  if (!node || typeof node !== 'object' || depth > 8 || out.length >= MAX_FIELDS) return;
  var k, v, i;

  if (Array.isArray(node)) {
    for (i = 0; i < Math.min(node.length, 4) && out.length < MAX_FIELDS; i++) {
      walk(node[i], path + '[' + i + ']', depth + 1, out);
    }
    return;
  }

  for (k in node) {
    if (!Object.prototype.hasOwnProperty.call(node, k)) continue;
    v = node[k];

    if (v !== null && typeof v === 'object') {
      walk(v, path + '.' + k, depth + 1, out);
      continue;
    }

    if (RX_VIP.test(k) && out.length < MAX_FIELDS) {
      var sv = '';
      try { sv = JSON.stringify(v); } catch (e) { sv = String(v); }
      if (sv && sv.length > 60) sv = sv.slice(0, 60) + '...';
      out.push(path + '.' + k + '=' + sv);
    }
  }
}

function run() {
  var url = $request.url || '';
  var host = '';
  var path = '';

  try {
    var m = url.match(/^https?:\/\/([^\/]+)(\/[^?#]*)?/);
    if (m) { host = m[1]; path = m[2] || '/'; }
  } catch (e) {}

  var resp = $response || {};
  var body = (typeof resp.body === 'string') ? resp.body : '';
  var st = resp.statusCode || 0;
  var info = '[PROBE] ' + host + path + ' st=' + st + ' len=' + body.length;

  try {
    if (body && body.length <= MAX_BODY) {
      var t = body.trim();
      if (t.charAt(0) === '{' || t.charAt(0) === '[') {
        var obj = null;
        try { obj = JSON.parse(t); } catch (e) { obj = null; }

        if (obj) {
          var out = [];
          walk(obj, '$', 0, out);
          info += out.length ? ('\n[PROBE] ' + out.join(' | ')) : '  (json, khong co field vip)';
        } else {
          info += '  (json parse fail -> protobuf/binary)';
        }
      } else {
        info += '  (not-json: ' + t.slice(0, 30).replace(/\s+/g, ' ') + ')';
      }
    } else if (body) {
      info += '  (body qua lon, bo qua)';
    }
  } catch (e) {}

  console.log(info);
  $done({});
}

try { run(); } catch (err) { try { $done({}); } catch (e2) {} }
