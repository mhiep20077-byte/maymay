# Meitu & Wink VIP Unlock (Bản sạch, sửa lỗi mất kết nối mạng)

Bộ cấu hình & script đã bỏ hoàn toàn code làm rối (`jsjiami`), sửa các lỗi gây mất kết nối mạng khi bật VPN, và bổ sung module **Bắt gói tin** (`Meitu_Capture.sgmodule`).

## 📁 Cấu trúc thư mục

```
├── js/
│   ├── MeiTuXiuXiu.js      # Mở khóa VIP Meitu XiuXiu (đã bỏ làm rối)
│   ├── WinkVipCrack.js     # Mở khóa VIP Wink (đã bỏ anti-tamper popup)
│   └── MeiTuCapture.js     # Bắt gói tin request/response JSON (chỉ đọc)
├── modules/
│   ├── Meitu.sgmodule         # Chỉ Meitu XiuXiu
│   ├── Wink.sgmodule          # Chỉ Wink
│   ├── Meitu_All.sgmodule     # Gộp Meitu XiuXiu + Wink
│   └── Meitu_Capture.sgmodule # Bắt gói tin Meitu & Wink
├── Meitu.conf              # File cấu hình độc lập cho Shadowrocket
└── README.md
```

## 🔧 Các lỗi gây mất kết nối mạng đã sửa

1. **Bỏ `jsjiami` (`window` / `setInterval` / `debugger`):** Runtime Shadowrocket/Surge không có `window` nên bản làm rối bị crash `ReferenceError`, làm gãy response.
2. **Sửa regex double-escape (`\\.` / `\\/`)** trong các file `.sgmodule` và thu hẹp `pattern` đúng endpoint VIP JSON, không kéo theo ảnh/AI/material.
3. **Đặt `max-size=524288` & `timeout=10`** thay cho `max-size=-1` & `timeout=60` để tránh tràn RAM Network Extension trên iOS.
4. **Bọc `try/catch` + trả `$done({})`** khi status != 200, non-JSON, hoặc đường dẫn `/beautify`, `/process`, `/material`, `/upload`, `/download`, `/cdn`.
5. **Bổ sung `[General]` + `[Rule] FINAL,DIRECT` + `[MITM] enable = true`** vào `Meitu.conf` và bỏ dấu phẩy thừa sau `%APPEND%`.

## 🚀 Link cài đặt (Shadowrocket / Surge / Loon)

- **Meitu + Wink (khuyên dùng):** `https://raw.githubusercontent.com/mhiep20077-byte/maymay/main/modules/Meitu_All.sgmodule`
- **Chỉ Meitu XiuXiu:** `https://raw.githubusercontent.com/mhiep20077-byte/maymay/main/modules/Meitu.sgmodule`
- **Chỉ Wink:** `https://raw.githubusercontent.com/mhiep20077-byte/maymay/main/modules/Wink.sgmodule`
- **Bắt gói tin (Capture):** `https://raw.githubusercontent.com/mhiep20077-byte/maymay/main/modules/Meitu_Capture.sgmodule`
- **Config độc lập:** `https://raw.githubusercontent.com/mhiep20077-byte/maymay/main/Meitu.conf`

## 📡 Cách dùng module Bắt gói tin (`Meitu_Capture.sgmodule`)

1. Tắt module VIP trước khi bật `Meitu_Capture.sgmodule`.
2. Bật VPN + MITM, mở Meitu/Wink và vào mục **Tài khoản / VIP** hoặc thử tính năng cần soi.
3. Xem kết quả trong Shadowrocket → **Dữ liệu / Nhật ký (Log → Script Log)**:
   - Không thấy `[MEITU-REQ]` cho host nào → host đó bị **SSL pinning** trên app (nếu là `api.xiuxiu.meitu.com`, gỡ host đó khỏi danh sách MITM để hết lỗi mạng).
   - Thấy `[MEITU-REQ]` + `[MEITU-CAP]` → có `VIP_KEYS:` và `JSON:` thật để kiểm tra/cập nhật key.
