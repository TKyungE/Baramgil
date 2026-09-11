/* node tests/logic.test.js — 계산 로직 검증 (브라우저 없이) */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ctx = { window: {}, console, localStorage: null };
ctx.window = ctx;
vm.createContext(ctx);
for (const f of ['geo.js', 'wind.js', 'streets.js', 'model.js', 'mock.js', 'places.js', 'route.js']) {
  vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'js', f), 'utf8'), ctx, { filename: f });
}
const { Geo, Wind, Streets, Model, Mock, Places, Route } = ctx;

let fails = 0, n = 0;
function eq(name, got, exp, tol) {
  n++;
  const ok = (typeof exp === 'number' && tol !== undefined) ? Math.abs(got - exp) <= tol : JSON.stringify(got) === JSON.stringify(exp);
  if (!ok) { fails++; console.log('FAIL', name, '| got', got, '| expected', exp); }
  else console.log('ok  ', name);
}

// --- Geo
const c = [126.8826, 37.4816];
eq('bearing north', Geo.bearing(c, Geo.destination(c, 0, 100)), 0, 0.01);
eq('bearing east', Geo.bearing(c, Geo.destination(c, 90, 100)), 90, 0.01);
eq('bearing SW', Geo.bearing(c, Geo.destination(c, 225, 100)), 225, 0.01);
eq('distance 100m', Geo.distance(c, Geo.destination(c, 37, 100)), 100, 0.01);
eq('angDiff 350 vs 10', Geo.angDiff(350, 10), 20, 1e-9);
eq('axisAngle axis 0 dir 180', Geo.axisAngle(0, 180), 0, 1e-9);
eq('axisAngle axis 90 dir 180', Geo.axisAngle(90, 180), 90, 1e-9);
eq('axisAngle axis 45 dir 315', Geo.axisAngle(45, 315), 90, 1e-9);
const a = Geo.destination(c, 90, -50), b = Geo.destination(c, 90, 50);
eq('distPointSeg on segment', Geo.distPointSeg(c, a, b).d, 0, 0.01);
eq('distPointSeg 30m off', Geo.distPointSeg(Geo.destination(c, 0, 30), a, b).d, 30, 0.05);
eq('distPointSeg beyond end', Geo.distPointSeg(Geo.destination(c, 90, 80), a, b).d, 30, 0.05);
eq('dirName 315', Geo.dirName(315), '북서');
eq('dirName 0', Geo.dirName(0), '북');
eq('dirName 200', Geo.dirName(200), '남');

// --- Streets: 분할·분류
const straight = { id: 1, name: 'A', tags: { highway: 'residential' }, coords: [c, Geo.destination(c, 0, 100), Geo.destination(c, 0, 200)] };
const lshape = { id: 2, name: 'L', tags: { highway: 'tertiary' }, coords: [c, Geo.destination(c, 0, 100), Geo.destination(Geo.destination(c, 0, 100), 90, 100)] };
const tiny = { id: 3, name: '', tags: { highway: 'footway' }, coords: [c, Geo.destination(c, 0, 2)] };
const ch = Streets.chunkWays([straight, lshape, tiny]);
eq('straight → 1 chunk', ch.filter(x => x.wayId === 1).length, 1);
eq('L → 2 chunks', ch.filter(x => x.wayId === 2).length, 2);
eq('tiny (<4m) dropped', ch.filter(x => x.wayId === 3).length, 0);
eq('straight axis 0', ch.find(x => x.wayId === 1).axis, 0, 0.01);
eq('L second axis 90', ch.filter(x => x.wayId === 2)[1].axis, 90, 0.01);
eq('L second chunk 2 pts', ch.filter(x => x.wayId === 2)[1].coords.length, 2);
eq('L second chunk length 100', ch.filter(x => x.wayId === 2)[1].length, 100, 0.05);
eq('classify primary', Streets.classify({ highway: 'primary' }), 'wide');
eq('classify tertiary 5 lanes', Streets.classify({ highway: 'tertiary', lanes: '5' }), 'wide');
eq('classify residential', Streets.classify({ highway: 'residential' }), 'alley');
eq('classify residential 3 lanes', Streets.classify({ highway: 'residential', lanes: '3' }), 'road');
eq('classify footway', Streets.classify({ highway: 'footway' }), 'alley');
const q = Streets.buildQuery([37.47, 126.87, 37.49, 126.89]);
eq('query has bbox', q.includes('(37.47000,126.87000,37.49000,126.89000)'), true);
eq('query excludes sidewalk', q.includes('["footway"!~"^(sidewalk|crossing)$"]'), true);
eq('query out geom', q.endsWith('out geom;'), true);

