// 실행: node test/originals.test.mjs   (의존성 없음)
// 2026-09-30 — 제공 자료(원본) 경로·형식·목록 규칙 (js/originals.js) 과 서버 SQL 의 형식 목록이 맞는지
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
const require = createRequire(import.meta.url);
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const O = require('../js/originals.js');

let passed = 0;
function test(name, fn) {
  try { fn(); passed++; console.log('  ok  ' + name); }
  catch (e) { console.error('  FAIL ' + name + '\n       ' + e.message); process.exitCode = 1; }
}
console.log('제공 자료 (originals/)');

test('경로는 originals/ 아래, Storage 가 받는 글자(영문·숫자·._()-)만', () => {
  for (const n of ['06_화면구성.xlsx', '100D-9V SM ENG.pdf', '__.docx', '기획안 (초안).docx', 'a/b\\c?.png', '확장자없음']) {
    const k = O.keyOf(n);
    assert.ok(k.startsWith('originals/'), k);
    assert.match(k.slice('originals/'.length), /^[A-Za-z0-9._()-]+$/, n + ' → ' + k);
  }
});
test('한글만 다른 이름도 경로가 겹치지 않고, 같은 이름은 늘 같은 경로(다시 올리면 덮어씀)', () => {
  assert.notEqual(O.keyOf('화면구성.xlsx'), O.keyOf('기획서.xlsx'));
  assert.notEqual(O.keyOf('01_기획안.docx'), O.keyOf('03_기획안.docx'));
  assert.equal(O.keyOf('06_화면구성.xlsx'), O.keyOf('06_화면구성.xlsx'));
  // macOS 가 준 NFD 이름과 NFC 이름은 같은 파일로 본다
  assert.equal(O.keyOf('화면구성.xlsx'.normalize('NFD')), O.keyOf('화면구성.xlsx'));
  assert.ok(O.keyOf('100D-9V SM ENG.pdf').endsWith('.pdf'));
});
test('형식은 확장자로 먼저 정하고, 모르면 octet-stream', () => {
  assert.equal(O.contentTypeOf('x.xlsx', ''), 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  assert.equal(O.contentTypeOf('x.PDF', 'application/octet-stream'), 'application/pdf');
  assert.equal(O.contentTypeOf('x.zip', 'application/x-zip-compressed'), 'application/zip');
  assert.equal(O.contentTypeOf('x.unknown', 'application/x-weird'), 'application/octet-stream');
  assert.equal(O.contentTypeOf('noext', 'image/png'), 'image/png');
});
test('화면이 붙이는 형식은 모두 서버 버킷이 받는 형식이다 (SQL 과 짝)', () => {
  const sql = readFileSync(join(ROOT, 'supabase/2026-09-30_data0901_originals.sql'), 'utf8');
  const arr = sql.slice(sql.indexOf('allowed_mime_types = array['), sql.indexOf(']', sql.indexOf('allowed_mime_types = array[')));
  const server = [...arr.matchAll(/'([a-z0-9.+\/-]+)'/g)].map(m => m[1]);
  assert.equal(server.length, 27, '서버 형식 수 ' + server.length);
  assert.deepEqual(O.ALLOWED.filter(x => !server.includes(x)), [], '화면에만 있는 형식');
  assert.deepEqual(server.filter(x => !O.ALLOWED.includes(x)), [], 'SQL 에만 있는 형식');
  for (const ext of ['pdf', 'docx', 'xlsx', 'pptx', 'png', 'jpg', 'zip', 'mp4', 'hwp', 'csv', 'md', 'xyz'])
    assert.ok(server.includes(O.contentTypeOf('a.' + ext, '')), ext);
});
test('목록: 실제 개체만, 원래 이름·메모는 목록 파일에서, 목록 파일·폴더 표시는 뺀다', () => {
  const k1 = O.keyOf('06_화면구성.xlsx'), k2 = O.keyOf('100D-9V SM ENG.pdf'), gone = O.keyOf('지운파일.docx');
  let ix = O.withFiles(null, [
    { key: k1, name: '06_화면구성.xlsx', note: '패들릿 09-28', size: 215156 },
    { key: gone, name: '지운파일.docx', size: 10 }]);
  ix = O.withFiles(ix, [{ key: k2, name: '100D-9V SM ENG.pdf', size: 55245322 }]);
  ix = O.withoutFiles(ix, [gone]);
  assert.equal(Object.keys(ix.files).length, 2);
  const objs = [
    { name: '_index.json', id: 'i', metadata: { size: 100 } },
    { name: k1.slice(10), id: 'a', metadata: { size: 215156 }, updated_at: '2026-09-30T06:00:00Z' },
    { name: k2.slice(10), id: 'b', metadata: { size: 55245322 }, created_at: '2026-09-30T06:01:00Z' },
    { name: 'sub', id: null },                                         // 하위 폴더 표시
    { name: 'orphan-00000000.bin', id: 'c', metadata: { size: 3 } }    // 목록 파일에 없는 개체도 보인다(경로 이름으로)
  ];
  const rows = O.merge(objs, JSON.stringify(ix));
  assert.deepEqual(rows.map(r => r.name), ['06_화면구성.xlsx', '100D-9V SM ENG.pdf', 'orphan-00000000.bin'].sort((a, b) => a.localeCompare(b, 'ko')));
  const r1 = rows.find(r => r.key === k1);
  assert.equal(r1.note, '패들릿 09-28'); assert.equal(r1.updated, '2026-09-30'); assert.equal(r1.size, 215156);
});
test('깨진 목록 파일은 빈 목록으로 읽는다', () => {
  assert.deepEqual(O.readIndex('not json').files, {});
  assert.deepEqual(O.readIndex({ format: 'other', files: { a: 1 } }).files, {});
});
test('크기 표기', () => {
  assert.equal(O.fmtSize(55245322), '52.7 MB'); assert.equal(O.fmtSize(215156), '210 KB'); assert.equal(O.fmtSize(12), '12 B');
});
console.log('\n' + (process.exitCode ? '실패가 있습니다.' : '전체 ' + passed + '개 통과'));
