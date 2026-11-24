# spotify-vn-premium

Module **Shadowrocket (小火箭)** gộp: bỏ quảng cáo + mở khoá Premium **phía máy** cho Spotify,
đóng gói để chạy ổn định trên mạng VN (chặn QUIC, chống 304, patch protobuf tại chỗ).

> Đây là bản **tích hợp** từ 2 nguồn: script rewrite protobuf của `xzavier-amico` / `lyc-000001`
> (script còn sống, chạy được) + phần chống 304 / chặn HTTP/3 mà bản đó thiếu.
> Logic patch giữ nguyên gốc — tao chỉ thêm phần hạ tầng và test để biết nó thật sự chạy.

![test](https://img.shields.io/badge/test-72%2F72%20pass-brightgreen)

---

## 1. Kết quả kiểm tra (offline, không cần Spotify)

```
bash tools/test.sh
→ PASS: 72    FAIL: 0
```

Test dựng protobuf giả đúng layout thật của Spotify rồi decode kết quả ra so từng field, gồm:

- `catalogue` / `type` / `player-license` → `premium`
- `ads` → `false`, `payment-state` bị xoá (đây là field làm app "rớt về free")
- remote config: bật crossfade/automix, xoá rule ad & free on-demand
- field lạ và thứ tự field còn nguyên (không làm app nhảy bài)
- 304 / body rác / body cụt → **không** trả body hỏng (bỏ qua an toàn)
- script chạy được cả khi host **không có `TextEncoder`** (đúng kiểu Shadowrocket)
- module: `script-path` trỏ đúng file, regex hợp lệ, có rule chặn UDP

### v2.0.0 — sửa lỗi "cài rồi mà không thấy gì"
Bản 9.2.x không còn gọi `bootstrap`: 91% API đi qua shard `gae2-spclient.spotify.com`, endpoint thật là
`nebula/v1/configuration/attributes` + `remote-config-resolver/v3/configuration`.
v1 vừa dùng wildcard MITM sai (`*-spclient…`) vừa nhắm sai endpoint → patch không chạy byte nào.
v2 sửa cả hai + thêm rule chặn quảng cáo theo URL. Đọc `docs/CHAN-DOAN-V2.md` trước khi test.


### v2.4.0 — badge ToCam nền xanh (như ảnh 3), chất lượng mọi endpoint, module capture có thông báo

- Nhãn badge `Premium → ToCam`, **giữ nền xanh lá** `#1ED760` (v2.3 đổi sang cam). Đổi màu bằng
  `$argument`: `{"badge_color":"#FFA500","badge_text_color":"#121212"}`.
- `patchJsonAll()` chạy cho **mọi** endpoint (product-state / user-profile / device-capabilities /
  remote-config / login5…): gạt cờ khoá → bật `isPremium` → ép `quality=VERY_HIGH`, `bitrate 96/160→320`.
- Module mới `spotify-vn-capture.module` + `scripts/capture.js`: mỗi response khớp pattern nổi
  **thông báo** trên máy, in endpoint + các chuỗi `quality/bitrate/premium/lock` bên trong payload,
  có `FREE·` khi payload còn `free`. Khử trùng lặp 300s, không sửa body.
- Test: **72/72**. Chi tiết + giới hạn: `docs/V2.4-CHAT-LUONG-VA-CAPTURE.md`.

### v2.3.0 — badge ToCam + cam vàng, mở khoá chip chất lượng

`GetPremiumPlanRow` là JSON REST: v2.3 ghi đè nhãn (`Premium → ToCam`) và mọi mã xanh Spotify
(`#1ED760 …`) thành `#FFA500` ngay trong payload; gRPC PAM cũng đổi chuỗi `Premium → ToCam`.
Thêm `unlockPairs()` gạt các cờ `premium_only / locked / restricted / requires_*` về `false` ở
`playback-settings`, và `clientrestrictions` giờ gạt từng cờ thay vì xoá cả body.
Chi tiết + giới hạn: `docs/V2.3-BADGE-VA-MAU.md`.

### v2.2.0 — vì sao v2.1 vẫn Free (đã chốt bằng log thật)

Log proxy 550 request của client 9.2.2 cho thấy state Premium đi qua **3 họ endpoint v2.1 không bắt**:
`pam-view-service` (`GetYourPremiumBadge` 9×, `GetPlanOverview` 2×, `GetPremiumPlanRow` 1×),
`playback-settings` (8×) và `clientrestrictions/GetRestrictedIntegrations` (1×).
`product-state` — endpoint v2.1 nhắm tới — **không được gọi lần nào**.

Thêm nữa 3 họ đó trả **gRPC khung 5 byte**, không phải protobuf trần → v2.1 parse null → không patch.

v2.2 bóc khung gRPC, patch từng khung data, giữ nguyên trailer, rồi:
nâng enum badge `0→1`, đổi `Spotify Free → Spotify Premium`, trả message rỗng cho
`GetRestrictedIntegrations` (hết khoá Phối/Blend/Jam), ép chất lượng về `VERY_HIGH`.
Chi tiết: `docs/V2.2-PAM-EVIDENCE.md`.

### v2.1.0 — trang Tài khoản vẫn hiện "Spotify Free"
Ads / skip / on-demand đã xong ở v2, nhưng **tên gói** và **badge Premium** đọc từ **product state**,
thứ v2 chưa đụng tới. v2.1 không đoán field number nữa (v1 đã đoán sai 1 lần) mà quét cấu trúc:
JSON thì đổi theo tên key, protobuf thì duyệt cả cây và đổi string ngắn đúng bằng `free` → `premium`.
Field > 64 byte (token/JWT) và field varint/enum **không bị đụng**.
Đọc `docs/FIX-PRODUCT-STATE.md` — trong đó có cả phần **product state bị cache ở keychain**,
là lý do phổ biến nhất khiến "cài rồi vẫn thấy Free".

Cái này **không** thay được test trên máy thật — xem `docs/HUONG-DAN-VN.md`.

---

## 2. Cấu trúc

```
spotify-vn-premium/
├── spotify-vn-premium.module     # module chính (dán URL này vào Shadowrocket)
├── spotify-vn-premium-DEBUG.module  # module chẩn đoán: chỉ in log, không sửa gì
├── scripts/
│   ├── spotify-premium.js        # http-response: patch nebula / remote-config / bootstrap / UCS
│   │                             #   + product state (JSON & protobuf, không phụ thuộc tên field)
│   ├── spotify-request.js        # http-request: bỏ If-None-Match, ép no-cache
│   └── debug.js                  # in log từng response MITM bắt được
├── optional/
│   ├── spotify-ipad.module       # TÙY CHỌN: trick platform=ipad (list track đầy đủ)
│   └── spotify-ipad.js
├── tools/
│   ├── set-repo.sh               # trỏ module về repo GitHub của mày
│   └── test.sh
├── tests/test-patch.js           # 42 test offline
├── docs/
│   ├── HUONG-DAN-VN.md           # test trên máy thật ở VN, checklist từng bước
│   ├── CHAN-DOAN-V2.md           # vì sao v1 không chạy + bằng chứng từ log thật + giới hạn
│   ├── FIX-PRODUCT-STATE.md      # vì sao v2 bỏ ads mà vẫn hiện "Spotify Free" + cách reset cache
│   └── KY-THUAT.md               # patch cái gì, tại sao, khi Spotify đổi thì sửa ở đâu
├── README.md
├── CHANGELOG.md
└── CREDITS.md
```

---

## 3. Push lên git + cài (5 bước)

```bash
cd spotify-vn-premium

# 1) trỏ module về repo của mày (thay user/repo/branch)
bash tools/set-repo.sh <github-user> <repo> main

# 2) test lại cho chắc (phải 51/51)
bash tools/test.sh

# 3) tạo repo trên GitHub rồi push
git init
git add -A
git commit -m "spotify vn premium module"
git branch -M main
git remote add origin https://github.com/<github-user>/<repo>.git
git push -u origin main
```

4) Lấy URL in ra ở bước 1, dạng:

