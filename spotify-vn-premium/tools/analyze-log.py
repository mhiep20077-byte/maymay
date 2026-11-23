#!/usr/bin/env python3
# ============================================================================
# spotify-vn-premium / tools/analyze-log.py
#
# Đọc file log proxy của Shadowrocket (SQLite, bảng logging/logging_content)
# và trả lời đúng 3 câu hỏi cần thiết trước khi sửa module:
#
#   1. Client gọi những endpoint nào, mỗi cái bao nhiêu lần?
#   2. Endpoint nào đang bị module bỏ sót (không khớp pattern http-response)?
#   3. Endpoint nào trông như quyết định trạng thái Premium mà vẫn chưa patch?
#
# Dùng:  python3 tools/analyze-log.py proxy-2026-11-24-061819.db
#        python3 tools/analyze-log.py log.db -v      # in cả danh sách đầy đủ
# ============================================================================

import re
import sqlite3
import sys
from collections import Counter
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
MODULE = ROOT / "spotify-vn-premium.module"

# Dấu hiệu endpoint có thể mang trạng thái tài khoản / quyền tính năng.
SUSPECT = re.compile(
    r"pam|premium|product-state|product_state|subscription|entitlement|badge|plan|"
    r"playback-settings|capabilit|clientrestrictions|restricted|nebula|attributes|"
    r"remote-config|bootstrap|account|profile|trial|upsell|offline|license",
    re.I,
)


def module_pattern():
    """Lấy regex pattern của script http-response trong file .module."""
    text = MODULE.read_text(encoding="utf-8", errors="replace")
    for line in text.splitlines():
        if "type=http-response" in line:
            m = re.search(r"pattern=([^,]+)", line)
            if m:
                return m.group(1)
    return None


def load(db_path):
    con = sqlite3.connect("file:%s?mode=ro" % db_path, uri=True)
    cols = [r[1] for r in con.execute("PRAGMA table_info(logging_content)")]
    if "c0url" not in cols:
        raise SystemExit("Không phải log Shadowrocket (thiếu cột c0url)")
    rows = con.execute(
        "SELECT c0url, c3type, c4created FROM logging_content ORDER BY c4created"
    ).fetchall()
    return rows


def main():
    args = [a for a in sys.argv[1:] if not a.startswith("-")]
    verbose = "-v" in sys.argv
    if not args:
        raise SystemExit("Dùng: python3 tools/analyze-log.py <file.db> [-v]")

    rows = load(args[0])
    print("Tổng request: %d" % len(rows))
    if rows:
        print("Khoảng thời gian: %s -> %s" % (rows[0][2], rows[-1][2]))

    # host vs policy
    policy = Counter()
    for url, typ, _ in rows:
        host = re.sub(r"^(?:https?://)?([^/:]+).*$", r"\1", url)
        if host.endswith("spotify.com") or "spotify" in host:
            policy[typ or "?"] += 1
    if policy:
        print("\nPolicy trên host spotify:")
        for k, v in policy.most_common():
            print("  %-10s %d" % (k, v))

    # path (bỏ query) -> số lần
    paths = Counter()
    for url, _, _ in rows:
        p = re.sub(r"^https?://[^/]+", "", url).split("?")[0]
        if p:
            paths[p] += 1

    raw = module_pattern()
    covered = re.compile(raw, re.I) if raw else None
    if not covered:
        raise SystemExit("Không đọc được pattern trong %s" % MODULE)

    covered_n = 0
    missed = []
    for p, n in paths.most_common():
        url = "https://gae2-spclient.spotify.com" + p
        if covered.search(url):
            covered_n += n
        else:
            missed.append((p, n))

    print("\nPattern http-response: khớp %d/%d request" % (covered_n, len(rows)))

    suspicious_missed = [(p, n) for p, n in missed if SUSPECT.search(p)]
    if suspicious_missed:
        print("\n⚠ BỎ SÓT endpoint có thể mang trạng thái Premium:")
        for p, n in suspicious_missed:
            print("  %4d×  %s" % (n, p[:110]))
    else:
        print("\n✅ Không thấy endpoint 'trạng thái Premium' nào bị bỏ sót.")

    if verbose:
        print("\nToàn bộ endpoint bị bỏ sót (%d):" % len(missed))
        for p, n in missed:
            print("  %4d×  %s" % (n, p[:110]))

    print(
        "\nGhi nhớ: nếu module bỏ sót endpoint gRPC (pam-view-service, playback-settings,\n"
        "clientrestrictions) thì phải thêm cả pattern LẪN phần bóc khung 5 byte."
    )


if __name__ == "__main__":
    main()
