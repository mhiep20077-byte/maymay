# Chẩn đoán v2 — vì sao module v1 "cài rồi mà không thấy gì"

Nguồn: file log proxy `proxy-2026-11-24-042223.db` (823 dòng, 04:22:25 → 04:28:25),
trong đó **721 dòng là traffic Spotify**, phiên khởi động app lúc 04:25:03.

Triệu chứng mày gặp: vẫn 5 tab (có tab **Premium**), vẫn banner "Nâng cấp Premium",
không hiện gói Premium trong phần tài khoản, không tua được, mở artist vẫn dính 1 quảng cáo.
So với bản dùng DNS của họ: 4 tab, có badge Premium, tua bình thường, sạch quảng cáo.

→ Nghĩa là **patch không hề chạy một byte nào**, chứ không phải "patch chạy mà thiếu".

---

## 1. Bằng chứng #1 — MITM không khớp host

Đếm host trong 721 request Spotify:

| Host | Số request |
|---|---|
| `gae2-spclient.spotify.com` | **658** (91%) |
| `spclient.wg.spotify.com` | 31 |
| `aet.spotify.com` | 15 |
| còn lại (cdn, login5, apresolve, dealer…) | 17 |

`gae2-spclient` là **shard** do `apresolve.spotify.com` cấp cho máy mày (GAE = Google App Engine region 2).
Toàn bộ API thật — `remote-config-resolver`, `nebula`, `ads`, `playplay`, `storage-resolve` — đi qua host này.

Module v1 để:

```
hostname = %APPEND% *-spclient.spotify.com, spclient.wg.spotify.com
```

Shadowrocket / Surge **chỉ hiểu wildcard ở đầu nhãn** (`*.spotify.com`).
`*-spclient.spotify.com` là wildcard giữa nhãn → **không khớp bất kỳ host nào**, không báo lỗi,
MITM im lặng không bật. Vì thế 658 request kia đi thẳng, script không có gì để chạy.

v2 sửa thành `%APPEND% *.spotify.com, spotify.com` — phủ hết shard, kể cả khi Spotify đổi sang `gew1`, `gae1`, `guc3`…

## 2. Bằng chứng #2 — script nhắm sai endpoint

v1 chỉ chạy trên `/bootstrap/v1/bootstrap` và `/user-customization-service/v1/customize`.

Trong 6 phút log đó, sau khi app khởi động lại (có `clienttoken` + `login5` + `apresolve` = login mới),
**không có một request nào** tới `bootstrap` hay `user-customization-service`. Đường dẫn thật của client 9.2.2:

| Endpoint | Số lần | Nội dung |
|---|---|---|
| `/remote-config-resolver/v3/configuration` | 4 | chuỗi `AssignedValue` (cờ bật/tắt UI, ads, cap) |
| `/nebula/v1/configuration/attributes` | 2 | `AccountAttribute` (catalogue, type, player-license…) |
| `/ads/v3/ads?slots=preroll` | 21 | chính là cái quảng cáo 1 phát khi mở artist |
| `/ad-logic/prefetch` | 31 | nạp trước catalogue quảng cáo |
| `/net-fortune/v2` | 21 | quảng cáo dạng "fortune"/sponsor |

→ Nếu chỉ sửa MITM mà giữ nguyên script cũ thì vẫn **không có tác dụng**, vì không endpoint nào khớp pattern.

v2 thêm dispatcher: `bootstrap` → `patchBootstrap`, `user-customization-service` → `patchCustomize`,
`nebula` → `patchAttributes`, `remote-config-resolver` → `patchConfiguration`.
Cả hai nhánh mới chạy ở chế độ **strict**: chỉ sửa khi message đúng layout và có ≥ 1 field mình hiểu;
layout lạ → trả `null` → app chạy nguyên bản (không bao giờ nhét field rác vào message lạ).

## 3. Quảng cáo — chặn domain là chưa đủ

`aet.spotify.com` đã bị REJECT trong log (15 lần) mà vẫn còn 1 quảng cáo, vì ads của bản 9.2.x
nằm **chung host với API** (`ads/v3`, `ad-logic`, `net-fortune`). Không thể REJECT cả host — sẽ mất luôn API.
v2 thêm rule REJECT theo URL:

```
URL-REGEX,^https?://[^/]*spotify\.com/(?:ads/v3|ad-logic|net-fortune|sponsoredplaylist|premium-marketing),REJECT
```

Nếu thấy nhạc khựng 1–2 giây lúc bắt đầu phát, xoá `ads/v3` khỏi regex là hết (đánh đổi: quảng cáo quay lại).

## 4. Cái v2 **không** hứa

- `device-capabilities/v1/capabilities`: server tính theo product của account. Log cho thấy client gọi nó lúc khởi động.
  Không patch client-side an toàn (layout khác, sửa bừa là app crash). Đây là lý do **có thể vẫn còn** dấu hiệu free.
- Offline download / 320 kbps: server cấp file theo tier, client không quyết.
- Badge "Premium" trong Account: có thể vẫn hiện Free dù UI đã mở khoá.

## 5. Bản DNS của họ khác gì

Bản đó không phải module — nó là **server trả response đã sửa** (client trỏ domain về server họ qua DNS + root CA riêng).
Response do server sinh ra nên `device-capabilities`, `nebula`, `remote-config` đều "premium" từ gốc → UI sạch 100%,
không phụ thuộc client, không sợ Spotify đổi layout protobuf.

Muốn đạt đúng mức đó thì phải làm **proxy phía server** (VPS + cert + DNS profile), không phải module.
Repo này chỉ là mức tốt nhất làm được **hoàn toàn trên máy** (không cần VPS).

## 6. Cách xác nhận trong 2 phút

1. Cài `spotify-vn-premium-DEBUG.module` (thay cho module chính), bật MITM.
2. Kill Spotify, mở lại, vào 1 artist.
3. Shadowrocket → Log, lọc `spot-vn-dbg`.

- **Có** dòng `[spot-vn-dbg] 200 … /nebula/…` → MITM đã ăn, xem tiếp mục 7.
- **Không có dòng nào** → MITM/cert chưa đúng: kiểm tra 3 thứ (module ON, MITM ON, cert đã Trust trong
  Cài đặt → Cài đặt chung → Giới thiệu → Cài đặt tin cậy chứng chỉ).
- Có dòng nhưng toàn 401/403 → token/region, không phải lỗi module.

Gửi lại các dòng `spot-vn-dbg` là tao chốt được chính xác field nào cần sửa thay vì đoán.

## 7. Bước tiếp theo (nếu v2 vẫn chưa đủ)

Gửi log `spot-vn-dbg` của 3 endpoint: `nebula/v1/configuration/attributes`,
`remote-config-resolver/v3/configuration`, `device-capabilities/v1/capabilities`.
Có `status + size + 12 byte đầu` là đủ để biết layout thật, rồi patch đúng field —
không cần đọc nội dung nhạy cảm nào của tài khoản.
