/* 배경 바람(관측/모델) 소스 — 현재값 + 15분 단위 예보(최대 6시간)
 *
 * 현재값 형식: { speed: m/s(10분 평균), dir: 도(불어오는 방향, 북=0), gust: m/s, time: ms 또는 ISO, source: 이름 }
 * 예보 형식:   [{ t: ms, speed, dir, gust }, ...]  (시각 오름차순, 15분 간격이 기본이지만 간격이 달라도 됨 → at() 이 보간)
 *
 * 1) OpenMeteo  — 키 없이 브라우저에서 바로 호출. 예보 모델 값(실측 아님). 기본 소스.
 *                 current + minutely_15 을 한 요청으로 받음. 한국은 15분 값이 시간별 모델값을 보간한 것
 *                 (Open-Meteo 문서: 15분 원자료는 북미 HRRR·유럽 ICON-D2/AROME 만).
 *                 config.model 에 'kma_seamless' 를 주면 기상청 LDPS(1.5 km, 1시간) 모델을 지정 — 실패하면 기본(best_match)으로 재시도.
 * 2) KmaProxy   — 기상청 API허브 자료를 서버(프록시)가 받아 위 형식 JSON으로 돌려줄 때 사용.
 *                 GET {kmaProxyUrl}?lat=..&lon=.. → { speed, dir, gust, time, source, forecast?: [{ time, speed, dir, gust }] }
 *                 forecast 는 선택(기상청 초단기예보: 1시간 간격 6시간 — 그대로 주면 15분으로 보간됨). 없으면 예보만 Open-Meteo 에서 받음.
 *                 프록시는 CORS(Access-Control-Allow-Origin: *)를 허용해야 함. 프록시가 실패하면 Open-Meteo 로 넘어감.
 */
