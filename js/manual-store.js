/*
 * 매뉴얼 색인 저장소 — 이 브라우저의 IndexedDB 에 둡니다.
 * 매뉴얼 4종의 텍스트는 합쳐 약 1.6MB 라 localStorage(약 5MB, 기술지원 DB 와 공유)에 넣기엔 큽니다.
 * IndexedDB 를 쓸 수 없는 환경(일부 사생활 보호 모드 등)에서는 메모리에만 두어 새로고침하면 사라집니다.
 * 저장되는 것은 사용자가 자기 PC 에서 불러온 매뉴얼의 텍스트뿐이며, 어디로도 전송하지 않습니다.
 */
(function (root) {
  'use strict';
  var DB_NAME = 'data09-01.manuals', STORE = 'indexes';
  var memory = {};
  var persistent = null; // null: 아직 모름, true/false

  function open() {
    return new Promise(function (resolve, reject) {
      try {
        if (!root.indexedDB) { reject(new Error('no indexedDB')); return; }
        var req = root.indexedDB.open(DB_NAME, 1);
        req.onupgradeneeded = function () { req.result.createObjectStore(STORE, { keyPath: 'file' }); };
        req.onsuccess = function () { resolve(req.result); };
        req.onerror = function () { reject(req.error); };
      } catch (e) { reject(e); }
    });
  }
  function tx(mode, fn) {
    return open().then(function (db) {
      return new Promise(function (resolve, reject) {
        var t = db.transaction(STORE, mode);
        var out = fn(t.objectStore(STORE));
        t.oncomplete = function () { db.close(); resolve(out && 'result' in out ? out.result : undefined); };
        t.onerror = function () { db.close(); reject(t.error); };
        t.onabort = function () { db.close(); reject(t.error); };
      });
    }).then(function (v) { persistent = true; return v; });
  }
  function values(o) { return Object.keys(o).map(function (k) { return o[k]; }); }

  root.TSManualStore = {
    // 저장된 색인 전부 (목차는 불러온 뒤 다시 계산합니다)
    list: function () {
      return tx('readonly', function (s) { return s.getAll(); })
        .catch(function () { persistent = false; return values(memory); });
    },
    put: function (ix) {
      memory[ix.file] = ix;
      return tx('readwrite', function (s) { s.put(ix); }).catch(function () { persistent = false; });
    },
    remove: function (file) {
      delete memory[file];
      return tx('readwrite', function (s) { s.delete(file); }).catch(function () { persistent = false; });
    },
    clear: function () {
      memory = {};
      return tx('readwrite', function (s) { s.clear(); }).catch(function () { persistent = false; });
    },
    isPersistent: function () { return persistent; }
  };
})(window);