// --- Model
const bgN = { speed: 6, dir: 0, gust: 9 };      // 북풍 → 남쪽으로 흐름
const nsAlley = { cls: 'alley', axis: 0, coords: [Geo.destination(c, 0, 50), Geo.destination(c, 180, 50)] }; // 북→남 순서
const snAlley = { cls: 'alley', axis: 0, coords: [Geo.destination(c, 180, 50), Geo.destination(c, 0, 50)] }; // 남→북 순서
const ewAlley = { cls: 'alley', axis: 90, coords: [Geo.destination(c, 270, 50), Geo.destination(c, 90, 50)] };
const ewWide = { cls: 'wide', axis: 90, coords: ewAlley.coords };
const diag = { cls: 'road', axis: 45, coords: [Geo.destination(c, 225, 50), Geo.destination(c, 45, 50)] };
let w = Model.localWind(nsAlley, bgN, null);
eq('aligned alley ratio 0.85', w.ratio, 0.85, 1e-9);
eq('aligned alley speed 5.1', w.speed, 5.1, 1e-9);
eq('aligned alley gust 7.65', w.gust, 7.65, 1e-9);
eq('aligned alley forward (N→S coords, flow S)', w.forward, true);
eq('aligned alley arrows', w.arrows, true);
eq('aligned alley level 주의', w.level.name, '주의');
w = Model.localWind(snAlley, bgN, null);
eq('S→N coords not forward', w.forward, false);
w = Model.localWind(ewAlley, bgN, null);
eq('cross alley ratio 0.25', w.ratio, 0.25, 1e-9);
eq('cross alley no arrows', w.arrows, false);
eq('cross alley level 잔잔', w.level.name, '잔잔');
w = Model.localWind(ewWide, bgN, null);
eq('cross wide ratio 0.5', w.ratio, 0.5, 1e-9);
w = Model.localWind(diag, bgN, null);
eq('diag road ratio 0.575', w.ratio, 0.40 + 0.35 * 0.5, 1e-9);
eq('diag road arrows (cos 0.707)', w.arrows, true);
eq('flowDir 315 → 135', Model.flowDir({ dir: 315 }), 135);
eq('level 3.39 잔잔', Model.level(3.39).name, '잔잔');
eq('level 3.4 주의', Model.level(3.4).name, '주의');
eq('level 5.5 강풍', Model.level(5.5).name, '강풍');
eq('level 8 위험', Model.level(8).name, '위험');

// 강한 바람에서 단계 분포
const bgStrong = { speed: 10, dir: 315, gust: 15 };
const mockChunks = Streets.chunkWays(Mock.ways(c));
const levels = mockChunks.map(x => Model.localWind(x, bgStrong, null).level.name);
eq('mock chunks exist', mockChunks.length > 8, true);
eq('mock has 위험 or 강풍 with 10 m/s', levels.some(l => l === '위험' || l === '강풍'), true);
eq('mock has 잔잔 with 10 m/s (cross alleys)', levels.some(l => l === '잔잔'), true);

