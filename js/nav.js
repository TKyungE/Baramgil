/* 지도 앱 기능 — 검색, 장소 시트, 길게 눌러 핀, 도보 길찾기(바람 프로필·대안), 줌·3D 버튼.
 * 참고한 흐름: 네이버지도·카카오맵(검색 → 결과 → 장소 시트 → 길찾기 → 경로 시트/대안 선택).
 * app.js 가 Nav.init(ctx) 로 연결한다. ctx = { map, S, heading(), toast(), hideToast(), params }
 */
(function () {
  const Nav = { state: { mode: 'idle', place: null, routes: null, active: 0, pinMarker: null } };
  let ctx, map, S, el;
  const $ = id => document.getElementById(id);

  Nav.init = function (c) {
    ctx = c; map = c.map; S = c.S;
    el = {
      search: $('search'), input: $('search-input'), list: $('search-list'), hint: $('search-hint'),
      btnSearch: $('btn-search'), back: $('search-back'), clear: $('search-clear'),
      sheet: $('sheet'), sheetBody: $('sheet-body'), sheetClose: $('sheet-close'),
      next: $('next'), legend: $('legend'),
      zin: $('zoom-in'), zout: $('zoom-out'), tilt: $('tilt')
    };
    el.btnSearch.addEventListener('click', openSearch);
    el.back.addEventListener('click', closeSearch);
    el.clear.addEventListener('click', () => { el.input.value = ''; renderRecent(); el.input.focus(); });
    el.input.addEventListener('keydown', e => {
      if (e.key !== 'Enter') return;
      e.preventDefault();
      // 자동완성 결과가 이미 떠 있으면 첫 결과 선택, 아니면 검색
      const first = el.list.querySelector('.search-row[data-result="1"]');
      if (first && el.input.value.trim() === lastQuery) first.click(); else runSearch();
    });
    el.input.addEventListener('input', () => {
      const q = el.input.value.trim();
      clearTimeout(typeTimer);
      if (!q) { renderRecent(); return; }
      if (!Places.autocomplete() || q.length < 2) return;
      typeTimer = setTimeout(() => runSearch(true), 280); // 타이핑 멈추면 바로 검색 (자동완성)
    });
    el.sheetClose.addEventListener('click', () => { if (Nav.state.mode === 'route') exitRoute(); else closeSheet(); });
    el.zin.addEventListener('click', () => map.zoomIn({ duration: 250 }));
    el.zout.addEventListener('click', () => map.zoomOut({ duration: 250 }));
    el.tilt.addEventListener('click', () => { const on = map.getPitch() < 10; map.easeTo({ pitch: on ? 50 : 0, duration: 400 }); el.tilt.classList.toggle('on', on); });

    map.on('style.load', addLayers);
    if (map.isStyleLoaded()) addLayers();
    setupLongPress();
    map.on('contextmenu', e => pinAt([e.lngLat.lng, e.lngLat.lat]));
  };

  function addLayers() {
    if (map.getSource('route')) return;
    const firstLabel = (map.getStyle().layers.find(l => l.type === 'symbol') || {}).id;
    map.addSource('route', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
    map.addLayer({ id: 'route-casing', type: 'line', source: 'route', layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: { 'line-color': '#1c1b18', 'line-width': ['interpolate', ['linear'], ['zoom'], 14, 6, 16, 10, 19, 18], 'line-opacity': 0.85 } }, firstLabel);
    map.addLayer({ id: 'route-line', type: 'line', source: 'route', layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: { 'line-color': ['get', 'color'], 'line-width': ['interpolate', ['linear'], ['zoom'], 14, 3, 16, 6, 19, 12] } }, firstLabel);
    map.addSource('route-alt', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
    map.addLayer({ id: 'route-alt', type: 'line', source: 'route-alt', layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: { 'line-color': '#9a968c', 'line-width': ['interpolate', ['linear'], ['zoom'], 14, 3, 16, 5, 19, 9], 'line-opacity': 0.6, 'line-dasharray': [1, 1.5] } }, 'route-casing');
    if (Nav.state.routes) drawRoutes();
  }

  /* ---------- 검색 ---------- */
  let typeTimer = 0, lastQuery = '', searchSeq = 0;
  function openSearch() { el.search.hidden = false; renderRecent(); setTimeout(() => el.input.focus(), 50); }
  function closeSearch() { el.search.hidden = true; el.input.blur(); }
  function renderRecent() {
    const r = Places.recent();
    el.hint.textContent = r.length ? '최근 검색' : '장소나 주소를 입력하고 엔터';
    el.list.innerHTML = '';
    r.forEach(item => el.list.appendChild(resultRow(item, true)));
    if (r.length) {
      const b = document.createElement('button'); b.className = 'search-clearall'; b.textContent = '최근 검색 지우기';
      b.addEventListener('click', () => { Places.clearRecent(); renderRecent(); });
      el.list.appendChild(b);
    }
  }
  function resultRow(item, isRecent) {
    const row = document.createElement('button');
    row.className = 'search-row';
    if (!isRecent) row.dataset.result = '1';
    const dist = S.pos ? Geo.distance(S.pos, [item.lon, item.lat]) : null;
    row.innerHTML = '<span class="ic">' + (isRecent ? svgClock() : svgPin()) + '</span>'
      + '<span class="txt"><b>' + esc(item.name) + '</b><small>' + esc([item.category, item.address].filter(Boolean).join(' · ')) + '</small></span>'
      + (dist !== null ? '<span class="dist">' + Route.fmtDist(dist) + '</span>' : '');
    row.addEventListener('click', () => selectPlace(item));
    return row;
  }
  async function runSearch(quiet) {
    const q = el.input.value.trim();
    if (!q) return;
    if (q === lastQuery && el.list.querySelector('.search-row[data-result="1"]')) return;
    const seq = ++searchSeq;
    if (!quiet) { el.hint.textContent = '검색 중…'; el.list.innerHTML = ''; }
    try {
      const rs = await Places.search(q, S.pos || ctx.defaultCenter);
      if (seq !== searchSeq) return; // 그새 다른 글자를 쳤으면 버림
      lastQuery = q;
      el.list.innerHTML = '';
      el.hint.textContent = rs.length ? '검색 결과 ' + rs.length + '건 · ' + (Places.providerName() === 'kakao' ? '카카오' : 'OpenStreetMap') : '결과가 없어요. 다른 말로 찾아보세요 (예: 역 이름, 도로명)';
      rs.forEach(r => el.list.appendChild(resultRow(r, false)));
    } catch (e) {
      if (seq !== searchSeq) return;
      console.warn(e);
      el.hint.textContent = '검색 서버 응답 없음 (' + (e && e.message ? e.message : '네트워크') + ') · 잠시 후 다시';
    }
  }

  /* ---------- 장소 ---------- */
  function selectPlace(item) {
    Places.addRecent(item);
    closeSearch();
    showPlace(item);
  }
  function showPlace(item) {
    Nav.state.place = item;
    Nav.state.mode = 'place';
    setPin([item.lon, item.lat]);
    map.easeTo({ center: [item.lon, item.lat], zoom: Math.max(map.getZoom(), 16.4), duration: 600 });
    S.follow = false;
    renderPlaceSheet(item);
    openSheet();
  }
  Nav.showPlace = showPlace;

  function setPin(ll) {
    if (!Nav.state.pinMarker) {
      const d = document.createElement('div'); d.className = 'pin';
      d.innerHTML = '<svg width="30" height="40" viewBox="0 0 30 40"><path d="M15 39C15 39 3 24 3 14a12 12 0 0 1 24 0c0 10-12 25-12 25z" fill="#1c1b18" stroke="#fff" stroke-width="2"/><circle cx="15" cy="14" r="4.5" fill="#fff"/></svg>';
      Nav.state.pinMarker = new maplibregl.Marker({ element: d, anchor: 'bottom' });
    }
    Nav.state.pinMarker.setLngLat(ll).addTo(map);
  }
  function clearPin() { if (Nav.state.pinMarker) Nav.state.pinMarker.remove(); }

  function windAt(ll) {
    if (!S.computed.length) return null;
    const n = Model.nearestChunk(S.computed, ll, 40, null);
    return n ? n.chunk : null;
  }
  function renderPlaceSheet(item) {
    const w = windAt([item.lon, item.lat]);
    const dist = S.pos ? Geo.distance(S.pos, [item.lon, item.lat]) : null;
    el.sheetBody.innerHTML =
      '<div class="sh-title">' + esc(item.name || '선택한 위치') + '</div>'
      + '<div class="sh-sub">' + esc([item.category, item.address].filter(Boolean).join(' · ') || '주소 확인 중…') + '</div>'
      + '<div class="sh-row">'
      + (dist !== null ? '<span>내 위치에서 ' + Route.fmtDist(dist) + '</span>' : '')
      + (w ? '<span><i class="dot" style="background:' + w.level.color + '"></i>' + w.level.name + ' ' + w.speed.toFixed(1) + ' m/s · 돌풍 ' + Math.round(w.gust) + (w.name ? ' · ' + esc(w.name) : '') + '</span>' : '<span class="muted">바람 정보는 화면 안 길에서만</span>')
      + '</div>'
      + '<div class="sh-actions"><button id="sh-route" class="btn primary">도보 길찾기</button><button id="sh-share" class="btn">공유</button></div>';
    $('sh-route').addEventListener('click', () => startRoute(item));
    $('sh-share').addEventListener('click', () => share(item));
  }

  async function pinAt(ll) {
    const item = { name: '', address: '', lat: ll[1], lon: ll[0], category: '' };
    showPlace(item);
    try {
      const r = await Places.reverse(ll[1], ll[0]);
      if (Nav.state.place === item) { item.name = r.name || '지도에서 고른 곳'; item.address = r.address; renderPlaceSheet(item); }
    } catch (e) { if (Nav.state.place === item) { item.name = '지도에서 고른 곳'; renderPlaceSheet(item); } }
  }
  Nav.pinAt = pinAt;

  function share(item) {
    const url = location.origin + location.pathname + '?lat=' + item.lat.toFixed(5) + '&lon=' + item.lon.toFixed(5) + '&q=' + encodeURIComponent(item.name || '');
    if (navigator.share) navigator.share({ title: item.name || '바람길', url }).catch(() => {});
    else if (navigator.clipboard) navigator.clipboard.writeText(url).then(() => ctx.toast('링크를 복사했어요')).catch(() => ctx.toast(url, 6000));
    else ctx.toast(url, 6000);
  }

  /* ---------- 길찾기 ---------- */
  async function startRoute(item) {
    if (!S.pos) { ctx.toast('내 위치를 먼저 잡아야 해요'); return; }
    ctx.toast('도보 경로 찾는 중…', 0);
    try {
      const routes = await Route.fetchRoutes(S.pos, [item.lon, item.lat]);
      ctx.hideToast();
      if (!routes.length) { ctx.toast('경로를 찾지 못했어요'); return; }
      Nav.state.routes = routes;
      Nav.state.dest = item;
      Nav.state.mode = 'route';
      profileAll();
      Nav.state.active = 0;
      drawRoutes();
      renderRouteSheet();
      openSheet();
      fitRoute();
    } catch (e) {
      console.warn(e);
      ctx.toast('길찾기 실패: ' + (e && e.message ? e.message : '네트워크') + ' · 잠시 후 다시', 6000);
    }
  }
  function profileAll() {
    for (const r of Nav.state.routes) r.profile = Route.windProfile(r, S.computed, S.bg);
    Nav.state.routes = Route.rank(Nav.state.routes);
  }
  function active() { return Nav.state.routes ? Nav.state.routes[Nav.state.active] : null; }
  function drawRoutes() {
    const a = active();
    if (!a || !map.getSource('route')) return;
    map.getSource('route').setData(a.profile.geojson);
    const alts = Nav.state.routes.filter(r => r !== a).map(r => ({ type: 'Feature', geometry: { type: 'LineString', coordinates: r.coords }, properties: {} }));
    map.getSource('route-alt').setData({ type: 'FeatureCollection', features: alts });
  }
  function fitRoute() {
    const a = active();
    if (!a) return;
    let minx = Infinity, miny = Infinity, maxx = -Infinity, maxy = -Infinity;
    for (const p of a.coords) { if (p[0] < minx) minx = p[0]; if (p[0] > maxx) maxx = p[0]; if (p[1] < miny) miny = p[1]; if (p[1] > maxy) maxy = p[1]; }
    S.follow = false;
    map.fitBounds([[minx, miny], [maxx, maxy]], { padding: { top: 130, bottom: 260, left: 40, right: 60 }, duration: 700, maxZoom: 17 });
  }
  function renderRouteSheet() {
    const rs = Nav.state.routes, a = active();
    const chips = rs.map((r, i) => '<button class="chip' + (i === Nav.state.active ? ' on' : '') + '" data-i="' + i + '">' + esc(r.label) + ' <small>' + Route.fmtTime(r.time) + '</small></button>').join('');
    const m = a.profile.meters, total = Math.max(1, m.reduce((x, y) => x + y, 0));
    const bar = Model.LEVELS.map(l => '<i style="width:' + (m[l.key] / total * 100).toFixed(1) + '%;background:' + l.color + '"></i>').join('');
    const parts = Model.LEVELS.filter(l => m[l.key] > 0).map(l => '<span><i class="dot" style="background:' + l.color + '"></i>' + l.name + ' ' + Route.fmtDist(m[l.key]) + '</span>').join('');
    const steps = a.maneuvers.map(mv => '<li><span>' + esc(mv.text) + '</span>' + (mv.length ? '<small>' + Route.fmtDist(mv.length) + '</small>' : '') + '</li>').join('');
    el.sheetBody.innerHTML =
      '<div class="chips">' + chips + '</div>'
      + '<div class="sh-title">도보 ' + Route.fmtTime(a.time) + ' <span class="sh-dim">· ' + Route.fmtDist(a.distance) + ' · ' + esc(Nav.state.dest.name || '목적지') + '</span></div>'
      + '<div class="windbar">' + bar + '</div>'
      + '<div class="sh-row">' + parts + '</div>'
      + '<div id="sh-next" class="sh-next"></div>'
      + '<details class="steps"><summary>경로 안내 ' + a.maneuvers.length + '단계</summary><ol>' + steps + '</ol></details>';
    el.sheetBody.querySelectorAll('.chip').forEach(b => b.addEventListener('click', () => { Nav.state.active = +b.dataset.i; drawRoutes(); renderRouteSheet(); }));
    updateRouteNext();
  }
  function updateRouteNext() {
    const box = $('sh-next');
    if (!box || !S.current) return;
    const a = active();
    const f = Route.aheadOnRoute(S.pos, a.profile, S.current, 150);
    if (f === undefined) box.innerHTML = '<span class="muted">경로에서 40 m 넘게 벗어남</span>';
    else if (f === null) box.innerHTML = '<span class="muted">앞 150 m 단계 변화 없음 (' + S.current.level.name + ')</span>';
    else box.innerHTML = '<i class="dot" style="background:' + f.level.color + '"></i><b>' + f.dist + ' m 앞 · ' + f.level.name + '</b>' + (f.chunk.name ? ' <span class="sh-dim">' + esc(f.chunk.name) + '</span>' : '');
  }
  function exitRoute() {
    Nav.state.routes = null; Nav.state.mode = 'idle';
    if (map.getSource('route')) { map.getSource('route').setData({ type: 'FeatureCollection', features: [] }); map.getSource('route-alt').setData({ type: 'FeatureCollection', features: [] }); }
    clearPin();
    closeSheet();
  }

  /* 바람·길목이 다시 계산되면 경로 색도 갱신 */
  Nav.onRecompute = function () {
    if (Nav.state.mode === 'route' && Nav.state.routes) { const a = active(); profileAll(); Nav.state.active = Math.max(0, Nav.state.routes.indexOf(a)); drawRoutes(); renderRouteSheet(); }
    else if (Nav.state.mode === 'place' && Nav.state.place) renderPlaceSheet(Nav.state.place);
  };
  /* 위치가 바뀌면 경로 기준 다음 길목 갱신 */
  Nav.onPosition = function () { if (Nav.state.mode === 'route') updateRouteNext(); };
  /* app.js 의 다음 길목 탐색을 경로 기준으로 바꿔치기: undefined 면 일반 탐색 */
  Nav.aheadOverride = function (cur) {
    if (Nav.state.mode !== 'route' || !S.pos) return undefined;
    const f = Route.aheadOnRoute(S.pos, active().profile, cur, 150);
    return f;
  };
  /* 지도 탭: 배경 지도의 장소(POI)를 누르면 이름·종류 */
  Nav.handleClick = function (e) {
    const poiLayers = map.getStyle().layers.filter(l => l['source-layer'] === 'poi' && l.type === 'symbol').map(l => l.id);
    if (!poiLayers.length) return false;
    const hit = map.queryRenderedFeatures([[e.point.x - 12, e.point.y - 12], [e.point.x + 12, e.point.y + 12]], { layers: poiLayers });
    if (!hit.length) return false;
    const p = hit[0].properties || {};
    const name = p['name:ko'] || p.name;
    if (!name) return false;
    const g = hit[0].geometry && hit[0].geometry.type === 'Point' ? hit[0].geometry.coordinates : [e.lngLat.lng, e.lngLat.lat];
    showPlace({ name, address: '', category: Places.typeKo(p.subclass || p.class || ''), lat: g[1], lon: g[0] });
    return true;
  };

  /* ---------- 시트·길게 누르기 ---------- */
  function openSheet() { el.sheet.hidden = false; el.next.classList.add('under-sheet'); el.legend.classList.add('under-sheet'); }
  function closeSheet() { el.sheet.hidden = true; el.next.classList.remove('under-sheet'); el.legend.classList.remove('under-sheet'); if (Nav.state.mode === 'place') { Nav.state.mode = 'idle'; Nav.state.place = null; clearPin(); } }
  function setupLongPress() {
    const cont = map.getCanvasContainer();
    let timer = 0, start = null;
    const cancel = () => { if (timer) clearTimeout(timer); timer = 0; start = null; };
    cont.addEventListener('pointerdown', e => {
      if (e.pointerType === 'mouse' && e.button !== 0) return;
      start = [e.clientX, e.clientY];
      timer = setTimeout(() => {
        timer = 0;
        const r = cont.getBoundingClientRect();
        const ll = map.unproject([e.clientX - r.left, e.clientY - r.top]);
        pinAt([ll.lng, ll.lat]);
      }, 550);
    });
    cont.addEventListener('pointermove', e => { if (start && Math.hypot(e.clientX - start[0], e.clientY - start[1]) > 8) cancel(); });
    ['pointerup', 'pointercancel', 'pointerleave'].forEach(t => cont.addEventListener(t, cancel));
  }

  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"]/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[ch])); }
  function svgPin() { return '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 22s7-7.1 7-12a7 7 0 1 0-14 0c0 4.9 7 12 7 12z"></path><circle cx="12" cy="10" r="2.5"></circle></svg>'; }
  function svgClock() { return '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"></circle><path d="M12 7v5l3 2"></path></svg>'; }

  window.Nav = Nav;
})();
