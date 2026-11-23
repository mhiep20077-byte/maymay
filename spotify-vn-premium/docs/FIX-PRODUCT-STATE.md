# Vì sao v2 đã bỏ ads / tua được mà trang Tài khoản vẫn hiện "Spotify Free"

Bản v2 giải quyết 2 nhóm khác nhau. Đừng nhầm chúng là một:

| Nhóm | Nguồn quyết định | v2 đã làm được |
|---|---|---|
| Quảng cáo, giới hạn skip, chế độ on-demand, ép shuffle | `nebula/v1/configuration/attributes` + `remote-config-resolver/v3/configuration` | ✅ ads biến mất, Next không giới hạn, tua được |
| **Tên gói hiển thị** ("Gói của bạn: Spotify Free"), badge Premium ở trang chất lượng nhạc / nút Tải xuống | **product state** — trả về qua nhiều endpoint khác nhau | ❌ v2 chưa đụng tới, v2.1 mới xử lý |

Nói cách khác: v2 làm app **cư xử** như Premium, nhưng **product state** vẫn ghi là `free`,
nên UI vẫn vẽ nhãn "Free" và vẽ ổ khoá trên các mục Premium-only.

---

## Tại sao không hard-code field number

Bản v1 đoán field number của product state và **sai** — nên "cài rồi không thấy gì".
Field number trong protobuf nội bộ của Spotify:

- đổi giữa các bản client (9.1 ≠ 9.2);
- khác nhau giữa `product-state` / `user-profile` / `login5`;
- không có trong bất kỳ schema công khai nào.

Đoán tiếp = sai tiếp. Nên v2.1 **không đoán nữa**: nó đọc **cấu trúc**.

---

## v2.1 làm gì (`patchUniversal`)

Chạy **sau** các patch chính. Endpoint nào không khớp 4 endpoint cũ thì đi thẳng vào đây.

### 1. Body là JSON
Spotify trả JSON ở `user-profile-view/v1/user`, `/me`, phần lớn endpoint account.

- Nếu key thuộc nhóm `product / product_state / product_type / product_name / plan / plan_type /
  tier / sub_tier / subscription / subscription_type / catalogue / catalog / account_type /
  account_plan / membership / pricing_plan / type` **và** giá trị đúng bằng
  `free`, `FREE`, `Free`, `free-tier`, `free_tier`, `free-tier-v2`, `spotify-free`, `spotify_free`
  → đổi thành bản Premium tương ứng (`premium` / `PREMIUM` / `Premium` / `Spotify Premium`).
- `isPremium`, `is_premium`, `product_premium`, `has_premium`, `is_subscribed`, `subscribed` = `false` → `true`.
- `ads`, `has_ads`, `show_ads`, `is_ad_supported`, `is_ad_free`… = `true` → `false`.
- Không có gì đổi → trả `null`, **không** re-encode JSON (giữ nguyên byte, tránh đổi format số).

### 2. Body là protobuf
Duyệt cả cây (sâu tối đa 8 tầng). Với mỗi field `LEN`:

- field **> 64 byte** → bỏ qua ngay. Đây là rào bảo vệ cho `access_token`, JWT, base64, hash.
- thử parse thành message con trước; parse được thì đệ quy xuống.
- không phải message → decode UTF-8, nếu giá trị nằm trong danh sách trên thì đổi, **độ dài đổi
  nên length prefix được ghi lại đúng**.

### 3. Cái gì **không** sửa
- Field `wire-type 0` (varint / enum): `product = 1` (FREE) / `2` (PREMIUM) — **không đụng**.
  Sửa bừa enum ở message không phải product state = app hiểu sai state = nhảy bài / crash.
- Field string dài > 64 byte.
- Binary không phải JSON cũng không phải protobuf parse được.
- Path media: `playplay`, `storage-resolve`, `image(s)`, `video(s)`, `audio`, `cdn` → script
  `return` ngay từ đầu, không đọc body.

