# Spotify Premium & AdBlock Module

Gói cấu hình độc lập mở khóa tính năng Spotify Premium, hiển thị huy hiệu Premium và chặn toàn bộ quảng cáo cho Spotify trên iOS.

## 📁 Cấu trúc thư mục

```
Spotify/
├── js/
│   ├── spotify-json.js     # Chuyển đổi layout iPad (mở khóa chọn bài, next bài không giới hạn)
│   ├── spotify-proto.js    # Giải mã nhị phân Protobuf, kích hoạt PAM Badge và dịch vụ Premium
│   ├── spotify-request.js  # Chặn ad server, trả về license capabilities hợp lệ
│   └── spotify-state.js    # Giả lập product state, user attributes thành Premium
├── modules/
│   └── SpotifyPremium.sgmodule # Module hoàn chỉnh dành cho Surge
├── Spotify.conf            # File cấu hình dành cho Shadowrocket / Loon / Quantumult X
└── README.md
```

## 🚀 Hướng dẫn cài đặt

### 1. Surge
- Thêm file `Spotify/modules/SpotifyPremium.sgmodule` vào mục **Modules** trong Surge và bật lên.

### 2. Shadowrocket / Loon / Quantumult X
- Nhập hoặc tích hợp các rule từ `Spotify/Spotify.conf` vào ứng dụng proxy.
- Đảm bảo đã bật **HTTPS Decryption (MITM)** và cài đặt/tin cậy CA Certificate của proxy.

---

## ⚠️ Lưu ý quan trọng: Lỗi nghe vài giây tự chuyển bài (Skip Track)

Nếu bạn gặp tình trạng **phát nhạc được vài giây thì Spotify tự động ngắt hoặc nhảy sang bài tiếp theo**, nguyên nhân và cách khắc phục như sau:

1. **Chất lượng âm thanh (Audio Quality) bị đặt ở mức "Rất cao" (Very High / 320kbps) hoặc Lossless**:
   - Máy chủ Spotify kiểm tra key DRM bản quyền đối với các luồng stream Very High. Script chỉ giả lập giao diện và quyền client, không thể cung cấp DRM key thật của máy chủ.
   - **Cách xử lý**: Vào **Cài đặt Spotify (Settings)** -> **Chất lượng âm thanh (Audio Quality)** -> Chuyển cả khi dùng Wi-Fi và Di động về mức **"Tự động" (Automatic)** hoặc **"Cao" (High)** (tuyệt đối không chọn *Rất cao*).
2. **Không hỗ trợ tải nhạc nghe Offline**:
   - Tính năng tải bài hát để nghe khi tắt mạng yêu cầu server cấp khóa mã hóa nội bộ nên không thể sử dụng trên tài khoản mod/tweak.
3. **Xóa Cache ứng dụng**:
   - Nếu vẫn bị nhảy bài, vào **Cài đặt Spotify** -> **Bộ nhớ lưu trữ (Storage)** -> Nhấn **Xóa bộ nhớ đệm (Clear Cache)**, sau đó khởi động lại app Spotify.
