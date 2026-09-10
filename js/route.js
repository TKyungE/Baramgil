/* 도보 길찾기 (Valhalla 공개 서버, 키 없음) + 경로 위 바람 프로필
 *
 * 경로 형식: { coords:[[lon,lat],...], distance(m), time(s), maneuvers:[{ text, length(m), begin, end, street }] }
 * 바람 프로필: 경로를 15 m 조각으로 나눠 가장 가까운 길목의 단계를 입힘 → 단계별 거리(m)와 노출 점수.
 *   노출 점수 = Σ 조각 길이 × 가중치(잔잔 0 · 주의 1 · 강풍 3 · 위험 6). 대안 경로는 이 점수로 순위를 매긴다.
 *   (자전거용 Headwind/BikeWind 류 앱이 바람을 고려해 경로를 고르는 것과 같은 발상, 보행자·길목 단위로.)
 */
(function () {
  const VALHALLA = 'https://valhalla1.openstreetmap.de/route';
  const WEIGHT = [0, 1, 3, 6];
  const STEP = 15;

  async function fetchRoutes(from, to, opts) {
    const o = Object.assign({ alternates: 2, language: 'ko-KR' }, opts || {});
    const req = {
      locations: [{ lat: from[1], lon: from[0], type: 'break' }, { lat: to[1], lon: to[0], type: 'break' }],
      costing: 'pedestrian',
      costing_options: { pedestrian: { walking_speed: 4.8 } },
      directions_options: { units: 'kilometers', language: o.language },
      alternates: o.alternates
    };
    let j = await call(req);
    if (!j || !j.trip) {
      // 대안 경로 옵션을 서버가 거부하면 대안 없이 한 번 더
      delete req.alternates;
      j = await call(req);
    }
    if (!j || !j.trip) throw new Error((j && j.error) || '경로 없음');
    const routes = [parseTrip(j.trip)];
    for (const alt of (j.alternates || [])) if (alt.trip) routes.push(parseTrip(alt.trip));
    return routes;
  }

  async function call(req) {
    const res = await fetch(VALHALLA + '?json=' + encodeURIComponent(JSON.stringify(req)));
    let j = null;
    try { j = await res.json(); } catch (e) { /* 본문 없음 */ }
    if (!res.ok) { console.warn('Valhalla', res.status, j && j.error); return j && j.trip ? j : { error: 'Valhalla ' + res.status + (j && j.error ? ' ' + j.error : '') }; }
    return j;
  }

  function parseTrip(trip) {
    const coords = [], maneuvers = [];
    let distance = 0, time = 0, offset = 0;
    for (const leg of trip.legs || []) {
      const c = Geo.decodePolyline(leg.shape, 6);
      for (const m of leg.maneuvers || []) {
        maneuvers.push({
          text: m.instruction || '',
          length: Math.round((m.length || 0) * 1000),
          time: m.time || 0,
          begin: offset + (m.begin_shape_index || 0),
          end: offset + (m.end_shape_index || 0),
          street: (m.street_names || []).join(' '),
          type: m.type
        });
      }
      for (const p of c) coords.push(p);
      offset += c.length;
      distance += (leg.summary && leg.summary.length || 0) * 1000;
      time += (leg.summary && leg.summary.time) || 0;
    }
    return { coords, distance: Math.round(distance), time: Math.round(time), maneuvers };
  }

  // computed = 길목 목록(바람 계산 포함, _idx 있으면 빠름), bg = 배경 바람
  function windProfile(route, computed, bg) {
    const dense = Geo.densify(route.coords, STEP);
    const meters = [0, 0, 0, 0];
    const pieces = []; // { a, b, level }
    let exposure = 0;
    for (let i = 0; i < dense.length - 1; i++) {
      const a = dense[i], b = dense[i + 1];
      const len = b.s - a.s;
      if (len <= 0) continue;
      const mid = [(a.p[0] + b.p[0]) / 2, (a.p[1] + b.p[1]) / 2];
      let level, chunk = null;
      const n = computed && computed.length ? Model.nearestChunk(computed, mid, 15, null) : null;
      if (n) { level = n.chunk.level; chunk = n.chunk; }
      else if (bg) level = Model.localWind({ cls: 'alley', axis: Geo.bearing(a.p, b.p) % 180, coords: [a.p, b.p] }, bg, null).level;
      else level = Model.LEVELS[0];
      meters[level.key] += len;
      exposure += len * WEIGHT[level.key];
      pieces.push({ a: a.p, b: b.p, s: a.s, len, level, chunk });
    }
    // 같은 단계가 이어지면 한 선으로 합침
    const features = [];
    let cur = null;
    for (const pc of pieces) {
      if (cur && cur.level === pc.level.key) { cur.coords.push(pc.b); }
      else { cur = { level: pc.level.key, color: pc.level.color, coords: [pc.a, pc.b] }; features.push(cur); }
    }
    return {
      meters: meters.map(Math.round), exposure: Math.round(exposure), pieces,
      geojson: { type: 'FeatureCollection', features: features.map(f => ({ type: 'Feature', geometry: { type: 'LineString', coordinates: f.coords }, properties: { level: f.level, color: f.color } })) }
    };
  }

  // 대안 순위: 노출 점수 낮은 순. 라벨: 가장 빠른 길 / 바람 덜 맞는 길
  function rank(routes) {
    const fastest = routes.reduce((a, b) => (b.time < a.time ? b : a), routes[0]);
    const calmest = routes.reduce((a, b) => (b.profile.exposure < a.profile.exposure ? b : a), routes[0]);
    for (const r of routes) {
      r.label = r === calmest && r !== fastest ? '바람 덜 맞는 길' : (r === fastest ? '가장 빠른 길' : '다른 길');
      if (r === calmest && r === fastest) r.label = '가장 빠른 길 · 바람도 가장 적음';
    }
    return routes.slice().sort((a, b) => (a === calmest ? -1 : b === calmest ? 1 : a.time - b.time));
  }

  // 경로 위 현재 위치에서 앞으로 lookAhead(m) 안에 단계가 달라지는 첫 조각
  function aheadOnRoute(pos, profile, cur, lookAhead) {
    const pieces = profile.pieces;
    if (!pieces.length) return null;
    let bi = 0, bd = Infinity;
    for (let i = 0; i < pieces.length; i++) {
      const r = Geo.distPointSeg(pos, pieces[i].a, pieces[i].b);
      if (r.d < bd) { bd = r.d; bi = i; }
    }
    if (bd > 40) return undefined; // 경로에서 벗어남 → 일반 탐색으로
    const s0 = pieces[bi].s;
    for (let i = bi; i < pieces.length; i++) {
      const pc = pieces[i];
      if (pc.s - s0 > (lookAhead || 150)) break;
      if (pc.level.key !== cur.level.key) return { chunk: pc.chunk || { name: '', speed: 0, gust: 0, level: pc.level }, dist: Math.max(0, Math.round(pc.s - s0)), ahead: true, level: pc.level };
    }
    return null;
  }

  function fmtTime(sec) { const m = Math.max(1, Math.round(sec / 60)); return m >= 60 ? Math.floor(m / 60) + '시간 ' + (m % 60) + '분' : m + '분'; }
  function fmtDist(m) { return m >= 1000 ? (m / 1000).toFixed(1) + ' km' : Math.round(m) + ' m'; }

  window.Route = { fetchRoutes, parseTrip, windProfile, rank, aheadOnRoute, fmtTime, fmtDist, WEIGHT };
})();
