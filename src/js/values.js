/* 셀 값 정규화·검증 — 항목정의(자료형·길이·허용값·범위)를 기준으로 원천 값을 해석한다.
 * 결과는 FHIR·KR CDI·DCAT 변환기가 공통으로 사용한다. */
window.KC = window.KC || {};

KC.values = (function () {
  'use strict';
  const U = KC.util;

  const TRUE_SET = ['y', 'yes', '1', '예', '네', 'true', 't', '있음', '유', 'o', '+', '양성', 'positive'];
  const FALSE_SET = ['n', 'no', '0', '아니오', '아니요', 'false', 'f', '없음', '무', 'x', '-', '음성', 'negative'];
  const UNK_SET = ['u', 'unk', 'unknown', '99', '9', '미상', '알수없음', '알 수 없음', 'm', '무응답', 'nodata', 'no data', 'na', 'n/a'];

  function isFlagItem(it) {
    if (it.codes && it.codes.length <= 4) {
      const cs = it.codes.map(function (c) { return String(c[0]).toUpperCase(); }).sort().join(',');
      if (cs === 'N,U,Y' || cs === 'N,Y') return true;
    }
    return it.role === '여부' || /(여부|유무)$/.test(it.name) || /_yn$/i.test(it.name);
  }

  function parseFlag(s) {
    const k = String(s).trim().toLowerCase();
    if (TRUE_SET.indexOf(k) >= 0) return true;
    if (FALSE_SET.indexOf(k) >= 0) return false;
    if (UNK_SET.indexOf(k) >= 0) return null;
    return undefined;
  }

  function validYmd(y, m, d) {
    if (m < 1 || m > 12 || d < 1) return false;
    const dim = new Date(Date.UTC(y, m, 0)).getUTCDate();
    return d <= dim && y >= 1800 && y <= 2100;
  }

  /** 날짜 문자열 → {date:'YYYY-MM-DD'|'YYYY-MM'|'YYYY', dateTime?} 또는 null */
  function parseDate(s, allowSerial) {
    s = String(s).trim();
    let m;
    if ((m = /^(\d{4})(\d{2})(\d{2})$/.exec(s))) {
      return validYmd(+m[1], +m[2], +m[3]) ? { date: m[1] + '-' + m[2] + '-' + m[3] } : null;
    }
    if ((m = /^(\d{4})[-./](\d{1,2})[-./](\d{1,2})(?:[ T](\d{1,2}):(\d{2})(?::(\d{2}))?)?$/.exec(s))) {
      const y = +m[1], mo = +m[2], d = +m[3];
      if (!validYmd(y, mo, d)) return null;
      const date = m[1] + '-' + U.pad(mo) + '-' + U.pad(d);
      if (m[4] != null) {
        return { date: date, dateTime: date + 'T' + U.pad(+m[4]) + ':' + m[5] + ':' + (m[6] || '00') + '+09:00' };
      }
      return { date: date };
    }
    if ((m = /^(\d{4})[-./]?(\d{2})$/.exec(s)) && +m[2] >= 1 && +m[2] <= 12) return { date: m[1] + '-' + m[2] };
    if ((m = /^(\d{4})$/.exec(s)) && +m[1] >= 1800 && +m[1] <= 2100) return { date: m[1] };
    if (allowSerial && /^\d{5}(\.\d+)?$/.test(s) && +s > 20000 && +s < 80000) {
      const d = new Date(Math.round((+s - 25569) * 86400000));
      return { date: d.getUTCFullYear() + '-' + U.pad(d.getUTCMonth() + 1) + '-' + U.pad(d.getUTCDate()), serial: true };
    }
    return null;
  }

  function parseNumber(s) {
    const t = String(s).trim().replace(/,/g, '');
    return /^[-+]?(\d+\.?\d*|\.\d+)$/.test(t) ? Number(t) : null;
  }

  function matchCode(it, s) {
    if (!it.codes) return null;
    const k = String(s).trim().toLowerCase();
    for (let i = 0; i < it.codes.length; i++) {
      const c = it.codes[i];
      if (String(c[0]).toLowerCase() === k || String(c[1]).toLowerCase() === k) return { code: c[0], label: c[1] };
    }
    return null;
  }

  /** 원천 셀 → 정규화 결과 */
  function normalize(raw, it) {
    const str = raw == null ? '' : String(raw).trim();
    const r = { raw: raw, str: str, empty: str === '', kind: 'text', issues: [] };
    if (r.empty) return r;
    const issue = function (level, code, msg) { r.issues.push({ level: level, code: code, msg: msg }); };

    // 코드표가 없는 CODE 항목(G1 결손)이라도 값이 Y/N/U 문자이면 여부 항목으로 해석 (숫자 0/1은 코드일 수 있어 제외)
    const flag = isFlagItem(it) || (it.type === 'CODE' && !it.codes && /^(y|n|u|yes|no|예|아니오|아니요|있음|없음|미상)$/i.test(str));
    r.isFlag = flag;
    if (flag) {
      r.flag = parseFlag(str);
      const mc = matchCode(it, str);
      if (mc) r.code = mc;
      if (r.flag === undefined && !mc) issue('경고', 'FLAG_INVALID', '여부 항목 값이 Y/N/U(예/아니오/미상)로 해석되지 않음');
      r.kind = 'flag';
      if (r.flag === true && !r.code) r.code = matchCode(it, 'Y') || { code: 'Y', label: '예' };
      if (r.flag === false && !r.code) r.code = matchCode(it, 'N') || { code: 'N', label: '아니오' };
      if (r.flag === null && !r.code) r.code = matchCode(it, 'U') || { code: 'U', label: '알 수 없음' };
      return r;
    }

    switch (it.type) {
      case 'DATE': {
        const d = parseDate(str, true);
        if (d) {
          r.kind = 'date'; r.date = d.date; r.dateTime = d.dateTime;
          if (d.serial) issue('정보', 'DATE_SERIAL', '엑셀 일련번호를 날짜로 변환함');
        } else issue('오류', 'DATE_INVALID', '날짜로 해석할 수 없음(YYYYMMDD 기대)');
        break;
      }
      case 'INTEGER':
      case 'NUMERIC': {
        const n = parseNumber(str);
        if (n == null) {
          const d = /year|년도|연도/i.test(it.name) ? parseDate(str) : null;
          if (d) { r.kind = 'date'; r.date = d.date; break; }
          issue('경고', 'NUM_INVALID', '수치로 해석할 수 없음');
        } else {
          r.kind = it.type === 'INTEGER' ? 'int' : 'num';
          r.num = n;
          if (it.type === 'INTEGER' && !Number.isInteger(n)) issue('경고', 'INT_INVALID', '정수 항목에 소수 값');
          if (it.range && (n < it.range[0] || n > it.range[1])) issue('경고', 'RANGE', '허용범위(' + it.range.join('~') + ') 밖의 값');
          if (it.dec != null && it.type === 'NUMERIC') {
            const dp = (String(n).split('.')[1] || '').length;
            if (dp > it.dec) issue('정보', 'DECIMAL', '소수점 자릿수(' + it.dec + ') 초과');
          }
        }
        break;
      }
      case 'CODE': {
        const mc = matchCode(it, str);
        r.kind = 'code';
        if (mc) r.code = mc;
        else if (it.codes) issue('경고', 'CODE_NOT_ALLOWED', '허용값 목록에 없는 코드');
        break;
      }
      default: {
        r.kind = 'text';
        const n = parseNumber(str);
        if (n != null) r.num = n;
        const d = /일자|일시|날짜|^dt_|date/i.test(it.name) ? parseDate(str, true) : null;
        if (d) { r.kind = 'date'; r.date = d.date; r.dateTime = d.dateTime; }
        const mc = matchCode(it, str);
        if (mc) { r.code = mc; r.kind = 'code'; }
      }
    }
    if (it.len && it.type !== 'DATE' && str.length > it.len) issue('경고', 'LEN_EXCEEDED', '정의 길이(' + it.len + ') 초과: ' + str.length + '자');
    return r;
  }

  /** 사람이 읽는 정규화 값 (KR CDI·DCAT 표시용) */
  function display(n) {
    if (n.empty) return '';
    if (n.kind === 'date') return n.dateTime || n.date;
    if (n.code && n.code.label && n.code.label !== n.code.code) return n.code.code + ' (' + n.code.label + ')';
    return n.str;
  }

  return { normalize: normalize, parseDate: parseDate, parseNumber: parseNumber, parseFlag: parseFlag, isFlagItem: isFlagItem, display: display };
})();
