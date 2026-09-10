/* 장소 검색·주소 — 공급자 3종, 공통 결과 형식 { name, address, lat, lon, category }
 *
 *  photon  (기본) OpenStreetMap 기반 Photon — 키 없음, 타이핑할 때마다 검색(자동완성) 허용. 한국 도로명주소는 OSM에 빠진 곳 있음.
 *  kakao   카카오 로컬(JS SDK) — developers.kakao.com 에서 앱 만들고 [플랫폼 → Web] 에 사이트 도메인(예: https://아이디.github.io) 등록,
 *          JavaScript 키를 app.js CONFIG.search.kakaoKey 에 넣으면 이 공급자를 씀. 한국 장소·주소 품질이 가장 좋음(네이버·카카오 수준).
 *  nominatim  OpenStreetMap Nominatim — 자동완성 금지·초당 1회 정책이라 예비용(엔터 검색·주소 찾기)으로만.
 */
(function () {
  const RECENT_KEY = 'baramgil.recent.v1';

  /* ---------- 공통 유틸 ---------- */
  const TYPE_KO = { 'station': '역', 'subway': '지하철', 'subway_entrance': '지하철 출입구', 'bus_stop': '버스정류장', 'bus_station': '버스터미널', 'platform': '승강장',
    'cafe': '카페', 'restaurant': '음식점', 'fast_food': '패스트푸드', 'bar': '바', 'pub': '술집', 'bakery': '베이커리', 'convenience': '편의점', 'convenience_store': '편의점',
    'supermarket': '마트', 'department_store': '백화점', 'mall': '쇼핑몰', 'marketplace': '시장', 'retail': '상가', 'school': '학교', 'university': '대학교', 'college': '전문대',
    'kindergarten': '유치원', 'childcare': '어린이집', 'library': '도서관', 'hospital': '병원', 'clinic': '의원', 'doctors': '의원', 'dentist': '치과', 'pharmacy': '약국',
    'park': '공원', 'garden': '정원', 'playground': '놀이터', 'bank': '은행', 'atm': 'ATM', 'apartments': '아파트', 'residential': '주거지', 'commercial': '상업시설',
    'office': '사무실', 'hotel': '호텔', 'motel': '모텔', 'guest_house': '게스트하우스', 'place_of_worship': '종교시설', 'church': '교회', 'temple': '사찰',
    'cinema': '영화관', 'theatre': '공연장', 'museum': '박물관', 'stadium': '경기장', 'sports_centre': '스포츠센터', 'fitness_centre': '헬스장', 'swimming_pool': '수영장',
    'parking': '주차장', 'fuel': '주유소', 'toilets': '화장실', 'police': '경찰서', 'fire_station': '소방서', 'post_office': '우체국', 'townhall': '관공서',
    'community_centre': '주민센터', 'city_hall': '시청', 'government': '관공서', 'public': '공공건물', 'industrial': '산업시설', 'viewpoint': '전망대', 'attraction': '명소',
    'neighbourhood': '동네', 'suburb': '동', 'quarter': '지역', 'city': '시', 'town': '읍', 'village': '마을', 'administrative': '행정구역', 'road': '도로',
    'pedestrian': '보행자길', 'footway': '보행로', 'building': '건물', 'house': '건물', 'gate': '출입문', 'entrance': '출입구', 'bridge': '다리', 'river': '강',
    'stream': '하천', 'peak': '봉우리', 'wood': '숲', 'postcode': '우편번호', 'yes': '' };
  function typeKo(t) {
    t = t || '';
    if (TYPE_KO[t] !== undefined) return TYPE_KO[t];
    return t.replace(/_/g, ' ');
  }
  function dedupe(list) {
    const seen = new Set();
    return list.filter(r => { const k = r.name + '|' + r.lat.toFixed(3) + '|' + r.lon.toFixed(3); if (seen.has(k)) return false; seen.add(k); return true; });
  }

  /* ---------- Photon ---------- */
  const Photon = {
    name: 'photon',
    async search(q, near) {
      let url = 'https://photon.komoot.io/api/?limit=8&q=' + encodeURIComponent(q);
      if (near) url += '&lat=' + near[1].toFixed(5) + '&lon=' + near[0].toFixed(5);
      const res = await fetch(url);
      if (!res.ok) throw new Error('Photon ' + res.status);
      const j = await res.json();
      return dedupe((j.features || []).filter(f => f.properties && (f.properties.countrycode || 'KR').toUpperCase() === 'KR').map(f => {
        const p = f.properties, g = f.geometry.coordinates;
        const name = p.name || [p.street, p.housenumber].filter(Boolean).join(' ') || p.city || '';
        const address = [p.state || p.county, p.city, p.district, p.locality, p.street && p.street !== name ? p.street : ''].filter(Boolean).join(' ');
        return { name, address, lat: g[1], lon: g[0], category: typeKo(p.osm_value === 'yes' ? p.osm_key : p.osm_value) };
      }).filter(r => r.name));
    },
    async reverse(lat, lon) {
      const res = await fetch('https://photon.komoot.io/reverse?lat=' + lat.toFixed(6) + '&lon=' + lon.toFixed(6));
      if (!res.ok) throw new Error('Photon ' + res.status);
      const j = await res.json();
      const f = (j.features || [])[0];
      if (!f) return { name: '', address: '' };
      const p = f.properties;
      const road = [p.street, p.housenumber].filter(Boolean).join(' ');
      return { name: road || p.name || '', address: [p.city, p.district, p.locality].filter(Boolean).join(' ') };
    }
  };

  /* ---------- Nominatim (예비) ---------- */
  let nomLast = 0;
  async function nomFetch(url) {
    const wait = 1100 - (Date.now() - nomLast);
    if (wait > 0) await new Promise(r => setTimeout(r, wait));
    nomLast = Date.now();
    const res = await fetch(url, { headers: { 'Accept': 'application/json' } });
    if (!res.ok) throw new Error('Nominatim ' + res.status);
    return res.json();
  }
  function shortAddress(displayName, name) {
    const parts = (displayName || '').split(',').map(s => s.trim()).filter(Boolean);
    const rest = parts.filter(p => p !== name && p !== '대한민국' && !/^\d{5}$/.test(p));
    return rest.slice(-3).reverse().concat(rest.slice(0, -3).reverse()).slice(0, 4).join(' ');
  }
  function normalize(r) {
    const name = r.name || (r.display_name || '').split(',')[0].trim();
    const cat = (r.category || r.class) === 'highway' ? '도로' : typeKo(r.type);
    return { name, address: shortAddress(r.display_name, name), lat: parseFloat(r.lat), lon: parseFloat(r.lon), category: cat, raw: r };
  }
  const Nominatim = {
    name: 'nominatim',
    async search(q, near) {
      let url = 'https://nominatim.openstreetmap.org/search?format=jsonv2&limit=8&accept-language=ko&countrycodes=kr&q=' + encodeURIComponent(q);
      if (near) url += '&viewbox=' + [near[0] - 0.25, near[1] + 0.2, near[0] + 0.25, near[1] - 0.2].map(v => v.toFixed(4)).join(',') + '&bounded=0';
      return dedupe((await nomFetch(url) || []).map(normalize));
    },
    async reverse(lat, lon) {
      const j = await nomFetch('https://nominatim.openstreetmap.org/reverse?format=jsonv2&accept-language=ko&zoom=18&lat=' + lat.toFixed(6) + '&lon=' + lon.toFixed(6));
      if (!j || j.error) return { name: '', address: '' };
      const a = j.address || {};
      const road = a.road || a.pedestrian || a.footway || '';
      const num = a.house_number ? ' ' + a.house_number : '';
      const area = [a.city || a.province || a.state, a.borough || a.city_district || a.county, a.suburb || a.quarter || a.neighbourhood || a.village].filter(Boolean).join(' ');
      return { name: (road ? road + num : (j.name || (j.display_name || '').split(',')[0])), address: area, raw: j };
    }
  };

  /* ---------- 카카오 로컬 (JS SDK) ---------- */
  let kakaoReady = null;
  function loadKakao(key) {
    if (kakaoReady) return kakaoReady;
    kakaoReady = new Promise((resolve, reject) => {
      if (window.kakao && window.kakao.maps && window.kakao.maps.services) { resolve(window.kakao); return; }
      const s = document.createElement('script');
      s.src = 'https://dapi.kakao.com/v2/maps/sdk.js?appkey=' + encodeURIComponent(key) + '&libraries=services&autoload=false';
      s.onload = () => { try { window.kakao.maps.load(() => resolve(window.kakao)); } catch (e) { reject(e); } };
      s.onerror = () => reject(new Error('카카오 SDK 로드 실패 — 키와 도메인 등록 확인'));
      document.head.appendChild(s);
    });
    return kakaoReady;
  }
  function Kakao(key) {
    return {
      name: 'kakao',
      async search(q, near) {
        const k = await loadKakao(key);
        return new Promise((resolve, reject) => {
          const opt = { size: 10 };
          if (near) { opt.location = new k.maps.LatLng(near[1], near[0]); opt.radius = 20000; }
          new k.maps.services.Places().keywordSearch(q, (data, status) => {
            if (status === k.maps.services.Status.OK) {
              resolve(dedupe(data.map(d => ({
                name: d.place_name, address: d.road_address_name || d.address_name || '',
                lat: parseFloat(d.y), lon: parseFloat(d.x),
                category: d.category_group_name || (d.category_name || '').split('>').pop().trim(), raw: d
              }))));
            } else if (status === k.maps.services.Status.ZERO_RESULT) resolve([]);
            else reject(new Error('카카오 검색 오류'));
          }, opt);
        });
      },
      async reverse(lat, lon) {
        const k = await loadKakao(key);
        return new Promise(resolve => {
          new k.maps.services.Geocoder().coord2Address(lon, lat, (data, status) => {
            if (status !== k.maps.services.Status.OK || !data.length) { resolve({ name: '', address: '' }); return; }
            const d = data[0];
            const road = d.road_address ? d.road_address.address_name : '';
            const jibun = d.address ? d.address.address_name : '';
            resolve({ name: road || jibun, address: road ? jibun : '' });
          });
        });
      }
    };
  }

  /* ---------- 공급자 선택 ---------- */
  let provider = Photon;
  function configure(cfg) {
    cfg = cfg || {};
    if (cfg.kakaoKey) provider = Kakao(cfg.kakaoKey);
    else if (cfg.provider === 'nominatim') provider = Nominatim;
    else provider = Photon;
  }
  function autocomplete() { return provider.name !== 'nominatim'; }

  async function search(q, near) {
    try { return await provider.search(q, near); }
    catch (e) {
      if (provider !== Nominatim) { console.warn(provider.name + ' 실패, Nominatim 으로 대체:', e.message); return Nominatim.search(q, near); }
      throw e;
    }
  }
  async function reverse(lat, lon) {
    try { return await provider.reverse(lat, lon); }
    catch (e) {
      if (provider !== Nominatim) { console.warn(provider.name + ' 실패, Nominatim 으로 대체:', e.message); return Nominatim.reverse(lat, lon); }
      throw e;
    }
  }

  /* ---------- 최근 검색 ---------- */
  function recent() { try { return JSON.parse(localStorage.getItem(RECENT_KEY) || '[]'); } catch (e) { return []; } }
  function addRecent(item) {
    try {
      const list = recent().filter(r => !(r.name === item.name && Math.abs(r.lat - item.lat) < 1e-4 && Math.abs(r.lon - item.lon) < 1e-4));
      list.unshift({ name: item.name, address: item.address, lat: item.lat, lon: item.lon, category: item.category });
      localStorage.setItem(RECENT_KEY, JSON.stringify(list.slice(0, 10)));
    } catch (e) { /* 무시 */ }
  }
  function clearRecent() { try { localStorage.removeItem(RECENT_KEY); } catch (e) { /* 무시 */ } }

  window.Places = { configure, autocomplete, search, reverse, recent, addRecent, clearRecent, normalize, shortAddress, typeKo, providers: { Photon, Nominatim, Kakao }, providerName: () => provider.name };
})();
