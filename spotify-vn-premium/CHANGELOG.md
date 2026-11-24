# Changelog

## v2.4.0 — 2026-11-24

### Bối cảnh
v2.3 đổi badge sang **cam** và vẫn chưa mở được dòng `Rất cao` ở 2 trang Chất lượng (ảnh 1–2).
Yêu cầu mới: chữ **ToCam** nhưng viên badge **nền xanh lá như ảnh 3** (không phải xám/cam),
và cần một file bắt gói **có thông báo nổi trên máy** để lần sau khỏi đoán.

### Sửa / thêm
1. `BADGE_COLOR` mặc định `#1ED760` (xanh lá), `BADGE_TEXT_COLOR` mặc định rỗng (không đụng màu chữ);
   đặt cam bằng `$argument {"badge_color":"#FFA500"}`.
2. Màu nhận đủ 4 dạng và **giữ đúng tiền tố gốc**: `#RRGGBB`, `RRGGBB`, `rgb(r,g,b)`, `0xRRGGBB`.
3. `patchJsonAll()` áp cho mọi endpoint đã khớp pattern: `patchBadgeJson` → `clearJsonLocks` →
   `patchJsonProduct` → `setQualityJson` (đúng thứ tự, tránh clear gạt mất `isPremium` vừa bật).
4. `bitrate / max_bitrate 96|160 → 320`, `quality|streamingQuality → VERY_HIGH`.
5. Module mới `spotify-vn-capture.module` + `scripts/capture.js` + `scripts/debug.js v1.4`:
   - banner `[spot-vn] <endpoint> <grpc|json> <bytes>` + chuỗi quality/bitrate/premium/lock bên trong
   - `FREE·` khi payload còn `free`; hex 32 byte đầu của payload bên trong khung gRPC
   - dedupe 300s, `notify=false` để tắt banner, không sửa body
6. Test: **72/72** (thêm 14 case cho màu/nhãn, bitrate, cờ khoá endpoint lạ, capture notify/dedupe/module).

### Không hứa
Offline + 320 kbps thật: server cấp license theo tier. Nút Blend/Jam: nếu feed không trả thì không chèn được.


## v2.3.0 — 2026-11-24

### Bối cảnh
Sau v2.2: ads biến mất, tua được, skip không giới hạn, hàng "Gói Premium của bạn" đã thành
Premium (ảnh 3) — nhưng:

- trang Chất lượng vẫn khoá "Rất cao" (ảnh 1–2),
- viên badge vẫn là chữ **Premium** màu xanh Spotify,
- nút **Phối nhạc** (Blend) vẫn không hiện.

Yêu cầu: đổi viên badge thành chữ **ToCam** + màu **cam vàng**, còn các thứ khác giữ nguyên.

### Sửa

1. **Nhãn + màu badge (mới)** — `pam-view-service/v1/GetPremiumPlanRow` là **JSON REST**, không
   phải gRPC. v2.2 chỉ đổi giá trị `free → premium` nên viên badge vẫn lấy chữ/màu từ server.
   v2.3 ghi đè trong chính payload đó:
   - key kiểu `badge / badge_text / pill / chip / tag` với giá trị `Premium|Free` → `ToCam`
   - key kiểu `title / name / text / label / value` chỉ đổi khi giá trị đúng bằng `Premium`
     (không đụng "Spotify Free" → vẫn thành "Spotify Premium")
   - key kiểu `color / tint / background / fill` và mọi mã xanh Spotify
     (`#1ED760 #1DB954 #1FDF64 #1AA34A #158A3F #2EBD59 #30D158`) → `#FFA500` (giữ/không giữ dấu `#`
     theo giá trị gốc)
   - gRPC PAM: chuỗi đúng bằng `Premium` → `ToCam`, mã xanh → cam
   - đổi được qua `$argument`: `{"badge_text":"ToCam","badge_color":"#FFA500"}`
2. **Gạt cờ khoá premium ở playback-settings** — thêm `unlockPairs()`: cặp protobuf
   `{1: tên_khoá, 2: bool}` có tên khoá chứa `premium / lock / restrict / requires / paid /
   subscriber / upsell / entitle` mà đang `true` → `false`. Đây là phần làm chip "Premium" ở
   trang chất lượng.
3. **clientrestrictions** — trước chỉ trả message rỗng; giờ nếu server trả danh sách khoá cụ thể
   thì gạt từng cờ về `false` (giữ dữ liệu khác), JSON thì làm rỗng mảng `restrictedIntegrations`.
   Message rỗng chỉ dùng khi không có gì để gạt.
4. **DEBUG v1.3** — in thêm các chuỗi ASCII đọc được trong payload (tên field / giá trị enum) và
   hex 32 byte đầu, để lần sau chốt đúng field trong một lần thay vì đoán.
5. **Test 58/58** (`bash tools/test.sh`), gồm 7 test mới cho badge ToCam, màu cam, cờ premium_only,
   restriction JSON + gRPC.

### Không hứa
Tải offline và 320 kbps thật vẫn do server cấp theo tier (`storage-resolve … product=0`),
client không với tới. Chữ/màu badge nếu app vẽ cứng trong UI (không lấy từ payload) thì proxy
không đổi được — phải jailbreak + tweak, xem `docs/V2.3-BADGE-VA-MAU.md`.

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
