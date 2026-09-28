/* 브라우저 저장소 — localStorage 를 쓰되, 막혀 있으면 메모리로만 동작합니다 */
(function (root) {
  'use strict';
  var KEY_DB = 'data09-01.db';
  var KEY_SESSION = 'data09-01.session';
  var KEY_LANG = 'data09-01.lang';
  var memory = {};
  var ok = true;
  function get(k) {
    try { return root.localStorage.getItem(k); } catch (e) { ok = false; return memory[k] == null ? null : memory[k]; }
  }
  function set(k, v) {
    try { root.localStorage.setItem(k, v); } catch (e) { ok = false; memory[k] = v; }
  }
  function del(k) {
    try { root.localStorage.removeItem(k); } catch (e) { ok = false; delete memory[k]; }
  }
  function loadDb() {
    var raw = get(KEY_DB);
    var db = root.TSLogic.emptyDb();
    if (!raw) return db;
    try {
      var p = JSON.parse(raw);
      Object.keys(db).forEach(function (k) { if (Array.isArray(p[k])) db[k] = p[k]; });
      if (p._sample) db._sample = true;
    } catch (e) { /* 깨진 값은 무시하고 빈 DB */ }
    return db;
  }
  root.TSStore = {
    loadDb: loadDb,
    saveDb: function (db) { set(KEY_DB, JSON.stringify(db)); },
    clearDb: function () { del(KEY_DB); del(KEY_SESSION); },
    getSession: function () { try { return JSON.parse(get(KEY_SESSION) || 'null'); } catch (e) { return null; } },
    setSession: function (s) { if (s) set(KEY_SESSION, JSON.stringify(s)); else del(KEY_SESSION); },
    getLang: function () { return get(KEY_LANG) || 'ko'; },
    setLang: function (l) { set(KEY_LANG, l); },
    available: function () { get(KEY_LANG); return ok; }
  };
})(window);