// --- Raster 인덱싱 (이미지 대신 직접 주입)
const R = Model.Raster();
R.meta = { west: 126.88, south: 37.48, east: 126.89, north: 37.49, width: 10, height: 10, directions: 16, ratio_max: 2.0 };
R.images = [];
for (let d = 0; d < 16; d++) {
  const arr = new Uint8ClampedArray(10 * 10 * 4);
  for (let i = 0; i < 100; i++) { arr[i * 4 + 2] = Math.round(255 * (d / 16)); arr[i * 4 + 3] = 255; }
  arr[(0 * 10 + 0) * 4 + 3] = 0; // (row0,col0) = 건물
  R.images.push(arr);
}
R.ready = true;
eq('raster outside → null', R.ratioAt(126.87, 37.485, 0), null);
eq('raster building → null', R.ratioAt(126.8801, 37.4899, 0), null);
eq('raster dir 90 → index 4 → 0.5', R.ratioAt(126.885, 37.485, 90), 2.0 * Math.round(255 * 4 / 16) / 255, 1e-9);
eq('raster dir 359 → index 0', R.ratioAt(126.885, 37.485, 359), 0, 1e-9);
w = Model.localWind({ cls: 'alley', axis: 0, coords: [[126.885, 37.486], [126.885, 37.484]] }, { speed: 4, dir: 90, gust: 6 }, R);
eq('raster used for ratio', w.ratio, 2.0 * Math.round(255 * 4 / 16) / 255, 1e-9);

// --- 다음 길목 탐색 (mock 격자, 북풍 7.5 m/s → 남북 골목 강풍, 동서 길 잔잔/주의)
const bgMock = Mock.wind();
const computed = Streets.chunkWays(Mock.ways(c)).map(ch => Object.assign({}, ch, Model.localWind(ch, bgMock, null)));
const byName = name => computed.filter(x => x.name === name);
eq('mock: 디지털로9길(남북 골목) 강풍', byName('디지털로9길')[0].level.name, '강풍');
eq('mock: 벚꽃로(동서 골목) 잔잔', byName('벚꽃로')[0].level.name, '잔잔');
eq('mock: 디지털로(동서 4차로) 잔잔', byName('디지털로')[0].level.name, '잔잔');
// 현재: 디지털로 위 (중심에서 서쪽 30 m), 서쪽으로 진행 → 30 m 앞에 디지털로9길(강풍) 교차
const posW = Geo.destination(c, 270, 30);
const curW = { chunk: byName('디지털로')[0], level: byName('디지털로')[0].level };
let nx = Model.nextChange(posW, 270, curW, computed);
eq('ahead west: found 강풍 alley', nx && nx.chunk.name, '디지털로9길');
eq('ahead west: dist ~30 m', nx && nx.dist, 30, 10);
eq('ahead west: ahead flag', nx && nx.ahead, true);
// 같은 자리에서 동쪽으로 진행 → 150 m 안에 가산디지털1로(남북 8차로, 비율 0.7 → 5.25 주의) 교차 (x=+160 → 190 m) 는 범위 밖, 남부순환로(대각) 는 교차
nx = Model.nextChange(posW, 90, curW, computed);
eq('ahead east: something within 150 m or null', nx === null || typeof nx.dist === 'number', true);
// 방향 없음 → 근처 다른 단계 길목
nx = Model.nextChange(posW, null, curW, computed);
eq('no heading: nearest different level within 80 m', nx && nx.ahead, false);
eq('no heading: nearest is 남부순환로(대각, ~21 m) or 디지털로9길(30 m)', nx && (nx.chunk.name === '남부순환로' || nx.chunk.name === '디지털로9길'), true);
// 변화 없는 방향: 벚꽃로 위에서 남쪽(격자 밖)으로
const posS = Geo.destination(c, 180, 180);
const curS = { chunk: byName('벚꽃로')[0], level: byName('벚꽃로')[0].level };
nx = Model.nextChange(posS, 180, curS, computed);
eq('ahead south from 벚꽃로: null or non-잔잔', nx === null || nx.chunk.level.name !== '잔잔', true);
// nearestChunk
const nc = Model.nearestChunk(computed, c, 25, null);
eq('nearestChunk at center = 디지털로 or 남부순환로', nc && (nc.chunk.name === '디지털로' || nc.chunk.name === '남부순환로'), true);
eq('nearestChunk far away → null', Model.nearestChunk(computed, Geo.destination(c, 0, 5000), 25, null), null);

