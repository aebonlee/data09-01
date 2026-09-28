// 실행: node test/logic.test.mjs   (의존성 없음)
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const L = require('../js/logic.js');
const Sample = require('../js/sample-data.js');

let passed = 0;
function test(name, fn) {
  try { fn(); passed++; console.log('  ok  ' + name); }
  catch (e) { console.error('  FAIL ' + name + '\n       ' + e.message); process.exitCode = 1; }
}

const NOW = new Date(2026, 8, 28, 10, 0); // 2026-09-28
const user = { reg_id: 'u1', user_type: 'USER' };
const other = { reg_id: 'u2', user_type: 'USER' };
function baseDb() {
  const db = L.emptyDb();
  db.sources.push({ notebook_name: 'nb', model: '30BRP-X', files: '' });
  db.users.push({ reg_id: 'u1', req_name: '가', dealer: 'D1', user_type: 'USER' },
    { reg_id: 'u2', req_name: '나', dealer: 'D2', user_type: 'USER' });
  return db;
}
const form = {
  model: '30brp-x', serial_no: 'UNFCFB18CF0000452', o_hour: '1234.5', type_cd: 'Troubleshooting',
  system_cat: 'Engine', phenomenon: '에러코드 219', requirement: '조치 사항'
};

console.log('ref_no 채번');
test('그날 첫 건은 yyyymmdd0001', () => assert.equal(L.nextRefNo([], NOW), '202609280001'));
test('같은 날 최대값 다음 번호', () => assert.equal(L.nextRefNo(['202609280001', '202609280007', '202609270099'], NOW), '202609280008'));
test('다른 날 번호는 영향 없음', () => assert.equal(L.nextRefNo(['202609279999'], NOW), '202609280001'));
test('하루 9999건 넘으면 오류', () => assert.throws(() => L.nextRefNo(['202609289999'], NOW)));

console.log('등록 검증');
test('정상 양식 통과', () => assert.equal(L.validateRequest(form, baseDb().sources).ok, true));
test('소스등록에 없는 모델은 model_not_registered', () => {
  const r = L.validateRequest({ ...form, model: 'ZZZ-1' }, baseDb().sources);
  assert.deepEqual(r.errors, [{ field: 'model', code: 'model_not_registered' }]);
});
test('빈 양식은 필수 7개 모두 오류', () => {
  const r = L.validateRequest({}, baseDb().sources);
  assert.deepEqual(r.errors.map(e => e.field).sort(),
    ['model', 'o_hour', 'phenomenon', 'requirement', 'serial_no', 'system_cat', 'type_cd']);
});
test('가동시간 DECIMAL(8,1): 소수 둘째 자리·문자 거부', () => {
  assert.equal(L.parseOHour('1234.55'), null);
  assert.equal(L.parseOHour('abc'), null);
  assert.equal(L.parseOHour('12345678'), null);
  assert.equal(L.parseOHour('1,234.5'), 1234.5);
  assert.equal(L.parseOHour(0), 0);
});
test('코드값 밖의 유형은 bad_code', () => {
  const r = L.validateRequest({ ...form, type_cd: 'Specificatio' }, baseDb().sources);
  assert.deepEqual(r.errors, [{ field: 'type_cd', code: 'bad_code' }]);
});
test('호기 20자 초과 거부', () => {
  const r = L.validateRequest({ ...form, serial_no: 'X'.repeat(21) }, baseDb().sources);
  assert.equal(r.errors[0].code, 'too_long');
});

