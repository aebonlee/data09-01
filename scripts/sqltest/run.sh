#!/usr/bin/env bash
# ============================================================================
# supabase/schema.sql(수강생 본인 프로젝트용)과 supabase/2026-09-30_data0901_auth.sql(공용 프로젝트용)을
# 임시 로컬 PostgreSQL 에 실제로 적용해 검증한다.
#
#   ./scripts/sqltest/run.sh
#
# 운영에서 처음 돌리지 않기 위한 장치다. 브라우저도 빌드도 SQL 은 잡아 주지 않는다.
# 임시 클러스터를 만들어 쓰고 끝나면 지우므로 기존 PostgreSQL 설치에 영향이 없다.
# ============================================================================
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
PGBIN="${PGBIN:-}"
if [ -z "$PGBIN" ]; then
  for c in /usr/local/opt/postgresql@17/bin /opt/homebrew/opt/postgresql@17/bin \
           /usr/local/opt/postgresql@16/bin /opt/homebrew/opt/postgresql@16/bin; do
    [ -x "$c/initdb" ] && PGBIN="$c" && break
  done
fi
# 데비안·우분투(그리고 GitHub Actions 러너) — 여기서는 initdb 가 PATH 에 없다
if [ -z "$PGBIN" ]; then
  for c in $(ls -d /usr/lib/postgresql/*/bin 2>/dev/null | sort -V -r); do
    [ -x "$c/initdb" ] && PGBIN="$c" && break
  done
fi
if [ -z "$PGBIN" ] && command -v initdb >/dev/null 2>&1; then
  PGBIN="$(dirname "$(command -v initdb)")"
fi
if [ -z "$PGBIN" ]; then
  echo "PostgreSQL 을 찾지 못했습니다." >&2
  echo "  macOS  : brew install postgresql@17" >&2
  echo "  우분투 : sudo apt-get install -y postgresql" >&2
  exit 1
fi

TMP="$(mktemp -d)"; PGDATA="$TMP/data"; PGSOCK="$TMP/sock"; mkdir -p "$PGSOCK"
cleanup() { "$PGBIN/pg_ctl" -D "$PGDATA" -m immediate stop >/dev/null 2>&1 || true; rm -rf "$TMP"; }
trap cleanup EXIT

echo "임시 PostgreSQL 준비 중…"
"$PGBIN/initdb" -D "$PGDATA" -U postgres --auth=trust >/dev/null
"$PGBIN/pg_ctl" -D "$PGDATA" -o "-k $PGSOCK -h '' -c listen_addresses=''" -w start >/dev/null
"$PGBIN/createdb" -h "$PGSOCK" -U postgres sqltest

PSQL=("$PGBIN/psql" -h "$PGSOCK" -U postgres -d sqltest -v ON_ERROR_STOP=1 -q)

echo "① Supabase 환경 스텁"
"${PSQL[@]}" -f "$ROOT/scripts/sqltest/00_supabase_stub.local.sql"

# schema.sql 의 "이미 있습니다, 건너뜁니다" NOTICE 는 정상이므로 경고 이상만 보인다
echo "② schema.sql 적용"
PGOPTIONS="-c client_min_messages=warning" "${PSQL[@]}" -f "$ROOT/supabase/schema.sql"

echo "③ 재적용 (재실행 안전한가)"
PGOPTIONS="-c client_min_messages=warning" "${PSQL[@]}" -f "$ROOT/supabase/schema.sql"

# 공용 프로젝트용 스크립트(data0901_ 접두사) — 공용 개체 스텁 위에 두 번 적용
# SHARED_SQL 로 다른 파일을 넣을 수 있다(일부러 깨뜨린 사본으로 검사기가 잡는지 볼 때)
SHARED_SQL="${SHARED_SQL:-$ROOT/supabase/2026-09-30_data0901_auth.sql}"
echo "③-1 공용 개체 스텁 (www_profiles·www_admins·storage)"
PGOPTIONS="-c client_min_messages=warning" "${PSQL[@]}" -f "$ROOT/scripts/sqltest/05_shared_stub.local.sql"
echo "③-1b 가드: 공용 개체가 있는 DB 에서는 schema.sql 이 멈춰야 한다"
if PGOPTIONS="-c client_min_messages=warning" "${PSQL[@]}" -f "$ROOT/supabase/schema.sql" >/dev/null 2>&1; then
  echo "실패: 공용 프로젝트에서 schema.sql 이 멈추지 않았습니다" >&2; exit 1
fi
echo "③-2 $(basename "$SHARED_SQL") 적용 · 재적용"
PGOPTIONS="-c client_min_messages=warning" "${PSQL[@]}" -f "$SHARED_SQL"
PGOPTIONS="-c client_min_messages=warning" "${PSQL[@]}" -f "$SHARED_SQL"
# 제공 자료 원본(originals/) — 버킷 제한을 넓히는 추가 스크립트. auth SQL 을 사이에 다시 돌려도
# 넓힌 제한이 좁아지지 않는지까지 본다. ORIG_SQL 로 일부러 깨뜨린 사본을 넣을 수 있다.
ORIG_SQL="${ORIG_SQL:-$ROOT/supabase/2026-09-30_data0901_originals.sql}"
echo "③-3 $(basename "$ORIG_SQL") 적용 → auth SQL 재실행 → 재적용 → auth SQL 재실행"
PGOPTIONS="-c client_min_messages=warning" "${PSQL[@]}" -f "$ORIG_SQL"
PGOPTIONS="-c client_min_messages=warning" "${PSQL[@]}" -f "$SHARED_SQL"
PGOPTIONS="-c client_min_messages=warning" "${PSQL[@]}" -f "$ORIG_SQL"
PGOPTIONS="-c client_min_messages=warning" "${PSQL[@]}" -f "$SHARED_SQL"

# 기술지원 기록 서버 저장(등록·문의·회신·소스·메일·접속 Log) — auth SQL 다음에 두 번(재실행 안전).
# REC_SQL 로 일부러 깨뜨린 사본을 넣을 수 있다.
REC_SQL="${REC_SQL:-$ROOT/supabase/2026-09-30_data0901_records.sql}"
echo "③-4 $(basename "$REC_SQL") 적용 · 재적용 (첫 적용 전후로 data0901_ 밖 카탈로그·데이터 대조)"
"${PSQL[@]}" -f "$ROOT/scripts/sqltest/34_data0901_records_before.local.sql"
PGOPTIONS="-c client_min_messages=warning" "${PSQL[@]}" -f "$REC_SQL"
PGOPTIONS="-c client_min_messages=warning" "${PSQL[@]}" -f "$REC_SQL"
"${PSQL[@]}" -f "$ROOT/scripts/sqltest/34_data0901_records_after.local.sql" 2>&1 | sed 's/^psql:.*NOTICE:  //'

echo "④ 공통 불변식 검증"
"${PSQL[@]}" -f "$ROOT/scripts/sqltest/10_common.local.sql" 2>&1 | sed 's/^psql:.*NOTICE:  //'

if [ -f "$ROOT/scripts/sqltest/20_project.local.sql" ]; then
  echo "⑤ 프로젝트별 검증"
  "${PSQL[@]}" -f "$ROOT/scripts/sqltest/20_project.local.sql" 2>&1 | sed 's/^psql:.*NOTICE:  //'
fi

echo "⑥ 공용 프로젝트(data0901_) 검증"
"${PSQL[@]}" -f "$ROOT/scripts/sqltest/30_data0901_shared.local.sql" 2>&1 | sed 's/^psql:.*NOTICE:  //'

echo "⑦ 제공 자료 원본(originals/) 검증"
"${PSQL[@]}" -f "$ROOT/scripts/sqltest/35_data0901_originals.local.sql" 2>&1 | sed 's/^psql:.*NOTICE:  //'

echo "⑧ 수강생 관리자 지정 SQL 검증"
"${PSQL[@]}" -f "$ROOT/scripts/sqltest/36_data0901_student_admin.local.sql" 2>&1 | sed 's/^psql:.*NOTICE:  //'

echo "⑨ 기술지원 기록(등록·문의·회신·소스·메일·접속 Log) 검증"
# 37 은 파일을 스스로 지웠다가 다시 적용한다(\ir) — 깨뜨린 사본을 검사할 때는 그 사본을 가리키는 임시 사본을 쓴다
REC_TEST="$ROOT/scripts/sqltest/37_data0901_records.local.sql"
if [ "$REC_SQL" != "$ROOT/supabase/2026-09-30_data0901_records.sql" ]; then
  sed "s#\\ir ../../supabase/2026-09-30_data0901_records.sql#\\i '$REC_SQL'#" "$REC_TEST" > "$TMP/37.local.sql"
  REC_TEST="$TMP/37.local.sql"
fi
"${PSQL[@]}" -f "$REC_TEST" 2>&1 | sed 's/^psql:.*NOTICE:  //'

echo ""
echo "SQL 검증 통과."