---

## Vì sao vẫn có thể chưa thấy đổi: product state được **cache ở máy**

Đây là phần quan trọng nhất, đọc kỹ trước khi kết luận "module hỏng".

`SPTProductState` sau khi `login5` trả về được **lưu xuống keychain/plist** của iOS.
Các lần mở app sau, client đọc bản cache đó, **không gọi lại** endpoint product state
(hoặc gọi nhưng vẫn hiển thị từ cache trong vài chục giây đầu).

Nghĩa là: patch có thể đã đúng, nhưng UI đang vẽ từ dữ liệu **cũ nằm sẵn trong máy**.

### Cách xác nhận + reset (làm theo thứ tự, dừng ở bước nào có kết quả)

1. **Kiểm tra MITM có ăn không** (không đoán):
   cài `spotify-vn-premium-DEBUG.module` thay module chính → tắt hẳn Spotify (vuốt lên) →
   mở lại → vào **Tài khoản** → mở Shadowrocket → tab Log → lọc `spot-vn-dbg`.
   - Không có dòng nào → cert chưa Trust, hoặc Private Relay đang bật, hoặc module chưa ON.
   - Có dòng `200 … json HAS_FREE /user-profile-view/…` → MITM ăn, và **đây chính là endpoint**
     đang trả `free`. Gửi tao 3–5 dòng đó là tao chốt đúng field.

2. **Ép app lấy lại product state**:
   Spotify → Cài đặt → **Đăng xuất** → đăng nhập lại.
   Lúc này client bắt buộc đi qua `login5` + `product-state`, patch sẽ chạy trên đường đó.
   (Rủi ro thấp: tài khoản vẫn là tài khoản Free như hiện tại, không mất playlist.)

3. **Nếu vẫn Free sau khi đăng nhập lại**: gỡ Spotify rồi cài lại (xoá sạch cache + keychain entry).
   Cách này chắc chắn nhất nhưng mất dữ liệu offline — nên chỉ làm sau bước 1–2.

### Thứ tự đúng khi test
```
tắt module chính → bật DEBUG → kill Spotify → mở lại → vào Tài khoản
→ xem log spot-vn-dbg → gỡ DEBUG → bật module v2.1 → kill Spotify → mở lại
```

---

## Ba thứ phải có, thiếu cái nào cũng "cài rồi không thấy gì"

1. **Module ON** trong Shadowrocket
2. **MITM ON** + **Certificate đã Trust** trong iOS (Cài đặt → Cài đặt chung → Giới thiệu →
   Cài đặt chứng chỉ tin cậy)
3. `verbose_log=true` (tuỳ chọn nhưng nên bật khi test) — log sẽ hiện
   `spotify-vn: patched /user-profile-view/v1/user 482 -> 489B`

Xong **kill Spotify rồi mở lại**. Log Shadowrocket phải hiện `[spotify-vn] request cleaned`
(từ `spotify-request.js`) — không có dòng đó nghĩa là MITM chưa bắt được request nào.

---

## Giới hạn thật, không hứa

- **Tải offline / 320 kbps**: server cấp theo tier thật của tài khoản. Patch phía client không
  tạo ra license offline. Chọn "Rất cao" rồi tải vẫn sẽ fail ở bước xin license.
- **Badge Premium ở trang chất lượng nhạc**: v2.1 sửa product state để nhãn đổi, nhưng nếu
  Spotify vẽ badge từ `device-capabilities` (server tính theo product account) thì vẫn có thể còn.
  `device-capabilities` đã nằm trong danh sách patch; nếu vẫn còn, log DEBUG sẽ chỉ ra nó.
- Bản DNS của người khác sạch hơn vì họ là **server trả response** (DNS + root CA riêng), muốn
  mức đó phải có VPS. Repo này là mức cao nhất làm **hoàn toàn trên máy**.
