#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
tools/decode-log.py — bóc dữ liệu capture từ file log .db của Shadowrocket

Cách dùng:
    python3 tools/decode-log.py proxy-YYYY-MM-DD-HHMMSS.db [--raw]

Nó tìm mọi URL có tham số zcap=<seq>.<base64url>, giải mã, ghép lại theo số
thứ tự, rồi in từng bản ghi:
    endpoint | status | size | flags | path | <body 720 byte đầu, base64>
--raw: in luôn 720 byte đầu dạng text (đọc được JSON là thấy ngay field).
"""
import base64
import re
import sqlite3
import sys
from urllib.parse import unquote

ZCAP = re.compile(r"[?&]zcap=(\d{4})\.([A-Za-z0-9_\-]+)")


def b64d(s: str) -> bytes:
    s = s.replace("-", "+").replace("_", "/")
    s += "=" * (-len(s) % 4)
    return base64.b64decode(s)


def load_urls(path: str):
    con = sqlite3.connect(path)
    try:
        rows = con.execute("select url from logging").fetchall()
    except sqlite3.DatabaseError:
        rows = con.execute("select c0url from logging_content").fetchall()
    con.close()
    return [r[0] for r in rows if r and r[0]]


def main():
    if len(sys.argv) < 2:
        print(__doc__)
        return 1
    raw = "--raw" in sys.argv
    path = [a for a in sys.argv[1:] if not a.startswith("--")][0]

    chunks = {}
    urls = load_urls(path)
    for u in urls:
        for m in ZCAP.finditer(unquote(u)):
            chunks[int(m.group(1))] = b64d(m.group(2))

    if not chunks:
        print("Không thấy zcap nào. Log này chỉ có URL.\n"
              "- Module capture đã bật chưa?\n"
              "- Mở app rồi dùng vài phút để drip.js kịp gắn dữ liệu.")
        return 2

    blob = "".join(chunks[k].decode("utf-8", "replace") for k in sorted(chunks))
    lines = [l for l in blob.split("\n") if l.strip()]
    print(f"// {len(chunks)} mẩu, {len(lines)} bản ghi\n")
    for line in lines:
        parts = line.split("|")
        if len(parts) < 6:
            print("?? " + line[:120])
            continue
        ep, status, size, flags, path_hint, b64 = parts[0], parts[1], parts[2], parts[3], parts[4], "|".join(parts[5:])
        print(f"{ep:14s} {status:>4s} {size:>7s}B  {flags}")
        print(f"   path: ...{path_hint}")
        if b64:
            try:
                body = b64d(b64)
            except Exception as e:  # noqa: BLE001
                print(f"   (decode lỗi: {e})")
                continue
            if raw:
                txt = body.decode("utf-8", "replace")
                print("   body: " + txt[:700].replace("\n", " ")[:700])
            else:
                printable = re.findall(rb"[\x20-\x7e]{4,}", body)
                if printable:
                    joined = b" | ".join(printable)[:400].decode("ascii", "replace")
                    print("   strings: " + joined)
        print()
    return 0


if __name__ == "__main__":
    sys.exit(main())
