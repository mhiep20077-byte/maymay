MEITU VIP — BẢN VIẾT LẠI (v2)
=============================

Gồm 4 file:
  MeiTuVIP.js       -> script patch chính
  MeiTuProbe.js     -> script DÒ (chỉ log, không sửa gì)
  Meitu.conf        -> cấu hình cho Shadowrocket
  Meitu.sgmodule    -> module cho Surge / Loon


VÌ SAO BẢN CŨ BÁO "LỖI KẾT NỐI MẠNG"
-----------------------------------
Bản cũ không patch sai chỗ VIP. Nó làm hỏng đường mạng ở 3 điểm:

1. MITM cả meitudata.com (CDN ảnh + template).
   -> Mọi ảnh/template khi chỉnh ảnh bị đi qua MITM, tải chậm hoặc gãy
      => app hiện "lỗi kết nối mạng". Đây là nguyên nhân số 1.
2. Rule khớp theo URL đuôi /vip /user /account /h5, max-size=-1.
   -> Bản mới đổi path nên không khớp nữa, đồng thời max-size=-1 cho mọi
      response khổng lồ (ảnh, video) chạy qua bộ xử lý JS.
3. Patch mù: cứ đúng URL là ghi đè vip_type/is_expire/screen_name vào body,
   kể cả body không phải JSON tài khoản. Bản mới có endpoint kiểm tra
   toàn vẹn body -> thấy body bị sửa là nó coi như mất mạng.

Bản v2 sửa cả 3:
- MITM chỉ còn host API (api-sub / api / *.xiuxiu), bỏ hẳn CDN.
- Không khớp URL kiểu đuôi nữa, mà soi nội dung: JSON có field VIP mới sửa.
- Dò field VIP ở mọi độ sâu, chỉ ĐỔI GIÁ TRỊ field đã tồn tại, không thêm
  field mới -> ít khả năng vỡ chữ ký/kiểm tra toàn vẹn.
- Không đụng luồng beautify/process/material/upload/cdn/video.


CÀI (Shadowrocket)
------------------
1. Tải MeiTuVIP.js về, mở bằng Shadowrocket -> nó nằm trong danh sách Script.
   (Hoặc upload lên worker/gist của bạn rồi sửa script-path thành link raw.)
2. Mở Meitu.conf, sửa script-path cho trỏ đúng file trên, import config.
3. Bật MITM + cài & tin cậy certificate (Cài đặt > Giới thiệu > Tin cậy
   chứng chỉ gốc). Không tin cậy cert là mọi request fail = "lỗi mạng".
4. Tắt module cũ của MinhHiep08 trước (để 2 module chạy cùng là patch đè nhau).
5. Tắt app (swipe up) rồi mở lại — không phải chỉ bấm back.

CÀI (Surge / Loon)
------------------
Import Meitu.sgmodule, sửa script-path, bật MITM + tin cậy cert tương tự.


NẾU VẪN KHÔNG ĂN / VẪN LỖI MẠNG — làm đúng thứ tự này
-----------------------------------------------------
B1. Tắt module -> app có hết lỗi mạng không?
    Có  => lỗi do MITM/script, không phải app. Làm tiếp B2.
    Không => app chặn theo version/server, không liên quan patch.

B2. Thay MeiTuVIP.js bằng MeiTuProbe.js (chỉ log).
    Mở app, vào tab "Tôi" và màn VIP, xem log Shadowrocket:
    - Không thấy dòng [PROBE] nào => MITM không vào được host đó.
      => certificate chưa tin cậy, hoặc app pinning SSL.
      => iOS: thử SSL Kill Switch / Frida objection ios sslpinning disable.
    - Có [PROBE] nhưng toàn "(không phải json)" / "(json parse fail)"
      => response là protobuf/nén, patch JSON vô dụng, phải đi hướng khác.

B3. Trong log, tìm dòng có vip_type / is_vip / expire / rights.
    Copy nguyên dòng [PROBE] đó gửi lại -> mình khoá đúng endpoint,
    siết MITM còn 1 host, script chạy nhẹ và không phá gì nữa.


LƯU Ý
------
- Token/response có thể có chữ ký. Nếu bản mới ký body thì mọi cách sửa
  response đều bị phát hiện -> lúc đó phải chuyển sang patch client
  (Frida / LSPatch), không dùng được proxy.
- Đừng dùng account chính khi test. Sửa field mà server đối chiếu về sau
  là dễ bị khoá nick.