console.log('신규 등록·후속 요청');
test('신규 등록: Submitted, s_turn 1, 모델은 소스 표기로 정규화, 첨부명 ref_no_n', () => {
  const r = L.createRequest(baseDb(), form, user, NOW, ['a.JPG', 'b.mp4', { name: 'noext', type: 'image/jpeg' }]);
  assert.equal(r.ok, true);
  assert.equal(r.ref_no, '202609280001');
  const m = r.db.mains[0];
  assert.equal(m.status, 'Submitted');
  assert.equal(m.model, '30BRP-X');
  assert.equal(m.o_hour, 1234.5);
  assert.equal(r.db.inquiries[0].s_turn, 1);
  assert.equal(r.db.inquiries[0].s_image, '202609280001_1.jpg; 202609280001_2.mp4; 202609280001_3');
});
test('신규 등록은 원본 db 를 바꾸지 않음', () => {
  const db = baseDb();
  L.createRequest(db, form, user, NOW, []);
  assert.equal(db.mains.length, 0);
});
test('후속 요청: s_turn 증가, 상태 다시 Submitted, 첨부 번호 이어짐', () => {
  let db = L.createRequest(baseDb(), form, user, NOW, ['a.jpg']).db;
  db = L.addReply(db, '202609280001', { reply_content: '회신' }, NOW).db;
  assert.equal(db.mains[0].status, 'Answered');
  const r = L.addFollowUp(db, '202609280001', { ...form, requirement: '추가 질문' }, user, NOW, ['c.png']);
  assert.equal(r.ok, true);
  assert.equal(r.s_turn, 2);
  assert.equal(r.db.mains[0].status, 'Submitted');
  assert.equal(r.db.inquiries[1].s_image, '202609280001_2.png');
  assert.equal(r.db.inquiries.length, 2);
});
test('남의 건은 후속 요청 불가', () => {
  const db = L.createRequest(baseDb(), form, user, NOW, []).db;
  const r = L.addFollowUp(db, '202609280001', form, other, NOW, []);
  assert.equal(r.errors[0].code, 'not_owner');
});
test('최근 1달 팝업: 본인 건만, 1달 이내만, 최신순', () => {
  const db = baseDb();
  db.mains.push(
    { ref_no: '202608270001', reg_id: 'u1', reg_date: '2026-08-27' },
    { ref_no: '202608280001', reg_id: 'u1', reg_date: '2026-08-28' },
    { ref_no: '202609200001', reg_id: 'u1', reg_date: '2026-09-20' },
    { ref_no: '202609210001', reg_id: 'u2', reg_date: '2026-09-21' });
  assert.deepEqual(L.recentOwnRequests(db, 'u1', NOW).map(m => m.ref_no), ['202609200001', '202608280001']);
});
test('1달 전 계산: 3/31 → 2월 말일', () => {
  assert.equal(L.toDateStr(L.oneMonthBefore(new Date(2026, 2, 31))), '2026-02-28');
});

