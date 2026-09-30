// 실행: node test/server-db.test.mjs   (의존성 없음)
// 2026-09-30 v0.8 — 기술지원 기록 서버 저장: 서버 행 ↔ 도구 행, 바뀐 것 고르기, 브라우저 기록 옮기기, SQL 과 짝 맞추기
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
const require = createRequire(import.meta.url);
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SD = require('../js/server-db.js');
const L = require('../js/logic.js');
const sql = readFileSync(join(ROOT, 'supabase/2026-09-30_data0901_records.sql'), 'utf8');
const src = readFileSync(join(ROOT, 'js/server-db.js'), 'utf8');

let passed = 0;
function test(name, fn) {
  try { fn(); passed++; console.log('  ok  ' + name); }
  catch (e) { console.error('  FAIL ' + name + '\n       ' + e.message); process.exitCode = 1; }
}
const NOW = new Date(2026, 8, 30, 10, 0);
function base() {
  const db = L.emptyDb();
  db.sources.push({ notebook_name: 'nb', model: '30BRP-X', files: 'a.pdf' });
  db.users.push({ reg_id: 'kim@example.com', req_name: '김', user_type: 'USER', territory_cd: '경기', approval: 'Approved' });
  return db;
}
const form = { model: '30brp-x', serial_no: 'SN1', o_hour: '12.5', type_cd: 'Troubleshooting', system_cat: 'Engine', phenomenon: '시동 불량', requirement: '점검' };
const user = { reg_id: 'kim@example.com', user_type: 'USER' };

console.log('서버 행 ↔ 도구 행');
test('등록: 빈 완료일은 null 로 보내고, 받으면 빈 칸', () => {
  const m = { ref_no: '202609300001', status: 'Submitted', reg_date: '2026-09-30', reg_id: 'kim@example.com', model: '30BRP-X', serial_no: 'SN1',
    o_hour: 12.5, type_cd: 'Troubleshooting', system_cat: 'Engine', action_content: '', complete_date: '', complete_image: '' };
  const row = SD.to.main(m);
  assert.equal(row.complete_date, null);
  assert.deepEqual(SD.from.main({ ...row, o_hour: '12.5', created_at: 'x' }), m);
});
test('메일·Log 시각은 브라우저 시간대의 YYYY-MM-DD HH:MM', () => {
  const at = new Date(2026, 8, 30, 9, 5).toISOString();
  assert.equal(SD.dt(at), '2026-09-30 09:05');
  assert.equal(SD.iso('2026-09-30 09:05'), at);
  assert.equal(SD.iso(''), null);
  assert.deepEqual(SD.from.log({ id: 3, user_id: 'u', reg_id: 'kim', login_at: at, logout_at: null }),
    { id: 3, user_id: 'u', reg_id: 'kim', login_date: '2026-09-30 09:05', logout_date: '' });
});
test('소스 모델은 대문자·앞뒤 공백 없이 (서버 트리거·UNIQUE(model) 과 같은 규칙)', () => {
  assert.equal(SD.to.source({ notebook_name: ' nb ', model: ' brp-9 ', files: '' }).model, 'BRP-9');
});