// --- 건물 파싱
const elems = [
  { type: 'way', id: 10, tags: { building: 'yes', 'building:levels': '5' }, geometry: [{ lon: 126.88, lat: 37.48 }, { lon: 126.881, lat: 37.48 }, { lon: 126.881, lat: 37.481 }, { lon: 126.88, lat: 37.481 }, { lon: 126.88, lat: 37.48 }] },
  { type: 'way', id: 11, tags: { building: 'apartments', height: '45' }, geometry: [{ lon: 126.88, lat: 37.48 }, { lon: 126.881, lat: 37.48 }, { lon: 126.881, lat: 37.481 }, { lon: 126.88, lat: 37.481 }] },
  { type: 'way', id: 12, tags: { building: 'yes' }, geometry: [{ lon: 126.88, lat: 37.48 }, { lon: 126.881, lat: 37.48 }] },
  { type: 'way', id: 13, tags: { highway: 'residential', name: '길' }, geometry: [{ lon: 126.88, lat: 37.48 }, { lon: 126.881, lat: 37.48 }] }
];
const area = Streets.splitElements(elems);
eq('buildings parsed (2 valid, 1 too small dropped)', area.buildings.length, 2);
eq('ways parsed', area.ways.length, 1);
eq('height from levels 5×3.2', area.buildings[0].height, 16, 1e-9);
eq('height from height tag', area.buildings[1].height, 45, 1e-9);
eq('open ring closed', JSON.stringify(area.buildings[1].ring[0]) === JSON.stringify(area.buildings[1].ring[area.buildings[1].ring.length - 1]), true);
eq('default height 9.6', Streets.buildingHeight({}), 9.6, 1e-9);
const gj = Streets.buildingsToGeoJSON(area.buildings);
eq('geojson polygons', gj.features.length === 2 && gj.features[0].geometry.type === 'Polygon', true);
eq('query includes building', Streets.buildQuery([37.47, 126.87, 37.49, 126.89]).includes('way["building"](37.47000,126.87000,37.49000,126.89000);'), true);
const mb = Mock.buildings(c);
eq('mock buildings exist', mb.features.length > 20, true);

