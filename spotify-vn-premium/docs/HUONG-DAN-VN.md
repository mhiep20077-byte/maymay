# Test trên máy thật ở Việt Nam

Mục tiêu: biết chắc module chạy với **tài khoản Spotify VN** (acc free) trên iPhone thật,
không phải chỉ tin vào test offline.

Chuẩn bị:

- iPhone đã cài Shadowrocket, có cert + đã Trust
- 1 acc Spotify **Free** (acc VN là tốt nhất — đúng thứ mày muốn kiểm tra)
- Repo đã push, đã có URL `.module`

---

## Bước -1 (v2) — Nếu đã cài bản cũ mà "không thấy gì"

Bản v1 không chạy được trên Spotify 9.2.x. Nguyên nhân + bằng chứng: `docs/CHAN-DOAN-V2.md`.
Tóm tắt: MITM dùng `*-spclient.spotify.com` (wildcard giữa nhãn → không khớp host nào) và script
chỉ patch `bootstrap` (client mới không gọi nữa).

Làm theo thứ tự:

1. **Xác nhận MITM có ăn không** — cài `spotify-vn-premium-DEBUG.module`, bật MITM, kill Spotify, mở lại, vào 1 artist.
   Mở Shadowrocket → Log, lọc `spot-vn-dbg`.
   - Không có dòng nào → MITM chưa ăn (sai cert / module OFF / Private Relay) → chưa cần sửa script.
   - Có dòng `200 … /nebula/…` → MITM ok, sang bước 2.
2. Gỡ module DEBUG, cài `spotify-vn-premium.module` (bản v2).
3. Kill Spotify (vuốt khỏi app switcher), mở lại, đợi 10 giây, rồi kiểm tra checklist bước 0.
4. Log phải có dòng `[spotify-vn] … -> … bytes` khi mở app / mở artist.

Nếu v2 vẫn chưa đủ: gửi lại các dòng `spot-vn-dbg` của `nebula`, `remote-config-resolver`,
`device-capabilities`. Có status + size + 12 byte đầu là đủ để sửa đúng field.

---

## Bước 0 — Trước khi cài: ghi lại "trạng thái free" để so

Trước khi bật module, làm đúng mấy việc này và **chụp màn hình**:

1. Mở 1 playlist bất kỳ (playlist của Spotify, không phải của mày) → bấm **Play**
   → nếu nó **shuffle** thay vì phát bài đầu tiên = đang free.
2. Bấm **Next** liên tục 7 lần → free sẽ bị chặn ở lần thứ 6 ("Bạn đã đạt giới hạn skip").
3. Nghe hết 2–3 bài → giữa các bài có **quảng cáo audio**.
4. Vào Settings → Account: ghi lại đang hiện **Free**.

Đây là mốc so sánh. Không có mốc này thì không biết module có tác dụng hay không.

---

## Bước 1 — Bật module

1. Shadowrocket → **Module** → dán URL `.../spotify-vn-premium.module` → tải về
2. Bật module (ON)
3. Vào trang chủ Shadowrocket → **MITM** phải ON
4. Kiểm tra hostname MITM có 2 dòng:
   ```
   *-spclient.spotify.com
   spclient.wg.spotify.com
   ```
5. **Kill Spotify** hoàn toàn (vuốt khỏi app switcher) → mở lại

---

## Bước 2 — Xác nhận script có chạy

Vào Shadowrocket → **Log** (hoặc tab Script → log). Mở Spotify, bấm play 1 bài.
Nếu thấy dòng:

```
[spotify-vn] request cleaned: if-none-match, accept-encoding
```

→ script request đã chạy. Nếu **không** thấy dòng nào:

- module chưa ON, hoặc
- MITM chưa bật / cert chưa trust, hoặc
- app đang đi HTTP/3 (kiểm tra rule chặn UDP có trong module), hoặc
- Spotify đang dùng endpoint khác (xem mục "Khi không thấy log" bên dưới)

---

## Bước 3 — Checklist kết quả (làm đúng thứ tự)

