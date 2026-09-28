// 예시 데이터 파일 생성: node scripts/make-samples.js
// js/sample-data.js 를 2026-09-28 기준 날짜로 풀어 samples/ 에 xlsx·csv 로 씁니다.
// 앱의 「예시 데이터 불러오기」는 같은 원본을 오늘 기준 날짜로 불러옵니다.
const fs = require('fs');
const path = require('path');
const XLSX = require('../vendor/xlsx.full.min.js');
const L = require('../js/logic.js');
const Sample = require('../js/sample-data.js');

const out = path.join(__dirname, '..', 'samples');
fs.mkdirSync(out, { recursive: true });
const db = Sample.build(new Date(2026, 8, 28));
const sheets = L.dbToSheets(db);

const wb = XLSX.utils.book_new();
for (const [name, rows] of Object.entries(sheets)) XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(rows), name);
fs.writeFileSync(path.join(out, '예시데이터_기술지원DB.xlsx'), XLSX.write(wb, { bookType: 'xlsx', type: 'buffer' }));

const csvName = { '등록': '등록', '문의': '문의', '회신': '회신', '사용자': '사용자', '소스등록': '소스등록', 'Log Data': 'LogData' };
for (const [name, rows] of Object.entries(sheets)) {
  const headers = rows[0].map(k => ({ key: k, label: k }));
  const objs = rows.slice(1).map(r => Object.fromEntries(rows[0].map((k, i) => [k, r[i]])));
  fs.writeFileSync(path.join(out, `예시데이터_${csvName[name]}.csv`), L.toCsv(headers, objs));
}

// 검증: 방금 쓴 xlsx 를 앱과 같은 방식으로 다시 읽어 원본과 같은지 확인
const back = XLSX.read(fs.readFileSync(path.join(out, '예시데이터_기술지원DB.xlsx')), { type: 'buffer', cellDates: true });
const read = {};
back.SheetNames.forEach(n => { read[n] = XLSX.utils.sheet_to_json(back.Sheets[n], { header: 1, raw: true, defval: '' }); });
const res = L.sheetsToDb(read);
for (const k of Object.keys(L.emptyDb())) {
  if (JSON.stringify(res.db[k]) !== JSON.stringify(db[k])) { console.error('왕복 불일치: ' + k); process.exit(1); }
}
console.log('samples/ 생성·왕복 확인 완료:', res.report.read.join(', '), res.report.problems.length ? res.report.problems : '');
