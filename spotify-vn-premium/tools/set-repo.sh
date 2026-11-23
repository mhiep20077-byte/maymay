#!/usr/bin/env bash
# ============================================================================
# spotify-vn-premium / tools/set-repo.sh
#
# Trỏ module về repo GitHub của mày (raw URL) trước khi push.
#
#   bash tools/set-repo.sh <github-user> <repo> [branch]
#   bash tools/set-repo.sh https://cdn.example.com/spotify     # host riêng
#
# Ví dụ:
#   bash tools/set-repo.sh taodz spotify-vn-premium main
#   -> https://raw.githubusercontent.com/taodz/spotify-vn-premium/main
#
# Sau khi chạy: kiểm tra bằng `bash tools/test.sh`, rồi commit + push.
# ============================================================================
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"

if [ "${1:-}" = "" ]; then
  echo "Dùng: bash tools/set-repo.sh <github-user> <repo> [branch]" >&2
  echo "  hoặc: bash tools/set-repo.sh https://your-host/path" >&2
  exit 1
fi

case "$1" in
  http://* | https://*)
    BASE="${1%/}"
    ;;
  *)
    USER_NAME="$1"
    REPO="${2:-}"
    BRANCH="${3:-main}"
    if [ -z "$REPO" ]; then
      echo "Thiếu tên repo. Dùng: bash tools/set-repo.sh <user> <repo> [branch]" >&2
      exit 1
    fi
    BASE="https://raw.githubusercontent.com/${USER_NAME}/${REPO}/${BRANCH}"
    ;;
esac

BASE="$BASE" ROOT="$ROOT" python3 - <<'PY'
import os, re, pathlib

base = os.environ["BASE"].rstrip("/")
root = pathlib.Path(os.environ["ROOT"])
changed = []

for mod in sorted(root.rglob("*.module")):
    s = mod.read_text()
    out = re.sub(
        r"(script-path=)(?:__RAW_BASE__|https?://[^\s,]+?)/(scripts|optional)/",
        lambda m: m.group(1) + base + "/" + m.group(2) + "/",
        s,
    )
    out = re.sub(r"(#!homepage=).*", r"\1" + base, out)
    if out != s:
        mod.write_text(out)
        changed.append(mod.relative_to(root).as_posix())

print("Base: " + base)
print("Đã cập nhật: " + (", ".join(changed) if changed else "không có gì thay đổi"))
PY

echo
echo "Bước tiếp:"
echo "  bash tools/test.sh"
echo "  git add -A && git commit -m 'spotify vn premium module' && git push"
echo
echo "Sau khi push, URL module để dán vào Shadowrocket:"
echo "  ${BASE}/spotify-vn-premium.module"