```
https://raw.githubusercontent.com/<user>/<repo>/main/spotify-vn-premium.module
```

5) Trên iPhone: **Shadowrocket → Cấu hình → Module → dấu + → dán URL → tải về → bật module**.

> Repo **private** thì raw URL không tải được. Để public, hoặc dùng jsDelivr / Gist raw.
> Không có bash/Node trên máy? Mở `spotify-vn-premium.module` bằng text editor, thay **tất cả**
> `__RAW_BASE__` bằng base URL của mày (dạng `https://raw.githubusercontent.com/user/repo/main`).

---

## 4. Trước khi nó chạy, phải có 3 thứ

| # | Việc | Ở đâu |
|---|---|---|
| 1 | Module ở trạng thái **ON** | Shadowrocket → Module |
| 2 | **MITM** bật + hostname có `*-spclient.spotify.com`, `spclient.wg.spotify.com` | module tự `%APPEND%`, nhưng kiểm tra lại ở trang chủ app |
| 3 | **Certificate** đã cài + **Trust** trong iOS | Cài đặt → Cài đặt chung → Giới thiệu → Cài đặt chứng chỉ → Trust Settings |

Thiếu 1 trong 3 → module "cài rồi mà không có gì xảy ra". Đây là lỗi số 1 của mọi người.

