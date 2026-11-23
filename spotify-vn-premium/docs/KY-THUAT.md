# Kỹ thuật: module này patch cái gì

Tài liệu để **bảo trì** khi Spotify đổi schema. Không cần đọc nếu chỉ muốn cài.

---

## 1. Luồng request

```
Spotify app
  └── GET https://<region>-spclient.spotify.com/bootstrap/v1/bootstrap      (protobuf)
  └── GET https://<region>-spclient.spotify.com/user-customization-service/v1/customize
        │
        ├─ [Rule]      chặn UDP/QUIC cho *.spotify.com  ← bắt buộc, không thì HTTP/3 đi xuyên
        ├─ [Script 1]  http-request  → xoá If-None-Match / If-Modified-Since
        │                              (chống 304, 304 = không body = không patch được)
        └─ [Script 2]  http-response → decode protobuf, sửa field, encode lại, $done({body})
```

Hai script **phải cùng pattern**. Script 1 chạy trước, script 2 chạy sau khi có body.

---

## 2. Layout protobuf (theo field number)

```
BootstrapMessage
  2: { 1: { 1: CustomizeMessage { 1: UcsResponse } } }      ← patchBootstrap đi path [2,1,1,1]
CustomizeMessage
  1: UcsResponse                                            ← patchCustomize đi path [1]
UcsResponse
  1: ResolveResponse
       1: ResolveConfiguration
            3: AssignedValue { 1: {1: scope, 2: name}, 3: BoolValue{1}, 5: EnumValue{1} }
  3: AccountAttributesResponse
       (map) 1: { 1: key(string), 2: AccountAttribute { 2: bool | 3: long | 4: string } }
```

Khi Spotify đổi field number, sửa ở 2 chỗ cuối file `scripts/spotify-premium.js`:

```js
const patchCustomize = (b) => edit(b, [1], patchUcs);
const patchBootstrap = (b) => edit(b, [2, 1, 1, 1], patchUcs);
```

Script tự thử `bootstrap` trước hay `customize` trước tuỳ URL, có fallback — nếu path sai thì
nó `$done({})` và app chạy bình thường (không phá app), đó là lý do module "im lặng" chứ không
làm app crash.

---

## 3. Attribute được set cứng (ATTR_CORE)

| Key | Giá trị | Tác dụng |
|---|---|---|
| `catalogue` / `type` | `premium` | app coi là premium |
| `player-license` / `player-license-v2` | `premium` | mở khoá phát nhạc |
| `unrestricted` / `on-demand` | true | chọn bài tuỳ ý |
| `shuffle-eligible` | true | bỏ ép shuffle |
| `high-bitrate` | true | **chỉ là cờ client**, server vẫn cấp theo tier |
| `product-expiry` / `subscription-enddate` | now + 365d | tránh bị coi là hết hạn |
| `ads` | false | tắt cờ quảng cáo |

Attribute bị **xoá** (STRIPPED) — quan trọng nhất là `payment-state`:
đây là field làm app gọi lại server để kiểm tra thanh toán → nhận "free" → rớt toàn bộ patch.
Xoá nó = app không có lý do để hỏi lại.

---

## 4. Remote config (rule)

`RULES` là danh sách `[scope, name, action, value, enumText, group]`:

- `action = 0` → xoá AssignedValue (dùng cho cờ ads/cap)
- `action = 1` → sửa BoolValue nếu đã có
- `action = 2` → **luôn** set BoolValue, kể cả khi chưa có (thêm mới)
- `action = 3` → set EnumValue (ví dụ `playback_timeout_action = "Nothing"`)

`group` là `ad` / `cap` / `misc` — để bật/tắt theo `$argument` nếu sau này cần.
Khoảng 240 rule, phần lớn là tắt ads ở mọi surface (home / search / artist / album / playlist /
now-playing / audiobook / banner / interstitial / upsell).

Muốn tắt ads ở surface mới: thêm 1 dòng `["", "enable_xxx_ad", 1, 0, "", "ad"]`.

---

## 5. Vì sao không có offline / 320 kbps

| Tính năng | Ai quyết | Vì sao không patch được |
|---|---|---|
| Download offline | server | file audio tải về được mã hoá theo quyền account; server không cấp URL cho free |
| 320 kbps / Very High | server | server chọn bitrate theo tier khi trả stream URL (khác nhau về `file_id`/format) |
| Premium trên web / máy khác | server | mỗi client tự xác thực với server |
| "Premium" trong Account | server | app hiển thị từ dữ liệu server, không phải từ protobuf này |

Patch client chỉ đổi **những gì app tự quyết**: ẩn ads flag, cho phép UI mở khoá, bỏ giới hạn
skip do app đếm. Cái gì server đếm thì thua.

---

## 6. Khi Spotify update làm module chết

Thứ tự kiểm tra:

1. **Log còn `[spotify-vn]` không?** Không còn → request không bị bắt (endpoint đổi / QUIC lọt).
2. **Có log nhưng app không đổi** → protobuf đổi field number, hoặc Spotify thêm attribute mới
   mà app đọc thay cho `catalogue`.
3. Cách tìm: bật HTTP Logger, lưu response `/bootstrap` (binary), rồi:
   ```bash
   node -e 'const fs=require("fs");const b=fs.readFileSync("boot.bin");console.log(b.subarray(0,64).toString("hex"))'
   ```
   Decode bằng `protoc --decode_raw < boot.bin` để xem cây field thật.
4. So với layout ở mục 2, sửa path hoặc thêm attribute, chạy `bash tools/test.sh` lại.

---

## 7. Test offline hoạt động thế nào

`tests/test-patch.js`:

- Dựng `BootstrapMessage` / `CustomizeMessage` / `UcsResponse` bằng tay (có cả field lạ để kiểm tra
  không bị mất).
- Chạy script trong `vm` context chỉ có `$request`, `$response`, `$done`, **không có**
  `TextEncoder`/`TextDecoder` → ép đi qua polyfill đúng như Shadowrocket.
- Decode output ra map, assert từng key/value.
- Có case đối chứng: chạy lại với `TextEncoder` thật, so hex phải giống 100%.
- Có case "phải bỏ qua": 304, body rác, body rỗng, protobuf cụt → không được trả body mới.

Cái test này không chứng minh Spotify thật sẽ chấp nhận — nó chỉ chứng minh **script không
làm hỏng dữ liệu và patch đúng chỗ**. Bước xác nhận cuối vẫn là máy thật (`docs/HUONG-DAN-VN.md`).