console.log('AI 회신 (반자동)');
test('프롬프트에 모델·호기·현상·답변 형식 머리말이 들어감', () => {
  const db = L.createRequest(baseDb(), form, user, NOW, []).db;
  const p = L.buildAiPrompt(db, '202609280001');
  for (const s of ['30BRP-X', 'UNFCFB18CF0000452', '에러코드 219', '[제목]', '[요약]', '[회신]', '[근거]', '[답변불가]', 'nb']) {
    assert.ok(p.includes(s), s + ' 없음');
  }
});
test('붙여 넣은 답변을 4개 필드로 나눔 (순서가 섞여도)', () => {
  const r = L.parseAiAnswer('**[근거]** 매뉴얼 p.10; 매뉴얼 p.11\n[제목] 에러 219\n[요약] 요약문\n[회신] 1. 점검\n2. 조치');
  assert.equal(r.r_title, '에러 219');
  assert.equal(r.req_summary, '요약문');
  assert.equal(r.reply_content, '1. 점검\n2. 조치');
  assert.equal(r.ref_info, '매뉴얼 p.10; 매뉴얼 p.11');
  assert.deepEqual(r.missing, []);
});
test('머리말이 없으면 전체를 회신 내용으로, 빠진 항목 표시', () => {
  const r = L.parseAiAnswer('그냥 답변');
  assert.equal(r.reply_content, '그냥 답변');
  assert.deepEqual(r.missing, ['r_title', 'req_summary', 'ref_info']);
});
test('[답변불가] 는 cannotAnswer', () => {
  const r = L.parseAiAnswer('[답변불가] 매뉴얼에 해당 에러코드가 없습니다.');
  assert.equal(r.cannotAnswer, true);
  assert.equal(r.reply_content, '매뉴얼에 해당 에러코드가 없습니다.');
});
test('회신 저장: r_turn 증가, 상태 Answered, 빈 회신 거부', () => {
  let db = L.createRequest(baseDb(), form, user, NOW, []).db;
  assert.equal(L.addReply(db, '202609280001', { reply_content: ' ' }, NOW).ok, false);
  db = L.addReply(db, '202609280001', { reply_content: 'a' }, NOW).db;
  const r = L.addReply(db, '202609280001', { reply_content: 'b' }, NOW);
  assert.equal(r.r_turn, 2);
  assert.equal(r.db.mains[0].status, 'Answered');
});
test('종료는 회신 받은 건만', () => {
  let db = L.createRequest(baseDb(), form, user, NOW, []).db;
  assert.equal(L.completeRequest(db, '202609280001', { action_content: '조치' }, NOW).errors[0].code, 'not_answered');
  db = L.addReply(db, '202609280001', { reply_content: 'a' }, NOW).db;
  assert.equal(L.completeRequest(db, '202609280001', { action_content: '조치' }, NOW).db.mains[0].status, 'Completed');
});
test('PS 메일 초안에 기준번호·현상 포함', () => {
  const db = L.createRequest(baseDb(), form, user, NOW, []).db;
  const m = L.buildPsMail(db, '202609280001', '근거 없음');
  assert.ok(m.subject.includes('202609280001'));
  assert.ok(m.body.includes('에러코드 219') && m.body.includes('근거 없음'));
});

console.log('조치 결과(조치 내용·완료일) — 2026-09-28 수강생 확인');
function answeredDb() {
  // 등록일 2026-09-20, 회신까지 받은 건
  let db = L.createRequest(baseDb(), form, user, new Date(2026, 8, 20), []).db;
  return L.addReply(db, '202609200001', { reply_content: '회신' }, new Date(2026, 8, 21)).db;
}
test('종료 시 조치 내용·완료일 저장, 상태 Completed', () => {
  const r = L.completeRequest(answeredDb(), '202609200001', { action_content: ' 커넥터 재체결 ', complete_date: '2026-09-25' }, NOW);
  assert.equal(r.ok, true);
  const m = r.db.mains[0];
  assert.equal(m.status, 'Completed');
  assert.equal(m.action_content, '커넥터 재체결');
  assert.equal(m.complete_date, '2026-09-25');
});
test('완료일을 비우면 오늘 날짜, 2026.09.27 표기도 받음', () => {
  assert.equal(L.completeRequest(answeredDb(), '202609200001', { action_content: 'x' }, NOW).db.mains[0].complete_date, '2026-09-28');
  assert.equal(L.completeRequest(answeredDb(), '202609200001', { action_content: 'x', complete_date: '2026.09.27' }, NOW).db.mains[0].complete_date, '2026-09-27');
});
test('조치 내용 없으면 required, 원본 db 는 그대로', () => {
  const db = answeredDb();
  const r = L.completeRequest(db, '202609200001', { action_content: '  ' }, NOW);
  assert.deepEqual(r.errors, [{ field: 'action_content', code: 'required' }]);
  assert.equal(db.mains[0].status, 'Answered');
});
test('완료일: 등록일 이전·미래·형식 오류 거부, 등록일·오늘 당일은 허용', () => {
  const c = d => L.completeRequest(answeredDb(), '202609200001', { action_content: 'x', complete_date: d }, NOW);
  assert.equal(c('2026-09-19').errors[0].code, 'date_before_reg');
  assert.equal(c('2026-09-29').errors[0].code, 'date_future');
  assert.equal(c('어제').errors[0].code, 'bad_date');
  assert.equal(c('2026-09-20').ok, true);
  assert.equal(c('2026-09-28').ok, true);
});
test('종료된 건은 후속 요청 불가(already_completed)', () => {
  const db = L.completeRequest(answeredDb(), '202609200001', { action_content: 'x' }, NOW).db;
  assert.equal(L.addFollowUp(db, '202609200001', form, user, NOW, []).errors[0].code, 'already_completed');
});
test('신규 등록 행에 빈 조치 필드, 목록 행에 완료일·조치 내용', () => {
  const db = L.completeRequest(answeredDb(), '202609200001', { action_content: '조치함', complete_date: '2026-09-22' }, NOW).db;
  const fresh = L.createRequest(baseDb(), form, user, NOW, []).db.mains[0];
  assert.equal(fresh.action_content, '');
  assert.equal(fresh.complete_date, '');
  const row = L.buildListRows(db)[0];
  assert.equal(row.complete_date, '2026-09-22');
  assert.equal(row.action_content, '조치함');
});