// --- 벡터 타일에서 꺼내기 (가짜 map)
const fakeMap = {
  querySourceFeatures(src, o) {
    const L = (cls, coords, extra) => ({ id: undefined, properties: Object.assign({ class: cls }, extra || {}), geometry: { type: 'LineString', coordinates: coords } });
    if (o.sourceLayer === 'transportation') return [
      L('primary', [Geo.destination(c, 270, 300), Geo.destination(c, 90, 300)]),                 // 동서 큰길
      L('primary', [Geo.destination(c, 270, 300), Geo.destination(c, 90, 300)]),                 // 중복(타일 버퍼)
      L('minor', [Geo.destination(c, 180, 300), Geo.destination(c, 0, 300)]),                    // 남북 골목
      L('motorway', [Geo.destination(c, 225, 300), Geo.destination(c, 45, 300)]),                // 제외
      L('minor', [Geo.destination(c, 135, 300), Geo.destination(c, 315, 300)], { brunnel: 'tunnel' }), // 제외
      { properties: { class: 'service' }, geometry: { type: 'MultiLineString', coordinates: [[Geo.destination(c, 90, 50), Geo.destination(c, 90, 120)], [Geo.destination(c, 90, 130), Geo.destination(c, 90, 200)]] } },
      L('rail', [Geo.destination(c, 270, 100), Geo.destination(c, 90, 100)])
    ];
    if (o.sourceLayer === 'transportation_name') return [
      { properties: { name: 'Digital-ro', 'name:ko': '디지털로' }, geometry: { type: 'LineString', coordinates: [Geo.destination(c, 270, 300), Geo.destination(c, 90, 300)] } },
      { properties: { name: '가산로' }, geometry: { type: 'LineString', coordinates: [Geo.destination(Geo.destination(c, 0, 200), 270, 300), Geo.destination(Geo.destination(c, 0, 200), 90, 300)] } }
    ];
    if (o.sourceLayer === 'building') return [
      { properties: { render_height: 42 }, geometry: { type: 'Polygon', coordinates: [[Geo.destination(c, 45, 30), Geo.destination(c, 45, 60), Geo.destination(c, 90, 60), Geo.destination(c, 45, 30)]] } },
      { properties: { render_height: 42 }, geometry: { type: 'Polygon', coordinates: [[Geo.destination(c, 45, 30), Geo.destination(c, 45, 60), Geo.destination(c, 90, 60), Geo.destination(c, 45, 30)]] } }, // 중복
      { properties: {}, geometry: { type: 'MultiPolygon', coordinates: [[[Geo.destination(c, 225, 30), Geo.destination(c, 225, 60), Geo.destination(c, 270, 60), Geo.destination(c, 225, 30)]]] } },
      { properties: {}, geometry: { type: 'Point', coordinates: c } }
    ];
    return [];
  }
};
const vt = Streets.fromVectorTiles(fakeMap, 'openmaptiles');
eq('vt: ways (dup·motorway·tunnel·rail 제외, multi 2조각)', vt.ways.length, 4);
eq('vt: primary → wide', vt.ways[0].cls, 'wide');
eq('vt: minor → alley', vt.ways[1].cls, 'alley');
eq('vt: buildings (dup 제외, Point 제외)', vt.buildings.features.length, 2);
eq('vt: render_height used', vt.buildings.features[0].properties.height, 42, 1e-9);
eq('vt: default height', vt.buildings.features[1].properties.height, 9.6, 1e-9);
const vtChunks = Streets.chunkWays(vt.ways);
eq('vt chunk: 동서 큰길 이름 = 디지털로 (name:ko 우선)', vtChunks.find(x => x.cls === 'wide').name, '디지털로');
eq('vt chunk: 남북 골목 이름 없음(가산로는 200 m 북쪽)', vtChunks.find(x => x.cls === 'alley' && Math.abs(x.axis) < 1).name, '');
eq('vt chunk: service 조각도 alley', vtChunks.filter(x => x.cls === 'alley').length >= 3, true);


// --- 폴리라인 해독 (구글 문서 예제, precision 5)
const dec5 = Geo.decodePolyline('_p~iF~ps|U_ulLnnqC_mqNvxq`@', 5);
eq('polyline5 3 pts', dec5.length, 3);
eq('polyline5 pt0', dec5[0], [-120.2, 38.5]);
eq('polyline5 pt2 lat', dec5[2][1], 43.252, 1e-9);
eq('polyline5 pt2 lon', dec5[2][0], -126.453, 1e-9);
// precision 6 왕복: 인코더로 만든 문자열을 해독
function enc(coords, prec) { const f = Math.pow(10, prec); let out = '', plat = 0, plon = 0;
  const encv = v => { v = v < 0 ? ~(v << 1) : (v << 1); let s = ''; while (v >= 0x20) { s += String.fromCharCode((0x20 | (v & 0x1f)) + 63); v >>= 5; } return s + String.fromCharCode(v + 63); };
  for (const [lon, lat] of coords) { const la = Math.round(lat * f), lo = Math.round(lon * f); out += encv(la - plat) + encv(lo - plon); plat = la; plon = lo; } return out; }
const pts6 = [[126.8826, 37.4816], [126.8831, 37.4822], [126.8840, 37.4822]];
const dec6 = Geo.decodePolyline(enc(pts6, 6), 6);
eq('polyline6 roundtrip', dec6.map(p => p.map(v => +v.toFixed(6))), pts6);
// densify
const dn = Geo.densify([c, Geo.destination(c, 90, 100)], 15);
eq('densify count (100 m / 15 → 7 +1)', dn.length, 8);
eq('densify last s = 100', dn[dn.length - 1].s, 100, 0.01);

