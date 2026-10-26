/* DCAT 2.0 (DCAT-AP 2.1 준용) 국가 데이터 카탈로그 생성 — NIA 「국가데이터 통합 연계를 위한 데이터 카탈로그 표준 가이드 v1.0」
 *  공통: Catalog / Dataset / Distribution / DataService / CatalogRecord
 *  확장: ndi:viewCnt·downloadCnt·srvcType·pltfrmAccessToken(필수), dataType·modiType·fileSize·fileUnit, summary·profile·quality(JSON)
 *  출력: RDF/XML(One-윈도우 연계 기본), Turtle, JSON-LD */
window.KC = window.KC || {};

KC.dcat = (function () {
  'use strict';
  const U = KC.util;

  const PREFIX = {
    rdf: 'http://www.w3.org/1999/02/22-rdf-syntax-ns#', rdfs: 'http://www.w3.org/2000/01/rdf-schema#',
    dcat: 'http://www.w3.org/ns/dcat#', dct: 'http://purl.org/dc/terms/', foaf: 'http://xmlns.com/foaf/0.1/',
    vcard: 'http://www.w3.org/2006/vcard/ns#', adms: 'http://www.w3.org/ns/adms#', prov: 'http://www.w3.org/ns/prov#',
    owl: 'http://www.w3.org/2002/07/owl#', spdx: 'http://spdx.org/rdf/terms#', odrl: 'http://www.w3.org/ns/odrl/2/',
    xsd: 'http://www.w3.org/2001/XMLSchema#', skos: 'http://www.w3.org/2004/02/skos/core#', dcatap: 'http://data.europa.eu/r5r/'
  };

  /* NIA 가이드 [표 5] 필수 속성 */
  const REQUIRED = {
    'dcat:Catalog': ['dct:title', 'dct:description', 'dct:publisher'],
    'dcat:Dataset': ['dct:title', 'dct:description', 'ndi:viewCnt', 'ndi:downloadCnt', 'ndi:srvcType', 'ndi:pltfrmAccessToken'],
    'dcat:DataService': ['dct:title', 'dcat:endpointURL'],
    'dcat:Distribution': ['dcat:accessURL'],
    'dcat:CatalogRecord': ['foaf:primaryTopic', 'dct:modified']
  };
  const RECOMMENDED = {
    'dcat:Catalog': ['dcat:dataset', 'foaf:homepage', 'dct:language', 'dct:license', 'dct:issued', 'dct:modified', 'dct:spatial', 'dcat:themeTaxonomy', 'dcat:service'],
    'dcat:Dataset': ['dcat:contactPoint', 'dcat:distribution', 'dcat:keyword', 'dct:publisher', 'dct:spatial', 'dct:temporal', 'dcat:theme'],
    'dcat:DataService': ['dcat:endpointDescription', 'dcat:servesDataset'],
    'dcat:Distribution': ['dct:description', 'dcatap:availability', 'dct:format', 'dct:license'],
    'dcat:CatalogRecord': ['dct:issued', 'dct:conformsTo', 'adms:status']
  };

  const STD = {
    krcdi: { iri: 'https://www.khis.or.kr/krcdi/v3', title: '한국 핵심교류데이터(KR CDI) V3' },
    krcore: { iri: 'https://www.hl7korea.or.kr/fhir/krcore/', title: '한국 핵심교류데이터 전송 표준(KR Core) V2.0.0 (HL7 FHIR R4)' },
    fhir: { iri: 'http://hl7.org/fhir/R4/', title: 'HL7 FHIR R4' },
    dcatap: { iri: 'https://semiceu.github.io/DCAT-AP/releases/2.1.1/', title: 'DCAT-AP 2.1' },
    ndiGuide: { iri: 'urn:nia:ndi:catalog-guide:1.0', title: '국가데이터 통합 연계를 위한 데이터 카탈로그 표준 가이드 v1.0 (NIA, 2025.10)' },
    argo: { iri: 'https://docs.icgc-argo.org/dictionary', title: 'ICGC ARGO Data Dictionary v1.34' },
    mcode: { iri: 'http://hl7.org/fhir/us/mcode/', title: 'HL7 mCODE STU4' },
    omop: { iri: 'https://ohdsi.github.io/CommonDataModel/cdm54.html', title: 'OMOP CDM v5.4' }
  };

  /* ---------- 그래프 모델 ---------- */
  function Graph(ndiNs) {
    this.nodes = [];
    this.prefix = Object.assign({}, PREFIX, { ndi: ndiNs });
    this.bn = 0;
  }
  Graph.prototype.node = function (iri, type) {
    const n = new Node(this, iri, type);
    this.nodes.push(n);
    return n;
  };
  function Node(g, iri, type) {
    this.g = g; this.iri = iri || null; this.types = type ? [type] : []; this.p = [];
  }
  Node.prototype.lit = function (pred, v, o) {
    if (v === undefined || v === null || v === '') return this;
    o = o || {};
    this.p.push([pred, { lit: String(v), lang: o.lang, dt: o.dt }]);
    return this;
  };
  Node.prototype.ko = function (pred, v) { return this.lit(pred, v, { lang: 'ko' }); };
  Node.prototype.date = function (pred, v) { return v ? this.lit(pred, v, { dt: v.length > 10 ? 'xsd:dateTime' : 'xsd:date' }) : this; };
  Node.prototype.int = function (pred, v) { return v == null ? this : this.lit(pred, v, { dt: 'xsd:integer' }); };
  Node.prototype.iriv = function (pred, iri) { if (iri) this.p.push([pred, { iri: iri }]); return this; };
  Node.prototype.ref = function (pred, node) { this.p.push([pred, { ref: node }]); return this; };
  Node.prototype.blank = function (pred, type) {
    const b = new Node(this.g, null, type);
    this.p.push([pred, { node: b }]);
    return b;
  };
  Node.prototype.has = function (pred) { return this.p.some(function (x) { return x[0] === pred; }); };

  function expand(g, qname) {
    const i = qname.indexOf(':');
    const pre = qname.slice(0, i);
    return g.prefix[pre] ? g.prefix[pre] + qname.slice(i + 1) : qname;
  }

  /* ---------- Turtle ---------- */
  function ttlLit(o) {
    const s = o.lit.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n').replace(/\r/g, '\\r').replace(/\t/g, '\\t');
    return '"' + s + '"' + (o.lang ? '@' + o.lang : o.dt ? '^^' + o.dt : '');
  }
  function toTurtle(g) {
    const lines = Object.keys(g.prefix).map(function (k) { return '@prefix ' + k + ': <' + g.prefix[k] + '> .'; });
    lines.push('');
    function body(n, ind) {
      const parts = [];
      if (n.types.length) parts.push('a ' + n.types.join(', '));
      n.p.forEach(function (x) {
        const o = x[1];
        let v;
        if (o.iri) v = '<' + o.iri + '>';
        else if (o.ref) v = '<' + o.ref.iri + '>';
        else if (o.node) v = '[\n' + ind + '    ' + body(o.node, ind + '    ') + '\n' + ind + '  ]';
        else v = ttlLit(o);
        parts.push(x[0] + ' ' + v);
      });
      return parts.join(' ;\n' + ind + '  ');
    }
    g.nodes.forEach(function (n) {
      lines.push('<' + n.iri + '>\n  ' + body(n, '') + ' .\n');
    });
    return lines.join('\n');
  }

  /* ---------- RDF/XML ---------- */
  function xe(s) { return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }
  function xa(s) { return xe(s).replace(/"/g, '&quot;'); }
  function toRdfXml(g) {
    const out = ['<?xml version="1.0" encoding="UTF-8"?>', '<rdf:RDF'];
    Object.keys(g.prefix).forEach(function (k) { out.push('    xmlns:' + k + '="' + xa(g.prefix[k]) + '"'); });
    out[out.length - 1] += '>';
    function el(n, ind, about) {
      const tag = n.types[0] || 'rdf:Description';
      const lines = [ind + '<' + tag + (about && n.iri ? ' rdf:about="' + xa(n.iri) + '"' : '') + '>'];
      n.types.slice(1).forEach(function (t) { lines.push(ind + '  <rdf:type rdf:resource="' + xa(expand(g, t)) + '"/>'); });
      n.p.forEach(function (x) {
        const o = x[1], p = x[0], i2 = ind + '  ';
        if (o.iri) lines.push(i2 + '<' + p + ' rdf:resource="' + xa(o.iri) + '"/>');
        else if (o.ref) lines.push(i2 + '<' + p + ' rdf:resource="' + xa(o.ref.iri) + '"/>');
        else if (o.node) { lines.push(i2 + '<' + p + '>'); lines.push.apply(lines, el(o.node, i2 + '  ', false)); lines.push(i2 + '</' + p + '>'); }
        else {
          const attr = o.lang ? ' xml:lang="' + o.lang + '"' : o.dt ? ' rdf:datatype="' + xa(expand(g, o.dt)) + '"' : '';
          lines.push(i2 + '<' + p + attr + '>' + xe(o.lit) + '</' + p + '>');
        }
      });
      lines.push(ind + '</' + tag + '>');
      return lines;
    }
    g.nodes.forEach(function (n) { out.push.apply(out, el(n, '  ', true)); });
    out.push('</rdf:RDF>');
    return out.join('\n');
  }

  /* ---------- JSON-LD ---------- */
  function toJsonLd(g) {
    function obj(n) {
      const o = {};
      if (n.iri) o['@id'] = n.iri;
      if (n.types.length) o['@type'] = n.types.length === 1 ? n.types[0] : n.types;
      n.p.forEach(function (x) {
        const v = x[1];
        let val;
        if (v.iri) val = { '@id': v.iri };
        else if (v.ref) val = { '@id': v.ref.iri };
        else if (v.node) val = obj(v.node);
        else if (v.lang) val = { '@value': v.lit, '@language': v.lang };
        else if (v.dt) val = { '@value': v.lit, '@type': v.dt };
        else val = v.lit;
        if (o[x[0]] === undefined) o[x[0]] = val;
        else if (Array.isArray(o[x[0]])) o[x[0]].push(val);
        else o[x[0]] = [o[x[0]], val];
      });
      return o;
    }
    return JSON.stringify({ '@context': g.prefix, '@graph': g.nodes.map(obj) }, null, 2);
  }

  /* ---------- 필수/권장 속성 검증 ---------- */
  function validate(g) {
    const issues = [];
    g.nodes.forEach(function (n) {
      const t = n.types[0];
      (REQUIRED[t] || []).forEach(function (p) {
        if (!n.has(p)) issues.push({ level: '오류', cls: t, node: n.iri, prop: p, msg: '필수 속성 누락(One-윈도우 연계 불가)' });
      });
      (RECOMMENDED[t] || []).forEach(function (p) {
        if (!n.has(p)) issues.push({ level: '정보', cls: t, node: n.iri, prop: p, msg: '권장 속성 미기재' });
      });
      n.p.forEach(function (x) {
        if (x[0] === 'ndi:pltfrmAccessToken' && /확인 필요|미발급/.test(x[1].lit || '')) {
          issues.push({ level: '경고', cls: t, node: n.iri, prop: x[0], msg: 'NDI 가입 후 발급되는 연계기관 TOKEN 값으로 교체 필요' });
        }
      });
    });
    return issues;
  }

  /* ---------- 공통 구성요소 ---------- */
  /* IRI 는 ASCII 로 유지 (One-윈도우 연계 시 URI 처리 호환성) */
  const CANCER_SLUG = { '간암': 'liver', '대장암': 'colorectal', '신장암': 'kidney', '위암': 'stomach', '유방암': 'breast',
    '자궁경부암': 'cervical', '전립선암': 'prostate', '췌장암': 'pancreas', '혈액암': 'hematologic' };
  function slug(s) {
    if (CANCER_SLUG[s]) return CANCER_SLUG[s];
    const a = String(s).replace(/[^A-Za-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '');
    return a || 'x' + KC.sha256(String(s)).slice(0, 8);
  }

  function catalogNode(g, conf, now) {
    const base = conf.base.replace(/\/?$/, '/');
    const cat = g.node(base + 'catalog/kcure', 'dcat:Catalog');
    cat.ko('dct:title', conf.catalogTitle).ko('dct:description', conf.catalogDesc);
    publisher(cat.blank('dct:publisher', 'foaf:Organization'), conf);
    cat.iriv('foaf:homepage', conf.homepage).lit('dct:language', 'ko').lit('dct:license', conf.license)
      .date('dct:issued', conf.catalogIssued || now.slice(0, 10)).date('dct:modified', now.slice(0, 10));
    cat.blank('dct:spatial', 'dct:Location').ko('rdfs:label', '대한민국').lit('skos:notation', 'KR');
    const tax = cat.blank('dcat:themeTaxonomy', 'skos:ConceptScheme');
    tax.ko('dct:title', '국가 데이터 분류체계(TTA 데이터 분류체계 표준 기반)');
    cat.ko('dcat:theme', '건강의료').ko('dct:rights', conf.rights).ko('dct:creator', conf.publisherName);
    return cat;
  }

  function publisher(n, conf) {
    n.lit('foaf:name', conf.publisherBizNo || '[확인 필요] 사업자등록번호').ko('rdfs:label', conf.publisherName);
    return n;
  }

  function contact(n, conf) {
    n.ko('vcard:fn', conf.contactName);
    if (conf.contactEmail) n.iriv('vcard:hasEmail', 'mailto:' + conf.contactEmail);
    if (conf.contactPhone) n.iriv('vcard:hasTelephone', 'tel:' + conf.contactPhone.replace(/[^\d+]/g, ''));
    return n;
  }

  function dataService(g, conf, datasets) {
    const base = conf.base.replace(/\/?$/, '/');
    const s = g.node(base + 'service/fhir', 'dcat:DataService');
    s.ko('dct:title', conf.serviceTitle || 'K-CURE 표준 데이터 FHIR API (KR Core)')
      .iriv('dcat:endpointURL', conf.endpointURL)
      .iriv('dcat:endpointDescription', conf.endpointDesc)
      .ko('dct:description', 'K-CURE 표준변환 데이터(FHIR R4, KR Core 프로파일)를 제공하는 API 서비스(엔드포인트는 운영 환경에 맞게 지정)')
      .ko('dct:accessRights', conf.accessRights).lit('dct:license', conf.license);
    datasets.forEach(function (d) { s.ref('dcat:servesDataset', d); });
    return s;
  }

  function ndiProduct(ds, conf, fileBytes) {
    ds.int('ndi:viewCnt', 0).int('ndi:downloadCnt', 0)
      .lit('ndi:srvcType', 'dataset')
      .lit('ndi:pltfrmAccessToken', conf.token || '[확인 필요] NDI 연계기관 TOKEN 미발급')
      .lit('ndi:freeYn', conf.freeYn).lit('ndi:price', conf.price)
      .ko('ndi:dataType', '정형').ko('ndi:modiType', '가공');
    if (fileBytes != null) {
      const kb = fileBytes / 1024;
      ds.lit('ndi:fileSize', kb < 1024 ? kb.toFixed(1) : (kb / 1024).toFixed(2)).lit('ndi:fileUnit', kb < 1024 ? 'KB' : 'MB');
    }
  }

  function record(g, conf, ds, now, title) {
    const base = conf.base.replace(/\/?$/, '/');
    const r = g.node(base + 'record/' + ds.iri.split('/').pop(), 'dcat:CatalogRecord');
    r.ko('dct:title', title + ' 카탈로그 레코드').ref('foaf:primaryTopic', ds)
      .date('dct:issued', now.slice(0, 10)).date('dct:modified', now)
      .iriv('dct:conformsTo', STD.dcatap.iri).ko('adms:status', '등록(초안)').lit('dct:language', 'ko')
      .ko('dct:source', 'K-CURE 표준변환기 ' + KC.APP_VERSION + ' 자동 생성');
    return r;
  }

  function std(ds, key) {
    ds.iriv('dct:conformsTo', STD[key].iri);
  }

  /* ---------- (A) 데이터 변환 결과 → 카탈로그 ---------- */
  function fromRun(conf, run, src, outputs) {
    const g = new Graph(conf.ndiNs);
    const now = U.nowIso();
    const base = conf.base.replace(/\/?$/, '/');
    const cat = catalogNode(g, conf, now);
    const dsId = conf.datasetId || ('kcure-' + (src.cancer ? slug(src.cancer) : 'all') + '-' + KC.sha256(src.fileName + now).slice(0, 8));
    const ds = g.node(base + 'dataset/' + dsId, 'dcat:Dataset');
    const title = conf.datasetTitle || ('K-CURE ' + (src.cancer || '암') + ' 표준변환 데이터셋');
    ds.ko('dct:title', title)
      .ko('dct:description', conf.datasetDesc || ('K-CURE ' + (src.cancer || '') + ' 원천 데이터 ' + run.meta.rows + '행(환자 ' + run.meta.patients +
        '명)을 K-CURE 표준항목정의(' + KC.spec.data.meta.source + ')에 따라 KR CDI V3 교류데이터와 KR Core V2(FHIR R4) 리소스로 변환한 데이터셋. ' +
        '매핑은 규칙승인(후보) 단계이며 항목별 전문가 의미검증은 미실시.'));
    contact(ds.blank('dcat:contactPoint', 'vcard:Organization'), conf);
    ['K-CURE', '암 데이터', src.cancer, 'KR CDI', 'KR Core', 'HL7 FHIR', 'mCODE', '중개포털'].filter(Boolean).forEach(function (k) { ds.ko('dcat:keyword', k); });
    publisher(ds.blank('dct:publisher', 'foaf:Organization'), conf);
    ds.blank('dct:spatial', 'dct:Location').ko('rdfs:label', '대한민국').lit('skos:notation', 'KR');
    if (run.meta.minDate) {
      ds.blank('dct:temporal', 'dct:PeriodOfTime').date('dcat:startDate', run.meta.minDate).date('dcat:endDate', run.meta.maxDate);
    }
    ds.ko('dcat:theme', '건강의료').ko('dct:accessRights', conf.accessRights).ko('dct:creator', conf.publisherName);
    std(ds, 'krcdi'); std(ds, 'krcore');
    ds.lit('dct:accrualPeriodicity', conf.accrualPeriodicity).lit('dct:identifier', dsId)
      .ko('dct:provenance', '원천 파일: ' + src.fileName + ' (' + src.encoding + ') → 컬럼 매핑 ' + run.meta.mappedColumns + '/' + run.meta.totalColumns +
        ' → 값 정규화·검증 → FHIR/KR CDI 변환' + (src.pseudonymized ? ' · 환자식별자 가명처리(SHA-256, 솔트)' : ''))
      .date('dct:issued', now.slice(0, 10)).date('dct:modified', now.slice(0, 10))
      .lit('dct:type', 'dataset').lit('owl:versionInfo', conf.version || '0.1')
      .ko('adms:versionNotes', '프로토타입 변환 결과(규칙승인 후보 매핑)').lit('dct:language', 'ko')
      .ko('dct:source', src.fileName);
    const act = ds.blank('prov:wasGeneratedBy', 'prov:Activity');
    act.ko('rdfs:label', 'K-CURE 표준변환기 ' + KC.APP_VERSION + ' 변환 실행').date('prov:endedAtTime', now);

    const totalBytes = outputs.reduce(function (s, o) { return s + (o.bytes || 0); }, 0);
    ndiProduct(ds, conf, totalBytes);
    // 품질 확장 (JSON)
    ds.lit('ndi:summary', JSON.stringify({ data: {
      rows: run.meta.rows, patients: run.meta.patients, mappedColumns: run.meta.mappedColumns, totalColumns: run.meta.totalColumns,
      fhirResources: run.fhirStats, krcdi: run.krcdi.summary, period: { start: run.meta.minDate, end: run.meta.maxDate },
      spec: KC.spec.data.meta.source, mappingStage: KC.spec.data.meta.stageNote
    } }));
    ds.lit('ndi:profile', JSON.stringify({ data: { variables: run.columns.reduce(function (o, c) {
      const it = KC.spec.byId[c.itemId];
      o[c.col] = {
        itemId: c.itemId, name: c.name, definition: it.def, type: c.type, length: it.len, unit: c.unit, allowed: it.allowed || undefined,
        n: c.n, missing: c.missing, missingRate: c.missingRate, distinct: c.distinct, min: c.min, max: c.max, issues: c.issues,
        krcdi: c.cdi || undefined, krcorePath: c.corePath, krcoreJudge: KC.match.label(c.judge), krcoreJudgeOriginal: c.judge, mcode: it.mcode.profile
      };
      return o;
    }, {}) } }));
    const byCode = {};
    run.log.entries.forEach(function (e) { byCode[e.code] = (byCode[e.code] || 0) + 1; });
    ds.lit('ndi:quality', JSON.stringify({ data: {
      errors: run.log.count('오류'), warnings: run.log.count('경고'), info: run.log.count('정보'), byCode: byCode,
      fhirStructuralErrors: run.fhirErrors, krcdiConformance: run.krcdi.conformance.length,
      note: '환자 단위 샘플(ndi:sample)은 개인정보 보호를 위해 수록하지 않음'
    } }));

    outputs.forEach(function (o) {
      const d = g.node(base + 'distribution/' + dsId + '-' + o.id, 'dcat:Distribution');
      d.ko('dct:title', o.title).ko('dct:description', o.desc)
        .iriv('dcat:accessURL', (conf.downloadBase || base + 'download/') + encodeURIComponent(o.fileName))
        .iriv('dcat:downloadURL', (conf.downloadBase || base + 'download/') + encodeURIComponent(o.fileName))
        .lit('dcatap:availability', 'available').lit('dct:format', o.format)
        .iriv('dcat:mediaType', 'https://www.iana.org/assignments/media-types/' + o.mediaType)
        .lit('dct:license', conf.license).int('dcat:byteSize', o.bytes)
        .date('dct:issued', now.slice(0, 10)).date('dct:modified', now.slice(0, 10)).lit('dct:language', 'ko');
      if (o.conformsTo) d.iriv('dct:conformsTo', STD[o.conformsTo].iri);
      if (o.sha256) {
        d.blank('spdx:checksum', 'spdx:Checksum').iriv('spdx:algorithm', PREFIX.spdx + 'checksumAlgorithm_sha256').lit('spdx:checksumValue', o.sha256);
      }
      ds.ref('dcat:distribution', d);
      d._isFhir = o.id === 'fhir';
    });
    const svc = dataService(g, conf, [ds]);
    g.nodes.forEach(function (n) { if (n._isFhir) n.ref('dcat:accessService', svc); });
    cat.ref('dcat:dataset', ds).ref('dcat:service', svc);
    const rec = record(g, conf, ds, now, title);
    cat.ref('dcat:record', rec);
    return { graph: g, issues: validate(g) };
  }

  function xsdType(t) {
    return { DATE: 'xsd:date', INTEGER: 'xsd:integer', NUMERIC: 'xsd:decimal' }[t] || 'xsd:string';
  }

  /** 컬럼 1개의 변수 정의 (ndi:profile) — K-CURE 정의 + KR CDI·KR Core·mCODE·ARGO 대응 */
  function variable(e) {
    const it = e.item;
    if (!it) return { name: e.col, standardMapping: '항목 미인식(K-CURE 표준항목 없음)' };
    const a = KC.meta ? KC.meta.argoOf(e) : null;
    const o = KC.meta ? KC.meta.omopOf(e) : null;
    const mc = KC.meta ? KC.meta.mcodeOf(e) : null;
    return {
      itemId: it.id, name: it.name, definition: it.def, domain: it.domain, category: it.cat1 + '/' + it.cat2,
      datatype: it.xsd || xsdType(it.type), sourceType: it.type, length: it.len || undefined, unit: it.unit || undefined,
      allowed: it.allowed || undefined, required: it.req,
      krcdi: it.cdi && it.cdi.el ? { class: it.cdi.cls, element: it.cdi.el, requirement: it.cdi.req, match: KC.match.label(it.cdi.match || '대응'), matchOriginal: it.cdi.match || undefined } : undefined,
      krcore: { profile: it.core.profile, profileUrl: it.core.url || undefined, path: it.core.path, judgement: KC.match.label(it.core.judge), judgementOriginal: it.core.judge },
      mcode: mc ? { profile: mc.title || mc.profile, profileUrl: mc.url || undefined, path: mc.path, element: mc.element || undefined, level: KC.match.label(mc.level), levelOriginal: mc.level }
        : { level: KC.match.label(it.mcode.level), levelOriginal: it.mcode.level, note: 'mCODE STU4 미매칭' },
      omop: o ? { table: o.table, field: o.field, conceptField: o.concept, dateField: o.date || undefined, vocabulary: o.vocab || undefined, confidence: o.conf } : undefined,
      argo: a ? { schema: a.schema, field: a.field, tier: a.tier, requirement: a.req, confidence: a.conf, transform: a.note || undefined } : undefined,
      definitionGap: it.gap
    };
  }

  /* ---------- (B) 항목정의(명세) → 암종별 데이터셋 카탈로그 ----------
   * groups: [{cancer, entries:[{col, item, argoKey?}]}]  (문자열 배열을 주면 암종 전체 항목) */
  function fromSpec(conf, groups) {
    const g = new Graph(conf.ndiNs);
    const now = U.nowIso();
    const base = conf.base.replace(/\/?$/, '/');
    const cat = catalogNode(g, conf, now);
    const datasets = [];
    groups = groups.map(function (x) {
      return typeof x === 'string' ? { cancer: x, entries: KC.spec.items.filter(function (it) { return it.cancers.indexOf(x) >= 0; }).map(function (it) { return { col: it.name, item: it }; }) } : x;
    });
    groups.forEach(function (grp) {
      const cancer = grp.cancer;
      const entries = grp.entries;
      const items = entries.filter(function (e) { return e.item; }).map(function (e) { return e.item; });
      const id = 'kcure-def-' + slug(cancer);
      const ds = g.node(base + 'dataset/' + id, 'dcat:Dataset');
      const title = 'K-CURE ' + cancer + ' 표준 항목 데이터셋';
      const nCdi = items.filter(function (i) { return i.cdi && i.cdi.el; }).length;
      const nArgo = entries.filter(function (e) { return e.item && KC.meta && KC.meta.argoOf(e); }).length;
      const nMc = entries.filter(function (e) { return e.item && KC.meta && KC.meta.mcodeOf(e); }).length;
      const nOm = entries.filter(function (e) { return e.item && KC.meta && KC.meta.omopOf(e); }).length;
      ds.ko('dct:title', title)
        .ko('dct:description', 'K-CURE ' + cancer + ' 임상 데이터 컬럼 ' + entries.length + '개(표준항목 ' + items.length + '개 · KR CDI 대응 ' + nCdi +
          '개 · mCODE 대응 ' + nMc + '개 · OMOP CDM 대응 후보 ' + nOm + '개 · ICGC ARGO 대응 후보 ' + nArgo + '개)의 정의와 KR CDI V3·KR Core V2·mCODE STU4·OMOP CDM v5.4·ICGC ARGO v1.34 연계 정보. 컬럼 정의는 ndi:profile에 수록. 매핑은 후보 단계(전문가 의미검증 전).');
      contact(ds.blank('dcat:contactPoint', 'vcard:Organization'), conf);
      ['K-CURE', '암 데이터', cancer, '항목정의', 'KR CDI', 'KR Core', 'mCODE', 'OMOP CDM', 'ICGC ARGO'].forEach(function (k) { ds.ko('dcat:keyword', k); });
      publisher(ds.blank('dct:publisher', 'foaf:Organization'), conf);
      ds.blank('dct:spatial', 'dct:Location').ko('rdfs:label', '대한민국').lit('skos:notation', 'KR');
      ds.ko('dcat:theme', '건강의료').ko('dct:accessRights', conf.accessRights).ko('dct:creator', conf.publisherName);
      std(ds, 'krcdi'); std(ds, 'krcore'); std(ds, 'mcode'); std(ds, 'omop'); std(ds, 'argo');
      ds.lit('dct:identifier', id).date('dct:issued', now.slice(0, 10)).date('dct:modified', now.slice(0, 10))
        .lit('dct:type', 'dataset').lit('owl:versionInfo', KC.spec.data.meta.source).lit('dct:language', 'ko')
        .ko('dct:source', KC.spec.data.meta.source)
        .ko('dct:provenance', '9개암종 표준항목정의서(2,304행) → 1,255 분석항목 정규화 → 의미역할 18종 × 규칙 140개 매핑(규칙승인)');
      ndiProduct(ds, conf, null);
      ds.lit('ndi:profile', JSON.stringify({ data: { variables: entries.reduce(function (o, e) {
        o[e.col] = variable(e);
        return o;
      }, {}) } }));
      ds.lit('ndi:summary', JSON.stringify({ data: {
        columns: entries.length, items: items.length, krcdiMapped: nCdi, mcodeMapped: nMc, omopMapped: nOm, argoMapped: nArgo,
        krcoreJudge: U.groupCount(items, function (i) { return KC.match.label(i.core.judge); }),
        domains: U.groupCount(items, function (i) { return i.domain; }),
        definitionComplete: items.filter(function (i) { return i.gap === 'G0'; }).length
      } }));
      const d = g.node(base + 'distribution/' + id + '-spec', 'dcat:Distribution');
      d.ko('dct:title', cancer + ' 표준 항목 매핑 명세(CSV)').ko('dct:description', '항목ID·정의·자료형·KR CDI·KR Core·mCODE 매핑')
        .iriv('dcat:accessURL', (conf.downloadBase || base + 'download/') + encodeURIComponent('KCURE_' + cancer + '_매핑명세.csv'))
        .lit('dcatap:availability', 'available').lit('dct:format', 'CSV').iriv('dcat:mediaType', 'https://www.iana.org/assignments/media-types/text/csv')
        .lit('dct:license', conf.license);
      ds.ref('dcat:distribution', d);
      cat.ref('dcat:dataset', ds);
      datasets.push(ds);
      cat.ref('dcat:record', record(g, conf, ds, now, title));
    });
    cat.ref('dcat:service', dataService(g, conf, datasets));
    return { graph: g, issues: validate(g) };
  }

  return { fromRun: fromRun, fromSpec: fromSpec, toTurtle: toTurtle, toRdfXml: toRdfXml, toJsonLd: toJsonLd, validate: validate,
    variable: variable, xsdType: xsdType, slug: slug, PREFIX: PREFIX };
})();
