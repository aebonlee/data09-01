// 실행: node test/logic.test.mjs   (의존성 없음)
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const L = require('../js/logic.js');
const Sample = require('../js/sample-data.js');
const M = require('../js/manual.js');

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
  for (const k of ['mains', 'inquiries', 'replies', 'users', 'sources', 'logs', 'mails']) {
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

console.log('완료 사진 (2026-09-29)');
function answered() {
  const db = baseDb();
  db.mains.push({ ref_no: '202609200001', status: 'Answered', reg_date: '2026-09-20', reg_id: 'u1', model: '30BRP-X', serial_no: 'S1', o_hour: 1, type_cd: 'Troubleshooting', system_cat: 'Engine', action_content: '', complete_date: '', complete_image: '' });
  return db;
}
test('완료 사진 파일명은 ref_no_C일련번호 + 원래 확장자', () => {
  const r = L.completeRequest(answered(), '202609200001', { action_content: 'x', complete_image: [{ name: 'a.JPG', type: 'image/jpeg' }, 'b.png'] }, NOW);
  assert.equal(r.ok, true);
  assert.equal(r.db.mains[0].complete_image, '202609200001_C1.jpg; 202609200001_C2.png');
});
test('완료 사진 없어도 종료(선택 항목), 칸은 빈 값', () => {
  assert.equal(L.completeRequest(answered(), '202609200001', { action_content: 'x' }, NOW).db.mains[0].complete_image, '');
});
test('완료 사진 6장·영상·문서는 거부', () => {
  const six = Array.from({ length: 6 }, (_, i) => 'p' + i + '.jpg');
  assert.deepEqual(L.completeRequest(answered(), '202609200001', { action_content: 'x', complete_image: six }, NOW).errors,
    [{ field: 'complete_image', code: 'too_many_images' }]);
  const five = L.completeRequest(answered(), '202609200001', { action_content: 'x', complete_image: six.slice(0, 5) }, NOW);
  assert.equal(five.ok, true);
  assert.ok(L.completeRequest(answered(), '202609200001', { action_content: 'x', complete_image: ['v.mp4'] }, NOW).errors.some(e => e.code === 'photo_only'));
  assert.ok(L.completeRequest(answered(), '202609200001', { action_content: 'x', complete_image: ['doc.pdf'] }, NOW).errors.some(e => e.code === 'bad_file_type'));
});

console.log('회원 등록·승인 (2026-09-29)');
const joinForm = { reg_id: 'kim01', req_name: '김', e_mail: 'kim@example.com', dealer: 'D', territory_cd: '경기' };
function withAdmin() {
  const db = L.emptyDb();
  db.users.push({ reg_id: 'boss', req_name: '관리', e_mail: 'boss@example.com', dealer: 'HQ', user_type: 'ADMIN', territory_cd: 'Direct Sales', approval: 'Approved', manage_territory: '경기; 경남' });
  return db;
}
test('중복 ID: 대소문자만 달라도 같은 ID, 규칙 밖 ID 거부', () => {
  const db = withAdmin();
  assert.equal(L.checkRegId(db, 'BOSS').code, 'id_taken');
  assert.equal(L.checkRegId(db, ' boss ').code, 'id_taken');
  assert.equal(L.checkRegId(db, 'boss2').ok, true);
  assert.equal(L.checkRegId(db, 'ab').code, 'bad_id');
  assert.equal(L.checkRegId(db, '_abc').code, 'bad_id');
  assert.equal(L.checkRegId(db, 'a'.repeat(21)).code, 'bad_id');
  assert.equal(L.checkRegId(db, '김봉수').code, 'bad_id');
  assert.equal(L.checkRegId(db, '').code, 'required');
});
test('가입하면 승인 대기(USER), 대기·반려 계정은 로그인 불가', () => {
  const r = L.registerMember(withAdmin(), joinForm, NOW);
  assert.equal(r.ok, true);
  assert.equal(r.autoApproved, false);
  assert.equal(r.user.approval, 'Pending');
  assert.equal(r.user.user_type, 'USER');
  assert.equal(L.canLogin(r.db, 'kim01').code, 'pending');
  assert.equal(L.canLogin(r.db, 'nobody').code, 'unknown_id');
  const rej = L.updateMember(r.db, 'kim01', { approval: 'Rejected' }, r.db.users[0], NOW);
  assert.equal(L.canLogin(rej.db, 'kim01').code, 'rejected');
});
test('가입 양식: 같은 ID 두 번·이메일 형식·지역 코드 검사', () => {
  const r = L.registerMember(withAdmin(), joinForm, NOW);
  assert.deepEqual(L.registerMember(r.db, { ...joinForm, reg_id: 'KIM01' }, NOW).errors, [{ field: 'reg_id', code: 'id_taken' }]);
  assert.deepEqual(L.registerMember(withAdmin(), { ...joinForm, e_mail: 'x@y' }, NOW).errors, [{ field: 'e_mail', code: 'bad_email' }]);
  assert.deepEqual(L.registerMember(withAdmin(), { ...joinForm, territory_cd: '서울' }, NOW).errors, [{ field: 'territory_cd', code: 'bad_code' }]);
});
test('관리자가 승인하면 로그인 가능, 승인자·승인일 기록', () => {
  const r = L.registerMember(withAdmin(), joinForm, NOW);
  const a = L.updateMember(r.db, 'kim01', { approval: 'Approved' }, r.db.users[0], NOW);
  assert.equal(a.ok, true);
  assert.equal(L.canLogin(a.db, 'KIM01').ok, true);
  assert.equal(a.user.approved_by, 'boss');
  assert.equal(a.user.approved_date, '2026-09-28');
});
test('승인 대기 계정·일반 사용자는 승인할 수 없다', () => {
  const r = L.registerMember(withAdmin(), joinForm, NOW);
  const r2 = L.registerMember(r.db, { ...joinForm, reg_id: 'lee01' }, NOW);
  assert.equal(L.updateMember(r2.db, 'lee01', { approval: 'Approved' }, r2.db.users[1], NOW).errors[0].code, 'not_admin');
  const pendingAdmin = { ...r2.db.users[1], user_type: 'ADMIN' };
  assert.equal(L.updateMember(r2.db, 'lee01', { approval: 'Approved' }, pendingAdmin, NOW).errors[0].code, 'not_admin');
});
test('빈 DB 첫 가입자만 관리자로 자동 승인', () => {
  const r = L.registerMember(L.emptyDb(), joinForm, NOW);
  assert.equal(r.autoApproved, true);
  assert.equal(r.user.user_type, 'ADMIN');
  assert.equal(L.canLogin(r.db, 'kim01').ok, true);
  assert.equal(L.registerMember(r.db, { ...joinForm, reg_id: 'lee01' }, NOW).autoApproved, false);
});
test('마지막 승인 관리자는 내리거나 중지할 수 없다', () => {
  const db = withAdmin();
  assert.equal(L.updateMember(db, 'boss', { user_type: 'USER' }, db.users[0], NOW).errors[0].code, 'last_admin');
  assert.equal(L.updateMember(db, 'boss', { approval: 'Rejected' }, db.users[0], NOW).errors[0].code, 'last_admin');
});
test('관리 지역: 코드값만·중복 제거, USER 로 내리면 비움', () => {
  const r = L.registerMember(withAdmin(), joinForm, NOW);
  const a = L.updateMember(r.db, 'kim01', { approval: 'Approved', user_type: 'ADMIN', manage_territory: ['경기', '서울', '경기', 'Europe'] }, r.db.users[0], NOW);
  assert.equal(a.user.manage_territory, '경기; Europe');
  const b = L.updateMember(a.db, 'kim01', { user_type: 'USER' }, a.db.users[0], NOW);
  assert.equal(b.user.manage_territory, '');
});
test('승인 칸 없는 옛 사용자·옛 엑셀은 승인된 것으로 본다', () => {
  assert.equal(L.isApproved({ reg_id: 'x' }), true);
  const r = L.sheetsToDb({ '사용자': [L.SHEETS['사용자'].slice(0, 9), ['old1', '옛', '', '', 'KR', 'D', '2026-01-01', 'USER', '경기']] });
  assert.equal(r.db.users[0].approval, 'Approved');
  assert.equal(L.canLogin(r.db, 'old1').ok, true);
});

console.log('중복 등록·PS 메일 (2026-09-29)');
function dupDb() {
  const db = withAdmin();
  db.users.push({ reg_id: 'gl', req_name: '해외', e_mail: 'gl@example.com', dealer: 'HQ', user_type: 'ADMIN', territory_cd: 'Direct Sales', approval: 'Approved', manage_territory: 'Europe' },
    { reg_id: 'u1', req_name: '가', dealer: 'D1', user_type: 'USER', territory_cd: '경기', approval: 'Approved' },
    { reg_id: 'u9', req_name: '나', dealer: 'D9', user_type: 'USER', territory_cd: '강원', approval: 'Approved' });
  db.sources.push({ notebook_name: 'nb', model: '30BRP-X', files: '' });
  return db;
}
test('같은 모델·호기의 진행 중 건은 중복, 다른 호기·오래된 종료 건은 아님', () => {
  let db = dupDb();
  db.mains.push(
    { ref_no: '202609010001', status: 'Answered', reg_date: '2026-09-01', reg_id: 'u9', model: '30BRP-X', serial_no: 'unf 452', o_hour: 1, type_cd: 'Troubleshooting', system_cat: 'Engine' },
    { ref_no: '202608010001', status: 'Completed', reg_date: '2026-08-01', reg_id: 'u1', model: '30BRP-X', serial_no: 'UNF452', o_hour: 1, type_cd: 'Troubleshooting', system_cat: 'Engine' },
    { ref_no: '202609100001', status: 'Completed', reg_date: '2026-09-10', reg_id: 'u1', model: '30BRP-X', serial_no: 'UNF452', o_hour: 1, type_cd: 'Troubleshooting', system_cat: 'Engine' },
    { ref_no: '202609150001', status: 'Submitted', reg_date: '2026-09-15', reg_id: 'u1', model: '30BRP-X', serial_no: 'OTHER', o_hour: 1, type_cd: 'Troubleshooting', system_cat: 'Engine' });
  const r = L.createRequest(db, { ...form, serial_no: 'UNF452' }, { reg_id: 'u1', user_type: 'USER' }, NOW);
  assert.equal(r.ok, true);
  // 진행 중(09-01, 호기 공백·대소문자 무시) + 1달 안 종료(09-10). 1달 넘은 종료(08-01)·다른 호기는 빠짐
  assert.deepEqual(r.duplicates, ['202609100001', '202609010001']);
  const r2 = L.createRequest(db, { ...form, serial_no: 'NEW-1' }, { reg_id: 'u1', user_type: 'USER' }, NOW);
  assert.deepEqual(r2.duplicates, []);
});
test('PS 메일 받는 사람: 요청자 지역 담당 관리자, 없으면 전원(fallback)', () => {
  const db = dupDb();
  db.mains.push({ ref_no: '202609280001', status: 'Submitted', reg_date: '2026-09-28', reg_id: 'u1', model: '30BRP-X', serial_no: 'S', o_hour: 1, type_cd: 'Troubleshooting', system_cat: 'Engine' },
    { ref_no: '202609280002', status: 'Submitted', reg_date: '2026-09-28', reg_id: 'u9', model: '30BRP-X', serial_no: 'S2', o_hour: 1, type_cd: 'Troubleshooting', system_cat: 'Engine' });
  const a = L.psRecipients(db, '202609280001');
  assert.deepEqual(a.to, ['boss@example.com']);
  assert.equal(a.fallback, false);
  const b = L.psRecipients(db, '202609280002'); // 강원 담당 없음
  assert.deepEqual(b.to, ['boss@example.com', 'gl@example.com']);
  assert.equal(b.fallback, true);
  // 승인 안 된 관리자는 받지 않는다
  db.users[0].approval = 'Pending';
  assert.deepEqual(L.psRecipients(db, '202609280001').to, ['gl@example.com']);
});
test('AI 답변 불가·중복 메일 초안: 받는 사람·제목·기 등록 건 목록', () => {
  const db = dupDb();
  db.mains.push({ ref_no: '202609270001', status: 'Answered', reg_date: '2026-09-27', reg_id: 'u9', model: '30BRP-X', serial_no: 'S', o_hour: 1, type_cd: 'Troubleshooting', system_cat: 'Engine' });
  db.inquiries.push({ ref_no: '202609270001', s_turn: 1, phenomenon: '먼저 건', requirement: 'r' });
  const r = L.createRequest(db, { ...form, serial_no: 'S' }, { reg_id: 'u1', user_type: 'USER' }, NOW);
  const dm = L.buildDupMail(r.db, r.ref_no, r.duplicates);
  assert.equal(dm.reason, 'duplicate');
  assert.deepEqual(dm.to, ['boss@example.com']);
  assert.ok(dm.subject.includes('중복') && dm.body.includes('202609270001') && dm.body.includes('먼저 건'));
  const cm = L.buildPsMail(r.db, r.ref_no, '근거 없음');
  assert.equal(cm.reason, 'cannot_answer');
  assert.ok(cm.body.includes('근거 없음') && cm.body.includes('지역 경기'));
});
test('mailto: 받는 사람 쉼표, 제목·본문 인코딩', () => {
  const href = L.mailtoHref({ to: ['a@x.com', 'b@x.com'], subject: '제목 & 1', body: '줄1\n줄2' });
  assert.equal(href, 'mailto:a@x.com,b@x.com?subject=' + encodeURIComponent('제목 & 1') + '&body=' + encodeURIComponent('줄1\n줄2'));
  assert.equal(L.mailtoHref({ mail_to: 'a@x.com; b@x.com', subject: '', body: '' }).startsWith('mailto:a@x.com,b@x.com?'), true);
});
test('발송 대기 목록: 같은 건·사유는 하나로, 보냄 표시 후엔 새로 쌓임, 엑셀 왕복', () => {
  let db = dupDb();
  const mail = { reason: 'duplicate', ref_no: '202609280001', to: ['a@x.com'], subject: 's', body: 'b' };
  let q = L.queueMail(db, mail, NOW);
  assert.equal(q.mail.mail_id, 'M00001');
  q = L.queueMail(q.db, { ...mail, body: 'b2' }, NOW);
  assert.equal(q.updated, true);
  assert.equal(q.db.mails.length, 1);
  assert.equal(q.db.mails[0].body, 'b2');
  const s = L.markMailSent(q.db, 'M00001', NOW);
  assert.equal(s.db.mails[0].status, 'Sent');
  const q2 = L.queueMail(s.db, mail, NOW);
  assert.equal(q2.mail.mail_id, 'M00002');
  const back = L.sheetsToDb(L.dbToSheets(q2.db));
  assert.deepEqual(back.db.mails, q2.db.mails);
});

console.log('매뉴얼 근거 검색 (2026-09-29)');
const pagesFixture = [
  { n: 1, text: 'CONTENTS\nSECTION 1 GENERAL\n  Group 1 Safety hints ---------------------------- 1-1\n  Group 2 Specifications ...................... 1-2\nSECTION 7 ELECTRICAL SYSTEM\n  Group 3 Electric components -------------------- 7-3\nAPPENDIX: SETTING PROCEDURE ................ A-1' },
  { n: 2, text: 'SAFETY\nAlways stop the engine.\n1-1' },
  { n: 3, text: 'SPECIFICATIONS\nWheel nut tightening torque 20 kgf·m\n1-2' },
  { n: 4, text: 'ELECTRIC COMPONENTS\nSTEPPER 219 DB Alarm will go off if stepper motor line voltages are mismatched.\nSteering is cut off.\n7-3' },
  { n: 5, text: 'Code 2190 is not the same code.\nstepper\n7-4' },
  { n: 6, text: 'Setting procedure for the controller.\nA-1' }
];
test('쪽 표기: 따로 떨어진 줄 중 마지막(0-1·6-17·8-4-1·A-1), 본문 속 숫자는 아님', () => {
  assert.equal(M.pageLabel('a\n6-17\nb'), '6-17');
  assert.equal(M.pageLabel('x\n8-4-1'), '8-4-1');
  assert.equal(M.pageLabel('A-1'), 'A-1');
  assert.equal(M.pageLabel('torque 6-17 Nm'), '');
});
test('목차: SECTION·Group 과 쪽 표기 → PDF 쪽번호, 목차 쪽 자신은 제외', () => {
  const ix = M.makeIndex({ file: 'TEST-1_SM.pdf' }, pagesFixture);
  assert.deepEqual(ix.toc.tocPages, [1]);
  const e = ix.toc.entries;
  assert.deepEqual(e.map(x => [x.level, x.title, x.page]), [
    [1, 'SECTION 1 GENERAL', 2], [2, 'Group 1 Safety hints', 2], [2, 'Group 2 Specifications', 3],
    [1, 'SECTION 7 ELECTRICAL SYSTEM', 4], [2, 'Group 3 Electric components', 4], [1, 'APPENDIX: SETTING PROCEDURE', 6]]);
  assert.equal(M.sectionOf(ix, 4), 'SECTION 7 ELECTRICAL SYSTEM › Group 3 Electric components');
  assert.equal(M.sectionOf(ix, 3), 'SECTION 1 GENERAL › Group 2 Specifications');
});
test('목차 정규식이 긴 점선 줄에서 멈추지 않는다(역추적 폭발 방지)', () => {
  const t0 = Date.now();
  M.buildToc([{ n: 1, text: ('Title ' + '. '.repeat(400) + 'x\n').repeat(30) }]);
  assert.ok(Date.now() - t0 < 500, (Date.now() - t0) + 'ms');
});
test('검색: 낱말 경계(219 ≠ 2190), 여러 낱말 함께 나온 쪽이 먼저, 목차 쪽 제외', () => {
  const ix = M.makeIndex({ file: 'TEST-1_SM.pdf' }, pagesFixture);
  const r = M.search([ix], '219 stepper steering');
  assert.equal(r.results[0].n, 4);
  assert.equal(r.results[0].label, '7-3');
  assert.deepEqual(r.results[0].hits, ['219', 'stepper', 'steering']);
  assert.deepEqual(r.results.map(x => x.n), [4, 5]);
  assert.deepEqual(r.results[1].hits, ['stepper']); // 2190 은 219 로 세지 않음
  assert.equal(M.search([ix], 'electrical').results.length, 0); // 목차 쪽(1)에만 있는 낱말
  assert.deepEqual(M.search([ix], '').results, []);
});
test('모델로 매뉴얼 고르기: 적용 모델 → 같은 계열 → 전체', () => {
  const a = M.makeIndex({ file: '15182023BRP-X OM.pdf' }, pagesFixture);
  const b = M.makeIndex({ file: 'BRP-9_SM.pdf' }, pagesFixture);
  assert.equal(a.models, '15BRP-X; 18BRP-X; 20BRP-X; 23BRP-X');
  assert.equal(b.models, 'BRP-9');
  assert.equal(M.pickManuals([a, b], '18brp-x').match, 'exact');
  assert.deepEqual(M.pickManuals([a, b], '30BRP-X').list, [a]);
  assert.equal(M.pickManuals([a, b], '30BRP-X').match, 'family');
  assert.equal(M.pickManuals([a, b], 'DEMO-25D').match, 'all');
  assert.equal(M.pickManuals([a, b], 'BRP-9').list[0], b);
});
test('접수 내용 → 검색 낱말: 영문 표기·에러코드 숫자 + 한글 현장 용어 영문화', () => {
  const k = M.keywordsFromRequest({ system_cat: 'Engine' }, { phenomenon: '클러스터에 에러코드 219, Stepper mot Mism 이라고 뜨며 스티어링 휠이 잠긴 상태임.', requirement: '조치 사항' });
  const w = k.split(' ');
  for (const x of ['219', 'stepper', 'mot', 'mism', 'steering', 'cluster', 'error', 'code']) assert.ok(w.includes(x), x + ' in ' + k);
});
test('프롬프트 발췌: 근거 표기·목차 위치·쪽 번호, 길이 제한', () => {
  const ix = M.makeIndex({ file: 'TEST-1_SM.pdf' }, pagesFixture);
  const block = M.groundingBlock([{ index: ix, n: 4 }], 40);
  assert.ok(block.includes('### [TEST-1 SM p.7-3] SECTION 7 ELECTRICAL SYSTEM › Group 3 Electric components (PDF 4쪽)'));
  assert.ok(block.includes('…(이하 생략)'));
  assert.ok(block.includes('[답변불가]'));
  assert.equal(M.groundingBlock([]), '');
});
test('회신 근거 표기로 쪽 찾기(p.7-3, 쪽 표기 없으면 PDF 쪽번호), 없는 쪽은 null', () => {
  const ix = M.makeIndex({ file: 'TEST-1_SM.pdf' }, pagesFixture);
  assert.equal(M.findRef([ix], 'TEST-1 SM p.7-3').n, 4);
  assert.equal(M.findRef([ix], 'test-1 sm p.2').n, 2);
  assert.equal(M.findRef([ix], 'TEST-1 SM p.9-9'), null);
  assert.equal(M.findRef([ix], '다른 매뉴얼 p.7-3'), null);
});
test('JSON 색인 읽기: 형식 검사, 저장용 사본 → 다시 읽으면 같은 목차', () => {
  const ix = M.makeIndex({ file: 'TEST-1_SM.pdf' }, pagesFixture);
  const again = M.readIndexJson(JSON.stringify(M.toStorable(ix)));
  assert.equal(again.ok, true);
  assert.deepEqual(again.index.toc, ix.toc);
  assert.equal(M.readIndexJson('{').code, 'bad_json');
  assert.equal(M.readIndexJson({ format: 'x', pages: [] }).code, 'bad_format');
  assert.equal(M.readIndexJson({ format: M.FORMAT, pages: [] }).code, 'no_pages');
});
test('PDF 텍스트 조각 → 줄: 위→아래·왼→오, 겹쳐 찍은 같은 조각 하나로', () => {
  const it = (s, x, y, w) => ({ str: s, transform: [10, 0, 0, 10, x, y], width: w });
  const text = M.itemsToText([it('world', 45, 700, 30), it('Hello', 10, 700, 30), it('Hello', 10.2, 700, 30), it('Line2', 10, 680, 30), it('7-3', 300, 40, 12)]);
  // 줄 앞 들여쓰기는 공백으로 남습니다(목차 큰 제목·항목 구분용). 글자 크기 10 → 5 단위당 공백 하나
  assert.equal(text, 'Hello world\nLine2\n' + ' '.repeat(58) + '7-3');
  assert.equal(M.itemsToText([it('SECTION 1', 10, 700, 50), it('Group 1', 30, 680, 40)]), 'SECTION 1\n    Group 1');
});

console.log('추가 매뉴얼 형식·모델 대응표 (2026-09-29 오후)');
test('쪽 표기: 맨 아래 「30 / 210」·「26」 형식도 읽고, 본문 속 숫자 줄은 맨 아래 두 줄만', () => {
  assert.equal(M.pageLabel('본문\n30 / 210'), '30');
  assert.equal(M.pageLabel('본문\n26'), '26');
  assert.equal(M.pageLabel('12\n본문 줄\n본문 끝 줄\nmore'), '');
  assert.equal(M.pageLabel('x\n7-3\n45'), '7-3'); // 6-17 형식이 먼저
});
const deSm = [
  { n: 1, text: '                CONTENTS\nFOREWORD ................................. 2\nSECTION 1    GENERAL ............................ 3\n    GROUP1       SAFETY HINTS ................... 3\n    GROUP2       SPECIFICATIONS ................. 4\nSECTION2     BRAKE SYSTEM ....................... 5\n    GROUP1       STRUCTURE AND FUNCTION ......... 5\n                1 / 6' },
  { n: 2, text: 'FOREWORD\n2 / 6' }, { n: 3, text: 'SAFETY HINTS\n3 / 6' }, { n: 4, text: 'SPECIFICATIONS\n4 / 6' },
  { n: 5, text: 'BRAKE STRUCTURE AND FUNCTION\n5 / 6' }, { n: 6, text: 'end\n6 / 6' }
];
test('붙여 쓴 SECTION2·GROUP1 + 숫자 쪽 표기(DE-7·LE-7 정비 매뉴얼)', () => {
  const ix = M.makeIndex({ file: '253035DE-7 SM.pdf' }, deSm);
  assert.deepEqual(ix.toc.entries.map(e => [e.level, e.title, e.page]), [
    [1, 'FOREWORD', 2], [1, 'SECTION 1 GENERAL', 3], [2, 'GROUP1 SAFETY HINTS', 3], [2, 'GROUP2 SPECIFICATIONS', 4],
    [1, 'SECTION2 BRAKE SYSTEM', 5], [2, 'GROUP1 STRUCTURE AND FUNCTION', 5]]);
  assert.equal(ix.models, '25DE-7; 30DE-7; 35DE-7');
});
test('모든 줄에 쪽 표기가 있는 목차(DE-7 운전자 매뉴얼): 들여쓰기로 큰 제목, 인쇄 쪽 → PDF 쪽(앞쪽 표기에서 이어 셈)', () => {
  const pages = [
    { n: 1, text: 'CONTENTS\nINTRODUCTION ........................ 1\nSAFETY LABELS ....................... 2\n    1. LOCATION ..................... 2\n    2. DESCRIPTION .................. 4\n1.SAFETY HINTS ...................... 5' },
    { n: 2, text: 'intro\n1' }, { n: 3, text: 'labels\n2' }, { n: 4, text: 'no number page' }, { n: 5, text: 'DESCRIPTION\n4' }, { n: 6, text: 'HINTS\n5' }
  ];
  const ix = M.makeIndex({ file: '253035DE-7 OM.pdf' }, pages);
  assert.deepEqual(ix.toc.entries.map(e => [e.level, e.title, e.page]), [
    [1, 'INTRODUCTION', 2], [1, 'SAFETY LABELS', 3], [2, '1. LOCATION', 3], [2, '2. DESCRIPTION', 5], [1, '1.SAFETY HINTS', 6]]);
  // 쪽 표기가 없는 쪽(4)을 가리키는 항목: 앞쪽 표기(2 → 3쪽)에서 이어 셈
  const ix2 = M.makeIndex({ file: 'X.pdf' }, [{ n: 1, text: 'CONTENTS\nA ........ 1\nB ........ 2\nC ........ 3' }, { n: 2, text: 'a\n1' }, { n: 3, text: 'b\n2' }, { n: 4, text: 'c no label' }]);
  assert.equal(ix2.toc.entries[2].page, 4);
});
test('두 단 목차(100D-9V 운전자 매뉴얼): 왼쪽 단을 다 읽고 오른쪽 단, 번호뿐인 조각은 붙임', () => {
  const pages = [
    { n: 1, text: 'A message ------ 0-1                          3. KNOW YOUR TRUCK\nIntro ----------------- 0-2      1. General locations ---------- 3-1\n1. SAFETY HINTS                                7. Air conditioner ------------ 3-2\n  1. Daily inspection ---------- 1-1    2. Name plate ---------- 3-3' },
    { n: 2, text: 'a\n0-1' }, { n: 3, text: 'b\n0-2' }, { n: 4, text: 'c\n1-1' }, { n: 5, text: 'd\n3-1' }, { n: 6, text: 'e\n3-2' }, { n: 7, text: 'f\n3-3' }
  ];
  const ix = M.makeIndex({ file: '100D-9V OM EXP.pdf' }, pages);
  assert.deepEqual(ix.toc.entries.map(e => [e.level, e.title, e.label]), [
    [2, 'A message', '0-1'], [2, 'Intro', '0-2'], [1, '1. SAFETY HINTS', ''], [2, '1. Daily inspection', '1-1'],
    [1, '3. KNOW YOUR TRUCK', ''], [2, '1. General locations', '3-1'], [2, '7. Air conditioner', '3-2'], [2, '2. Name plate', '3-3']]);
  assert.equal(ix.models, '100D-9V');
});
test('PDF 텍스트: 넓은 빈칸(단 사이)은 빈칸 수로, 빈칸 조각이 끝 위치를 늘리지 않음, NUL 은 빈칸', () => {
  const it = (s, x, y, w) => ({ str: s, transform: [11, 0, 0, 11, x, y], width: w });
  const line = M.itemsToText([it('0-2', 270.2, 720, 14.1), it(' ', 284.3, 720, 27), it('1. General', 311.7, 720, 50)]);
  assert.ok(/0-2 {4,}1\. General/.test(line), JSON.stringify(line));
  assert.equal(M.itemsToText([it('A\u0000MESSAGE', 10, 700, 50)]), 'A MESSAGE');
});
const table = [['model', 'notebook_name', '파일명'],
  ['15BRP-9', '15/18/20/23BRP-9', 'BRP-9_OM.pdf, BRP-9_SM'],
  ['25DE-7', '25/30/35DE-7', '253035DE-7 OM, 253035DE-7 SM'],
  ['', '', ''], ['100D-9V', '100D-9V', '100D-9V OM EXP.pdf, 100D-9V SM ENG']];
test('모델 대응표(Manual Medel Name.xlsx 형식) → 소스 등록 행: 쉼표 구분 파일명을 ; 로', () => {
  const r = M.sourcesFromRows(table);
  assert.equal(r.problem, '');
  assert.deepEqual(r.rows[0], { model: '15BRP-9', notebook_name: '15/18/20/23BRP-9', files: 'BRP-9_OM.pdf; BRP-9_SM' });
  assert.equal(r.rows.length, 3);
  assert.equal(M.sourcesFromRows([['a', 'b']]).problem, 'no_header');
});
test('접수 모델 → 소스 등록 대응표의 매뉴얼을 먼저(.pdf 유무·대소문자 무시), 없으면 기존 순서', () => {
  const sources = M.sourcesFromRows(table).rows;
  const mk = f => M.makeIndex({ file: f }, pagesFixture);
  const ixs = ['BRP-9_OM.pdf', 'BRP-9_SM.pdf', '253035DE-7 OM.pdf', '253035DE-7 SM.pdf', '100D-9V SM ENG.pdf', '15BRP-X SM_EXP.pdf'].map(mk);
  const p = M.pickManuals(ixs, '15brp-9', sources);
  assert.equal(p.match, 'source');
  assert.deepEqual(p.list.map(x => x.file), ['BRP-9_OM.pdf', 'BRP-9_SM.pdf']);
  assert.deepEqual(M.pickManuals(ixs, '25DE-7', sources).list.map(x => x.file), ['253035DE-7 OM.pdf', '253035DE-7 SM.pdf']);
  assert.deepEqual(M.pickManuals(ixs, '100D-9V', sources).list.map(x => x.file), ['100D-9V SM ENG.pdf']); // OM 은 안 불러옴
  // 대응표에 없는 모델은 기존 규칙(적용 모델 → 같은 계열)
  assert.equal(M.pickManuals(ixs, '18BRP-X', sources).match, 'family');
  assert.equal(M.search(ixs, 'stepper', { model: '25DE-7', sources }).match, 'source');
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
  // 가입 승인·관리 지역 시연: 승인 대기 1명, 관리 지역이 나뉜 관리자 2명
  assert.equal(db.users.filter(u => u.approval === 'Pending').length, 1);
  assert.deepEqual(L.psRecipients(db, db.mains.find(m => m.reg_id === 'demo_eu01').ref_no).to, ['ps-global@example.com']);
  assert.deepEqual(L.psRecipients(db, db.mains.find(m => m.reg_id === 'demo_user01').ref_no).to, ['ps@example.com']);
});

console.log(process.exitCode ? '\n실패가 있습니다.' : '\n전체 ' + passed + '개 통과');
