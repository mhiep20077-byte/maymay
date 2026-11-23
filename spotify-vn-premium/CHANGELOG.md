# Changelog

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