console.log('바뀐 것 고르기 (diff)');
test('새 등록 → 등록 insert + 문의 insert, 순서는 등록 먼저', () => {
  const prev = base();
  const r = L.createRequest(prev, form, user, NOW, []);
  const ops = SD.diff(prev, r.db);
  assert.deepEqual(ops.map(o => o.op + ':' + o.table), ['insert:data0901_requests', 'insert:data0901_inquiries']);
  assert.equal(ops[0].row.ref_no, r.ref_no);
});
test('아무것도 안 바뀌면 보낼 것 없음', () => assert.deepEqual(SD.diff(base(), base()), []));
test('회신 → 회신 insert + 등록 상태 update(ref_no 로)', () => {
  const a = L.createRequest(base(), form, user, NOW, []).db;
  const b = L.addReply(a, '202609300001', { reply_content: '필터 교체' }, NOW).db;
  const ops = SD.diff(a, b);
  assert.deepEqual(ops.map(o => o.op + ':' + o.table), ['update:data0901_requests', 'insert:data0901_replies']);
  assert.deepEqual(ops[0].match, { ref_no: '202609300001' });
  assert.equal(ops[0].row.status, 'Answered');
  assert.ok(!('reg_id' in ops[0].row) && !('ref_no' in ops[0].row), '아이디·번호는 고치지 않음');
});
test('후속 요청 → 2차 문의 insert, 1차 문의는 그대로', () => {
  const a = L.createRequest(base(), form, user, NOW, []).db;
  const b = L.addFollowUp(a, '202609300001', { ...form, phenomenon: '여전히' }, user, NOW, []).db;
  const ins = SD.diff(a, b).filter(o => o.table === 'data0901_inquiries');
  assert.equal(ins.length, 1);
  assert.equal(ins[0].op, 'insert');
  assert.equal(ins[0].row.s_turn, 2);
});
test('소스: 추가 insert · 고침 update(모델로) · 지움 delete', () => {
  const a = base();
  const b = L.upsertSource(a, { model: 'brp-9', notebook_name: 'n2' }).db;
  assert.deepEqual(SD.diff(a, b).map(o => o.op), ['insert']);
  const c = L.upsertSource(b, { model: '30brp-x', notebook_name: 'nb2', files: 'b.pdf' }).db;
  const up = SD.diff(b, c);
  assert.deepEqual(up.map(o => o.op + ':' + JSON.stringify(o.match)), ['update:{"model":"30BRP-X"}']);
  const d = JSON.parse(JSON.stringify(c)); d.sources = d.sources.filter(x => x.model.toUpperCase() !== 'BRP-9');
  assert.deepEqual(SD.diff(c, d).map(o => o.op + ':' + o.match.model), ['delete:BRP-9']);
});
test('새 메일 → data0901_queue_mail (번호·받는 사람은 서버가), 보냄 표시 → update(mail_id 로)', () => {
  const a = L.createRequest(base(), form, user, NOW, []).db;
  const q = L.queueMail(a, L.buildDupMail(a, '202609300001', ['202609290001']), NOW);
  const ops = SD.diff(a, q.db);
  assert.equal(ops.length, 1);
  assert.equal(ops[0].op, 'rpc');
  assert.equal(ops[0].name, 'data0901_queue_mail');
  assert.deepEqual(Object.keys(ops[0].args).sort(), ['p_body', 'p_mail_to', 'p_reason', 'p_ref_no', 'p_subject']);
  const sent = L.markMailSent(q.db, q.mail.mail_id, NOW).db;
  const ops2 = SD.diff(q.db, sent);
  assert.deepEqual(ops2.map(o => o.op + ':' + JSON.stringify(o.match)), ['update:{"mail_id":"' + q.mail.mail_id + '"}']);
  assert.equal(ops2[0].row.status, 'Sent');
});

console.log('번호 겹침 방지');
test('서버가 알려 준 그날 마지막 번호 다음으로 매긴다 (내 db 에 그 건이 없어도)', () => {
  const r = L.createRequest(base(), form, user, NOW, [], ['202609300007']);
  assert.equal(r.ref_no, '202609300008');
  assert.equal(L.createRequest(base(), form, user, NOW, []).ref_no, '202609300001', '넘기지 않으면 예전과 같음');
});

console.log('브라우저 기록 → 서버 (관리자, 한 번)');
test('서버에 없는 등록 건만, 문의·회신·메일을 함께 · 서버에 있는 번호는 통째로 건너뜀', () => {
  let local = base();
  local = L.createRequest(local, form, user, NOW, []).db;                    // 202609300001
  local = L.createRequest(local, { ...form, serial_no: 'SN2' }, user, NOW, []).db; // 202609300002
  local = L.addReply(local, '202609300002', { reply_content: '회신' }, NOW).db;
  local = L.queueMail(local, L.buildPsMail(local, '202609300002', '근거 없음'), NOW).db;
  local.logs.push({ reg_id: 'kim@example.com', login_date: '2026-09-30 09:00', logout_date: '' });
  const server = { mains: [{ ref_no: '202609300001' }], sources: [{ model: '30BRP-X' }] };
  const plan = SD.planMigration(local, server);
  assert.deepEqual(plan.requests.map(x => x.ref_no), ['202609300002']);
  assert.deepEqual(plan.inquiries.map(x => x.ref_no + '/' + x.s_turn), ['202609300002/1']);
  assert.deepEqual(plan.replies.map(x => x.ref_no), ['202609300002']);
  assert.equal(plan.mails.length, 1);
  assert.equal(plan.mails[0].mail_id, '', '메일 번호는 서버가 새로 매김');
  assert.equal(plan.sources.length, 0, '서버에 있는 모델은 건너뜀');
  assert.equal(plan.skipped, 1);
  assert.equal(plan.logs, 1, '접속 Log 는 옮기지 않고 개수만 알림');
});
test('옛 형식 번호(12자리 숫자 아님)는 올리지 않는다 (DB 제약에 걸림)', () => {
  const local = base(); local.mains.push({ ref_no: 'R-1', status: 'Submitted', reg_date: '2026-09-30', reg_id: 'x' });
  assert.equal(SD.planMigration(local, { mains: [], sources: [] }).requests.length, 0);
});
test('표·함수가 없으면(SQL 실행 전) missing 으로 알아본다', () => {
  assert.equal(SD.isMissing({ code: 'PGRST205', message: "Could not find the table 'public.data0901_requests' in the schema cache" }), true);
  assert.equal(SD.isMissing({ code: 'PGRST202', message: 'Could not find the function' }), true);
  assert.equal(SD.isMissing({ code: '42501', message: 'permission denied' }), false);
});

