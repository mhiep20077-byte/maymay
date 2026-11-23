# Changelog

## v2.2.0 — 2026-11-24

### Vì sao v2.1 không có tác dụng (bằng chứng từ log proxy thật, 550 request)

Log của client `iphone-9.2.2.2587` cho thấy:

| Endpoint | Số lần | v2.1 có bắt? |
|---|---|---|
| `pam-view-service/…/GetYourPremiumBadge` | 9 | ❌ không |
| `pam-view-service/…/GetPlanOverview` | 2 | ❌ không |
| `pam-view-service/v1/GetPremiumPlanRow?locale=vi` | 1 | ❌ không |
| `playback-settings/…/GetAllStoredContentValues` + `GetDeviceSettings` | 3 | ❌ không |
| `spotify.clientrestrictions…/GetRestrictedIntegrations` | 1 | ❌ không |
| `product-state` (endpoint v2.1 nhắm tới) | **0** | — client không còn gọi |

Nên: pattern của module không khớp → script không chạy lần nào trên 3 họ endpoint quyết định
trạng thái Premium. Đó là toàn bộ lý do "Gói của bạn: Spotify Free", badge Premium ở trang
chất lượng và nút Phối vẫn khoá.

### Sửa

1. **Bóc khung gRPC** — 3 họ endpoint trên trả `[flag][len 4B][payload]`, không phải protobuf trần.
   v2.1 gọi `parse()` lên cả khung → luôn null → không patch. Giờ tách khung, patch từng khung
   data (`0x00`), giữ nguyên byte khung trailer (`0x80`), ghép lại đúng độ dài.
2. **PAM** — `GetYourPremiumBadge` trả message tí xíu toàn varint: enum `0` = free → nâng `0 → 1`
   (chỉ khi message toàn varint ≤ 8, đúng hình dạng badge; badge khác giữ nguyên).
   Chuỗi `Spotify Free / free_tier / Spotify_Free` → `Spotify Premium`.
3. **clientrestrictions** — `GetRestrictedIntegrations` trả message rỗng = "không khoá gì"
   → nút Phối / Blend / Jam không còn bị chặn theo tier.
4. **playback-settings** — cặp `(key chứa quality/bitrate, value)` ép về `VERY_HIGH`
   ở cả `GetAllStoredContentValues` và `GetDeviceSettings`.
5. **JSON** — `GetPremiumPlanRow` (REST, `?locale=vi`) đổi literal `Spotify Free` → `Spotify Premium`
   ở bất kỳ key nào (trước đây chỉ đổi khi key tên product/plan).
6. **DEBUG v1.2** — bóc khung rồi in 16 byte đầu của payload + cờ `HAS_FREE`, thay vì in 12 byte
   đầu của cả khung (toàn số khung, vô dụng).

### Test

`51/51 PASS`. Thêm 9 test: khung gRPC 1 khung / nhiều khung / trailer nguyên byte, badge enum,
PAM string re-length, restrictions rỗng, quality pair (và không đụng setting khác),
plan-row JSON, pattern module khớp 3 họ endpoint mới.

### Vẫn không làm được (server quyết, không phải client)

- Tải offline: server cấp license theo tier thật.
- 320 kbps thật: `storage-resolve` trả file theo `product=0`, byte nhạc do server chọn.


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
