MEITU v5 — BO FILE DUA LEN GIT (repo: mhiep20077-byte/maymay)

Muc dich: dung module qua LINK thay vi add script tay. Module link chi hoat dong
khi 3 file duoi day nam dung path tren nhanh main.

== 1. File nao thay file nao ==

  MeiTuVIP.js     -> THAY the MeiTuVIP.js cu (dang la ban "rewrite v2")
  MeiTuProbe.js   -> THAY the MeiTuProbe.js cu
  Meitu.sgmodule  -> THAY the Meitu.sgmodule cu (ban cu MITM ca *.xiuxiu.meitu.com = sai)
  Meitu_raw.sgmodule -> file MOI, them vao (ban du phong, script lay tu raw)
  Meitu.conf      -> XOA khoi root (ban v1 MinhHiep08). Khong de trong repo de khoi import nham.

== 2. Cach day len (web, khong can git CLI) ==

  1) Mo https://github.com/mhiep20077-byte/maymay
  2) Bam vao file can sua -> bieu tuong but chi (Edit) -> Ctrl+A -> dan noi dung moi
     -> Commit changes (commit thang vao main)
  3) File moi: Add file -> Create new file -> dat ten -> dan noi dung -> Commit
  4) Xoa Meitu.conf: mo file -> bieu tuong thung rac -> Commit

  Neu dung git CLI:
     git clone https://github.com/mhiep20077-byte/maymay
     copy 4 file trong thu muc nay vao root repo
     git rm Meitu.conf
     git add . && git commit -m "meitu v5 narrow" && git push

== 3. Sau khi push, kiem tra script song chua (lam truoc khi import module) ==

  Mo bang Safari tren iPhone:
    https://cdn.jsdelivr.net/gh/mhiep20077-byte/maymay@main/MeiTuVIP.js
  Phai hien ra ma JS, dong dau co chu "MeiTuVIP_v5.js".
  Neu van hien "rewrite v2" -> jsDelivr con cache, xem muc 4.

== 4. jsDelivr cache (cho nay 90% nguoi sai) ==

  jsDelivr cache nhanh main. Ep no lay ban moi bang cach mo 1 lan:
    https://purge.jsdelivr.net/gh/mhiep20077-byte/maymay@main/MeiTuVIP.js
    https://purge.jsdelivr.net/gh/mhiep20077-byte/maymay@main/Meitu.sgmodule
  Thay {user} bang ten repo cua ban. Purge xong doi ~10s roi tai lai.
  Hoac dung Meitu_raw.sgmodule (raw.githubusercontent cap nhat tuc thi).

== 5. Import module vao Shadowrocket ==

  1) Xoa / tat HET module Meitu cu (MinhHiep08, v3) + moi script Meitu add tay
  2) Cau hinh -> Module -> dau + -> dan link:
       https://cdn.jsdelivr.net/gh/mhiep20077-byte/maymay@main/Meitu.sgmodule
  3) Bat MITM + HTTPS Decrypt, hostname chi con: api-sub.meitu.com
  4) Cert: Cai dat chung -> Gioi thieu -> Cai dat tin cay chung chi -> bat cong tac (buoc 2)
  5) Kill han app (vuot khoi app switcher) -> mo lai -> vao tab "Toi" -> trang VIP

== 6. Thu tu test khi van loi ==

  A. Tat MITM, giu VPN xanh  -> tab co ve khong?
  B. Bat MITM, chua cai script -> tab co ve khong?
  C. Cai module v5 -> tab co ve khong?
     - Mat tab = loi tang MITM/cert/pinning (khong phai script)
     - Con tab nhung VIP khong an -> doi sang ban PROBE (sua comment trong module),
       mo trang VIP, roi copy dong [PROBE] co chu vip/expire gui lai

== 7. Luu y ==

  - Khong chay module + script add tay cung luc (hook 2 lan -> loi mang)
  - Khong them *.meitu.com / meitudata.com vao hostname
  - Sua script tren git thi phai purge cache hoac dung ban raw
