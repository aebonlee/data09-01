-- ============================================================================
-- data09-01 (hdx-ps) — 「제공 자료」 원본 보관 (기획서·DB 엑셀·화면구성·매뉴얼 PDF 원문 등)
--
--  실행 위치 : 공용 Supabase 프로젝트(hcmgdztsgjvzcyxyayaj) SQL Editor — 대표가 실행
--  전제      : 2026-09-30_data0901_auth.sql 을 먼저 실행(버킷 data0901-manuals·판정 함수)
--  재실행    : 안전합니다 (버킷 행 update 뿐 — 두 파일을 어느 순서로 몇 번 실행해도 결과가 같습니다)
--
--  무엇을 바꾸나
--    버킷 data0901-manuals 의 올릴 수 있는 형식·크기만 넓힙니다.
--      전 : application/gzip · application/json, 한 파일 50MB  → 매뉴얼 텍스트 색인만 올라감
--      후 : + PDF · Word · Excel · PowerPoint · 한글 · zip · 이미지 · 영상 · CSV/텍스트, 한 파일 100MB
--    원본은 같은 버킷의 originals/ 아래에 둡니다. 목록 파일 originals/_index.json 에 원래 이름을 적습니다
--    (Storage 경로에는 한글을 쓸 수 없어서).
--
--  권한은 그대로입니다 — auth SQL 의 Storage 정책 4개가 버킷 전체(경로 제한 없음)에 걸려 있습니다.
--    읽기 = 승인 회원(관리자 포함, data0901_is_approved) / 올리기·바꾸기·지우기 = 관리자(data0901_is_admin)
--    비로그인·승인 대기·반려 회원은 목록도 파일도 보지 못합니다. 버킷은 private 그대로입니다.
--
--  ⚠ 100MB 는 이 버킷의 한도입니다. 프로젝트 전체 한도(Dashboard → Storage → Settings →
--    Global file size limit)가 50MB 이면 50MB 가 넘는 파일(예: 100D-9V SM ENG.pdf 55MB)은 그 한도에서 막힙니다.
-- ============================================================================

do $pre$
begin
  if not exists (select 1 from storage.buckets where id = 'data0901-manuals') then
    raise exception '버킷 data0901-manuals 가 없습니다. 2026-09-30_data0901_auth.sql 을 먼저 실행해 주세요.';
  end if;
  if (select count(*) from pg_policy where polname like 'data0901\_manuals\_%') <> 4 then
    raise exception 'Storage 정책 data0901_manuals_* 4개가 없습니다. 2026-09-30_data0901_auth.sql 을 먼저 실행해 주세요.';
  end if;
end;
$pre$;

update storage.buckets
   set public = false,
       file_size_limit = 104857600,   -- 100MB
       allowed_mime_types = array[
         -- 매뉴얼 텍스트 색인 · 자료 목록
         'application/gzip', 'application/json',
         -- 문서
         'application/pdf',
         'application/vnd.openxmlformats-officedocument.wordprocessingml.document',   -- docx
         'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',         -- xlsx
         'application/vnd.openxmlformats-officedocument.presentationml.presentation', -- pptx
         'application/msword', 'application/vnd.ms-excel', 'application/vnd.ms-powerpoint',
         'application/x-hwp', 'application/haansofthwp', 'application/vnd.hancom.hwp', 'application/vnd.hancom.hwpx',
         'text/csv', 'text/plain', 'text/markdown',
         -- 묶음
         'application/zip', 'application/x-zip-compressed',
         -- 사진 · 영상
         'image/png', 'image/jpeg', 'image/gif', 'image/webp', 'image/svg+xml',
         'video/mp4', 'video/quicktime', 'video/webm',
         -- 브라우저가 형식을 모르는 파일(화면이 확장자로 못 정하면 이 값으로 올림)
         'application/octet-stream'
       ]
 where id = 'data0901-manuals';

-- ============================================================================
-- 실행 뒤 확인 (SQL Editor)
--   select id, public, file_size_limit, array_length(allowed_mime_types, 1) from storage.buckets
--    where id = 'data0901-manuals';                       -- false · 104857600 · 27
--   select name from storage.objects where bucket_id = 'data0901-manuals' and name like 'originals/%';
-- ============================================================================
