/*
 * 제공 자료(원본) — 수강생이 준 기획서·DB 엑셀·화면구성·매뉴얼 PDF 원문 등을 비공개 버킷에 보관하는 규칙
 *
 *  - 위치: 버킷 data0901-manuals 의 originals/ 아래 (읽기 = 승인 회원, 올리기·지우기 = 관리자 — 서버 정책)
 *  - Storage 경로에는 한글을 쓸 수 없어서, 경로는 영문·숫자로 줄이고 원래 이름은 목록 파일
 *    originals/_index.json 에 적습니다. 같은 이름의 파일을 다시 올리면 같은 경로라 덮어씁니다.
 *  - 이 파일은 브라우저·서버와 무관한 계산만 합니다(node 테스트: test/originals.test.mjs).
 */
(function (root) {
  'use strict';
  var PREFIX = 'originals/';
  var INDEX = PREFIX + '_index.json';

  var TYPES = {
    pdf: 'application/pdf',
    docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    doc: 'application/msword', xls: 'application/vnd.ms-excel', ppt: 'application/vnd.ms-powerpoint',
    hwp: 'application/x-hwp', hwpx: 'application/vnd.hancom.hwpx',
    csv: 'text/csv', txt: 'text/plain', md: 'text/markdown', json: 'application/json', gz: 'application/gzip',
    zip: 'application/zip',
    png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp', svg: 'image/svg+xml',
    mp4: 'video/mp4', mov: 'video/quicktime', webm: 'video/webm'
  };
  // 서버 버킷이 받는 형식(supabase/2026-09-30_data0901_originals.sql 과 같은 목록)
  var ALLOWED = ['application/gzip', 'application/json', 'application/pdf',
    TYPES.docx, TYPES.xlsx, TYPES.pptx, TYPES.doc, TYPES.xls, TYPES.ppt,
    'application/x-hwp', 'application/haansofthwp', 'application/vnd.hancom.hwp', 'application/vnd.hancom.hwpx',
    'text/csv', 'text/plain', 'text/markdown', 'application/zip', 'application/x-zip-compressed',
    'image/png', 'image/jpeg', 'image/gif', 'image/webp', 'image/svg+xml', 'video/mp4', 'video/quicktime', 'video/webm',
    'application/octet-stream'];

  function extOf(name) { var m = /\.([A-Za-z0-9]{1,8})$/.exec(String(name || '')); return m ? m[1].toLowerCase() : ''; }

  // 확장자로 먼저 정하고(브라우저마다 file.type 이 다름), 모르면 브라우저 값, 그것도 서버가 안 받으면 octet-stream
  function contentTypeOf(name, browserType) {
    var byExt = TYPES[extOf(name)];
    if (byExt) return byExt;
    var bt = String(browserType || '').split(';')[0].trim().toLowerCase();
    return ALLOWED.indexOf(bt) !== -1 ? bt : 'application/octet-stream';
  }

  // FNV-1a 32비트 — 한글만 달라 영문 부분이 같은 이름(예: 「화면구성.xlsx」와 「기획서.xlsx」)이 겹치지 않게
  function hash8(s) {
    var h = 0x811c9dc5;
    s = String(s);
    for (var i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = (h + ((h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24))) >>> 0; }
    return ('0000000' + h.toString(16)).slice(-8);
  }
  // 원래 이름 → Storage 경로. 같은 이름이면 늘 같은 경로(다시 올리면 덮어씀)
  function keyOf(name) {
    var n = String(name || 'file').normalize ? String(name || 'file').normalize('NFC') : String(name || 'file');
    var ext = extOf(n);
    var base = ext ? n.slice(0, -(ext.length + 1)) : n;
    var safe = base.replace(/[^A-Za-z0-9._()-]+/g, '_').replace(/_+/g, '_').replace(/^[_.]+|[_.]+$/g, '').slice(0, 80) || 'file';
    return PREFIX + safe + '-' + hash8(n) + (ext ? '.' + ext : '');
  }

  // 목록 파일(manifest) 읽기 — 깨졌거나 없으면 빈 목록
  function readIndex(text) {
    try {
      var o = typeof text === 'string' ? JSON.parse(text) : text;
      if (o && o.format === 'data09-01.originals' && o.files && typeof o.files === 'object') return o;
    } catch (e) { /* 무시 */ }
    return { format: 'data09-01.originals', version: 1, files: {} };
  }
  // 올린 파일을 목록에 넣은 새 목록
  function withFiles(index, entries) {
    var out = readIndex(JSON.parse(JSON.stringify(index || {})));
    (entries || []).forEach(function (e) { out.files[e.key] = { name: e.name, note: e.note || '', size: e.size || 0, type: e.type || '', uploaded: e.uploaded || '' }; });
    return out;
  }
  function withoutFiles(index, keys) {
    var out = readIndex(JSON.parse(JSON.stringify(index || {})));
    (keys || []).forEach(function (k) { delete out.files[k]; });
    return out;
  }
  // Storage 목록(originals/ 안의 개체) + 목록 파일 → 화면에 보일 행. 실제로 있는 개체만 보입니다.
  function merge(objects, index) {
    var ix = readIndex(index);
    return (objects || []).filter(function (o) { return o && o.name && o.id !== null && o.name !== '_index.json' && !/\/$/.test(o.name); })
      .map(function (o) {
        var key = PREFIX + o.name, m = ix.files[key] || {};
        return {
          key: key, name: m.name || o.name, note: m.note || '',
          size: (o.metadata && o.metadata.size) || m.size || 0,
          updated: String(o.updated_at || o.created_at || m.uploaded || '').slice(0, 10)
        };
      })
      .sort(function (a, b) { return a.name.localeCompare(b.name, 'ko'); });
  }
  function fmtSize(n) {
    n = Number(n) || 0;
    if (n >= 1048576) return (n / 1048576).toFixed(1) + ' MB';
    if (n >= 1024) return Math.round(n / 1024) + ' KB';
    return n + ' B';
  }

  var api = { PREFIX: PREFIX, INDEX: INDEX, ALLOWED: ALLOWED, extOf: extOf, contentTypeOf: contentTypeOf, keyOf: keyOf,
    readIndex: readIndex, withFiles: withFiles, withoutFiles: withoutFiles, merge: merge, fmtSize: fmtSize, hash8: hash8 };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.TSOriginals = api;
})(typeof window !== 'undefined' ? window : this);
