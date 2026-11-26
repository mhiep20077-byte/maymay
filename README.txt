MEITU VIP v6 (narrow) — repo: mhiep20077-byte/maymay

== Link cai vao Shadowrocket ==

1. Module (khuyen dung — them vao tab Module khi da co .conf hoat dong):
   https://raw.githubusercontent.com/mhiep20077-byte/maymay/main/Meitu.sgmodule

2. Module qua jsDelivr CDN (du phong neu mang VN chan raw.githubusercontent):
   https://cdn.jsdelivr.net/gh/mhiep20077-byte/maymay@main/Meitu_cdn.sgmodule

3. Config doc lap (chi dung neu nap lam file .conf chinh, da co FINAL,DIRECT + MITM):
   https://raw.githubusercontent.com/mhiep20077-byte/maymay/main/Meitu.conf

4. Script & Probe truc tiep:
   https://raw.githubusercontent.com/mhiep20077-byte/maymay/main/MeiTuVIP.v6.js
   https://raw.githubusercontent.com/mhiep20077-byte/maymay/main/MeiTuProbe.js

== Da sua loi "loi ket noi mang" ==

- Chi MITM dung 1 host: api-sub.meitu.com (bo *.xiuxiu.meitu.com, meitudata.com, meitu.com).
- Sua cu phap "%APPEND% api-sub.meitu.com" (bo dau phay thua sau %APPEND%).
- Gioi han max-size=524288 + timeout=10 (bo max-size=-1).
- Meitu.conf bo sung [General], [Rule] FINAL,DIRECT va [MITM] enable = true.
- Script luon $done({}) khi khong phai JSON/khong co field VIP/status != 200/path anh.
- Patch day du: vip_type, is_expire, expire_days, valid_time, screen_name va cac key VIP chuan.

== Thu tu test tren iPhone ==

1. Xoa/tat het module Meitu cu & script add tay (tranh hook trung).
2. Add 1 link module o tren -> kiem tra Settings > HTTPS Decryption bat, hostname co api-sub.meitu.com.
3. iOS Cai dat > Cai dat chung > Gioi thieu > Cai dat tin cay chung nhan -> bat xanh cho Root CA Shadowrocket.
4. Force-quit Meitu -> mo lai -> kiem tra feed/chinh anh khong bao loi mang -> vao trang Tai khoan/VIP.