console.log('첨부 제한(사진 5장·영상 1개 60초) — 2026-09-28 수강생 확인');
const imgs = n => Array.from({ length: n }, (_, i) => 'p' + i + '.jpg');
test('사진 5장은 통과, 6장은 too_many_images', () => {
  assert.equal(L.validateAttachments(imgs(5)).ok, true);
  assert.deepEqual(L.validateAttachments(imgs(6)).errors, [{ field: 's_image', code: 'too_many_images' }]);
});
test('영상 1개 통과, 2개는 too_many_videos', () => {
  const v = s => ({ name: 'v.mp4', type: 'video/mp4', duration: s });
  assert.equal(L.validateAttachments([v(10), ...imgs(5)]).ok, true);
  assert.equal(L.validateAttachments([v(10), v(10)]).errors[0].code, 'too_many_videos');
});
test('영상 길이: 60초 통과, 60.5초·61초 video_too_long', () => {
  const v = s => [{ name: 'v.mov', type: 'video/quicktime', duration: s }];
  assert.equal(L.validateAttachments(v(60)).ok, true);
  assert.equal(L.validateAttachments(v(60.5)).errors[0].code, 'video_too_long');
  assert.equal(L.validateAttachments(v(61)).errors[0].code, 'video_too_long');
});
test('영상 길이를 모르면(null·NaN·Infinity·파일명만) 막지 않고 경고', () => {
  for (const f of [{ name: 'a.mp4', duration: null }, { name: 'a.mp4', duration: NaN }, { name: 'a.webm', duration: Infinity }, 'a.mp4']) {
    const r = L.validateAttachments([f]);
    assert.equal(r.ok, true);
    assert.equal(r.warnings[0].code, 'video_duration_unknown');
  }
});
test('종류 판정: MIME 우선, 없으면 확장자, 그 밖은 bad_file_type', () => {
  assert.equal(L.attachKind({ name: 'IMG_0001', type: 'image/heic' }), 'image');
  assert.equal(L.attachKind('clip.MOV'), 'video');
  assert.equal(L.attachKind('photo.HEIC'), 'image');
  assert.equal(L.validateAttachments(['manual.pdf']).errors[0].code, 'bad_file_type');
});
test('등록·후속 요청 모두 제출 1회마다 제한 적용, 초과면 저장 안 함', () => {
  const r = L.createRequest(baseDb(), form, user, NOW, imgs(6));
  assert.equal(r.ok, false);
  assert.deepEqual(r.errors, [{ field: 's_image', code: 'too_many_images' }]);
  let db = L.createRequest(baseDb(), form, user, NOW, imgs(5)).db;
  const f2 = L.addFollowUp(db, '202609280001', form, user, NOW, imgs(5));
  assert.equal(f2.ok, true);
  assert.equal(L.splitList(f2.db.inquiries[1].s_image)[0], '202609280001_6.jpg');
  assert.equal(L.addFollowUp(db, '202609280001', form, user, NOW, [{ name: 'v.mp4', duration: 75 }]).errors[0].code, 'video_too_long');
});

