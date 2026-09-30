// 실행: node test/profile-i18n.test.mjs   (의존성 없음)
// 2026-09-30 — 한/영 화면 문구 완결성, 기본 정보(온보딩) 검증, 서버 회원 → 도구 사용자 변환
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
const require = createRequire(import.meta.url);
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const I = require('../js/i18n.js');
const P = require('../js/profile.js');
const L = require('../js/logic.js');

let passed = 0;
function test(name, fn) {
  try { fn(); passed++; console.log('  ok  ' + name); }
  catch (e) { console.error('  FAIL ' + name + '\n       ' + e.message); process.exitCode = 1; }
}
const HANGUL = /[가-힣ㄱ-ㅎㅏ-ㅣ]/;
// 영어 화면에 남아도 되는 한글: 수강생 엑셀의 시트 이름·열 이름(가져오기와 짝), AI 답변 표식 [답변불가]
const EN_ALLOWED = ['등록·문의·회신·사용자·소스등록', '파일명', '[답변불가]'];
const app = readFileSync(join(ROOT, 'js/app.js'), 'utf8');
const html = readFileSync(join(ROOT, 'index.html'), 'utf8');
const sql = readFileSync(join(ROOT, 'supabase/2026-09-30_data0901_auth.sql'), 'utf8');

console.log('화면 문구 (한/영)');
const ko = I.DICT.ko, en = I.DICT.en;
test('두 언어의 키가 같다', () => {
  const k = Object.keys(ko).sort(), e = Object.keys(en).sort();
  assert.deepEqual(k.filter(x => !(x in en)), [], '영어에 없는 키');
  assert.deepEqual(e.filter(x => !(x in ko)), [], '한국어에 없는 키');
});
test('빈 문구가 없다', () => {
  for (const [lang, d] of [['ko', ko], ['en', en]]) for (const [k, v] of Object.entries(d)) assert.ok(String(v).trim(), lang + '.' + k);
});
test('끼워 넣는 자리({name} 등)가 두 언어에서 같다', () => {
  const holes = s => (String(s).match(/\{[a-z_]+\}/g) || []).sort().join(',');
  const bad = Object.keys(ko).filter(k => holes(ko[k]) !== holes(en[k]));
  assert.deepEqual(bad, []);
});
test('영어 문구에 한글이 없다 (시트·열 이름과 [답변불가] 표식만 예외)', () => {
  const bad = Object.entries(en).filter(([, v]) => {
    let s = String(v); EN_ALLOWED.forEach(a => { s = s.split(a).join(''); });
    return HANGUL.test(s);
  }).map(([k]) => k);
  assert.deepEqual(bad, []);
});
test('화면 코드가 부르는 t(\'키\')는 모두 사전에 있다', () => {
  const keys = [...app.matchAll(/\bt\('([a-zA-Z0-9_]+)'\s*[,)]/g)].map(m => m[1]); // 'err_' + code 처럼 조립하는 것은 아래 따로
  assert.ok(keys.length > 150, '찾은 키 ' + keys.length);
  assert.deepEqual([...new Set(keys.filter(k => !(k in ko)))], []);
});
test('index.html 의 data-t · data-t-attr 키가 사전에 있다', () => {
  const keys = [...html.matchAll(/data-t="([^"]+)"/g)].map(m => m[1]).concat([...html.matchAll(/data-t-attr="[^:"]+:([^"]+)"/g)].map(m => m[1]));
  assert.ok(keys.length >= 6);
  assert.deepEqual(keys.filter(k => !(k in ko)), []);
});
test('조립해 부르는 키(err_·approval_·login_ 등)도 사전에 있다', () => {
  const need = ['err_required', 'err_bad_phone', 'err_bad_email', 'err_too_long_50', 'err_too_long_60', 'err_bad_code',
    'approval_Pending', 'approval_Approved', 'approval_Rejected', 'login_pending', 'login_rejected', 'login_unknown_id',
    'manual_json_bad_json', 'manual_json_bad_format', 'manual_json_no_pages', 'manual_json_bad_pages', 'kind_sm', 'kind_om'];
  assert.deepEqual(need.filter(k => !(k in ko) || !(k in en)), []);
});
test('기본 언어: 브라우저가 한국어면 KO, 그 밖에는 EN', () => {
  assert.equal(I.defaultLang('ko-KR'), 'ko');
  assert.equal(I.defaultLang('ko'), 'ko');
  assert.equal(I.defaultLang('en-US'), 'en');
  assert.equal(I.defaultLang('de'), 'en');
  assert.equal(I.defaultLang(''), 'en');
  assert.equal(I.defaultLang('kok'), 'en'); // 콘칸어(kok)는 한국어가 아님
});
test('끼워 넣기 동작', () => {
  const t = I.make('en');
  assert.equal(t('mreg_done', { n: 18 }), '18 manual(s) registered.');
  assert.equal(I.make('ko')('mreg_done', { n: 18 }), '매뉴얼 18개를 등록했습니다.');
});