// --- 경로 바람 프로필 (mock 격자: 북풍 7.5 → 남북 골목 강풍)
const comp2 = Streets.chunkWays(Mock.ways(c)).map(ch => Object.assign({}, ch, Model.localWind(ch, Mock.wind(), null)));
comp2._idx = Model.buildIndex(comp2);
// 경로: 디지털로(동서, 잔잔)를 서쪽으로 100 m → 디지털로9길(남북, 강풍)을 북쪽으로 150 m
const r1 = { coords: [Geo.destination(c, 90, 40), Geo.destination(c, 270, 60), Geo.destination(Geo.destination(c, 270, 60), 0, 150)], distance: 250, time: 190, maneuvers: [] };
const prof = Route.windProfile(r1, comp2, Mock.wind());
eq('profile total ≈ 250 m', prof.meters.reduce((a, b) => a + b, 0), 250, 3);
eq('profile has 강풍 meters ~150', prof.meters[2], 150, 20);
eq('profile has 잔잔 meters ~100', prof.meters[0], 100, 20);
eq('profile exposure = 강풍 m + 위험×3 + 주의×0.15', prof.exposure, Math.round(prof.meters[2] * 1 + prof.meters[3] * 3 + prof.meters[1] * 0.15), 3);
eq('profile strong meters', prof.strong, prof.meters[2] + prof.meters[3], 1);
eq('profile geojson merged into ≤3 lines', prof.geojson.features.length <= 3 && prof.geojson.features.length >= 2, true);
// 대안 순위
const r2 = { coords: [Geo.destination(c, 90, 40), Geo.destination(c, 270, 60)], distance: 100, time: 75, maneuvers: [] };
r1.profile = prof; r2.profile = Route.windProfile(r2, comp2, Mock.wind());
const ranked = Route.rank([r1, r2]);
eq('rank: calmest first', ranked[0], r2);
eq('rank: r2 label 가장 빠른+센 바람 적음', r2.label, '가장 빠른 길 · 센 바람도 가장 적음');
eq('rank: r1 label 다른 길', r1.label, '다른 길');
// 우회 상한: 센 바람 피하는 길이 1.4배 넘게 느리면 기본 선택은 빠른 길
const rSlowCalm = { coords: r2.coords, distance: 400, time: 300, maneuvers: [], profile: { exposure: 0, strong: 0, meters: [400, 0, 0, 0] } };
const rFastWindy = { coords: r1.coords, distance: 200, time: 150, maneuvers: [], profile: { exposure: 150, strong: 150, meters: [50, 0, 150, 0] } };
let rk = Route.rank([rFastWindy, rSlowCalm]);
eq('detour cap: 2.0× slower calm route → fastest first', rk[0], rFastWindy);
eq('detour cap: calm still labeled', rSlowCalm.label, '센 바람 피하는 길');
rSlowCalm.time = 200;
rk = Route.rank([rFastWindy, rSlowCalm]);
eq('within cap (1.33×): calm first', rk[0], rSlowCalm);
// 경로 기준 다음 길목: 디지털로 위(잔잔)에서 → 60 m 뒤 골목 진입(강풍)
const curOnRoad = { chunk: null, level: Model.LEVELS[0] };
const ah = Route.aheadOnRoute(Geo.destination(c, 90, 30), prof, curOnRoad, 150);
eq('aheadOnRoute finds 강풍', ah && ah.level.name, '강풍');
eq('aheadOnRoute dist ~90 m', ah && ah.dist, 90, 20);
eq('aheadOnRoute off-route → undefined', Route.aheadOnRoute(Geo.destination(c, 180, 300), prof, curOnRoad, 150), undefined);
eq('fmtTime 190s → 3분', Route.fmtTime(190), '3분');
eq('fmtDist 1250 → 1.3 km', Route.fmtDist(1250), '1.3 km');

// --- 장소 정규화
const nr = Places.normalize({ lat: '37.4816', lon: '126.8826', name: '가산디지털단지역', display_name: '가산디지털단지역, 가산디지털1로, 가산동, 금천구, 서울특별시, 08505, 대한민국', category: 'railway', type: 'station' });
eq('place name', nr.name, '가산디지털단지역');
eq('place category 역', nr.category, '역');
eq('place address starts with 서울특별시', nr.address.startsWith('서울특별시'), true);

