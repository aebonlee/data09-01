#!/usr/bin/env bash
# 사이트 배포 — 화면에 필요한 파일만 gh-pages 가지에 올린다.
#
# 왜: Pages 가 리포 전체(main /)를 서빙하면 docs/source/ 의 수강생 제공 파일(기획안·DB·화면구성 …)이
#     https://hdx-ps.jobability.co.kr/docs/source/… 로 누구나 받아진다(2026-09-30 실측 200).
#     리포를 비공개로 돌려도 Pages 로 서빙된 파일은 그대로 공개된다(CLAUDE.md §3.8).
#     그래서 배포본에는 아래 목록만 담고, docs/ · scripts/ · supabase/ · test/ 는 넣지 않는다.
#
# 쓰는 법: bash scripts/deploy-pages.sh   (main 에 커밋·푸시한 뒤)
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
OUT="$(mktemp -d)"
trap 'rm -rf "$OUT"' EXIT

SITE_FILES=(index.html css js vendor samples og-image.png CNAME .nojekyll)
for f in "${SITE_FILES[@]}"; do
  [ -e "$ROOT/$f" ] || { echo "없음: $f" >&2; exit 1; }
  cp -R "$ROOT/$f" "$OUT/"
done
find "$OUT" -name .DS_Store -delete

# 가드: 배포본에 수강생 제공 파일·매뉴얼·문서가 섞이면 멈춘다
if find "$OUT" \( -path '*/docs/*' -o -iname '*.docx' -o -iname '*.pdf' -o -iname '*.manual.json*' \) | grep -q .; then
  echo "배포 중단: 배포본에 docs/·docx·pdf·매뉴얼 JSON 이 들어 있습니다." >&2
  find "$OUT" \( -path '*/docs/*' -o -iname '*.docx' -o -iname '*.pdf' -o -iname '*.manual.json*' \) >&2
  exit 1
fi

echo "배포할 파일 $(find "$OUT" -type f | wc -l | tr -d ' ')개"
# --add 는 쓰지 않는다: 이 사이트는 해시 파일이 없고, --add 는 예전 배포본의 파일을 지우지 않고 남긴다
#   (민감한 파일이 한 번 섞이면 계속 공개된다). 매번 배포본 전체로 gh-pages 를 바꾼다.
npx --yes gh-pages -d "$OUT" --dotfiles -m "배포: $(git -C "$ROOT" rev-parse --short HEAD)"
