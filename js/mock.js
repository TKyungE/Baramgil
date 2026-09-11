/* 네트워크 없이 화면을 확인하기 위한 모의 데이터 (?mock=1). 실제 서비스 로직과 무관. */
(function () {
  function ways(center) {
    const [lon, lat] = center;
    const dx = 1 / (111320 * Math.cos(lat * Math.PI / 180)); // 1 m 를 경도 도로
    const dy = 1 / 110540;
    const P = (x, y) => [lon + x * dx, lat + y * dy];       // 중심 기준 m 좌표
    let id = 1;
    const W = (name, highway, pts, extra) => ({ id: id++, name, tags: Object.assign({ highway }, extra || {}), coords: pts });
    return [
      W('디지털로', 'secondary', [P(-400, 0), P(400, 0)], { lanes: '4' }),
      W('가산로', 'tertiary', [P(-400, 260), P(400, 260)]),
      W('벚꽃로', 'residential', [P(-400, -180), P(400, -180)]),
      W('디지털로9길', 'residential', [P(-60, -400), P(-60, 400)], { lanes: '1' }),
      W('가산디지털1로', 'primary', [P(160, -400), P(160, 400)], { lanes: '6' }),
      W('', 'service', [P(-260, 0), P(-260, 260)]),
      W('', 'footway', [P(-60, 120), P(60, 120), P(60, 260)]),
      W('가산로3길', 'living_street', [P(-400, -320), P(-160, -320), P(-100, -260), P(-60, -180)]),
      W('', 'service', [P(160, 130), P(360, 130)]),
      W('남부순환로', 'primary', [P(-400, -400), P(400, 400)], { lanes: '8' })
    ];
  }
  // 격자 도로 사이 블록에 건물 직사각형 채우기 (남부순환로 대각선 근처는 비움)
  function buildings(center) {
    const [lon, lat] = center;
    const dx = 1 / (111320 * Math.cos(lat * Math.PI / 180)), dy = 1 / 110540;
    const P = (x, y) => [lon + x * dx, lat + y * dy];
    const xs = [[-400, -74], [-46, 146], [174, 400]];
    const ys = [[-400, -194], [-166, -14], [14, 246], [274, 400]];
    const feats = [];
    let seed = 7;
    const rnd = () => { seed = (seed * 9301 + 49297) % 233280; return seed / 233280; };
    for (const xr of xs) for (const yr of ys) {
      const cols = Math.max(1, Math.round((xr[1] - xr[0]) / 70)), rows = Math.max(1, Math.round((yr[1] - yr[0]) / 70));
      const cw = (xr[1] - xr[0]) / cols, rh = (yr[1] - yr[0]) / rows;
      for (let i = 0; i < cols; i++) for (let j = 0; j < rows; j++) {
        const x0 = xr[0] + i * cw + 8, x1 = xr[0] + (i + 1) * cw - 8;
        const y0 = yr[0] + j * rh + 8, y1 = yr[0] + (j + 1) * rh - 8;
        const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2;
        if (Math.abs(cx - cy) / Math.SQRT2 < 40) continue; // 대각 도로 자리
        const shrink = rnd() * 0.3;
        const ax = x0 + (x1 - x0) * shrink * 0.5, bx = x1 - (x1 - x0) * shrink * 0.5;
        const levels = 2 + Math.floor(rnd() * (Math.abs(cx) < 200 && cy > 0 ? 20 : 6));
        feats.push({
          type: 'Feature',
          geometry: { type: 'Polygon', coordinates: [[P(ax, y0), P(bx, y0), P(bx, y1), P(ax, y1), P(ax, y0)]] },
          properties: { height: levels * 3.2, name: '' }
        });
      }
    }
    return { type: 'FeatureCollection', features: feats };
  }
  function wind() {
    return { speed: 7.5, dir: 350, gust: 12, time: Date.now(), source: '모의' };
  }
  // 15분 간격 7시간 예보: 잦아들었다가(+1.5h 잔잔) 다시 세지고(+4h 위험 근처) 저녁에 가라앉는 모양. 풍향은 북→북서로 서서히.
  function forecast(now) {
    const t0 = Math.floor((now || Date.now()) / 900e3) * 900e3; // 현재 15분 구간 시작
    const out = [];
    for (let k = 0; k <= 28; k++) {
      const h = k / 4; // 시간
      const speed = 7.5 - 4.5 * Math.exp(-((h - 1.5) ** 2) / 0.8) + 2.5 * Math.exp(-((h - 4) ** 2) / 1.2) - 0.35 * Math.max(0, h - 4.5);
      out.push({ t: t0 + k * 900e3, speed: +speed.toFixed(2), dir: (350 - 50 * Math.min(1, h / 6) + 360) % 360, gust: +(speed * 1.5 + 1).toFixed(2) });
    }
    return out;
  }
  window.Mock = { ways, buildings, wind, forecast };
})();