(function () {
  const HORIZON_MIN = 6 * 60;   // 예보 범위 (분)
  const STEP_MIN = 15;          // 예보 간격 (분)
  const SLOTS = HORIZON_MIN / STEP_MIN; // 24

  function num(v) { return typeof v === 'number' && isFinite(v); }
  function toMs(t) {
    if (num(t)) return t < 1e12 ? t * 1000 : t; // 초 단위 unixtime → ms
    const d = new Date(t);
    return isNaN(d) ? NaN : d.getTime();
  }

  const OpenMeteo = {
    name: 'Open-Meteo',
    async fetch(lat, lon, opts) {
      const o = opts || {};
      const base = 'https://api.open-meteo.com/v1/forecast'
        + '?latitude=' + lat.toFixed(4) + '&longitude=' + lon.toFixed(4)
        + '&current=wind_speed_10m,wind_direction_10m,wind_gusts_10m'
        + '&minutely_15=wind_speed_10m,wind_direction_10m,wind_gusts_10m'
        + '&forecast_minutely_15=' + (SLOTS + 4) // 현재 15분 구간부터 7시간 → 6시간 뒤까지 보간 가능
        + '&wind_speed_unit=ms&timeformat=unixtime&timezone=Asia%2FSeoul';
      let j;
      try { j = await get(base + (o.model ? '&models=' + encodeURIComponent(o.model) : '')); }
      catch (e) {
        if (!o.model) throw e;
        console.warn('Open-Meteo 모델 ' + o.model + ' 실패, 기본 모델로 재시도:', e.message);
        j = await get(base);
      }
      const c = j.current || {};
      if (!num(c.wind_speed_10m)) throw new Error('Open-Meteo: 응답에 바람 값이 없음');
      const current = {
        speed: c.wind_speed_10m,
        dir: num(c.wind_direction_10m) ? c.wind_direction_10m : 0,
        gust: num(c.wind_gusts_10m) ? c.wind_gusts_10m : c.wind_speed_10m * 1.5,
        time: num(c.time) ? c.time * 1000 : c.time,
        source: 'Open-Meteo'
      };
      return { current, forecast: parseSeries(j.minutely_15), source: 'Open-Meteo' };
    }
  };
  async function get(url) {
    const res = await fetch(url);
    let j = null;
    try { j = await res.json(); } catch (e) { /* 본문 없음 */ }
    if (!res.ok) throw new Error('Open-Meteo ' + res.status + (j && j.reason ? ' ' + j.reason : ''));
    return j || {};
  }
  // Open-Meteo minutely_15 블록 → 예보 배열. 값이 없는 시각(null)은 건너뜀.
  function parseSeries(m) {
    if (!m || !Array.isArray(m.time)) return [];
    const out = [];
    for (let i = 0; i < m.time.length; i++) {
      const sp = m.wind_speed_10m && m.wind_speed_10m[i];
      if (!num(sp)) continue;
      const gu = m.wind_gusts_10m && m.wind_gusts_10m[i];
      const di = m.wind_direction_10m && m.wind_direction_10m[i];
      out.push({ t: toMs(m.time[i]), speed: sp, dir: num(di) ? di : 0, gust: num(gu) ? gu : sp * 1.5 });
    }
    return out.filter(p => !isNaN(p.t)).sort((a, b) => a.t - b.t);
  }

  const KmaProxy = {
    name: '기상청',
    async fetch(lat, lon, proxyUrl) {
      const url = proxyUrl + (proxyUrl.includes('?') ? '&' : '?') + 'lat=' + lat.toFixed(5) + '&lon=' + lon.toFixed(5);
      const res = await fetch(url);
      if (!res.ok) throw new Error('KMA proxy ' + res.status);
      const j = await res.json();
      if (!num(j.speed) || !num(j.dir)) throw new Error('KMA proxy: 형식 오류');
      const current = {
        speed: j.speed,
        dir: j.dir,
        gust: num(j.gust) ? j.gust : j.speed * 1.5,
        time: j.time || Date.now(),
        source: j.source || '기상청'
      };
      const forecast = Array.isArray(j.forecast)
        ? j.forecast.filter(p => p && num(p.speed)).map(p => ({ t: toMs(p.time !== undefined ? p.time : p.t), speed: p.speed, dir: num(p.dir) ? p.dir : 0, gust: num(p.gust) ? p.gust : p.speed * 1.5 }))
          .filter(p => !isNaN(p.t)).sort((a, b) => a.t - b.t)
        : [];
      return { current, forecast, source: current.source };
    }
  };

  // 현재 + 예보를 한 번에. 프록시가 설정돼 있으면 현재값은 프록시 우선, 예보는 프록시에 없으면 Open-Meteo.
  async function fetchAll(lat, lon, config) {
    const cfg = config || {};
    let r = null;
    if (cfg.kmaProxyUrl) {
      try { r = await KmaProxy.fetch(lat, lon, cfg.kmaProxyUrl); }
      catch (e) { console.warn('KMA 프록시 실패, Open-Meteo 로 대체:', e.message); }
    }
    if (r && r.forecast.length) return r;
    const om = await OpenMeteo.fetch(lat, lon, { model: cfg.model });
    if (r) return { current: r.current, forecast: om.forecast, source: om.source };
    return om;
  }
  async function fetchCurrent(lat, lon, config) { return (await fetchAll(lat, lon, config)).current; }

  // 예보 배열에서 시각 t(ms)의 값을 선형 보간. 방향은 최단 호로 보간(350°↔10° 사이는 0°).
  // t 가 첫 값보다 앞이면 첫 값(1시간 이내), 마지막 값보다 뒤면 null.
  function at(forecast, t) {
    if (!forecast || !forecast.length) return null;
    const n = forecast.length;
    if (t <= forecast[0].t) return t >= forecast[0].t - 3600e3 ? point(forecast[0], t) : null;
    if (t > forecast[n - 1].t) return null;
    let i = 1;
    while (i < n && forecast[i].t < t) i++;
    const a = forecast[i - 1], b = forecast[i];
    const f = b.t === a.t ? 0 : (t - a.t) / (b.t - a.t);
    const dd = ((b.dir - a.dir + 540) % 360) - 180;
    return { t, speed: a.speed + (b.speed - a.speed) * f, gust: a.gust + (b.gust - a.gust) * f, dir: ((a.dir + dd * f) % 360 + 360) % 360 };
  }
  function point(p, t) { return { t, speed: p.speed, gust: p.gust, dir: p.dir }; }

  // now 로부터 15분 간격 6시간(24칸)의 값. 자료가 없는 칸은 null. k번째 칸 = now + k×15분 (k = 1..24)
  function slots(forecast, now) {
    const out = [];
    for (let k = 1; k <= SLOTS; k++) out.push(at(forecast, now + k * STEP_MIN * 60e3));
    return out;
  }

  window.Wind = { OpenMeteo, KmaProxy, fetchAll, fetchCurrent, parseSeries, at, slots, HORIZON_MIN, STEP_MIN, SLOTS };
})();
