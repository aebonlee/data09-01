# Supabase DB 스크립트 — 지게차 AI 기술지원

## 이 사이트의 회원·매뉴얼 — `2026-09-30_data0901_auth.sql` (강사 공용 프로젝트)

https://hdx-ps.jobability.co.kr/ 의 구글·카카오 로그인 회원·승인과 매뉴얼 색인 보관용입니다. **강사가 공용 Supabase 프로젝트 SQL Editor 에서 한 번 실행**합니다(여러 번 실행해도 안전). 수강생 본인 프로젝트용인 아래 `schema.sql` 과는 별개입니다.

| 개체 | 용도 |
|---|---|
| `data0901_profiles` | 회원 기본 정보(이름·전화·이메일·딜러 여부·딜러사명·국가·지역·territory_cd) + 승인(`Pending`/`Approved`/`Rejected`)·권한(USER/ADMIN)·관리 지역 |
| `data0901_is_admin()` · `data0901_is_approved()` | 판정 함수 — 관리자 = www 관리자 또는 이 사이트에서 승인된 ADMIN |
| `data0901_guard_profile()` | 트리거 — 가입은 늘 승인 대기로, 승인·권한·관리 지역은 관리자만 바꿈(관리자가 자기 권한을 스스로 내리는 것도 막음) |
| 버킷 `data0901-manuals` (private) | 매뉴얼 쪽별 텍스트 색인(`*.manual.json.gz`). 읽기 = 승인 회원, 올리기·지우기 = 관리자 |

- 비로그인(anon)은 회원 표·판정 함수·매뉴얼 파일 모두 막혀 있습니다. 공용 `www_profiles`·`www_admins` 는 읽기만 하고 구조를 바꾸지 않습니다.
- 검증: `./scripts/sqltest/run.sh` — 임시 로컬 PostgreSQL 에 공용 개체 스텁(`scripts/sqltest/05_shared_stub.local.sql`)을 깔고 적용해 권한을 확인합니다(`30_data0901_shared.local.sql`).

## 수강생 본인 프로젝트용 — `schema.sql`

이 폴더에는 지금 브라우저에 저장되는 기술지원 기록을 Supabase(PostgreSQL) 표로 옮기기 위한 스크립트가 들어 있습니다.
스크립트만 먼저 준비해 둔 단계이며, 앱은 아직 localStorage 로 동작합니다.

## 왜 DB 가 필요한가

지금 도구는 모든 기록을 브라우저의 localStorage(`data09-01.db`) 한 곳에 저장합니다.
시연에는 충분하지만 실제 기술지원 업무에서는 다음 문제가 생깁니다.

- 정비사가 등록한 건을 PS 담당자(ADMIN)가 볼 수 없습니다. 기록이 정비사의 브라우저 안에만 있기 때문입니다.
- 정비사가 다른 PC·휴대폰으로 접속하면 자기가 등록한 건과 회신이 보이지 않습니다.
- 브라우저 데이터를 지우면 등록·문의·회신 이력이 모두 사라집니다.
- 접속 Log 는 보안 감사용인데, 본인 브라우저에 있으면 누구나 고치거나 지울 수 있습니다.
- USER/ADMIN 권한이 화면에서만 나뉘어 있어, 저장소를 직접 열면 남의 건도 보입니다.

DB 로 옮기면 기록이 한 곳에 모이고, 누가 무엇을 볼 수 있는지를 DB 가 직접 막습니다(RLS).

## 테이블

| 테이블 | 용도 | localStorage 대응 |
|---|---|---|
| `app_members` | 권한(USER/ADMIN). 관리자 판정의 기준입니다 | 없음 (새로 생김) |
| `users` | 사용자 (사용자 시트). 비밀번호 열은 없고 로그인은 Supabase Auth 가 맡습니다. 가입 승인(`approval`·`approved_by`·`approved_date`)·관리 지역(`manage_territory`) 칸 — 2026-09-29 | `data09-01.db` → `users` |
| `sources` | 소스등록 (모델 ↔ 노트북·매뉴얼 파일) | `data09-01.db` → `sources` |
| `mains` | 기술지원 등록 (ref_no 1건 = 1행, 상태·조치 내용·완료일·완료 사진 파일명) | `data09-01.db` → `mains` |
| `inquiries` | 문의 (ref_no × s_turn, 후속 요청마다 1행) | `data09-01.db` → `inquiries` |
| `replies` | 회신 (ref_no × r_turn) | `data09-01.db` → `replies` |
| `access_log` | 접속 Log (로그인·로그아웃 시각). 기록성 표라 수정·삭제가 되지 않습니다 | `data09-01.db` → `logs` |
| `mails` | PS 통보 메일 발송 대기 (AI 답변 불가·중복 등록). 같은 건·같은 사유의 대기 메일은 하나만 — 2026-09-29 | `data09-01.db` → `mails` |

`data09-01.session`(로그인 상태)은 Supabase Auth 세션으로 바뀌고, `data09-01.lang`(화면 언어)은 기기별 설정이라 그대로 브라우저에 둡니다.