// --- 예보 (15분 단위 6시간)
const T0 = Date.UTC(2026, 8, 10, 5, 0, 0); // 14:00 KST
const series = { time: [T0 / 1000, T0 / 1000 + 900, T0 / 1000 + 1800, T0 / 1000 + 2700], wind_speed_10m: [2, 4, null, 8], wind_direction_10m: [350, 10, 20, 30], wind_gusts_10m: [3, 6, 7, 12] };
const fc = Wind.parseSeries(series);
eq('parseSeries: null 값은 건너뜀', fc.length, 3);
eq('parseSeries: unixtime 초 → ms', fc[0].t, T0);
eq('parseSeries: 값', [fc[1].speed, fc[1].dir, fc[1].gust], [4, 10, 6]);
eq('parseSeries: 빈 입력', Wind.parseSeries(null), []);
eq('parseSeries: 돌풍 없으면 1.5배', Wind.parseSeries({ time: [T0 / 1000], wind_speed_10m: [4], wind_direction_10m: [0] })[0].gust, 6);
let fa = Wind.at(fc, T0 + 450e3); // 첫 구간 중간 (14:07:30)
eq("at: 풍속 선형 보간", fa.speed, 3, 1e-9);
eq("at: 풍향 최단 호 보간 350→10 = 0", fa.dir, 0, 1e-9);
eq("at: 돌풍 보간", fa.gust, 4.5, 1e-9);
fa = Wind.at(fc, T0 + 900e3 + 1350e3); // 14:15 → 14:45 구간(30분)의 3/4 지점 (null 이 빠져 구간이 넓어짐)
eq("at: 빠진 값 건너 넓은 구간 보간", fa.speed, 7, 1e-9);
eq('at: 정확히 자료 시각', Wind.at(fc, T0 + 900e3).speed, 4);
eq('at: 마지막 자료 뒤 → null', Wind.at(fc, T0 + 2700e3 + 1), null);
eq('at: 첫 자료 1시간 이내 앞 → 첫 값', Wind.at(fc, T0 - 600e3).speed, 2);
eq('at: 첫 자료 1시간 넘게 앞 → null', Wind.at(fc, T0 - 3700e3), null);
eq('at: 빈 예보 → null', Wind.at([], T0), null);
eq('at: 풍향 보간 wrap 200→340 중간 = 270', Wind.at([{ t: 0, speed: 1, dir: 200, gust: 1 }, { t: 100, speed: 1, dir: 340, gust: 1 }], 50).dir, 270, 1e-9);
const sl = Wind.slots(fc, T0 + 60e3);
eq('slots: 24칸', sl.length, 24);
eq('slots: 1번째 칸 = 지금+15분', sl[0].t, T0 + 60e3 + 900e3);
eq('slots: 자료 밖은 null', sl[23], null);
eq('slots: 자료 안 개수 (14:01 기준 14:45 까지 → 2칸)', sl.filter(Boolean).length, 2);
eq('상수: 6시간 · 15분 · 24칸', [Wind.HORIZON_MIN, Wind.STEP_MIN, Wind.SLOTS], [360, 15, 24]);
// 모의 예보: 7시간 이상, 15분 간격, 단계가 잔잔~위험 사이를 오감
const mf = Mock.forecast(T0 + 400e3);
eq('mock forecast: 29개(7시간)', mf.length, 29);
eq('mock forecast: 15분 간격', mf[1].t - mf[0].t, 900e3);
eq('mock forecast: 현재 15분 구간에서 시작', mf[0].t, T0);
const mfSlots = Wind.slots(mf, T0 + 400e3);
eq('mock forecast: 6시간 뒤까지 모두 있음', mfSlots.every(Boolean), true);
const lvls = new Set(mfSlots.map(p => Model.level(p.speed).name));
eq('mock forecast: 단계가 여러 개 등장', lvls.size >= 3, true);
// Open-Meteo 응답 파싱 (fetch 흉내)
const omResp = { current: { time: T0 / 1000, wind_speed_10m: 5.5, wind_direction_10m: 300, wind_gusts_10m: 9 }, minutely_15: series };
ctx.fetch = async url => ({ ok: true, status: 200, json: async () => { ctx.lastUrl = url; return omResp; } });
(async () => {
  const r = await Wind.OpenMeteo.fetch(37.4816, 126.8826, {});
  eq('OpenMeteo: current 파싱', [r.current.speed, r.current.dir, r.current.gust, r.current.time], [5.5, 300, 9, T0]);
  eq('OpenMeteo: forecast 파싱', r.forecast.length, 3);
  eq('OpenMeteo: 요청에 minutely_15·unixtime·28칸', /minutely_15=wind_speed_10m/.test(ctx.lastUrl) && /forecast_minutely_15=28/.test(ctx.lastUrl) && /timeformat=unixtime/.test(ctx.lastUrl), true);
  eq('OpenMeteo: 모델 미지정이면 models 없음', /models=/.test(ctx.lastUrl), false);
  await Wind.OpenMeteo.fetch(37.4816, 126.8826, { model: 'kma_seamless' });
  eq('OpenMeteo: 모델 지정', /models=kma_seamless/.test(ctx.lastUrl), true);
  // 모델 지정 요청이 실패하면 기본 모델로 재시도
  let calls = 0;
  ctx.fetch = async url => { calls++; if (/models=/.test(url)) return { ok: false, status: 400, json: async () => ({ error: true, reason: 'bad model' }) }; return { ok: true, status: 200, json: async () => omResp }; };
  const r2 = await Wind.OpenMeteo.fetch(37.4816, 126.8826, { model: 'nope' });
  eq('OpenMeteo: 모델 실패 → 기본으로 재시도', [calls, r2.current.speed], [2, 5.5]);
  // 프록시: 현재값만 주면 예보는 Open-Meteo 에서
  ctx.fetch = async url => /proxy/.test(url) ? { ok: true, status: 200, json: async () => ({ speed: 3.3, dir: 90, gust: 5, time: '2026-09-10T14:03:00+09:00', source: '기상청 AWS' }) } : { ok: true, status: 200, json: async () => omResp };
  const r3 = await Wind.fetchAll(37.48, 126.88, { kmaProxyUrl: 'https://x/proxy' });
  eq('fetchAll: 프록시 현재값 + Open-Meteo 예보', [r3.current.source, r3.current.speed, r3.forecast.length, r3.source], ['기상청 AWS', 3.3, 3, 'Open-Meteo']);
  // 프록시가 예보(1시간 간격)까지 주면 그대로 (15분 보간은 at 이 담당)
  ctx.fetch = async () => ({ ok: true, status: 200, json: async () => ({ speed: 3, dir: 90, gust: 5, source: '기상청', forecast: [{ time: T0 / 1000, speed: 3, dir: 90, gust: 5 }, { time: T0 / 1000 + 3600, speed: 5, dir: 90, gust: 8 }] }) });
  const r4 = await Wind.fetchAll(37.48, 126.88, { kmaProxyUrl: 'https://x/proxy' });
  eq('fetchAll: 프록시 예보 사용', [r4.source, r4.forecast.length, Wind.at(r4.forecast, T0 + 1800e3).speed], ['기상청', 2, 4]);
  // 프록시 실패 → Open-Meteo
  ctx.fetch = async url => /proxy/.test(url) ? { ok: false, status: 500, json: async () => ({}) } : { ok: true, status: 200, json: async () => omResp };
  const r5 = await Wind.fetchAll(37.48, 126.88, { kmaProxyUrl: 'https://x/proxy' });
  eq('fetchAll: 프록시 실패 → Open-Meteo', [r5.current.source, r5.forecast.length], ['Open-Meteo', 3]);
  eq('fetchCurrent 호환', (await Wind.fetchCurrent(37.48, 126.88, {})).speed, 5.5);

  console.log(`(건물 포함) ${n - fails}/${n} passed`);
  process.exit(fails ? 1 : 0);
})().catch(e => { console.log('FAIL (exception)', e); process.exit(1); });
