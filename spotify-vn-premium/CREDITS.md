# Credits

- **Logic rewrite protobuf gốc**: `xzavier-amico` — plugin Loon `spotify_premium.js`
  (repo: github.com/xzavier-amico/modules)
- **Bản chuyển sang Shadowrocket**: `lyc-000001` — github.com/lyc-000001/spotify-shadowrocket
  (header tương thích `TextEncoder` / `bodyBytes` / `statusCode`)
- **Đóng gói repo này**: hợp nhất 2 bản trên + phần chống 304 (http-request script),
  chặn QUIC/UDP, ép `Accept-Encoding: identity`, tăng `max-size`, viết bộ test offline,
  tài liệu VN.

Logic patch protobuf giữ nguyên như bản gốc, không sửa thuật toán.

Dùng cho mục đích cá nhân / học tập. Không bán, không bán key, không cam kết Premium thật.