필드 이름은 도구의 필드 이름(04_DB.xlsx 기준)을 그대로 씁니다.
코드값(status·type_cd·system_cat·territory_cd), ref_no 형식(12자리 숫자), 가동시간 DECIMAL(8,1), 완료일이 등록일보다 앞설 수 없다는 규칙은 DB 제약으로도 걸려 있습니다.

## 권한 규칙

| 누가 | 볼 수 있는 것 | 할 수 있는 것 |
|---|---|---|
| 정비사(USER, 승인 대기) | 자기 사용자 정보, 소스 목록 | 없음 — 관리자 승인을 기다립니다 |
| 정비사(USER, 승인됨) | 자기 등록 건·문의·회신, 자기 사용자 정보, 자기 접속 Log, 소스 목록 | 등록, 후속 요청, 조치 결과 등록, 자기 건의 중복 검토 메일 대기 등록 |
| PS 담당자(ADMIN) | 전부 | 가입 승인·관리 지역 지정, 회신 등록, 소스 등록, 권한 부여, 메일 보냄 표시 |
| 비로그인 | 없음 | 없음 |

- 관리자 여부는 `app_members.role` 만으로 정합니다. `users.user_type` 은 화면 표시용이며, 사용자가 스스로 ADMIN 으로 바꿀 수 없습니다.
- 접속 Log 는 INSERT·SELECT 만 열려 있습니다. 로그아웃 시각은 `close_access_log(id)` 함수로 본인 기록에 한 번만 채웁니다.
- 가입하면 `approval` 은 본인이 무엇을 적든 `Pending` 으로 들어가고, 승인·관리 지역은 관리자만 바꿉니다(트리거 `users_guard_approval`). 스크립트를 이미 만든 프로젝트에 다시 실행하면 기존 사용자는 `Approved` 로 채워집니다(쓰던 계정이 막히지 않도록).
- ID 는 대소문자만 달라도 같은 ID 로 봅니다(`lower(reg_id)` UNIQUE). 가입 화면의 중복 확인은 `reg_id_available(id)` 함수로 합니다(남의 행은 읽지 못하므로 있는지 여부만 돌려줌).
- 함수는 모두 로그인 사용자만 실행할 수 있습니다(비로그인 실행 권한 제거).

## 적용 방법

1. [supabase.com](https://supabase.com) 에 가입합니다.
2. New project 로 본인 프로젝트를 만듭니다.
3. 왼쪽 메뉴에서 SQL Editor 를 엽니다.
4. `supabase/schema.sql` 내용을 통째로 붙여 넣습니다.
5. Run 을 누릅니다.

여러 번 실행해도 안전합니다. 이미 있는 표와 데이터는 그대로 두고 정책·함수만 다시 만듭니다.

첫 관리자는 Authentication 에서 가입한 뒤 SQL Editor 에서 다음을 실행해 지정합니다(이메일만 바꿉니다).

```sql
insert into public.app_members (user_id, role)
select id, 'ADMIN' from auth.users where email = '관리자 이메일'
on conflict (user_id) do update set role = 'ADMIN';
update public.users set user_type = 'ADMIN', approval = 'Approved', approved_by = '(첫 관리자)', approved_date = current_date
 where owner_id = (select id from auth.users where email = '관리자 이메일');
```

## 확인 방법

- Table Editor 에 위 8개 표가 보이는지 확인합니다.
- Authentication → Policies 에서 표마다 RLS 가 켜져 있고(Enabled) 정책이 붙어 있는지 확인합니다.
- SQL Editor 에서 다음을 실행해 8개 표 모두 `true` 인지 봅니다.

```sql
select relname, relrowsecurity from pg_class
where relnamespace = 'public'::regnamespace and relkind = 'r' order by relname;
```

## 앱 연결은 다음 단계입니다

이 스크립트는 DB 틀만 만듭니다. 화면(`js/store.js`)은 아직 localStorage 를 씁니다.
앱을 DB 에 연결하는 작업(Supabase 클라이언트 추가, 로그인을 Supabase Auth 로 교체, 저장·조회를 표 단위로 교체)은 다음 단계에서 진행합니다.
연결할 때 upsert 는 `onConflict` 를 반드시 지정합니다(문의 `ref_no,s_turn`, 회신 `ref_no,r_turn`).

## 로컬 검증

운영 프로젝트에 올리기 전에 내 컴퓨터의 임시 PostgreSQL 에 실제로 적용해 검사합니다.
PostgreSQL 17(또는 16)이 설치되어 있어야 합니다(macOS: `brew install postgresql@17`).

```sh
./scripts/sqltest/run.sh
```

임시 DB 를 만들어 `schema.sql` 을 두 번 적용하고(재실행 안전성), 사용자 A·B·관리자·비로그인으로 바꿔 가며 RLS·제약·함수 권한을 검사한 뒤 지웁니다.
마지막 줄에 「SQL 검증 통과.」가 나오면 성공입니다.
`scripts/sqltest/*.local.sql` 은 검증 전용이며 운영 DB 에서는 스스로 실행을 멈춥니다. SQL Editor 에 붙여 넣지 않습니다.
