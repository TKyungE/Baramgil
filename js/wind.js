/* 배경 바람(관측/모델) 소스.
 * 반환 형식(공통): { speed: m/s(10분 평균), dir: 도(불어오는 방향, 북=0), gust: m/s, time: ISO 문자열, source: 이름 }
 *
 * 1) OpenMeteo  — 키 없이 브라우저에서 바로 호출. 예보 모델 값(실측 아님). 기본 소스.
 * 2) KmaProxy   — 기상청 API허브(AWS 1분 자료)를 서버(프록시)가 받아 위 공통 형식 JSON으로 돌려줄 때 사용.
 *                 config.kmaProxyUrl 이 있으면 우선 사용하고, 실패하면 OpenMeteo 로 넘어감.
 *                 프록시는 GET {kmaProxyUrl}?lat=..&lon=.. 에 대해 위 JSON 을 CORS 허용(Access-Control-Allow-Origin: *)으로 응답해야 함.
 */
(function () {
  const OpenMeteo = {
    name: 'Open-Meteo',
    async current(lat, lon) {
      const url = 'https://api.open-meteo.com/v1/forecast'
        + '?latitude=' + lat.toFixed(4) + '&longitude=' + lon.toFixed(4)
        + '&current=wind_speed_10m,wind_direction_10m,wind_gusts_10m'
        + '&wind_speed_unit=ms&timezone=Asia%2FSeoul';
      const res = await fetch(url);
      if (!res.ok) throw new Error('Open-Meteo ' + res.status);
      const j = await res.json();
      const c = j.current || {};
      if (typeof c.wind_speed_10m !== 'number') throw new Error('Open-Meteo: 응답에 바람 값이 없음');
      return {
        speed: c.wind_speed_10m,
        dir: c.wind_direction_10m,
        gust: typeof c.wind_gusts_10m === 'number' ? c.wind_gusts_10m : c.wind_speed_10m * 1.5,
        time: c.time,
        source: 'Open-Meteo'
      };
    }
  };

  const KmaProxy = {
    name: '기상청',
    async current(lat, lon, proxyUrl) {
      const url = proxyUrl + (proxyUrl.includes('?') ? '&' : '?') + 'lat=' + lat.toFixed(5) + '&lon=' + lon.toFixed(5);
      const res = await fetch(url);
      if (!res.ok) throw new Error('KMA proxy ' + res.status);
      const j = await res.json();
      if (typeof j.speed !== 'number' || typeof j.dir !== 'number') throw new Error('KMA proxy: 형식 오류');
      return {
        speed: j.speed,
        dir: j.dir,
        gust: typeof j.gust === 'number' ? j.gust : j.speed * 1.5,
        time: j.time || new Date().toISOString(),
        source: j.source || '기상청'
      };
    }
  };

  // 현재 바람을 가져온다. 프록시가 설정돼 있으면 먼저 시도.
  async function fetchCurrent(lat, lon, config) {
    if (config && config.kmaProxyUrl) {
      try { return await KmaProxy.current(lat, lon, config.kmaProxyUrl); }
      catch (e) { console.warn('KMA 프록시 실패, Open-Meteo 로 대체:', e.message); }
    }
    return OpenMeteo.current(lat, lon);
  }

  window.Wind = { OpenMeteo, KmaProxy, fetchCurrent };
})();