console.log('SQL 과 짝 맞추기');
test('도구가 쓰는 표 이름이 SQL 에 모두 있고 전부 data0901_ 접두사', () => {
  for (const t of Object.values(SD.TABLES)) {
    assert.ok(/^data0901_/.test(t), t);
    assert.ok(sql.includes('create table if not exists public.' + t + ' ('), t);
  }
});
test('upsert onConflict 글자가 SQL 의 UNIQUE 제약과 같다', () => {
  const pairs = [...src.matchAll(/up\(T\.(\w+), plan\.\w+, '([^']+)'\)/g)].map(m => [SD.TABLES[m[1]], m[2]]);
  assert.equal(pairs.length, 4);
  for (const [table, cols] of pairs) {
    const want = cols === 'ref_no' ? /ref_no\s+text primary key/ : new RegExp('unique \\(' + cols.replace(/,/g, ', ') + '\\)');
    const block = sql.slice(sql.indexOf('create table if not exists public.' + table + ' ('), sql.indexOf(');', sql.indexOf('create table if not exists public.' + table + ' (')));
    assert.ok(want.test(block), table + ' onConflict ' + cols);
  }
});
test('SQL 이 부르는 함수 이름 = 도구가 부르는 rpc 이름', () => {
  for (const fn of ['data0901_last_ref_no', 'data0901_find_duplicates', 'data0901_queue_mail', 'data0901_close_access_log']) {
    assert.ok(src.includes("'" + fn + "'"), 'js ' + fn);
    assert.ok(sql.includes('create or replace function public.' + fn + '('), 'sql ' + fn);
  }
});
test('SQL 의 상태·유형·구분 코드가 도구와 같다', () => {
  const inList = re => (sql.match(re) || [''])[0].match(/'([^']+)'/g).map(x => x.slice(1, -1));
  assert.deepEqual(inList(/status in \('Submitted'[^)]*\)/), Object.values(L.STATUS));
  assert.deepEqual(inList(/type_cd in \([^)]*\)/), L.TYPE_CD.map(x => x.code));
  assert.deepEqual(inList(/system_cat in \([^)]*\)/), L.SYSTEM_CAT.map(x => x.code));
});
test('SQL 파일은 data0901_ 밖의 개체를 만들거나 고치지 않는다 (글자 검사 — 실제 확인은 sqltest 하네스)', () => {
  const body = sql.replace(/--.*$/gm, '');
  const made = [...body.matchAll(/create (?:or replace )?(?:table|function|sequence|trigger|policy|unique index|index)(?: if not exists)? (?:public\.)?(\w+)/gi)].map(m => m[1]);
  assert.ok(made.length > 20);
  assert.deepEqual(made.filter(n => !/^data0901_/.test(n)), []);
  assert.deepEqual([...body.matchAll(/alter table (?:public\.)?(\w+)/gi)].map(m => m[1]).filter(n => !/^data0901_/.test(n)), []);
  assert.ok(!/\b(www_\w+|user_profiles)\b/.test(body), 'www_*·user_profiles 를 쓰지 않음');
  assert.ok(!/(insert into|update|delete from|alter table|drop \w+( if exists)?) auth\./i.test(body), 'auth 스키마를 바꾸지 않음');
});

console.log(`\n${passed} passed`);