test('접속 유지 시간 표기가 화면 언어를 따른다', () => {
  assert.equal(L.formatDuration(85, 'en'), '1 h 25 min');
  assert.equal(L.formatDuration(12, 'en'), '12 min');
  assert.equal(L.formatDuration(85), '1시간 25분');
});

console.log('기본 정보 입력 검증');
const good = { name: '김봉수', phone: '010-1234-5678', e_mail: 'kim@example.com', is_dealer: 'Y', dealer_name: '경기딜러', country_cd: 'kr', region: '경기' };
test('정상 입력 통과 · 값 정리(국가 대문자, 관리 지역 짐작)', () => {
  const r = P.validateOnboarding(good);
  assert.equal(r.ok, true, JSON.stringify(r.errors));
  assert.deepEqual(r.value, { name: '김봉수', phone: '010-1234-5678', e_mail: 'kim@example.com', is_dealer: true, dealer_name: '경기딜러',
    country_cd: 'KR', region: '경기', territory_cd: '경기' });
});
test('필수 칸이 비면 칸마다 required', () => {
  const r = P.validateOnboarding({});
  assert.equal(r.ok, false);
  assert.deepEqual(r.errors.map(e => e.field + ':' + e.code).sort(),
    ['country_cd:required', 'e_mail:required', 'is_dealer:required', 'name:required', 'phone:required', 'region:required']);
});
test('딜러사명은 선택 — 딜러여도 비워 둘 수 있다', () => assert.equal(P.validateOnboarding({ ...good, dealer_name: '' }).ok, true));
test('본사·직원이면 딜러사명은 비운다', () => assert.equal(P.validateOnboarding({ ...good, is_dealer: 'N' }).value.dealer_name, ''));
test('전화번호: 국내·국제 형식 통과', () => {
  for (const p of ['010-1234-5678', '01012345678', '+82 10-1234-5678', '+49 151 2345 6789', '02-479-7142', '+1 (312) 555-0199'])
    assert.equal(P.isPhone(p), true, p);
});
test('전화번호: 틀린 형식 bad_phone', () => {
  for (const p of ['12', '010-12', 'abc-defg-hijk', '+', '010 1234 5678 9999 0000', '--1234567', '010.1234.5678'])
    assert.equal(P.isPhone(p), false, p);
  assert.deepEqual(P.validateOnboarding({ ...good, phone: '12' }).errors, [{ field: 'phone', code: 'bad_phone' }]);
});
test('이메일 형식', () => assert.deepEqual(P.validateOnboarding({ ...good, e_mail: 'kim@' }).errors, [{ field: 'e_mail', code: 'bad_email' }]));
test('목록에 없는 국가는 bad_code', () => assert.deepEqual(P.validateOnboarding({ ...good, country_cd: 'ZZ' }).errors, [{ field: 'country_cd', code: 'bad_code' }]));
test('길이 제한', () => {
  assert.deepEqual(P.validateOnboarding({ ...good, name: 'x'.repeat(51) }).errors, [{ field: 'name', code: 'too_long_50' }]);
  assert.deepEqual(P.validateOnboarding({ ...good, region: 'x'.repeat(61) }).errors, [{ field: 'region', code: 'too_long_60' }]);
  assert.deepEqual(P.validateOnboarding({ ...good, dealer_name: 'x'.repeat(61) }).errors, [{ field: 'dealer_name', code: 'too_long_60' }]);
});
test('전화번호 규칙이 DB 제약과 같다 (js/profile.js ↔ SQL)', () => {
  const m = sql.match(/phone ~ '([^']+)'/);
  assert.ok(m, 'SQL 에서 전화번호 정규식을 찾지 못함');
  assert.equal(m[1], P.PHONE_RE.source);
  assert.match(sql, /between 7 and 15/);
});
test('SQL 의 관리 지역 목록이 도구의 TERRITORY_CD 와 같다', () => {
  const block = sql.slice(sql.indexOf('territory_cd     text'), sql.indexOf('approval         text'));
  const inList = block.slice(block.indexOf('territory_cd in (') + 'territory_cd in ('.length, block.indexOf('))'));
  const codes = [...inList.matchAll(/'([^']*)'/g)].map(m => m[1]);
  assert.deepEqual(codes, L.TERRITORY_CD);
});

