/* 길목별 바람 계산.
 *
 * 배경 바람(10 m 높이, 트인 곳 기준)을 받아 각 길목의 보행자 높이 풍속·돌풍·흐름 방향을 만든다.
 *
 * 기본: 길 축과 바람 각도에 따른 '통로 효과' 휴리스틱 (측정으로 보정해야 하는 값)
 *   ratio = c_perp + (c_par − c_perp) · cos²θ
 *     θ      = 바람 방향과 길 축 사이 각 (0 = 길 따라 붊, 90 = 가로질러 붊)
 *     c_par  = 길 따라 불 때 배경 대비 비율, c_perp = 가로질러 불 때 비율
 *   좁은 골목은 따라 불면 잘 뚫리고(비율 큼) 가로지르면 건물에 막힘(비율 작음).
 *
 * 정밀: data/manifest.json + 방향별 래스터(PNG)가 있으면 그 값을 쓴다 (Raster 참고).
 *
 * 단계 기준 (Lawson·Penwarden 1976 보행자 바람 영향 표):
 *   잔잔 < 3.4 ≤ 주의 < 5.5 ≤ 강풍 < 8.0 ≤ 위험  (m/s)
 */
(function () {
  const PARAMS = {
    alley: { par: 0.85, perp: 0.25 },
    road:  { par: 0.75, perp: 0.40 },
    wide:  { par: 0.70, perp: 0.50 }
  };
  const ARROW_MIN_COS = 0.3; // 이보다 축에 비스듬하면(거의 가로지르면) 흐름 화살표를 그리지 않음

  const LEVELS = [
    { key: 0, name: '잔잔', color: '#2e9a5f', max: 3.4 },
    { key: 1, name: '주의', color: '#d8961c', max: 5.5 },
    { key: 2, name: '강풍', color: '#d64a2f', max: 8.0 },
    { key: 3, name: '위험', color: '#8a3aa8', max: Infinity }
  ];
  function level(speed) {
    for (const l of LEVELS) if (speed < l.max) return l;
    return LEVELS[3];
  }

  // 흐름 방향(바람이 가는 쪽) = 풍향(불어오는 쪽) + 180
  function flowDir(bg) { return (bg.dir + 180) % 360; }

  // 한 길목의 바람. bg = 배경 바람, raster = 선택(정밀 래스터)
  function localWind(chunk, bg, raster) {
    const flow = flowDir(bg);
    const theta = Geo.axisAngle(chunk.axis, flow); // 0..90
    const cos = Math.cos(theta * Math.PI / 180);
    let ratio;
    if (raster && raster.ready) {
      const mid = chunk.coords[Math.floor(chunk.coords.length / 2)];
      const r = raster.ratioAt(mid[0], mid[1], bg.dir);
      ratio = (r === null) ? heuristic(chunk.cls, cos) : r;
    } else {
      ratio = heuristic(chunk.cls, cos);
    }
    const speed = bg.speed * ratio;
    const gust = bg.gust * ratio;

    // 흐름이 길의 좌표 순서(처음→끝)와 같은 쪽인지
    const fwd = Geo.bearing(chunk.coords[0], chunk.coords[chunk.coords.length - 1]);
    const forward = Geo.angDiff(fwd, flow) <= 90;
    return { speed, gust, ratio, theta, forward, arrows: cos >= ARROW_MIN_COS, level: level(speed) };
  }

  function heuristic(cls, cos) {
    const p = PARAMS[cls] || PARAMS.alley;
    return p.perp + (p.par - p.perp) * cos * cos;
  }

  /* 정밀 래스터 어댑터.
   * data/manifest.json 형식:
   * {
   *   "west": 126.87, "south": 37.47, "east": 126.90, "north": 37.49,   // 래스터가 덮는 범위(도)
   *   "width": 700, "height": 560,                                        // 픽셀 수
   *   "directions": 16,                                                   // 방향 개수 (0°=북에서 시계방향, 360/16 간격)
   *   "files": "dir_{i}.png",                                             // {i} 에 0..directions-1
   *   "ratio_max": 2.0                                                    // B 채널 255 = ratio_max
   * }
   * PNG 규약: B 채널 = 보행자 높이 풍속 / 배경 풍속 비율 (0..ratio_max), A=0 이면 건물(값 없음).
   * windfield.py 출력이 이 규약과 다르면 내보내기 단계에서 맞추면 됨.
   */
  function Raster() {
    const self = { ready: false, meta: null, images: [] };
    self.load = async function (url) {
      const res = await fetch(url);
      if (!res.ok) throw new Error('manifest ' + res.status);
      const meta = await res.json();
      const base = url.substring(0, url.lastIndexOf('/') + 1);
      const imgs = [];
      for (let i = 0; i < meta.directions; i++) {
        const img = new Image();
        img.src = base + meta.files.replace('{i}', String(i));
        await img.decode();
        const cv = document.createElement('canvas');
        cv.width = meta.width; cv.height = meta.height;
        const ctx = cv.getContext('2d', { willReadFrequently: true });
        ctx.drawImage(img, 0, 0);
        imgs.push(ctx.getImageData(0, 0, meta.width, meta.height).data);
      }
      self.meta = meta; self.images = imgs; self.ready = true;
      return self;
    };
    self.ratioAt = function (lon, lat, windDir) {
      const m = self.meta;
      if (!m) return null;
      if (lon < m.west || lon > m.east || lat < m.south || lat > m.north) return null;
      const col = Math.min(m.width - 1, Math.floor((lon - m.west) / (m.east - m.west) * m.width));
      const row = Math.min(m.height - 1, Math.floor((m.north - lat) / (m.north - m.south) * m.height));
      const di = Math.round(((windDir % 360) + 360) % 360 / (360 / m.directions)) % m.directions;
      const px = (row * m.width + col) * 4;
      const data = self.images[di];
      if (data[px + 3] === 0) return null; // 건물
      return data[px + 2] / 255 * (m.ratio_max || 2.0);
    };
    return self;
  }

  /* 위치 기반 조회 (computed = localWind 결과가 합쳐진 길목 목록) */
  function nearestChunk(computed, p, maxDist, excludeId) {
    let best = null, bd = maxDist;
    for (const c of computed) {
      if (excludeId && c.id === excludeId) continue;
      const d = Geo.distPointLine(p, c.coords);
      if (d < bd) { bd = d; best = c; }
    }
    return best ? { chunk: best, d: bd } : null;
  }

  // 진행 방향 앞에서 단계가 달라지는 첫 길목. heading 이 없으면 주변에서 가장 가까운 '다른 단계' 길목.
  // 반환: { chunk, dist, ahead } 또는 null
  function nextChange(pos, heading, cur, computed, opts) {
    const o = Object.assign({ lookAhead: 150, step: 10, cone: 22, tol: 18, nearRadius: 80 }, opts || {});
    const curId = cur.chunk ? cur.chunk.id : null;
    if (heading !== null && heading !== undefined) {
      for (let d = o.step; d <= o.lookAhead; d += o.step) {
        for (const off of [0, -o.cone, o.cone]) {
          const p = Geo.destination(pos, heading + off, d);
          const n = nearestChunk(computed, p, o.tol, curId);
          if (n && n.chunk.level.key !== cur.level.key) return { chunk: n.chunk, dist: d, ahead: true };
        }
      }
      return null;
    }
    let best = null;
    for (const c of computed) {
      if (c.id === curId || c.level.key === cur.level.key) continue;
      const d = Geo.distPointLine(pos, c.coords);
      if (d <= o.nearRadius && (!best || d < best.dist)) best = { chunk: c, dist: d, ahead: false };
    }
    return best;
  }

  window.Model = { PARAMS, LEVELS, level, localWind, flowDir, Raster, nearestChunk, nextChange };
})();
