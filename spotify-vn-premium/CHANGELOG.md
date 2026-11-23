# Changelog

## v2.0.0 — 2026-11-24

Sửa nguyên nhân gốc khiến v1 "cài rồi mà không thấy gì" (chi tiết + bằng chứng: `docs/CHAN-DOAN-V2.md`).

### Sửa
- **MITM host**: `*-spclient.spotify.com` → `*.spotify.com`. Wildcard giữa nhãn không khớp host nào,
  nên 91% traffic (shard `gae2-spclient`) đi thẳng và script không chạy.
- **Endpoint**: thêm `nebula/v1/configuration/attributes` và `remote-config-resolver/v3/configuration`
  — đây mới là 2 endpoint client 9.2.x thật sự gọi; `bootstrap`/`user-customization-service` chỉ còn là dự phòng.
- `scripts/spotify-request.js`: pattern bắt theo path, host nào của spotify.com cũng dính, không phụ thuộc shard.

### Thêm
- `patchAttributes()` + `patchConfiguration()`: patch field ở **gốc message** với guard strict
  (layout lạ → trả `null` → app chạy nguyên bản).
- Rule `URL-REGEX,…REJECT` cho `ads/v3`, `ad-logic`, `net-fortune`, `sponsoredplaylist`, `premium-marketing`
  (ads 9.2.x nằm chung host API nên không REJECT theo domain được).
- `spotify-vn-premium-DEBUG.module` + `scripts/debug.js`: log `status / size / kiểu body / path / 12 byte đầu`
  để biết MITM có ăn không mà không phải đoán.
- `docs/CHAN-DOAN-V2.md`: phân tích log thật 721 request + giới hạn của hướng client-side.
- 7 test mới (nebula, remote-config, guard strict, MITM wildcard, module debug, pattern vs URL thật từ log) → **30/30**.

### Không đổi
- Toàn bộ logic rewrite protobuf của bản gốc (vẫn chạy được khi host không có `TextEncoder`).

## v1.0.0 — 2026-11-24

Bản tích hợp đầu tiên, chạy được trên Shadowrocket.

### Thêm
- `spotify-vn-premium.module`: gộp script + rule + MITM trong 1 file.
- `scripts/spotify-request.js` (http-request): xoá `If-None-Match`, `If-Modified-Since`,
  ép `Cache-Control: no-cache` + `Accept-Encoding: identity` → chống 304 và body nén.
- `[Rule]` chặn `PROTOCOL,UDP` cho `spotify.com` (HTTP/3 không MITM được).
- `max-size` 8 MB (bản cũ 4 MB, body lớn bị cắt).
- `tests/test-patch.js`: 23 test offline (protobuf giả, sandbox không có TextEncoder).
- `tools/set-repo.sh`: trỏ module về raw URL của repo mày.
- `docs/HUONG-DAN-VN.md`, `docs/KY-THUAT.md`.
- `optional/spotify-ipad.module`: trick platform=ipad, tắt mặc định.

### Giữ nguyên
- Toàn bộ logic patch protobuf của bản gốc (không sửa byte nào trong phần rewrite).
