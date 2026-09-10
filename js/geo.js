/* 좌표·거리·방위 계산. 모든 좌표는 [lon, lat] (도), 거리는 m, 방위는 북=0° 시계방향. */
(function () {
  const R_LAT = 110540; // 위도 1도 ≈ m
  function kx(lat) { return 111320 * Math.cos(lat * Math.PI / 180); } // 경도 1도 ≈ m (해당 위도에서)

  function bearing(a, b) {
    const k = kx((a[1] + b[1]) / 2);
    const dx = (b[0] - a[0]) * k;
    const dy = (b[1] - a[1]) * R_LAT;
    return (Math.atan2(dx, dy) * 180 / Math.PI + 360) % 360;
  }

  function distance(a, b) {
    const k = kx((a[1] + b[1]) / 2);
    const dx = (b[0] - a[0]) * k;
    const dy = (b[1] - a[1]) * R_LAT;
    return Math.sqrt(dx * dx + dy * dy);
  }

  // 두 방위각의 최소 차 (0..180)
  function angDiff(a, b) {
    let d = Math.abs(((a - b) % 360 + 360) % 360);
    return d > 180 ? 360 - d : d;
  }

  // 축(0..180, 방향 없음)과 방향(0..360) 사이 각 (0..90)
  function axisAngle(axis, dir) {
    const d = angDiff(axis, dir);
    return d > 90 ? 180 - d : d;
  }

  // 점 p에서 선분 ab까지 거리(m)와 선분 위 투영 비율 t(0..1)
  function distPointSeg(p, a, b) {
    const k = kx(p[1]);
    const ax = (a[0] - p[0]) * k, ay = (a[1] - p[1]) * R_LAT;
    const bx = (b[0] - p[0]) * k, by = (b[1] - p[1]) * R_LAT;
    const vx = bx - ax, vy = by - ay;
    const len2 = vx * vx + vy * vy;
    let t = 0;
    if (len2 > 0) t = Math.max(0, Math.min(1, -(ax * vx + ay * vy) / len2));
    const cx = ax + t * vx, cy = ay + t * vy;
    return { d: Math.sqrt(cx * cx + cy * cy), t };
  }

  // 점 p에서 폴리라인 coords까지 최소 거리
  function distPointLine(p, coords) {
    let best = Infinity;
    for (let i = 0; i < coords.length - 1; i++) {
      const r = distPointSeg(p, coords[i], coords[i + 1]);
      if (r.d < best) best = r.d;
    }
    return best;
  }

  // p에서 방위 brg로 dist(m) 이동한 좌표
  function destination(p, brg, dist) {
    const rad = brg * Math.PI / 180;
    const dx = Math.sin(rad) * dist, dy = Math.cos(rad) * dist;
    return [p[0] + dx / kx(p[1]), p[1] + dy / R_LAT];
  }

  // 중심 좌표에서 half(m) 반경의 bbox [S, W, N, E]
  function bbox(center, half) {
    return [
      center[1] - half / R_LAT,
      center[0] - half / kx(center[1]),
      center[1] + half / R_LAT,
      center[0] + half / kx(center[1])
    ];
  }

  function polylineLength(coords) {
    let s = 0;
    for (let i = 0; i < coords.length - 1; i++) s += distance(coords[i], coords[i + 1]);
    return s;
  }

  // 풍향(도)을 8방위 한국어 이름으로
  function dirName(deg) {
    const names = ['북', '북동', '동', '남동', '남', '남서', '서', '북서'];
    return names[Math.round((((deg % 360) + 360) % 360) / 45) % 8];
  }

  // 구글식 인코딩 폴리라인 해독 (Valhalla 는 precision 6). 반환 [[lon, lat], ...]
  function decodePolyline(str, precision) {
    const f = Math.pow(10, precision || 6);
    let idx = 0, lat = 0, lon = 0;
    const out = [];
    while (idx < str.length) {
      let b, shift = 0, result = 0;
      do { b = str.charCodeAt(idx++) - 63; result |= (b & 0x1f) << shift; shift += 5; } while (b >= 0x20);
      lat += (result & 1) ? ~(result >> 1) : (result >> 1);
      shift = 0; result = 0;
      do { b = str.charCodeAt(idx++) - 63; result |= (b & 0x1f) << shift; shift += 5; } while (b >= 0x20);
      lon += (result & 1) ? ~(result >> 1) : (result >> 1);
      out.push([lon / f, lat / f]);
    }
    return out;
  }

  // 폴리라인을 최대 step(m) 간격의 점 목록으로 촘촘하게 (각 점에 누적 거리 포함)
  function densify(coords, step) {
    const out = [];
    let acc = 0;
    for (let i = 0; i < coords.length - 1; i++) {
      const a = coords[i], b = coords[i + 1];
      const d = distance(a, b);
      const n = Math.max(1, Math.ceil(d / step));
      for (let k = 0; k < n; k++) {
        const t = k / n;
        out.push({ p: [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t], s: acc + d * t });
      }
      acc += d;
    }
    const last = coords[coords.length - 1];
    out.push({ p: last, s: acc });
    return out;
  }

  window.Geo = { bearing, distance, angDiff, axisAngle, distPointSeg, distPointLine, destination, bbox, polylineLength, dirName, decodePolyline, densify };
})();
