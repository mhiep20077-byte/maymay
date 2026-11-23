# Changelog

## v2.1.0 — 2026-11-24

Trả lời đúng 3 thứ còn thiếu sau v2 (ads/skip/on-demand đã OK):

1. Trang **Tài khoản** vẫn hiện "Gói của bạn: Spotify Free" (ảnh 2, 7)
2. Trang **chất lượng nhạc** vẫn có badge Premium ở "Rất cao" (ảnh 1)
3. Trang **Tải xuống** vẫn có badge Premium, nút **Phối** bị khoá (ảnh 3, 4)

### Nguyên nhân
Cả 3 đều đọc từ **product state** — không nằm ở 4 endpoint cũ. Mà product state được trả về
qua nhiều endpoint khác nhau (`product-state`, `user-profile`, `account`, `login5`, `bootstrap`…),
đổi tên field giữa các bản client, và **field number không đoán được** (v1 đã đoán sai 1 lần).

### Cách sửa: bỏ đoán field, quét cấu trúc
`patchUniversal()` mới, chạy sau các patch chính:

- Body là **JSON** → đổi giá trị của key `product / product_state / plan / tier / subscription /
  catalogue / account_type / type / membership…` khi giá trị ∈ {free, FREE, Free, free-tier,
  free_tier, spotify-free, spotify_free} → bản Premium tương ứng giữ đúng kiểu chữ.
  `isPremium/is_premium/is_premium_user/has_premium/is_subscribed…` = `false` → `true`.
  `ads/has_ads/show_ads/is_ad_supported…` = `true` → `false`.
- Body là **protobuf** → duyệt cả cây (sâu ≤ 8), field LEN nào là string ≤ 64 byte và đúng
  bằng một trong các giá trị trên → đổi (độ dài đổi nên length prefix được ghi lại).
- **Bảo vệ**: field > 64 byte bị bỏ qua (access_token / JWT / base64 / hash không bao giờ bị đụng),
  field wire-type 0 (varint/enum) **không sửa** — sửa bừa enum là app nhảy bài / crash.
- Không nhận ra → trả `null` → `$done({})` → app chạy nguyên bản.

### Thêm
- Module pattern mở rộng: `product-state`, `product_state`, `product/`, `user-profile`, `user_profile`,
  `profile`, `account`, `device-capabilities`, `login5`, `v3/login`, `subscription`, `attributes`,
  `catalogue`, `premium`, `checkout`, `payment`, `me`.
- Script **bỏ qua ngay** các path media (`playplay`, `storage-resolve`, `image(s)`, `video(s)`, `audio`, `cdn`)
  — không quét body lớn, không có nguy cơ sửa manifest playplay.
- Module DEBUG: pattern mở rộng theo, `debug.js` v1.1 in thêm **đoạn đầu JSON** (đã che token)
  và cờ **`HAS_FREE`** — nhìn log là biết ngay endpoint nào còn trả "free".
- `verbose_log`: log có thêm path, ví dụ
  `spotify-vn: patched /user-profile-view/v1/user 482 -> 489B`.
- 12 test mới (JSON product/flag/ads/không-sửa-bừa, protobuf string/FREE/Free/token dài/lồng sâu,
  binary lạ, endpoint media, pattern khớp endpoint thật) → **42/42 PASS**.

### Không đổi
- Toàn bộ logic patch 4 endpoint gốc + rewrite protobuf bản gốc.
- Rule chặn ads, QUIC/UDP, `spotify-request.js`.

### Vẫn không làm được (server quyết, không phải client)
- Tải offline, 320 kbps (server cấp theo tier thật).
- Nếu sau khi cài vẫn hiện Free: xem `docs/HUONG-DAN-VN.md` mục "vẫn hiện Free".

## v2.0.1 — 2026-11-24

Chỉ sửa **bộ test**, module không đổi → cài lại module không cần thiết.

### Sửa
- `tests/test-patch.js`: test `[7]` chỉ strip domain khi đọc `script-path`, nên sau khi chạy
  `tools/set-repo.sh` (script-path thành URL raw thật) nó báo `FAIL: debug.js không tồn tại` **oan**.
  Giờ strip tới `scripts/` / `optional/`. Đã chạy lại: **30/30 PASS cả trước và sau `set-repo`**.

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