Xong thì **kill Spotify** (vuốt khỏi app switcher), mở lại. Module chỉ có tác dụng từ lần
request đầu tiên sau khi mở app.

---

## 5. Được gì / không được gì

| Tính năng | Kết quả | Ghi chú |
|---|---|---|
| Bỏ ads audio + banner | ✅ | ads còn lại thì do cache, kill app |
| Skip không giới hạn | ✅ | acc free bị giới hạn 6 skip/giờ → patch bỏ |
| Chọn bài tuỳ ý (on-demand) | ✅ | hết bị ép shuffle |
| Bỏ ép shuffle khi bấm play playlist | ✅ | |
| Crossfade / automix | ✅ | bật trong remote config |
| Danh sách track album/artist đầy đủ | ⚠️ | tuỳ build; thử `optional/spotify-ipad.module` |
| **Tải offline** | ❌ | server quyết, client không với tới |
| **320 kbps / Very High** | ❌ | server cấp theo tier → **đừng set Very High**, set xong có bài không phát được |
| Premium thật (web, máy khác, account page) | ❌ | chỉ máy này, chỉ app này |
| Lyrics, podcast, mọi thứ khác | giữ nguyên | module không đụng endpoint khác |

Nói thẳng: **đây không phải Premium thật**. Nó lừa app ở tầng protobuf. Spotify đổi schema
hoặc bật kiểm tra server-side là tắt. Dùng cá nhân, đừng mua bán key/module.

---

## 6. Vì sao bản này khác bản cũ

| Vấn đề của module cũ | Bản này |
|---|---|
| Không chặn QUIC → app đi HTTP/3 → **MITM không thấy gì** | `[Rule]` chặn `PROTOCOL,UDP` cho `spotify.com` |
| Server trả **304** → không có body → script bỏ qua → "lúc được lúc không" | `http-request` script xoá `If-None-Match` / `If-Modified-Since` |
| Response bị gzip → protobuf không đọc được | ép `Accept-Encoding: identity` |
| Body vào qua `bodyBytes` thay vì `body` | đã normalize trong script |
| Thiếu `TextEncoder` → script chết ngay dòng đầu | polyfill UTF-8 trong script |
| `max-size` 4 MB, body lớn bị cắt | nâng 8 MB |

---

## 7. Sửa nhanh khi không ăn

| Triệu chứng | Kiểm tra |
|---|---|
| Không có gì thay đổi | Module ON? MITM ON? Cert đã Trust? Đã kill app? |
| Ads vẫn còn | Nghe 3 bài liên tiếp xem còn ads audio không; xoá app cache bằng cách kill app |
| Vẫn bị giới hạn skip | Mở **Settings → xem tài khoản**: nếu vẫn hiện Free thì bình thường, kiểm tra lại log script |
| Muốn biết script có chạy | Shadowrocket → Log / Script log, tìm `[spotify-vn]` |
| Bài bị nhảy giữa chừng | Thường do set Very High; hạ về Automatic |
| Spotify **không load / không phát được gì** sau khi bật module | Mở module, tạm xoá dòng `SpotifyVN Request` trong `[Script]` → nếu hết lỗi thì host không nhận sửa header; báo tao để đổi cách |
| Toàn bộ im lặng sau khi Spotify update | Spotify đổi schema → xem `docs/KY-THUAT.md` |

**Tắt khẩn cấp:** chỉ cần tắt module trong Shadowrocket là app về bình thường ngay,
không có gì bị ghi vào máy, không cần xoá cert.

---

## 8. Credit

- Logic rewrite protobuf gốc: **xzavier-amico** (plugin Loon) — build Shadowrocket: **lyc-000001**
- Đóng gói, phần chống 304/QUIC, test: repo này

Xem `CREDITS.md`. Dùng cho mục đích cá nhân.