console.log('국가·지역·관리 지역');
test('국가 코드는 ISO 두 글자·중복 없음, 이름 두 언어', () => {
  const codes = P.COUNTRIES.map(c => c.code);
  assert.equal(new Set(codes).size, codes.length);
  for (const c of P.COUNTRIES) {
    assert.match(c.code, /^[A-Z]{2}$/);
    assert.ok(c.ko && c.en && !HANGUL.test(c.en), c.code);
    assert.ok(c.code === 'KR' || L.TERRITORY_CD.includes(c.territory), c.code + ' → ' + c.territory);
  }
});
test('국가 목록은 대한민국이 맨 위, 나머지는 화면 언어 순', () => {
  const en2 = P.countryOptions('en'), ko2 = P.countryOptions('ko');
  assert.equal(en2[0].code, 'KR'); assert.equal(ko2[0].code, 'KR');
  assert.equal(en2.length, P.COUNTRIES.length);
  assert.ok(!en2.some(o => HANGUL.test(o.label)), '영어 목록에 한글');
  const names = en2.slice(1).map(o => o.label);
  assert.deepEqual(names, [...names].sort((a, b) => a.localeCompare(b, 'en')));
});
test('관리 지역 짐작: 국내는 지역 이름(한글·영문), 해외는 대륙', () => {
  assert.equal(P.territoryFor('KR', '경기'), '경기');
  assert.equal(P.territoryFor('KR', 'Gyeonggi'), '경기');
  assert.equal(P.territoryFor('KR', 'direct sales'), 'Direct Sales');
  assert.equal(P.territoryFor('KR', '서울'), '');   // 관리 지역 이름이 아니면 비움 → 관리자가 정함
  assert.equal(P.territoryFor('DE', 'Bavaria'), 'Europe');
  assert.equal(P.territoryFor('US', ''), 'North America');
  assert.equal(P.territoryFor('ZZ', 'x'), '');
});
test('지역 제안: 한국은 관리 지역 이름부터, 모르는 나라는 빈 목록', () => {
  assert.deepEqual(P.regionSuggestions('KR').slice(0, 6), P.KR_TERRITORIES);
  assert.deepEqual(P.regionSuggestions('ZZ'), []);
});
test('관리 지역 영문 표기', () => {
  assert.equal(P.territoryLabel('경기', 'en'), 'Gyeonggi');
  assert.equal(P.territoryLabel('경기', 'ko'), '경기');
  assert.equal(P.territoryLabel('Europe', 'en'), 'Europe');
  for (const c of L.TERRITORY_CD) assert.ok(!HANGUL.test(P.territoryLabel(c, 'en')), c);
});

console.log('서버 회원 → 도구 사용자');
const row = { user_id: 'u-1', reg_id: 'kim@example.com', name: '김봉수', phone: '010-1234-5678', e_mail: 'kim@example.com', is_dealer: true,
  dealer_name: '경기딜러', country_cd: 'KR', region: '경기', territory_cd: '경기', approval: 'Approved', role: 'ADMIN',
  manage_territory: '경기; 경남', created_at: '2026-09-30T01:02:03Z', approved_at: '2026-09-30T02:00:00Z' };
test('사용자 시트 모양으로 바뀐다', () => {
  const u = P.toLocalUser(row, false);
  assert.equal(u.reg_id, 'kim@example.com'); assert.equal(u.req_name, '김봉수'); assert.equal(u.dealer, '경기딜러');
  assert.equal(u.user_type, 'ADMIN'); assert.equal(u.join_date, '2026-09-30'); assert.equal(u.approval, 'Approved');
  assert.equal(L.isApprovedAdmin(u), true);
  assert.deepEqual(L.listTerritories(u.manage_territory), ['경기', '경남']);
});
test('승인 대기 회원은 도구에서 승인된 사용자가 아니다', () => {
  const u = P.toLocalUser({ ...row, approval: 'Pending', role: 'USER' }, false);
  assert.equal(L.isApproved(u), false); assert.equal(u.user_type, 'USER');
});
test('대표 계정(공용 관리자)은 사이트 권한과 무관하게 ADMIN', () => assert.equal(P.toLocalUser({ ...row, role: 'USER' }, true).user_type, 'ADMIN'));
test('딜러 칸: 딜러사명 → 없으면 Dealer, 본사·직원은 HQ/Staff', () => {
  assert.equal(P.dealerText({ is_dealer: true, dealer_name: '' }), 'Dealer');
  assert.equal(P.dealerText({ is_dealer: false, dealer_name: 'x' }), 'HQ/Staff');
});
test('서버 회원도 PS 메일 받는 사람 고르기에 그대로 쓰인다', () => {
  const db = L.emptyDb();
  db.users.push(P.toLocalUser(row, false), P.toLocalUser({ ...row, user_id: 'u-2', reg_id: 'mech@example.com', role: 'USER', manage_territory: '' }, false));
  db.mains.push({ ref_no: '202609300001', reg_id: 'mech@example.com', model: 'M', serial_no: 'S', status: 'Submitted' });
  assert.deepEqual(L.psRecipients(db, '202609300001').to, ['kim@example.com']);
});
test('www_profiles 갱신값: 가입 출처는 비어 있을 때만 hdx-ps, 소속은 비어 있을 때만', () => {
  const v = P.validateOnboarding(good).value;
  assert.deepEqual(P.wwwPatch({ signup_site: null, org: null }, v),
    { name: '김봉수', phone: '010-1234-5678', email: 'kim@example.com', org: '경기딜러', signup_site: 'hdx-ps' });
  const p2 = P.wwwPatch({ signup_site: 'mju', org: '명지대' }, v);
  assert.equal('signup_site' in p2, false); assert.equal('org' in p2, false);
  assert.equal(P.SITE_ID, 'hdx-ps');
});

console.log(process.exitCode ? '\n실패가 있습니다.' : '\n전체 ' + passed + '개 통과');
