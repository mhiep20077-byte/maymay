# Locket Cam-UI v2 — bắt UI mới (không phải filter)

Bản cũ (kit CamTu / allui v1) **hardcode tên key** → server đổi tên hoặc thêm UI mới là mù.
Bản này **tự dò toàn bộ cây config**: key nào thuộc nhóm camera/video/zoom/lens/timer/filter mà đang tắt thì bật.
Không cần biết trước tên key.

---

## 1. Cài (3 phút)

1. Host 3 file `.js` lên chỗ nào lấy được raw: GitHub raw / Gist / VPS của mày.
2. Mở `Locket_CamUI.sgmodule`, thay `__BASE__` (4 chỗ) bằng thư mục chứa 3 file.
   Ví dụ: `https://raw.githubusercontent.com/tao/locket/main`
3. Shadowrocket → Config → Import → chọn file .sgmodule → bật MITM → cài CA (đã cài từ trước thì thôi).

---

## 2. Chạy lần đầu: CHẾ ĐỘ SCAN (quan trọng)

Mở `Locket_CamUI.js`, dòng đầu:

```js
var SCAN_ONLY   = false;   // ← đổi thành true
```

Vào app Locket mở camera 1 lần. Noti sẽ ra dạng:

```
CamUI scan · cam9 lens1 booth1 tarot0 zoom3 timer0 vid6 roll1 filter1
23 key UI, 21 đang tắt
feature_gates.video=disabled
camera.ultra_wide=false
...
```

**Đọc dòng đầu tiên** — đây là bảng chẩn đoán:

| Nhóm | Ý nghĩa | Nếu = 0 |
|---|---|---|
| `cam` | key camera nói chung | app quá cũ |
| `lens` | Digicam / Point & Shoot / film stock / 35mm | **app chưa có code Lenses** → phải update App Store |
| `booth` | Photobooth 1x1 / 2x2 | app chưa có code |
| `tarot` | Tarot / Gieo quẻ | app chưa có code |
| `zoom` | .5x / 1x / 2x, ultra-wide, telephoto | máy không có lens đó, hoặc app cũ |
| `timer` | đếm giây 3s/5s/10s | app cũ |
| `vid` | video / upload / sound | app cũ |
| `roll` | Lịch sử / rewind | app cũ |

**Quy tắc đọc:** `lens0 tarot0 booth0` = config không hề chứa mấy tính năng đó → **không phải lỗi script**, mà app binary chưa có code. RC chỉ bật/tắt cái đã có trong app, nó không sinh ra code mới. Lúc đó chỉ có 1 đường: update Locket từ App Store/CH Play.

Ngược lại `lens4 tarot2 booth6` mà UI vẫn không hiện → cờ đang tắt, để `SCAN_ONLY = false` là bật.

---

## 3. Chạy thật

```js
var SCAN_ONLY   = false;
var BUMP_DUR    = 60;     // video/camera max duration
var FORCE_EXPERIMENTS = true;  // ép A/B về nhóm mới nhất
```

Mở app → noti:

```
CamUI · bật 14 cờ
cam9 lens4 booth6 tarot2 zoom3 timer1 vid6 roll1
camera.max_duration: 10->60
camera.zoom_enabled: false->true
feature_gates.digicam: disabled->enabled
```

Danh sách thay đổi lưu ở `locket_camui_last`, 60 mục gần nhất.

---

## 4. Nó sửa cái gì / không sửa cái gì

**Bật:**
- `feature_gates.*` — gate từng tính năng (video, digicam, tarot, photobooth, camera_roll, camera_filter_sheet…)
- `camera.*` — zoom, ultra_wide, telephoto, timer, max_duration, gold_max_duration
- `camera_roll.*` / `video_upload.*` — bật upload video, nâng giới hạn cắt
- `live_photos.*`
- `experiments` — ép weight 100% về nhóm cuối (nhóm mới nhất)

**KHÔNG đụng:**
- `camera_filter_config.remote_filters` — giữ nguyên 100% catalog server trả. Đây là chỗ Tarot/Photobooth/Digicam chảy về. Ghi đè nó = đóng băng UI ở bản cũ (đúng lỗi của kit CamTu cũ).
- `picker_filters`, `frames`, `stickers`, `quality_mbps`, `*_size`, `*_limit` — bỏ qua để không phá app.

---

## 5. Catalog Probe — bắt "mẫu" mới

Script thứ 3 chạy trên `api.locketcamera.com`, chỉ đọc, không sửa. Nó đếm object có `id`+`name` trong response và báo khi thấy mục mới khớp
`tarot|gieo|photobooth|digicam|lens|phim|golden|35mm|point&shoot|film stock`.

Noti:

```
Locket Catalog · +2 mẫu mới
api.locketcamera.com · 340 item
Lá Bài Hôm Nay, Photobooth 1x1 Bạn thân
```

Có cooldown 6h chống spam. Đây là kênh để biết **server đã trả mẫu mới chưa** — nếu probe báo +mẫu mà app vẫn không hiện, thì là binary thiếu code.

---

## 6. Giới hạn phải nói thẳng

| Muốn | Làm được? |
|---|---|
| Nâng video 10s → 60s | ✅ có |
| Bật zoom .5x/1x/2x | ✅ nếu máy có lens, cờ đang tắt |
| Hiện thanh 3s/5s/10s | ✅ nếu app có code timer + cờ tắt |
| Bật nút mặt cười / filter sheet | ✅ |
| Hiện Lịch sử (camera roll) | ✅ |
| Upload video + cắt dài hơn 10s | ✅ |
| Hiện Tarot / Gieo quẻ / Photobooth 1x1-2x2 | ⚠️ chỉ khi catalog server trả về **và** app hiểu layout đó |
| Hiện "Các ống kính" (Digicam/Photo/Short/Video, Phim, Golden hour, 35mm, Home Mode, Lấy nét) | ❌ nếu app cũ — đây là code mới trong binary, RC không tạo ra được |

**RC = công tắc đèn. Không phải người xây nhà.** Nhà chưa xây thì bật công tắc cũng không sáng.

---

## 7. Test

```bash
node test/run.js
```

33 case: scan mode, force mode, catalog không bị đảo `is_locked`, experiment weight, UA lạ, body hỏng (502).
