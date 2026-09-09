/* 주변 길(도로·골목·보행로) 가져오기와 '길목' 단위로 나누기.
 * 데이터: OpenStreetMap (Overpass API, © OpenStreetMap contributors, ODbL)
 *
 * 길목(chunk) = 방향이 거의 일정한 길 조각. { id, name, cls, coords:[[lon,lat],...], axis: 0..180 }
 *   cls: 'alley' 좁은 골목·이면도로·보행로 / 'road' 2~4차로 / 'wide' 큰길
 */
(function () {
  const OVERPASS_URLS = [
    'https://overpass-api.de/api/interpreter',
    'https://overpass.private.coffee/api/interpreter',
    'https://overpass.kumi.systems/api/interpreter'
  ];
  const HIGHWAYS = '^(primary|primary_link|secondary|secondary_link|tertiary|tertiary_link|residential|unclassified|living_street|pedestrian|service|footway|path)$';
  const CACHE_KEY = 'baramgil.streets.v1';
  const CACHE_TTL = 7 * 24 * 3600 * 1000;
  const MAX_TURN = 25; // 도. 이 이상 꺾이면 새 길목

  function classify(tags) {
    const h = tags.highway || '';
    if (h === 'primary' || h === 'primary_link' || h === 'trunk') return 'wide';
    if (h === 'secondary' || h === 'secondary_link' || h === 'tertiary' || h === 'tertiary_link') {
      const lanes = parseInt(tags.lanes || '0', 10);
      return lanes >= 5 ? 'wide' : 'road';
    }
    if (h === 'residential' || h === 'unclassified') {
      const lanes = parseInt(tags.lanes || '0', 10);
      const width = parseFloat(tags.width || '0');
      if (lanes >= 3 || width >= 12) return 'road';
      return 'alley';
    }
    return 'alley'; // living_street, pedestrian, service, footway, path
  }

  // 길 + 건물 윤곽을 한 번에 요청
  function buildQuery(bbox) {
    const b = bbox.map(v => v.toFixed(5)).join(',');
    return '[out:json][timeout:25];'
      + '(way["highway"~"' + HIGHWAYS + '"]'
      + '["footway"!~"^(sidewalk|crossing)$"]'
      + '["service"!~"^(parking_aisle|driveway|drive-through)$"]'
      + '["area"!="yes"]'
      + '(' + b + ');'
      + 'way["building"](' + b + ');'
      + ');out geom;';
  }

  // 건물 높이(m): height 태그 > 층수×3.2 > 기본 3층
  function buildingHeight(tags) {
    const h = parseFloat(tags.height || '');
    if (h > 0) return h;
    const lv = parseFloat(tags['building:levels'] || '');
    if (lv > 0) return lv * 3.2;
    return 9.6;
  }

  function splitElements(elements) {
    const ways = [], buildings = [];
    for (const e of elements) {
      if (e.type !== 'way' || !e.geometry || e.geometry.length < 2) continue;
      const tags = e.tags || {};
      const coords = e.geometry.map(g => [g.lon, g.lat]);
      if (tags.building) {
        if (coords.length < 4) continue;
        const ring = coords.slice();
        const f = ring[0], l = ring[ring.length - 1];
        if (f[0] !== l[0] || f[1] !== l[1]) ring.push(f);
        buildings.push({ id: e.id, ring, height: buildingHeight(tags), name: tags.name || '' });
      } else if (tags.highway) {
        ways.push({ id: e.id, name: tags.name || tags['name:ko'] || '', tags, coords });
      }
    }
    return { ways, buildings };
  }

  async function fetchArea(bbox) {
    const q = buildQuery(bbox);
    let lastErr = null;
    for (const base of OVERPASS_URLS) {
      try {
        const res = await fetch(base + '?data=' + encodeURIComponent(q));
        if (!res.ok) throw new Error('Overpass ' + res.status);
        const j = await res.json();
        return splitElements(j.elements || []);
      } catch (e) {
        lastErr = e;
        console.warn('Overpass 실패, 다음 서버 시도:', base, e.message);
      }
    }
    throw lastErr || new Error('Overpass 실패');
  }

  function buildingsToGeoJSON(buildings) {
    return {
      type: 'FeatureCollection',
      features: buildings.map(b => ({
        type: 'Feature',
        geometry: { type: 'Polygon', coordinates: [b.ring] },
        properties: { height: b.height, name: b.name }
      }))
    };
  }

  /* ---------- 배경 지도(벡터 타일)에서 바로 꺼내기 ----------
   * OpenFreeMap 등 OpenMapTiles 규격 벡터 지도를 쓸 때는 화면에 이미 받아온 타일 안에
   * 길(transportation)·길 이름(transportation_name)·건물(building)이 들어 있으므로
   * Overpass 요청 없이 그대로 쓴다. 타일 경계에서 잘린 조각이 겹칠 수 있지만 표시엔 문제 없음.
   */
  const SKIP_CLASS = new Set(['motorway', 'motorway_construction', 'trunk_construction', 'primary_construction', 'secondary_construction',
    'tertiary_construction', 'minor_construction', 'rail', 'transit', 'ferry', 'aerialway', 'raceway', 'busway', 'bus_guideway', 'shipway', 'pier']);
  function clsFromTile(p) {
    const c = p.class || '';
    if (c === 'trunk' || c === 'primary') return 'wide';
    if (c === 'secondary' || c === 'tertiary') return 'road';
    return 'alley';
  }
  function eachLine(geom, fn) {
    if (!geom) return;
    if (geom.type === 'LineString') fn(geom.coordinates);
    else if (geom.type === 'MultiLineString') geom.coordinates.forEach(fn);
  }
  const cellKey = c => Math.floor(c[0] / 0.001) + ',' + Math.floor(c[1] / 0.001);

  function fromVectorTiles(map, sourceId) {
    const roads = map.querySourceFeatures(sourceId, { sourceLayer: 'transportation' });
    const names = map.querySourceFeatures(sourceId, { sourceLayer: 'transportation_name' });
    const blds = map.querySourceFeatures(sourceId, { sourceLayer: 'building' });

    // 이름 조각 격자 색인
    const nameIdx = new Map();
    for (const f of names) {
      const p = f.properties || {};
      const name = p['name:ko'] || p.name || '';
      if (!name) continue;
      eachLine(f.geometry, line => {
        for (let i = 0; i < line.length - 1; i++) {
          const a = line[i], b = line[i + 1];
          const seg = { a, b, axis: Geo.bearing(a, b) % 180, name };
          // 조각이 지나는 모든 격자 칸에 등록 (40 m 간격으로 표본)
          const len = Geo.distance(a, b), steps = Math.max(1, Math.ceil(len / 40));
          let lastKey = null;
          for (let t = 0; t <= steps; t++) {
            const k = cellKey([a[0] + (b[0] - a[0]) * t / steps, a[1] + (b[1] - a[1]) * t / steps]);
            if (k === lastKey) continue;
            lastKey = k;
            if (!nameIdx.has(k)) nameIdx.set(k, []);
            nameIdx.get(k).push(seg);
          }
        }
      });
    }
    // 폴리라인의 길이 기준 중간 지점
    function midpoint(coords) {
      const total = Geo.polylineLength(coords);
      let acc = 0;
      for (let i = 0; i < coords.length - 1; i++) {
        const d = Geo.distance(coords[i], coords[i + 1]);
        if (acc + d >= total / 2) {
          const t = d > 0 ? (total / 2 - acc) / d : 0;
          return [coords[i][0] + (coords[i + 1][0] - coords[i][0]) * t, coords[i][1] + (coords[i + 1][1] - coords[i][1]) * t];
        }
        acc += d;
      }
      return coords[coords.length - 1];
    }
    function nameNear(coords, axis) {
      const mid = midpoint(coords);
      const cx = Math.floor(mid[0] / 0.001), cy = Math.floor(mid[1] / 0.001);
      let best = '', bd = 10;
      for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) {
        const segs = nameIdx.get((cx + dx) + ',' + (cy + dy));
        if (!segs) continue;
        for (const s of segs) {
          if (Geo.axisAngle(s.axis, axis) > 20) continue;
          const d = Geo.distPointSeg(mid, s.a, s.b).d;
          if (d < bd) { bd = d; best = s.name; }
        }
      }
      return best;
    }

    const seen = new Set();
    const ways = [];
    for (const f of roads) {
      const p = f.properties || {};
      if (SKIP_CLASS.has(p.class) || p.brunnel === 'tunnel') continue;
      const cls = clsFromTile(p);
      eachLine(f.geometry, line => {
        if (line.length < 2) return;
        const key = cls + '|' + line[0].map(v => v.toFixed(6)).join(',') + '|' + line[line.length - 1].map(v => v.toFixed(6)).join(',') + '|' + line.length;
        if (seen.has(key)) return;
        seen.add(key);
        ways.push({ id: f.id || key, tags: { highway: p.class }, cls, coords: line, nameLookup: nameNear });
      });
    }

    const bseen = new Set();
    const features = [];
    for (const f of blds) {
      const g = f.geometry;
      if (!g || (g.type !== 'Polygon' && g.type !== 'MultiPolygon')) continue;
      const ring = g.type === 'Polygon' ? g.coordinates[0] : g.coordinates[0][0];
      if (!ring || ring.length < 4) continue;
      const key = ring[0].map(v => v.toFixed(6)).join(',') + '|' + ring.length + '|' + ring[Math.floor(ring.length / 2)].map(v => v.toFixed(6)).join(',');
      if (bseen.has(key)) continue;
      bseen.add(key);
      const p = f.properties || {};
      const h = parseFloat(p.render_height);
      features.push({ type: 'Feature', geometry: g, properties: { height: h > 0 ? h : 9.6, name: '', key } });
    }
    return { ways, buildings: { type: 'FeatureCollection', features } };
  }

  // 길을 방향이 일정한 조각으로 나눈다
  function chunkWays(ways) {
    const chunks = [];
    let n = 0;
    for (const w of ways) {
      const cls = w.cls || classify(w.tags);
      const pts = w.coords;
      let start = 0;
      let refBearing = null;
      for (let i = 0; i < pts.length - 1; i++) {
        const b = Geo.bearing(pts[i], pts[i + 1]);
        if (refBearing === null) { refBearing = b; continue; }
        if (Geo.axisAngle(refBearing % 180, b) > MAX_TURN) {
          pushChunk(pts.slice(start, i + 1));
          start = i;
          refBearing = b;
        }
      }
      pushChunk(pts.slice(start));

      function pushChunk(c) {
        if (c.length < 2) return;
        const len = Geo.polylineLength(c);
        if (len < 4) return;
        const axis = Geo.bearing(c[0], c[c.length - 1]) % 180;
        const name = w.name !== undefined ? w.name : (w.nameLookup ? w.nameLookup(c, axis) : '');
        chunks.push({ id: 'c' + (n++), wayId: w.id, name, cls, coords: c, axis, length: len });
      }
    }
    return chunks;
  }

  // 캐시: bbox 를 0.005도 격자로 반올림한 키
  function cacheKey(bbox) {
    return bbox.map(v => (Math.round(v / 0.005) * 0.005).toFixed(3)).join(',');
  }
  function readCache(key) {
    try {
      const all = JSON.parse(localStorage.getItem(CACHE_KEY) || '{}');
      const hit = all[key];
      if (hit && Date.now() - hit.t < CACHE_TTL && hit.ways && hit.buildings) return hit;
    } catch (e) { /* 저장소 없음 */ }
    return null;
  }
  const r6 = v => Math.round(v * 1e6) / 1e6;
  function writeCache(key, area) {
    try {
      const all = JSON.parse(localStorage.getItem(CACHE_KEY) || '{}');
      const keys = Object.keys(all);
      while (keys.length > 5) delete all[keys.shift()];
      all[key] = {
        t: Date.now(),
        ways: area.ways.map(w => ({ id: w.id, name: w.name, tags: { highway: w.tags.highway, lanes: w.tags.lanes, width: w.tags.width }, coords: w.coords.map(c => [r6(c[0]), r6(c[1])]) })),
        buildings: area.buildings.map(b => ({ id: b.id, height: Math.round(b.height * 10) / 10, name: b.name, ring: b.ring.map(c => [r6(c[0]), r6(c[1])]) }))
      };
      localStorage.setItem(CACHE_KEY, JSON.stringify(all));
    } catch (e) {
      try { localStorage.removeItem(CACHE_KEY); } catch (e2) { /* 무시 */ }
    }
  }

  // 중심 좌표 주변 half(m) 범위의 길목 목록 + 건물
  async function loadArea(center, half) {
    const bbox = Geo.bbox(center, half);
    const key = cacheKey(bbox);
    let area = readCache(key);
    if (!area) {
      area = await fetchArea(bbox);
      writeCache(key, area);
    }
    return { chunks: chunkWays(area.ways), buildings: buildingsToGeoJSON(area.buildings) };
  }

  window.Streets = { loadArea, fromVectorTiles, chunkWays, classify, clsFromTile, buildQuery, fetchArea, splitElements, buildingsToGeoJSON, buildingHeight };
})();
