/* 바람길 — 길목 단위 실시간 바람 지도 (앱 본체) */
(function () {
  const CONFIG = {
    kmaProxyUrl: '',                    // 기상청 프록시 URL (비우면 Open-Meteo 사용) — README 참고
    model: '',                          // Open-Meteo 모델 지정: '' = 자동(best_match) | 'kma_seamless' = 기상청 LDPS(1.5 km, 1시간 → 15분 보간)
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
    buildings3d: true,                  // 건물을 높이 있는 형상으로 (두 손가락 위아래로 기울여 보기)
    // 장소 검색: 기본은 Photon(OpenStreetMap, 키 없음, 자동완성). 카카오 JavaScript 키를 넣으면 카카오 로컬(한국 장소·주소 품질 최고, 자동완성).
    //   키 발급: developers.kakao.com → 내 애플리케이션 → 앱 만들기 → [앱 키] JavaScript 키 복사
    //           → [플랫폼] Web 에 사이트 도메인 등록 (예: https://아이디.github.io) — 등록 안 하면 SDK 가 거부함
    search: { provider: 'photon', kakaoKey: '' }
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
    bg: null,             // 지금 지도에 적용된 배경 바람 (= live 또는 선택한 예측 시각의 값)
    live: null,           // 현재(관측/모델) 배경 바람
    forecast: [],         // 예보 [{ t, speed, dir, gust }] (15분 간격, 6시간+)
    forecastSource: '',
    slot: 0,              // 선택한 타임라인 칸: 0 = 지금, k = k×15분 뒤 (최대 24 = 6시간)
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
    nowGust: $('now-gust'), nowArrow: $('now-arrow'), nowDir: $('now-dir'), nowPlace: $('now-place'), nowFc: $('now-fc'),
    next: $('next'), nextDot: $('next-dot'), nextTitle: $('next-title'), nextSub: $('next-sub'),
    tl: $('tl'), tlWhen: $('tl-when'), tlClock: $('tl-clock'), tlNow: $('tl-now'), tlBars: $('tl-bars'), tlTicks: $('tl-ticks'),
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
    attributionControl: false
  });
  map.addControl(new maplibregl.AttributionControl({ compact: true, customAttribution: WIND_ATTR }), 'bottom-left');
  map.touchZoomRotate.disableRotation();
  if (!CONFIG.buildings3d) map.touchPitch.disable();

  const meMarker = new maplibregl.Marker({ element: el.me, rotationAlignment: 'map', pitchAlignment: 'map' });

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
    // 길목 색 = 단계. 방향·세기는 캔버스 입자(particles.js)가 맡는다 — 지도 스타일은 이후 건드리지 않음
    map.addSource('wind', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
    add({
      id: 'wind-casing', type: 'line', source: 'wind',
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: { 'line-color': '#ffffff', 'line-width': widthExpr(1, 2), 'line-opacity': 0.9 }
    });
    add({
      id: 'wind-line', type: 'line', source: 'wind',
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: { 'line-color': ['coalesce', ['feature-state', 'color'], '#c9c5bb'], 'line-width': widthExpr(1, 0), 'line-opacity': 0.92 }
    });
    if (S.windGeoJSON) { map.getSource('wind').setData(S.windGeoJSON); applyWindStates(); }
    if (!S.particles) {
      S.particles = Particles.create(map, map.getContainer());
      if (S.computed.length) { S.particles.setTracks(S.computed); S.particles.start(); }
    }
    // 벡터 지도면 길·건물을 타일에서 바로 꺼낸다 (Overpass 불필요)
    const st = map.getStyle();
    const vs = Object.keys(st.sources).find(k => st.sources[k].type === 'vector');
    S.vectorSource = (!MOCK && vs) ? vs : null;
    S.needExtract = true;
  });
  map.on('dragstart', () => { S.follow = false; el.locate.classList.remove('on'); });
  // 탭: 길을 누르면 그 길목의 값, 빈 곳을 누르면(테스트 모드) 그 자리로 이동
  const popup = new maplibregl.Popup({ closeButton: false, closeOnClick: true, offset: 10, maxWidth: '260px' });
  map.on('click', e => {
    if (window.Nav && Nav.handleClick(e)) return;
    const hit = map.getLayer('wind-line') ? map.queryRenderedFeatures([[e.point.x - 10, e.point.y - 10], [e.point.x + 10, e.point.y + 10]], { layers: ['wind-line'] }) : [];
    if (hit.length) {
      const c = S.computed[hit[0].id]; // feature id = S.computed 인덱스
      if (c) {
        const lv = c.level;
        popup.setLngLat(e.lngLat).setHTML(
          '<div class="pop"><b style="color:' + lv.text + '">' + lv.name + '</b> ' + c.speed.toFixed(1) + ' m/s · 돌풍 ' + Math.round(c.gust)
          + (S.bg && S.bg.forecast ? ' <span class="fc-tag">' + timeLabel(S.bg.time) + ' 예측</span>' : '')
          + '<div class="pop-sub">' + (c.name || '이름 없는 길') + (c.arrows ? '' : ' · 바람이 가로지름') + '</div></div>').addTo(map);
        return;
      }
    }
    popup.remove();
    if (SIM) simMoveTo([e.lngLat.lng, e.lngLat.lat]);
  });
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

  /* ---------- 시작 ---------- */
  el.btnStart.addEventListener('click', () => start(false));
  el.btnSim.addEventListener('click', () => start(true));

  async function start(sim) {
    S.started = true;
    el.start.hidden = true;
    SIM = sim || SIM;
    await requestCompass();
    // 공유 링크(?lat&lon&q)로 열었으면 그 장소를 바로 보여줌
    if (params.get('q') && params.get('lat') && params.get('lon') && window.Nav) {
      setTimeout(() => Nav.showPlace({ name: params.get('q'), address: '', category: '', lat: parseFloat(params.get('lat')), lon: parseFloat(params.get('lon')) }), 800);
    }
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
    if (window.Nav) Nav.onPosition();
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
  let lastNextHeading = null, lastNextTime = 0;
  function onOrient(e) {
    let h = null;
    if (typeof e.webkitCompassHeading === 'number') h = e.webkitCompassHeading;          // iOS
    else if (e.absolute && typeof e.alpha === 'number') h = (360 - e.alpha) % 360;       // Android
    if (h === null || isNaN(h)) return;
    setCompass(h);
  }
  function setCompass(h) {
    S.compass = h; S.compassTime = Date.now();
    feedHeading(h); // 부채꼴은 필터를 거쳐 매 프레임 부드럽게 따라감
    // 다음 길목 탐색(계산 비용 큼)은 3도 이상 바뀌고 250 ms 지났을 때만
    const now = Date.now();
    if (lastNextHeading !== null && Geo.angDiff(lastNextHeading, h) < 3) return;
    if (now - lastNextTime < 250) return;
    lastNextHeading = h; lastNextTime = now;
    if (S.pos && S.computed.length) updateNext();
  }
  function heading() {
    if (S.compass !== null && Date.now() - S.compassTime < 5000) return S.compass;
    return S.moveBearing;
  }
  /* 표시용 방위: 1€ 필터 (Casiez·Roussel·Vogel, CHI 2012)
   *  가만히 있을 땐 나침반 떨림(±2~3°)을 죽이고, 빨리 돌릴 땐 차단 주파수를 올려 지연 없이 따라간다.
   *  각도는 최단 회전 방향으로 '풀어서'(unwrap) 연속값으로 만든 뒤 걸러서, 359°→1° 에서도 튀지 않는다.
   *  나침반 이벤트가 오는 동안엔 매 프레임 그리고, 400 ms 동안 조용하면 루프를 멈춘다(CPU 절약). */
  function oneEuro(minCutoff, beta, dCutoff) {
    let xPrev = null, dxPrev = 0, tPrev = 0;
    const alpha = (cutoff, dt) => { const tau = 1 / (2 * Math.PI * cutoff); return 1 / (1 + tau / dt); };
    const f = function (x, t) {
      if (xPrev === null) { xPrev = x; tPrev = t; return x; }
      const dt = Math.max(0.001, (t - tPrev) / 1000); tPrev = t;
      const dx = (x - xPrev) / dt;
      const aD = alpha(dCutoff, dt);
      const dxHat = aD * dx + (1 - aD) * dxPrev; dxPrev = dxHat;
      const a = alpha(minCutoff + beta * Math.abs(dxHat), dt);
      xPrev = a * x + (1 - a) * xPrev;
      return xPrev;
    };
    f.reset = () => { xPrev = null; dxPrev = 0; };
    return f;
  }
  const headingFilter = oneEuro(0.9, 0.015, 1.0);
  let rawUnwrapped = null, lastRaw = null, lastHeadingEvent = 0, shownHeading = null, headingAnim = 0;
  function feedHeading(h) {
    if (lastRaw === null) { rawUnwrapped = h; lastRaw = h; }
    else { rawUnwrapped += ((h - lastRaw + 540) % 360) - 180; lastRaw = h; } // 최단 회전으로 누적
    lastHeadingEvent = performance.now();
    kickHeading();
  }
  function animateHeading(now) {
    headingAnim = 0;
    if (heading() === null) { el.meWedge.style.opacity = '0'; shownHeading = null; lastRaw = null; headingFilter.reset(); return; }
    el.meWedge.style.opacity = '1';
    let v = headingFilter(rawUnwrapped, now);
    const settled = Math.abs(v - rawUnwrapped) < 0.15;
    if (settled && now - lastHeadingEvent >= 400) v = rawUnwrapped; // 멈출 땐 정확한 값에 붙임
    shownHeading = ((v % 360) + 360) % 360;
    el.meWedge.style.transform = 'rotate(' + shownHeading.toFixed(2) + 'deg)';
    if (!settled || now - lastHeadingEvent < 400) headingAnim = requestAnimationFrame(animateHeading);
  }
  function kickHeading() { if (!headingAnim) headingAnim = requestAnimationFrame(animateHeading); }
  let headingRaf = 0;
  function updateHeadingUI() {
    const h = heading();
    if (h !== null) feedHeading(h); else kickHeading();
    if (headingRaf) return;
    headingRaf = requestAnimationFrame(() => {
      headingRaf = 0;
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
      let r;
      if (MOCK) r = { current: Mock.wind(), forecast: Mock.forecast(), source: '모의' };
      else r = await Wind.fetchAll(S.pos[1], S.pos[0], CONFIG);
      S.live = r.current; S.forecast = r.forecast || []; S.forecastSource = r.source || r.current.source;
      S.bgTime = Date.now();
      if (!applySlot(S.slot)) applySlot(0); // 선택해 둔 예측 시각을 새 자료로 다시 계산 (자료 범위를 벗어났으면 지금으로)
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
  document.addEventListener('visibilitychange', () => { if (!document.hidden) { ensureWind(); if (S.forecast.length && S.slot > 0 && !applySlot(S.slot)) applySlot(0); } });

  /* ---------- 예측 타임라인 (지금 ~ 6시간 뒤, 15분 단위) ----------
   * 칸 k 의 배경 바람 = 예보를 (지금 + k×15분) 시각으로 보간한 값. 지도·현재 카드·다음 길목·경로 프로필이 모두 그 시각 기준으로 다시 계산된다.
   * 막대 = 각 시각에 '내 길목'이 받을 풍속(현재 카드와 같은 규칙), 색 = 단계. Windy 의 하단 타임라인·날씨앱의 시간별 그래프와 같은 자리·같은 조작(끌기·탭). */
  const SLOT_MS = Wind.STEP_MIN * 60e3;
  function slotBg(k, now) {
    if (k === 0) return S.live;
    const p = Wind.at(S.forecast, now + k * SLOT_MS);
    if (!p) return null;
    return { speed: p.speed, dir: p.dir, gust: p.gust, time: p.t, source: S.forecastSource, forecast: true, ahead: k * Wind.STEP_MIN };
  }
  function applySlot(k) {
    const bg = slotBg(k, Date.now());
    if (!bg) return false;
    S.slot = k; S.bg = bg;
    document.body.classList.toggle('tl-on', S.forecast.length > 0 && !!S.live);
    recompute();
    return true;
  }
  // 내 위치 기준 바람 (현재 카드와 같은 규칙) — 배경 바람 bg 를 넣어 계산
  function windForBg(bg) {
    if (!bg) return null;
    const n = (S.pos && S.computed.length) ? Model.nearestChunk(S.computed, S.pos, 80, null) : null;
    if (n) { const w = Model.localWind(n.chunk, bg, S.raster); return { speed: w.speed, gust: w.gust, level: w.level }; }
    const f = S.pos ? 0.6 : 1; // 길에서 먼 트인 곳 (currentWind 와 같은 계수)
    const sp = bg.speed * f;
    return { speed: sp, gust: bg.gust * f, level: Model.level(sp) };
  }
  function fmtAhead(min) {
    const h = Math.floor(min / 60), m = min % 60;
    return (h ? h + '시간' : '') + (m ? (h ? ' ' : '') + m + '분' : '');
  }
  let tlBuilt = false, tlDrag = false, tlPending = -1, tlRaf = 0, tlLastApply = 0;
  function buildTimeline() {
    if (tlBuilt) return;
    tlBuilt = true;
    let html = '';
    for (let k = 0; k <= Wind.SLOTS; k++) html += '<i data-k="' + k + '"' + (k === 0 ? ' class="live"' : '') + '></i>';
    el.tlBars.innerHTML = html;
    let ticks = '';
    for (let h = 0; h <= Wind.HORIZON_MIN / 60; h++) {
      const k = h * 60 / Wind.STEP_MIN;
      ticks += '<span style="left:' + ((k + 0.5) / (Wind.SLOTS + 1) * 100).toFixed(2) + '%">' + (h === 0 ? '지금' : h + '시간') + '</span>';
    }
    el.tlTicks.innerHTML = ticks;
    const pick = e => {
      const r = el.tlBars.getBoundingClientRect();
      const k = Math.max(0, Math.min(Wind.SLOTS, Math.floor((e.clientX - r.left) / r.width * (Wind.SLOTS + 1))));
      requestSlot(k);
    };
    el.tlBars.addEventListener('pointerdown', e => { if (e.button !== undefined && e.button !== 0) return; tlDrag = true; try { el.tlBars.setPointerCapture(e.pointerId); } catch (x) { /* 무시 */ } pick(e); e.preventDefault(); });
    el.tlBars.addEventListener('pointermove', e => { if (tlDrag) pick(e); });
    const end = () => { tlDrag = false; flushSlot(); };
    el.tlBars.addEventListener('pointerup', end);
    el.tlBars.addEventListener('pointercancel', end);
    el.tlBars.addEventListener('lostpointercapture', end);
    el.tlBars.addEventListener('keydown', e => {
      const base = tlPending >= 0 ? tlPending : S.slot; // 빠르게 연타해도 한 칸씩
      if (e.key === 'ArrowRight' || e.key === 'ArrowUp') { requestSlot(Math.min(Wind.SLOTS, base + 1)); e.preventDefault(); }
      else if (e.key === 'ArrowLeft' || e.key === 'ArrowDown') { requestSlot(Math.max(0, base - 1)); e.preventDefault(); }
      else if (e.key === 'Home') { requestSlot(0); e.preventDefault(); }
      else if (e.key === 'End') { requestSlot(Wind.SLOTS); e.preventDefault(); }
    });
    el.tlNow.addEventListener('click', () => requestSlot(0));
  }
  // 끌 때는 프레임당 한 번, 60 ms 에 한 번만 다시 계산 (지도 소스 갱신이 밀리지 않게)
  function requestSlot(k) {
    if (k === S.slot && tlPending < 0) return;
    tlPending = k;
    if (!tlDrag) { flushSlot(); return; } // 탭·키보드·[지금으로]는 바로 적용
    if (!tlRaf) tlRaf = requestAnimationFrame(flushSlot);
  }
  function flushSlot() {
    tlRaf = 0;
    if (tlPending < 0) return;
    const now = performance.now();
    if (tlDrag && now - tlLastApply < 60) { tlRaf = requestAnimationFrame(flushSlot); return; }
    const k = tlPending; tlPending = -1;
    tlLastApply = now;
    if (k !== S.slot && !applySlot(k)) toast('그 시각 예보가 아직 없어요');
  }
  function renderTimeline() {
    const show = S.forecast.length > 0 && !!S.live;
    document.body.classList.toggle('tl-on', show);
    el.tl.hidden = !show;
    if (!show) return;
    buildTimeline();
    const now = Date.now();
    const bars = el.tlBars.children;
    const vals = [windForBg(S.live)].concat(Wind.slots(S.forecast, now).map(p => windForBg(p)));
    for (let k = 0; k <= Wind.SLOTS; k++) {
      const b = bars[k], v = vals[k];
      b.classList.toggle('on', k === S.slot);
      if (!v) { b.className = (k === S.slot ? 'on ' : '') + 'none'; b.style.background = ''; b.title = '예보 없음'; continue; }
      b.classList.remove('none');
      b.style.height = (10 + 90 * Math.min(1, v.speed / 10)).toFixed(0) + '%'; // 10 m/s 에서 꽉 참
      b.style.background = v.level.color;
      b.title = (k === 0 ? '지금' : '+' + fmtAhead(k * Wind.STEP_MIN)) + ' · ' + v.level.name + ' ' + v.speed.toFixed(1) + ' m/s';
    }
    const k = S.slot;
    el.tlWhen.textContent = k === 0 ? '지금' : '+' + fmtAhead(k * Wind.STEP_MIN);
    el.tlClock.textContent = k === 0 ? (S.live.time ? timeLabel(S.live.time) + ' 기준 · ' + S.live.source : S.live.source)
      : timeLabel(now + k * SLOT_MS) + ' 예측 · ' + S.forecastSource;
    el.tlNow.hidden = k === 0;
    el.tlBars.setAttribute('aria-valuenow', String(k));
    el.tlBars.setAttribute('aria-valuetext', el.tlWhen.textContent);
  }
  // 시간이 흐르면 '+15분'의 실제 시각도 흐른다: 1분마다 선택 시각을 다시 계산
  setInterval(() => { if (!S.forecast.length || !S.live) return; if (S.slot > 0) { if (!applySlot(S.slot)) applySlot(0); } else renderTimeline(); }, 60000);

  async function loadRaster() {
    if (!CONFIG.rasterManifest) return;
    try { S.raster = await Model.Raster().load(CONFIG.rasterManifest); recompute(); }
    catch (e) { console.warn('래스터 없음 → 휴리스틱 사용', e.message); }
  }
  loadRaster();

  /* ---------- 계산·표시 ---------- */
  function recompute() {
    if (!S.bg || !S.chunks.length) { updateNow(); renderTimeline(); return; }
    S.computed = S.chunks.map(ch => {
      const w = Model.localWind(ch, S.bg, S.raster);
      return Object.assign({}, ch, w, { coordsFlow: w.forward ? ch.coords : ch.coords.slice().reverse() });
    });
    S.computed._idx = Model.buildIndex(S.computed);
    if (S.particles) { S.particles.setTracks(S.computed); S.particles.start(); }
    if (window.Nav) Nav.onRecompute();
    // 선 기하는 길목이 바뀔 때만 다시 올리고(타일 재생성 = 비쌈), 색(단계)은 feature-state 로만 바꾼다
    // → 예측 시각을 끌어 바꿀 때 지도 소스 재생성 없이 색만 갱신 (2,000 길목에서도 수 ms)
    const src = map.getSource('wind');
    if (S.windChunksRef !== S.chunks) {
      S.windChunksRef = S.chunks;
      S.windGeoJSON = {
        type: 'FeatureCollection',
        features: S.computed.map((c, i) => ({ type: 'Feature', id: i, geometry: { type: 'LineString', coordinates: c.coords }, properties: { cid: c.id, cls: c.cls, name: c.name } }))
      };
      if (src) src.setData(S.windGeoJSON);
    }
    if (src) applyWindStates();
    refreshCards();
  }
  function applyWindStates() {
    if (!map.getSource('wind')) return;
    for (let i = 0; i < S.computed.length; i++) {
      const c = S.computed[i];
      map.setFeatureState({ source: 'wind', id: i }, { color: c.level.color, level: c.level.key });
    }
  }

  function refreshCards() {
    updateNow();
    updateNext();
    renderTimeline();
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
    const fc = !!(S.bg && S.bg.forecast);
    el.nowFc.hidden = !fc;
    el.now.classList.toggle('fc-on', fc);
    if (!cur) {
      el.nowLevel.textContent = '—'; el.nowSpeed.textContent = '–.–'; el.nowGust.textContent = '';
      el.nowDir.textContent = S.bg ? '' : '바람 데이터 기다리는 중'; el.nowTime.textContent = '';
      el.nowDot.style.background = '#c9c5bb'; el.nowLevel.style.color = '#6b675d';
      el.nowPlace.textContent = '';
      return;
    }
    el.nowDot.style.background = cur.level.color;
    el.nowLevel.textContent = cur.level.name;
    el.nowLevel.style.color = cur.level.text;
    el.nowSpeed.textContent = cur.speed.toFixed(1);
    el.nowGust.textContent = '돌풍 ' + Math.round(cur.gust) + ' m/s';
    el.nowArrow.style.transform = 'rotate(' + Model.flowDir(S.bg) + 'deg)';
    el.nowDir.textContent = Geo.dirName(S.bg.dir) + '풍';
    el.nowTime.textContent = fc ? '+' + fmtAhead(S.bg.ahead) + '\n' + timeLabel(S.bg.time)
      : timeLabel(S.bg.time) + ' 기준 · ' + S.bg.source;
    el.nowPlace.textContent = cur.place || (cur.chunk ? '이름 없는 길' : '');
  }

  function updateNext() {
    const cur = S.current;
    if (!cur || !S.computed.length) { el.next.hidden = true; return; }
    const h = heading();
    const ov = window.Nav ? Nav.aheadOverride(cur) : undefined; // 경로 안내 중이면 경로 기준
    const onRoute = ov !== undefined;
    const found = onRoute ? ov : Model.nextChange(S.pos, h, cur, S.computed, { lookAhead: CONFIG.lookAhead });
    el.next.hidden = false;
    if (!found) {
      el.nextDot.style.background = cur.level.color;
      el.nextTitle.textContent = (onRoute ? '경로 앞 ' + CONFIG.lookAhead + ' m' : (h === null ? '주변 80 m' : '앞 ' + CONFIG.lookAhead + ' m')) + ' · 변화 없음';
      el.nextSub.textContent = '지금 단계(' + cur.level.name + ') 그대로';
      return;
    }
    const c = found.chunk, lv = found.level || c.level;
    el.nextDot.style.background = lv.color;
    el.nextTitle.textContent = (found.ahead ? found.dist + ' m 앞' : '근처 ' + Math.round(found.dist) + ' m') + ' · ' + lv.name;
    el.nextSub.textContent = (c.name || '이름 없는 길') + (c.id ? ' · ' + c.speed.toFixed(1) + ' m/s · 돌풍 ' + Math.round(c.gust) : '')
      + (found.ahead ? '' : ' · 방향 확인 중') + (onRoute ? ' · 경로 기준' : '');
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
  // 시각 표시 HH:MM. 숫자(ms)는 기기 시간대로, 문자열은 ISO 의 시:분 그대로(제공자 시간대)
  function timeLabel(t) {
    if (t === undefined || t === null || t === '') return '';
    if (typeof t === 'number') { const d = new Date(t); return isNaN(d) ? '' : String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0'); }
    const m = /T(\d{2}):(\d{2})/.exec(t);
    if (m) return m[1] + ':' + m[2];
    const d = new Date(t);
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

  Places.configure(CONFIG.search);
  if (window.Nav) Nav.init({ map, S, heading, toast, hideToast, defaultCenter: CONFIG.defaultCenter, timeLabel, fmtAhead });

  window.App = { S, CONFIG, map, recompute, start, heading, setCompass, shownHeading: () => shownHeading, applySlot, timeLabel, fmtAhead };
})();
