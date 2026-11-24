# Spotify VN v3.0 — module Shadowrocket

Bản v3.0 sửa đúng cái đang chặn mày: **bật VPN lên là báo lỗi, mất mạng**.
Nguyên nhân không phải script, mà là mấy dòng trong file module mà Shadowrocket
không đọc nổi → hỏng cả file cấu hình → VPN không lên.

## Đã bỏ những gì (chính là thủ phạm)

| Thứ đã bỏ | Vì sao |
|---|---|
| `[Rule]` + `AND,((DOMAIN-SUFFIX,spotify.com),(PROTOCOL,UDP)),REJECT` | Cú pháp logic của Surge, Shadowrocket không hiểu → parse lỗi |
| `URL-REGEX,...,REJECT` | Một số bản Shadowrocket không hỗ trợ trong module |
| `binary-body-mode=true` | Khoá của Loon, không phải Shadowrocket |
| `timeout=` trong dòng script | Không phải khoá module của Shadowrocket |
| Pattern regex dài có `(?!...)` và `\/` | Dễ làm parser chia sai dòng |
| `#!icon=` | Gọi mạng lúc nạp module, mạng chưa lên là treo |

Bây giờ mỗi dòng script chỉ còn 5 khoá: `type`, `pattern`, `script-path`,
`requires-body`, `max-size`. Pattern rút về `^https://.*spotify\.com/` — script
tự lọc endpoint bên trong.

## 4 module, cài từ nhẹ đến nặng

| File | Nội dung | Khi nào dùng |
|---|---|---|
| `spotify-vn-mini.module` | 1 script sửa payload | **Cài cái này trước** để kiểm tra VPN có lên không |
| `spotify-vn-lite.module` | mini + ép cấp âm thanh + dọn header | Bản dùng hằng ngày |
| `spotify-vn-premium.module` | lite + bắt gói có banner + gom dữ liệu | Khi cần xem app nhận gì |
| `spotify-vn-capture.module` | chỉ bắt gói | Khi gửi log cho Zaka |

## Thứ tự cài (đúng thứ tự, đừng nhảy)

1. Tắt VPN. Vào Module → **xoá hết** module có chữ Spotify (2.5, 2.6, 2.7, của người khác).
2. Bật VPN **khi chưa có module Spotify nào**. Lên được → lỗi do module. Không lên được → lỗi ở file cấu hình `.conf` của mày, xem `docs/V3.0-FIX-VPN.md`.
3. Dán link `spotify-vn-mini.module` → Add → bật VPN → phải lên.
4. Lên OK rồi mới đổi sang `spotify-vn-lite.module`, rồi `spotify-vn-premium.module`.
5. Bước nào bật VPN báo lỗi → dừng ở bước đó, gửi ảnh chụp câu báo lỗi.

Link cài (host cố định):
```
https://spotify-vn.web.zaka.live/spotify-vn-mini.module
https://spotify-vn.web.zaka.live/spotify-vn-lite.module
https://spotify-vn.web.zaka.live/spotify-vn-premium.module
https://spotify-vn.web.zaka.live/spotify-vn-capture.module
```

Shadowrocket không nhận `.module` thì dùng `.txt`, cùng nội dung.

## Tùy chỉnh qua `$argument`

Dán vào cuối dòng script trong module (sau `max-size=...`):
`argument={"audio_level":1,"badge_text":"ToCam","badge_color":"#FFA500"}`

- `audio_level`: 2 = ép 320kbps, 1 = 160kbps, `"keep"` = không đổi. Bài nào ép 2 mà bị nhảy thì hạ 1.
- `badge_text`: chữ hiện ở badge (mặc định `ToCam`).
- `badge_color`: màu badge (mặc định xanh `#1ED760`).

## Nói thẳng giới hạn

- **320kbps và tải offline**: server Spotify chọn file + cấp license theo tier tài khoản. Nếu `net-fortune` chỉ trả 96/160 thì đó là server quyết, client không với tới.
- **Chữ "Premium" trên hồ sơ**: phần lớn nằm trong app bundle, không đi qua mạng → proxy không sửa được. Chỉ sửa được khi chuỗi đó có trong response JSON/protobuf.
- **Trang quản lý gói**: đổi được nhãn/màu của dữ liệu server trả về, không tạo ra gói không tồn tại.

## Test

```bash
node tests/test-patch.js     # 92 test
node tests/test-capture.js   # 19 test
```

Test chạy offline, không cần Spotify, không cần mạng. Trong đó có nhóm test
`v3.0 module:` khoá chặt: không được lọt lại `[Rule]`, `URL-REGEX`,
`AND,(`, `binary-body-mode`, `timeout=`.

## Cấu trúc

```
spotify-vn-mini.module          module nhẹ nhất
spotify-vn-lite.module
spotify-vn-premium.module
spotify-vn-capture.module
scripts/
  spotify-premium.js            sửa payload (protobuf + JSON)
  spotify-request.js            bỏ header điều kiện để có body thật
  spotify-audio-level.js        ép cấp âm thanh trong URL
  capture.js                    bắt gói + banner
  drip.js                       bơm dữ liệu đã gom vào URL kế tiếp
  debug.js                      in endpoint app đang gọi
tests/                          test offline
tools/                          set-repo.sh, test.sh, decode-log.py, analyze-log.py
docs/                           ghi chép từng bản
optional/                       module phụ (debug, ipad)
```

## Ghi đè lên repo cũ

```bash
unzip -o spotify-vn-premium-v3.0.zip -d tam
cd /duong/dan/repo
cp -R /duong/dan/tam/. .
git status          # phải KHÔNG thấy deleted: .git hay .github
git add -A && git commit -m "v3.0: fix loi VPN khong bat duoc"
git push origin main
```

Lưu ý: bản v3.0 **không chặn quảng cáo** nữa (rule chặn quảng cáo chính là một
phần làm hỏng cấu hình). Nếu sau này muốn chặn thì thêm file `.list` riêng trong
cấu hình Shadowrocket, đừng nhét `[Rule]` vào module.