console.log('조회·필터');
function listDb() {
  let db = L.createRequest(baseDb(), form, user, NOW, []).db;
  db = L.createRequest(db, { ...form, type_cd: 'Maintenance' }, other, new Date(2026, 8, 20), []).db;
  db = L.addFollowUp(db, '202609280001', form, user, NOW, []).db;
  db = L.addReply(db, '202609280001', { r_title: '제목2', reply_content: '회신' }, NOW).db;
  return db;
}
test('목록 행: 접수 횟수 = 최대 s_turn, 제목 = 최근 회신, 이름·딜러 결합', () => {
  const rows = L.buildListRows(listDb());
  const r = rows.find(x => x.ref_no === '202609280001');
  assert.equal(r.count, 2);
  assert.equal(r.r_title, '제목2');
  assert.equal(r.req_name, '가');
  assert.equal(r.dealer, 'D1');
});
test('User 조회는 본인 건만', () => {
  assert.deepEqual(L.filterRows(L.buildListRows(listDb()), { reg_id: 'u2' }).map(r => r.ref_no), ['202609200001']);
});
test('기간·모델(대소문자 무시)·딜러·유형 필터', () => {
  const rows = L.buildListRows(listDb());
  assert.equal(L.filterRows(rows, { from: '2026-09-21', to: '2026-09-30' }).length, 1);
  assert.equal(L.filterRows(rows, { model: 'brp' }).length, 2);
  assert.equal(L.filterRows(rows, { dealer: 'D2' }).length, 1);
  assert.equal(L.filterRows(rows, { type_cd: 'Maintenance' })[0].ref_no, '202609200001');
});

console.log('접속 Log');
test('유지 시간 계산', () => {
  assert.equal(L.sessionMinutes('2026-09-28 09:10', '2026-09-28 10:42'), 92);
  assert.equal(L.formatDuration(92), '1시간 32분');
  assert.equal(L.sessionMinutes('2026-09-28 09:10', ''), null);
});
test('로그 필터: 사용자 이름/ID, 기간', () => {
  const db = baseDb();
  db.logs.push({ reg_id: 'u1', login_date: '2026-09-01 09:00', logout_date: '2026-09-01 09:30' },
    { reg_id: 'u2', login_date: '2026-09-20 09:00', logout_date: '' });
  assert.equal(L.buildLogRows(db, { user: '나' }).length, 1);
  assert.equal(L.buildLogRows(db, { from: '2026-09-10' })[0].reg_id, 'u2');
});

console.log('소스등록');
test('신규 등록, 같은 모델은 갱신하며 파일명 합침', () => {
  let r = L.upsertSource(L.emptyDb(), { model: 'A-1', notebook_name: 'nb', files: 'a.pdf' });
  r = L.upsertSource(r.db, { model: 'a-1', notebook_name: 'nb2', files: 'b.pdf; a.pdf' });
  assert.equal(r.updated, true);
  assert.equal(r.db.sources.length, 1);
  assert.equal(r.db.sources[0].files, 'a.pdf; b.pdf');
  assert.equal(L.upsertSource(L.emptyDb(), { model: '' }).ok, false);
});

