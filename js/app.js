/* 바람길 — 길목 단위 실시간 바람 지도 (앱 본체) */
(function () {
  const CONFIG = {
    kmaProxyUrl: '',                    // 기상청 프록시 URL (비우면 Open-Meteo 사용) — README 참고
    rasterManifest: '',                 // 'data/manifest.json' 로 두면 정밀 래스터 사용 (model.js 참고)
    fetchRadius: 700,                   // 길 데이터를 받아올 반경 (m)
    refetchMove: 350,                   // 이만큼 이동하면 길 데이터 다시 받음 (m)
    windRefreshMs: 10 * 60 * 1000,      // 배경 바람 갱신 주기
    lookAhead: 150,                     // 다음 길목 탐색 거리 (m)
    snapDist: 25,                       // 이 거리 안이면 그 길목 '위'로 봄 (m)
    defaultCenter: [126.8826, 37.4816], // 위치를 못 잡을 때 시작점: 가산디지털단지역
    // 배경 지도: 'positron'(밝은 벡터 지도, 기본) | 'bright'(색 있는 벡터 지도) | 'osm'(표준 OSM 래스터)
    //            | 'https://...style.json'(MapLibre 스타일 URL) | ['https://.../{z}/{x}/{y}.png'](XYZ 래스터 타일 URL 배열)
    // positron/bright 는 OpenFreeMap(키·한도 없음). CARTO 래스터는 2026-08부터 키 없으면 워터마크가 찍혀서 뺐음.
    basemap: 'positron',
    buildings3d: true                   // 건물을 높이 있는 형상으로 (두 손가락 위아래로 기울여 보기)
  };

  const WIND_ATTR = '바람 <a href="https://open-meteo.com/">Open-Meteo</a>';
  function rasterStyle(tiles, attribution) {
    return {
      version: 8,
      sources: { base: { type: 'raster', tiles, tileSize: 256, maxzoom: 19, attribution } },
      layers: [{ id: 'base', type: 'raster', source: 'base' }]
    };
  }
  function resolveStyle(bm) {
    if (MOCK) return { version: 8, sources: {}, layers: [{ id: 'bg', type: 'background', paint: { 'background-color': '#f3f1ec' } }] }; // 모의: 배경 지도 없이
    if (Array.isArray(bm)) return rasterStyle(bm, '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors');
    if (typeof bm === 'string' && (/^https?:\/\//.test(bm) || bm.endsWith('.json'))) return bm;
    if (bm === 'osm') return rasterStyle(['https://tile.openstreetmap.org/{z}/{x}/{y}.png'], '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors');
    if (bm === 'bright') return 'https://tiles.openfreemap.org/styles/bright';
    return 'https://tiles.openfreemap.org/styles/positron';
  }

  const params = new URLSearchParams(location.search);
  const MOCK = params.get('mock') === '1';
  const VECTOR_EXPECTED = !MOCK && !(Array.isArray(CONFIG.basemap) || CONFIG.basemap === 'osm'); // 벡터 배경이면 Overpass 를 쓰지 않음
  let SIM = params.get('sim') === '1';
  if (params.get('lat') && params.get('lon')) {
    CONFIG.defaultCenter = [parseFloat(params.get('lon')), parseFloat(params.get('lat'))];
  }
  if (params.get('style')) CONFIG.basemap = params.get('style'); // 개발용: 스타일 URL 직접 지정

  const S = {
    pos: null,            // [lon, lat]
    posTime: 0,
    compass: null,        // 나침반 방위 (도) 또는 null
    compassTime: 0,
    moveBearing: null,    // 이동 방향 (도) 또는 null
    lastMovePos: null,
    bg: null,             // 배경 바람
    bgTime: 0,
    chunks: [],
    buildings: null,      // GeoJSON
    vectorSource: null,   // 벡터 지도 소스 id (있으면 타일에서 길·건물을 꺼냄)
    needExtract: false, tileCenter: null, tileZoom: 0,
    computed: [],         // chunk + wind
    fetchCenter: null,
    loadingStreets: false,
    raster: null,
    follow: true,
    current: null,
    started: false
  };

  const $ = id => document.getElementById(id);
  const el = {
    start: $('start'), btnStart: $('btn-start'), btnSim: $('btn-sim'),
    now: $('now'), nowDot: $('now-dot'), nowLevel: $('now-level'), nowSpeed: $('now-speed'), nowTime: $('now-time'),
    nowGust: $('now-gust'), nowArrow: $('now-arrow'), nowDir: $('now-dir'), nowPlace: $('now-place'),
    next: $('next'), nextDot: $('next-dot'), nextTitle: $('next-title'), nextSub: $('next-sub'),
    locate: $('locate'), toast: $('toast'), me: $('me'), meWedge: $('me-wedge')
  };

  /* ---------- 지도 ---------- */
  const map = new maplibregl.Map({
    container: 'map',
    style: resolveStyle(CONFIG.basemap),
    center: CONFIG.defaultCenter,
    zoom: 16.4,
    minZoom: 12,
    maxZoom: 19.5,
    maxPitch: 60,
    pitchWithRotate: false,
    dragRotate: false,
    attributionControl: { compact: true, customAttribution: WIND_ATTR }
  });
  map.touchZoomRotate.disableRotation();
  if (!CONFIG.buildings3d) map.touchPitch.disable();

  const meMarker = new maplibregl.Marker({ element: el.me, rotationAlignment: 'map', pitchAlignment: 'map' });

  function chevronImage() {
    const s = 32, cv = document.createElement('canvas');
    cv.width = s; cv.height = s;
    const c = cv.getContext('2d');
    c.lineCap = 'round'; c.lineJoin = 'round';
    c.strokeStyle = 'rgba(28,27,24,0.35)'; c.lineWidth = 7;
    c.beginPath(); c.moveTo(9, 7); c.lineTo(22, 16); c.lineTo(9, 25); c.stroke();
    c.strokeStyle = '#ffffff'; c.lineWidth = 3.5;
    c.beginPath(); c.moveTo(9, 7); c.lineTo(22, 16); c.lineTo(9, 25); c.stroke();
    return c.getImageData(0, 0, s, s);
  }

  // 선 굵기: 길 종류별 기본 굵기 × 줌 배율 ("zoom"은 최상위 interpolate 안에서만 쓸 수 있음)
  const clsW = ['match', ['get', 'cls'], 'wide', 7, 'road', 5, 3];
  const widthAt = (k, plus) => plus ? ['+', ['*', k, clsW], plus] : ['*', k, clsW];
  const widthExpr = (scale, plus) => ['interpolate', ['exponential', 1.5], ['zoom'],
    14, widthAt(0.45 * scale, plus), 16, widthAt(1 * scale, plus), 19, widthAt(2.6 * scale, plus)];

  // 스타일이 준비되는 즉시 레이어를 얹는다 ('load'는 타일까지 다 받은 뒤라 느린 망에서 늦어짐)
  map.on('style.load', () => {
    if (map.getSource('wind')) return;
    // 벡터 지도의 글자를 한국어 이름 우선으로
    try {
      for (const l of map.getStyle().layers) {
        const tf = l.type === 'symbol' ? map.getLayoutProperty(l.id, 'text-field') : null;
        if (tf && JSON.stringify(tf).includes('name')) {
          map.setLayoutProperty(l.id, 'text-field', ['coalesce', ['get', 'name:ko'], ['get', 'name']]);
        }
      }
    } catch (e) { /* 래스터 지도 등: 무시 */ }
    map.addImage('chev', chevronImage(), { pixelRatio: 2 });
    // 우리 레이어는 배경 지도의 글자(라벨) 아래에 끼워 넣어 지명이 가려지지 않게 한다
    const firstLabel = (map.getStyle().layers.find(l => l.type === 'symbol') || {}).id;
    const add = layer => map.addLayer(layer, firstLabel);
    // 건물 (OpenStreetMap 윤곽 + 층수 기반 높이)
    map.addSource('buildings', { type: 'geojson', data: S.buildings || { type: 'FeatureCollection', features: [] } });
    if (CONFIG.buildings3d) {
      add({
        id: 'buildings', type: 'fill-extrusion', source: 'buildings',
        paint: { 'fill-extrusion-color': '#e3dfd5', 'fill-extrusion-height': ['get', 'height'], 'fill-extrusion-base': 0, 'fill-extrusion-opacity': 0.92, 'fill-extrusion-vertical-gradient': true }
      });
    } else {
      add({ id: 'buildings', type: 'fill', source: 'buildings', paint: { 'fill-color': '#e3dfd5', 'fill-opacity': 0.92 } });
    }
    add({ id: 'buildings-edge', type: 'line', source: 'buildings', paint: { 'line-color': '#cbc6ba', 'line-width': 0.7 } });
    map.addSource('wind', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
    add({
      id: 'wind-casing', type: 'line', source: 'wind',
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: { 'line-color': '#ffffff', 'line-width': widthExpr(1, 3), 'line-opacity': 0.95 }
    });
    add({
      id: 'wind-line', type: 'line', source: 'wind',
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: { 'line-color': ['get', 'color'], 'line-width': widthExpr(1, 0) }
    });
    for (let i = 0; i < 4; i++) {
      add({
        id: 'flow-' + i, type: 'line', source: 'wind',
        filter: ['all', ['==', ['get', 'level'], i], ['==', ['get', 'arrows'], true]],
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: { 'line-color': '#ffffff', 'line-width': widthExpr(0.38, 0), 'line-opacity': [0.55, 0.8, 0.9, 0.95][i], 'line-dasharray': [0, 4, 3] }
      });
    }
    add({
      id: 'arrows', type: 'symbol', source: 'wind',
      filter: ['==', ['get', 'arrows'], true],
      layout: {
        'symbol-placement': 'line', 'symbol-spacing': 46,
        'icon-image': 'chev', 'icon-size': ['interpolate', ['linear'], ['zoom'], 14, 0.45, 16, 0.75, 19, 1.1],
        'icon-rotation-alignment': 'map', 'icon-allow-overlap': true, 'icon-ignore-placement': true
      }
    });
    if (S.windGeoJSON) map.getSource('wind').setData(S.windGeoJSON);
    startFlowAnimation();
    // 벡터 지도면 길·건물을 타일에서 바로 꺼낸다 (Overpass 불필요)
    const st = map.getStyle();
    const vs = Object.keys(st.sources).find(k => st.sources[k].type === 'vector');
    S.vectorSource = (!MOCK && vs) ? vs : null;
    S.needExtract = true;
  });
  map.on('dragstart', () => { S.follow = false; el.locate.classList.remove('on'); });
  map.on('click', e => { if (SIM) simMoveTo([e.lngLat.lng, e.lngLat.lat]); });
  // 화면이 움직이거나 타일이 새로 도착하면 길·건물을 다시 꺼낸다.
  // ('idle' 이벤트는 흐름 애니메이션 때문에 거의 안 오므로 쓰지 않는다)
  map.on('moveend', () => { S.needExtract = true; tryExtract(); });
  map.on('sourcedata', e => { if (S.vectorSource && e.sourceId === S.vectorSource && e.isSourceLoaded) tryExtract(); });
  setInterval(tryExtract, 2000);
  function tryExtract() {
    if (!S.vectorSource || !S.needExtract) return;
    if (map.getZoom() < 14) return; // 이 아래 줌에는 골목이 타일에 없음
    if (!map.isSourceLoaded(S.vectorSource)) return; // 타일 로딩 중 → sourcedata 때 다시
    const c = map.getCenter(), cc = [c.lng, c.lat];
    if (S.tileCenter && Geo.distance(S.tileCenter, cc) < 80 && Math.abs(S.tileZoom - map.getZoom()) < 0.7) { S.needExtract = false; return; }
    S.needExtract = false;
    try {
      const area = Streets.fromVectorTiles(map, S.vectorSource);
      if (!area.ways.length && !area.buildings.features.length) return;
      S.chunks = Streets.chunkWays(area.ways);
      mergeBuildings(area.buildings, cc);
      S.tileCenter = cc; S.tileZoom = map.getZoom();
      recompute();
    } catch (e) { console.warn('타일에서 길 꺼내기 실패', e); }
  }
  // 건물은 한 번 본 곳을 기억해 둔다 (중심에서 2.5 km 넘게 먼 것은 버림)
  const bIndex = new Map();
  function mergeBuildings(fc, center) {
    for (const f of fc.features) bIndex.set(f.properties.key || JSON.stringify(f.geometry.coordinates[0][0]), f);
    if (bIndex.size > 4000) {
      for (const [k, f] of bIndex) {
        const p = f.geometry.type === 'Polygon' ? f.geometry.coordinates[0][0] : f.geometry.coordinates[0][0][0];
        if (Geo.distance(center, p) > 2500) bIndex.delete(k);
      }
    }
    S.buildings = { type: 'FeatureCollection', features: Array.from(bIndex.values()) };
    const bsrc = map.getSource('buildings');
    if (bsrc) bsrc.setData(S.buildings);
  }

  /* 흐름 점선 애니메이션: 단계가 셀수록 빨리 흐름 */
  const DASH = [[0, 4, 3], [0.5, 4, 2.5], [1, 4, 2], [1.5, 4, 1.5], [2, 4, 1], [2.5, 4, 0.5], [3, 4, 0],
    [0, 0.5, 3, 3.5], [0, 1, 3, 3], [0, 1.5, 3, 2.5], [0, 2, 3, 2], [0, 2.5, 3, 1.5], [0, 3, 3, 1], [0, 3.5, 3, 0.5]];
  const STEP_MS = [120, 70, 42, 26];
  function startFlowAnimation() {
    const step = [0, 0, 0, 0], last = [0, 0, 0, 0];
    function frame(ts) {
      if (!document.hidden && S.computed.length) {
        for (let i = 0; i < 4; i++) {
          if (ts - last[i] > STEP_MS[i]) {
            step[i] = (step[i] + 1) % DASH.length; last[i] = ts;
            map.setPaintProperty('flow-' + i, 'line-dasharray', DASH[step[i]]);
          }
        }
      }
      requestAnimationFrame(frame);
    }
    requestAnimationFrame(frame);
  }

  /* ---------- 시작 ---------- */
  el.btnStart.addEventListener('click', () => start(false));
  el.btnSim.addEventListener('click', () => start(true));

  async function start(sim) {
    S.started = true;
    el.start.hidden = true;
    SIM = sim || SIM;
    await requestCompass();
    if (SIM || MOCK) {
      setPosition(CONFIG.defaultCenter, true);
      toast('테스트 모드 · 지도를 탭하면 그 자리로 이동');
    } else if (navigator.geolocation) {
      toast('현재 위치 찾는 중…');
      navigator.geolocation.watchPosition(onGeo, onGeoError, { enableHighAccuracy: true, maximumAge: 2000, timeout: 15000 });
    } else {
      onGeoError({ code: 0 });
    }
  }

  function onGeo(p) {
    const c = p.coords;
    if (typeof c.heading === 'number' && !isNaN(c.heading) && c.speed > 0.6) S.moveBearing = c.heading;
    setPosition([c.longitude, c.latitude], false);
  }
  function onGeoError(e) {
    console.warn('geolocation 실패', e);
    if (!S.pos) {
      SIM = true;
      setPosition(CONFIG.defaultCenter, true);
      toast('위치를 못 받아서 테스트 모드로 시작 · 지도를 탭하면 이동');
    }
  }
  function simMoveTo(p) {
    if (S.pos) S.moveBearing = Geo.bearing(S.pos, p);
    setPosition(p, false);
  }

  function setPosition(p, first) {
    if (S.lastMovePos && Geo.distance(S.lastMovePos, p) >= 8) {
      if (!SIM) S.moveBearing = Geo.bearing(S.lastMovePos, p);
      S.lastMovePos = p;
    } else if (!S.lastMovePos) S.lastMovePos = p;
    S.pos = p; S.posTime = Date.now();
    meMarker.setLngLat(p).addTo(map);
    updateHeadingUI();
    if (first || S.follow) map.easeTo({ center: p, duration: first ? 0 : 600 });
    ensureStreets();
    ensureWind();
    refreshCards();
  }

  /* ---------- 나침반 ---------- */
  async function requestCompass() {
    try {
      if (window.DeviceOrientationEvent && typeof DeviceOrientationEvent.requestPermission === 'function') {
        const r = await DeviceOrientationEvent.requestPermission();
        if (r !== 'granted') return;
        window.addEventListener('deviceorientation', onOrient, true);
      } else if ('ondeviceorientationabsolute' in window) {
        window.addEventListener('deviceorientationabsolute', onOrient, true);
      } else if (window.DeviceOrientationEvent) {
        window.addEventListener('deviceorientation', onOrient, true);
      }
    } catch (e) { console.warn('나침반 권한 없음', e); }
  }
  function onOrient(e) {
    let h = null;
    if (typeof e.webkitCompassHeading === 'number') h = e.webkitCompassHeading;          // iOS
    else if (e.absolute && typeof e.alpha === 'number') h = (360 - e.alpha) % 360;       // Android
    if (h === null || isNaN(h)) return;
    S.compass = h; S.compassTime = Date.now();
    updateHeadingUI();
  }
  function heading() {
    if (S.compass !== null && Date.now() - S.compassTime < 5000) return S.compass;
    return S.moveBearing;
  }
  let headingRaf = 0;
  function updateHeadingUI() {
    if (headingRaf) return;
    headingRaf = requestAnimationFrame(() => {
      headingRaf = 0;
      const h = heading();
      el.meWedge.style.opacity = h === null ? '0' : '1';
      if (h !== null) meMarker.setRotation(h);
      if (S.pos && S.computed.length) updateNext();
    });
  }

  /* ---------- 데이터 ---------- */
  async function ensureStreets() {
    if (!S.pos || S.loadingStreets) return;
    if (S.vectorSource || VECTOR_EXPECTED) return; // 벡터 지도: 타일에서 꺼냄 (tryExtract)
    if (S.fetchCenter && Geo.distance(S.fetchCenter, S.pos) < CONFIG.refetchMove) return;
    S.loadingStreets = true;
    const center = S.pos;
    try {
      let area;
      if (MOCK) area = { chunks: Streets.chunkWays(Mock.ways(center)), buildings: Mock.buildings(center) };
      else {
        toast('주변 길·건물 불러오는 중… (OpenStreetMap)');
        area = await Streets.loadArea(center, CONFIG.fetchRadius);
      }
      S.chunks = area.chunks;
      S.buildings = area.buildings;
      const bsrc = map.getSource('buildings');
      if (bsrc) bsrc.setData(S.buildings);
      S.fetchCenter = center;
      hideToast();
      recompute();
    } catch (e) {
      console.error(e);
      toast('길 데이터를 못 받았어요 · 1분 뒤 다시 시도');
      setTimeout(() => { S.loadingStreets = false; ensureStreets(); }, 60000);
      return;
    }
    S.loadingStreets = false;
  }

  let windTimer = 0, windLoading = false;
  async function ensureWind() {
    if (!S.pos || windLoading) return;
    if (S.bg && Date.now() - S.bgTime < CONFIG.windRefreshMs) return;
    windLoading = true;
    try {
      if (MOCK) S.bg = Mock.wind();
      else S.bg = await Wind.fetchCurrent(S.pos[1], S.pos[0], CONFIG);
      S.bgTime = Date.now();
      recompute();
    } catch (e) {
      console.error(e);
      S.bgTime = Date.now() - CONFIG.windRefreshMs + 60000; // 1분 뒤 재시도
      if (!S.bg) S.bg = null;
      toast('바람 데이터를 못 받았어요 · 1분 뒤 다시 시도');
    }
    windLoading = false;
    clearTimeout(windTimer);
    windTimer = setTimeout(ensureWind, S.bg ? CONFIG.windRefreshMs + 1000 : 60000);
  }
  document.addEventListener('visibilitychange', () => { if (!document.hidden) ensureWind(); });

  async function loadRaster() {
    if (!CONFIG.rasterManifest) return;
    try { S.raster = await Model.Raster().load(CONFIG.rasterManifest); recompute(); }
    catch (e) { console.warn('래스터 없음 → 휴리스틱 사용', e.message); }
  }
  loadRaster();

  /* ---------- 계산·표시 ---------- */
  function recompute() {
    if (!S.bg || !S.chunks.length) { updateNow(); return; }
    S.computed = S.chunks.map(ch => {
      const w = Model.localWind(ch, S.bg, S.raster);
      return Object.assign({}, ch, w, { coordsFlow: w.forward ? ch.coords : ch.coords.slice().reverse() });
    });
    const fc = {
      type: 'FeatureCollection',
      features: S.computed.map(c => ({
        type: 'Feature',
        geometry: { type: 'LineString', coordinates: c.coordsFlow },
        properties: { color: c.level.color, level: c.level.key, cls: c.cls, arrows: c.arrows, speed: +c.speed.toFixed(1), gust: Math.round(c.gust), name: c.name }
      }))
    };
    S.windGeoJSON = fc;
    const src = map.getSource('wind');
    if (src) src.setData(fc); else map.once('style.load', () => map.getSource('wind').setData(S.windGeoJSON));
    refreshCards();
  }

  function refreshCards() {
    updateNow();
    updateNext();
  }

  function currentWind() {
    if (!S.bg || !S.pos) return null;
    const n = S.computed.length ? Model.nearestChunk(S.computed, S.pos, 80, null) : null;
    if (n && n.d <= CONFIG.snapDist) return { chunk: n.chunk, speed: n.chunk.speed, gust: n.chunk.gust, level: n.chunk.level, place: n.chunk.name };
    if (n) return { chunk: n.chunk, speed: n.chunk.speed, gust: n.chunk.gust, level: n.chunk.level, place: n.chunk.name };
    const sp = S.bg.speed * 0.6, gu = S.bg.gust * 0.6; // 길에서 먼 트인 곳
    return { chunk: null, speed: sp, gust: gu, level: Model.level(sp), place: '' };
  }

  function updateNow() {
    const cur = currentWind();
    S.current = cur;
    if (!cur) {
      el.nowLevel.textContent = '—'; el.nowSpeed.textContent = '–.–'; el.nowGust.textContent = '';
      el.nowDir.textContent = S.bg ? '' : '바람 데이터 기다리는 중'; el.nowTime.textContent = '';
      el.nowDot.style.background = '#c9c5bb'; el.nowLevel.style.color = '#6b675d';
      el.nowPlace.textContent = '';
      return;
    }
    el.nowDot.style.background = cur.level.color;
    el.nowLevel.textContent = cur.level.name;
    el.nowLevel.style.color = cur.level.color;
    el.nowSpeed.textContent = cur.speed.toFixed(1);
    el.nowGust.textContent = '돌풍 ' + Math.round(cur.gust) + ' m/s';
    el.nowArrow.style.transform = 'rotate(' + Model.flowDir(S.bg) + 'deg)';
    el.nowDir.textContent = Geo.dirName(S.bg.dir) + '풍';
    el.nowTime.textContent = timeLabel(S.bg.time) + ' 기준 · ' + S.bg.source;
    el.nowPlace.textContent = cur.place || (cur.chunk ? '이름 없는 길' : '');
  }

  function updateNext() {
    const cur = S.current;
    if (!cur || !S.computed.length) { el.next.hidden = true; return; }
    const h = heading();
    const found = Model.nextChange(S.pos, h, cur, S.computed, { lookAhead: CONFIG.lookAhead });
    el.next.hidden = false;
    if (!found) {
      el.nextDot.style.background = cur.level.color;
      el.nextTitle.textContent = (h === null ? '주변 80 m' : '앞 ' + CONFIG.lookAhead + ' m') + ' · 변화 없음';
      el.nextSub.textContent = '지금 단계(' + cur.level.name + ') 그대로';
      return;
    }
    const c = found.chunk;
    el.nextDot.style.background = c.level.color;
    el.nextTitle.textContent = (found.ahead ? found.dist + ' m 앞' : '근처 ' + Math.round(found.dist) + ' m') + ' · ' + c.level.name;
    el.nextSub.textContent = (c.name || '이름 없는 길') + ' · ' + c.speed.toFixed(1) + ' m/s · 돌풍 ' + Math.round(c.gust)
      + (found.ahead ? '' : ' · 방향 확인 중');
  }

  /* ---------- 기타 UI ---------- */
  el.locate.addEventListener('click', () => {
    S.follow = true; el.locate.classList.add('on');
    if (S.pos) map.easeTo({ center: S.pos, zoom: Math.max(map.getZoom(), 16.4), duration: 500 });
  });
  let toastTimer = 0;
  function toast(msg, ms) {
    el.toast.textContent = msg; el.toast.hidden = false;
    clearTimeout(toastTimer);
    if (ms !== 0) toastTimer = setTimeout(hideToast, ms || 4000);
  }
  function hideToast() { el.toast.hidden = true; }
  function timeLabel(iso) {
    if (!iso) return '';
    const m = /T(\d{2}):(\d{2})/.exec(iso);
    if (m) return m[1] + ':' + m[2];
    const d = new Date(iso);
    return isNaN(d) ? '' : d.toTimeString().slice(0, 5);
  }

  if (location.protocol === 'http:' || location.protocol === 'https:') {
    const link = document.createElement('link');
    link.rel = 'manifest'; link.href = 'manifest.webmanifest';
    document.head.appendChild(link);
    if ('serviceWorker' in navigator && !MOCK) {
      navigator.serviceWorker.register('sw.js').catch(e => console.warn('sw 등록 실패', e));
    }
  }

  window.App = { S, CONFIG, map, recompute, start };
})();
