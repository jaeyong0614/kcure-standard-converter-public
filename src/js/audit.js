/* 로컬 감사 이력 (Hospital sw flow 6.2 Local Audit History)
 * 화면에서 일어난 검토·승인·코드 생성 이벤트를 기록한다. IndexedDB 에 임시 보관하고(쓸 수 없으면 메모리),
 * audit.jsonl 로 내려받아 기관 기록과 함께 보관한다. 환자 데이터 값은 기록하지 않는다(컬럼명·규칙·해시만). */
window.KC = window.KC || {};

KC.audit = (function () {
  'use strict';
  const DB = 'kcure-audit', STORE = 'events';
  const mem = [];
  let dbp = null;

  function openDb() {
    if (dbp) return dbp;
    dbp = new Promise(function (resolve) {
      try {
        if (!window.indexedDB) return resolve(null);
        const req = indexedDB.open(DB, 1);
        req.onupgradeneeded = function () { req.result.createObjectStore(STORE, { keyPath: 'seq', autoIncrement: true }); };
        req.onsuccess = function () { resolve(req.result); };
        req.onerror = function () { resolve(null); };
      } catch (e) { resolve(null); }
    });
    return dbp;
  }

  /** 체인 해시: 각 이벤트에 직전 이벤트 해시를 넣어 중간 삭제·변경을 알아볼 수 있게 한다 */
  let lastHash = '';
  function log(action, detail) {
    const ev = Object.assign({ ts: KC.util.nowIso(), action: action, app: KC.APP_VERSION }, detail || {});
    ev.prev = lastHash;
    ev.hash = KC.sha256(JSON.stringify(ev)).slice(0, 16);
    lastHash = ev.hash;
    mem.push(ev);
    openDb().then(function (db) {
      if (!db) return;
      try { db.transaction(STORE, 'readwrite').objectStore(STORE).add(ev); } catch (e) { /* 메모리 기록만 유지 */ }
    });
    return ev;
  }

  async function all() {
    const db = await openDb();
    if (!db) return mem.slice();
    return new Promise(function (resolve) {
      try {
        const req = db.transaction(STORE, 'readonly').objectStore(STORE).getAll();
        req.onsuccess = function () { resolve(req.result.length >= mem.length ? req.result : mem.slice()); };
        req.onerror = function () { resolve(mem.slice()); };
      } catch (e) { resolve(mem.slice()); }
    });
  }

  async function clear() {
    mem.length = 0;
    lastHash = '';
    const db = await openDb();
    if (db) { try { db.transaction(STORE, 'readwrite').objectStore(STORE).clear(); } catch (e) { /* 무시 */ } }
  }

  /** 체인 검증: 각 이벤트의 prev 가 직전 hash 와 같은지 */
  function verify(events) {
    for (let i = 1; i < events.length; i++) if (events[i].prev !== events[i - 1].hash) return { ok: false, at: i };
    return { ok: true };
  }

  async function toJsonl() { return (await all()).map(function (e) { return JSON.stringify(e); }).join('\n') + '\n'; }

  return { log: log, all: all, clear: clear, verify: verify, toJsonl: toJsonl, memory: mem };
})();