console.log('내보내기·가져오기');
test('CSV: BOM·따옴표·줄바꿈 이스케이프', () => {
  const csv = L.toCsv([{ key: 'a', label: 'a' }], [{ a: '쉼표,"따옴표"\n줄' }]);
  assert.equal(csv, '﻿a\r\n"쉼표,""따옴표""\n줄"');
});
test('엑셀 시트 왕복: dbToSheets → sheetsToDb 가 같은 데이터', () => {
  const db = Sample.build(NOW);
  const back = L.sheetsToDb(L.dbToSheets(db));
  for (const k of ['mains', 'inquiries', 'replies', 'users', 'sources', 'logs']) {
    assert.deepEqual(back.db[k], db[k], k);
  }
  assert.deepEqual(back.report.problems, []);
});
test('수강생 원본 형식(제목 행 + 코드 안내 행, 오타 Specificatio) 읽기', () => {
  const sheets = {
    '등록': [['Main Data'], L.SHEETS['등록'], ['', '색으로 상태 구분', '', '', '', '', '', 'Troubleshooting(고장진단)'],
      ['202609280001', 'Submitted', '2026.09.28', 'u1', '30BRP-X', 'S1', '12.5', 'Specificatio', 'Engine']],
    '문의': [['문의정보'], L.SHEETS['문의'], ['202609280009', 1, '2026-09-28', 'u1', 'x', 'y', '']]
  };
  const r = L.sheetsToDb(sheets);
  assert.equal(r.db.mains.length, 1);
  assert.equal(r.db.mains[0].type_cd, 'Specification');
  assert.equal(r.db.mains[0].reg_date, '2026-09-28');
  assert.ok(r.report.problems.some(p => p.includes('등록에 없는 ref_no')));
});

test('옛 등록 시트(조치 열 없음)도 읽고 두 필드는 빈 값', () => {
  const r = L.sheetsToDb({ '등록': [L.SHEETS['등록'].slice(0, 9),
    ['202609280001', 'Answered', '2026-09-28', 'u1', '30BRP-X', 'S1', '12.5', 'Troubleshooting', 'Engine']] });
  assert.equal(r.db.mains[0].action_content, '');
  assert.equal(r.db.mains[0].complete_date, '');
});
test('새 등록 시트: 완료일 표기 정규화, 유형 대소문자·오타 정규화', () => {
  const r = L.sheetsToDb({ '등록': [L.SHEETS['등록'],
    ['202609280001', 'Completed', '2026-09-28', 'u1', '30BRP-X', 'S1', '1', 'specification', 'Engine', '재체결', '2026.09.29'],
    ['202609280002', 'Submitted', '2026-09-28', 'u1', '30BRP-X', 'S1', '1', 'SPECIFICATIO', 'Engine', '', '']] });
  assert.equal(r.db.mains[0].complete_date, '2026-09-29');
  assert.equal(r.db.mains[0].action_content, '재체결');
  assert.equal(r.db.mains[0].type_cd, 'Specification');
  assert.equal(r.db.mains[1].type_cd, 'Specification');
});
test('화면·코드값에 쓰는 유형 표기는 Specification 하나(오타 표기 없음)', () => {
  assert.deepEqual(L.TYPE_CD.map(t => t.code), ['Troubleshooting', 'Maintenance', 'Specification']);
});

console.log('예시 데이터');
test('예시 데이터 자체 정합성: 코드값·ref_no 형식·참조·소스 모델', () => {
  const db = Sample.build(NOW);
  const refs = new Set(db.mains.map(m => m.ref_no));
  assert.equal(refs.size, db.mains.length);
  for (const m of db.mains) {
    assert.match(m.ref_no, /^\d{12}$/);
    assert.ok(L.STATUS_META[m.status], m.status);
    assert.ok(L.TYPE_CD.some(t => t.code === m.type_cd));
    assert.ok(L.SYSTEM_CAT.some(t => t.code === m.system_cat));
    assert.ok(L.findSource(db.sources, m.model), m.model);
    assert.ok(db.users.some(u => u.reg_id === m.reg_id));
    assert.equal(m.ref_no.slice(0, 8), m.reg_date.replace(/-/g, ''));
    if (m.status === 'Completed') assert.ok(m.action_content && m.complete_date >= m.reg_date, m.ref_no + ' 조치 결과');
    else assert.equal(m.complete_date, '');
  }
  for (const q of [...db.inquiries, ...db.replies]) assert.ok(refs.has(q.ref_no));
  assert.ok(L.recentOwnRequests(db, 'demo_user01', NOW).length >= 2);
});

console.log(process.exitCode ? '\n실패가 있습니다.' : '\n전체 ' + passed + '개 통과');