| # | Thao tác | Trước (free) | Sau (module ON) | Ghi |
|---|---|---|---|---|
| 1 | Bấm Play playlist Spotify | bị shuffle | phát từ bài đầu | ☐ |
| 2 | Bấm Next 10 lần | chặn ở ~lần 6 | qua hết 10 | ☐ |
| 3 | Nghe 2 bài liền | có ads audio | không ads | ☐ |
| 4 | Mở Home | có banner "Nâng cấp Premium" | banner biến mất / giảm | ☐ |
| 5 | Bấm vào 1 bài bất kỳ trong album | có thể bị chặn / phát preview | phát full | ☐ |
| 6 | Mở album → xem danh sách track | có thể bị rút gọn | đầy đủ (thử `optional/`) | ☐ |
| 7 | Settings → Account | Free | vẫn Free (bình thường) | ☐ |

Điểm 7 rất quan trọng: **account vẫn hiện Free là đúng**. Module không sửa server,
nó chỉ làm app hành xử như premium. Ai nói "phải hiện Premium" là hiểu sai.

---

## Bước 4 — Những thứ phải FAIL (đừng tưởng module hỏng)

Thử mấy cái này, nếu nó **không** hoạt động thì module đang đúng:

- **Tải offline**: bấm download 1 album → vẫn báo cần Premium.
- **Very High quality**: Settings → Audio quality → Very High → vẫn bị giới hạn, hoặc bài không phát.
- **Mở web spotify.com trên máy tính**: vẫn Free, vẫn ads.

Đó là giới hạn server, không phải lỗi module.

---

## Đặc thù Spotify Việt Nam

- Acc VN và acc US/EU dùng **cùng endpoint** `*-spclient.spotify.com` → module không phân biệt
  vùng, nên chạy ở VN giống hệt nơi khác. Không cần VPN.
- Quảng cáo audio ở VN đôi khi là file MP3 từ CDN riêng. Nếu ads audio vẫn còn sau khi patch
  flag, đó là ads **server chèn vào stream** (không phải flag client) → không chặn được bằng
  module này. Kiểm tra: nếu ads hết sau khi nghe 2–3 bài thì là flag đã ăn; nếu bài nào cũng có
  ads đúng 30s thì là server-side.
- Nhạc VN có nhiều bài "exclusive" chỉ phát khi Premium thật → những bài đó vẫn có thể bị
  chặn/preview. Không có cách client-side.
- Mạng 4G VN (Viettel/Vina/Mobi) hay có CGNAT + DNS riêng: nếu Shadowrocket dùng DNS của nhà
  mạng, MITM vẫn chạy bình thường, nhưng nếu bật "DNS over HTTPS" trong Shadowrocket thì
  kiểm tra lại xem traffic có đi qua proxy không.
- Nếu máy bật **iCloud Private Relay** → tắt đi, nó đẩy traffic ra ngoài tunnel của Shadowrocket
  và module sẽ không thấy request.

---

## Khi không thấy log `[spotify-vn]`

1. Mở Shadowrocket → Tool → **HTTP Logger** (nếu có), xem có request tới `*spclient.spotify.com`
   không. Không có request nào = app đi HTTP/3 → kiểm tra rule `PROTOCOL,UDP`.
2. Thử tắt "Private Relay", tắt "Limit IP Address Tracking" trong Wi-Fi.
3. Thử trên Wi-Fi thay vì 4G (một số nhà mạng chặn/sửa TLS).
4. Thử module với 1 host khác (mở Safari vào https://spclient.wg.spotify.com/bootstrap/v1/bootstrap
   → phải trả 401 JSON, chứng tỏ MITM đang giải mã được host này).
5. Spotify đổi endpoint: mở HTTP Logger, tìm request trả về protobuf khi mở app, xem path thật
   rồi thêm vào `pattern` của module.

---

## Cách thu bằng chứng để so sánh / báo lỗi

Khi test, ghi lại:

- iOS version, Spotify version (Settings → About trong app)
- Mạng: Wi-Fi / 4G nhà mạng nào
- Log Shadowrocket (copy mấy dòng `[spotify-vn]`)
- Ảnh chụp 4 mục trong checklist bước 3

Có đủ 4 thứ này thì việc debug nhanh hơn nhiều, khỏi đoán.
