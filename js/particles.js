/* 길 위를 흐르는 입자(스트리클릿) 레이어 — 캔버스 한 장.
 *
 * 근거: 2D 벡터장 시각화 사용자 연구(Laidlaw et al. 2005)에서 격자 화살표는 가장 성적이 나빴고,
 * 흐름선(적분곡선)을 보여주는 방식이 방향·경로 판단에 가장 좋았다. 정지 화살표·정지 흐름선보다
 * "움직이는 스트리클릿"이 패턴 탐지·경로 추적 모두에서 더 빠르고 정확했다(Ware et al. 2016).
 * 속도는 굵기·밝기보다 '움직이는 속도'로 보여줄 때 최대치 탐지가 가장 잘 됐다(CaGIS 2018).
 * hint.fm Wind Map(2012)처럼 표현은 한 가지(흐르는 꼬리)만 쓰고 나머지 장식은 뺀다.
 *
 * 성능: 지도 엔진은 건드리지 않고(스타일 변경 없음) 캔버스만 매 프레임 그린다.
 * 지도가 움직이는 동안은 그리지 않고, 프레임이 느려지면 입자 수를 줄인다.
 */
(function () {
  function create(map, container, opts) {
    const o = Object.assign({ mPerParticle: 28, maxParticles: 700, minParticles: 60, speedScale: 6, fade: 0.86 }, opts || {});
    const canvas = document.createElement('canvas');
    canvas.className = 'particles';
    container.appendChild(canvas);
    const ctx = canvas.getContext('2d');
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    let W = 0, H = 0, tracks = [], parts = [], moving = false, running = false, lastT = 0;
    let target = 0, slowFrames = 0;

    function resize() {
      const r = container.getBoundingClientRect();
      W = r.width; H = r.height;
      canvas.width = Math.round(W * dpr); canvas.height = Math.round(H * dpr);
      canvas.style.width = W + 'px'; canvas.style.height = H + 'px';
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      clear();
    }
    function clear() { ctx.clearRect(0, 0, W, H); for (const p of parts) p.px = null; }

    function cumulative(coords) {
      const cum = [0];
      for (let i = 0; i < coords.length - 1; i++) cum.push(cum[i] + Geo.distance(coords[i], coords[i + 1]));
      return cum;
    }
    function posAt(t, s) {
      const cum = t.cum;
      let i = 0;
      while (i < cum.length - 2 && cum[i + 1] < s) i++;
      const seg = cum[i + 1] - cum[i];
      const f = seg > 0 ? Math.min(1, Math.max(0, (s - cum[i]) / seg)) : 0;
      const a = t.coords[i], b = t.coords[i + 1];
      return [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f];
    }

    // computed = 길목 + 바람 계산 결과. 바람이 길을 따라 흐르는 길목만 입자를 얹는다.
    function setTracks(computed) {
      tracks = computed.filter(c => c.arrows).map(c => ({ coords: c.coordsFlow, cum: cumulative(c.coordsFlow), len: c.length, speed: c.speed, level: c.level.key }));
      const total = tracks.reduce((a, t) => a + t.len, 0);
      target = Math.min(o.maxParticles, Math.max(tracks.length ? o.minParticles : 0, Math.round(total / o.mPerParticle)));
      seed(total);
    }
    function seed(total) {
      parts = [];
      if (!tracks.length || !total) { clear(); return; }
      for (const t of tracks) {
        const n = Math.max(1, Math.round(target * t.len / total));
        for (let i = 0; i < n; i++) parts.push({ t, s: Math.random() * t.len, px: null, py: null });
      }
      clear();
    }

    function frame(now) {
      if (!running) return;
      requestAnimationFrame(frame);
      if (document.hidden || moving || !parts.length) { lastT = now; return; }
      let dt = (now - lastT) / 1000;
      lastT = now;
      if (!(dt > 0)) dt = 0.016;
      // 느리면 입자 수를 줄인다 (연속 30프레임이 30fps 미만이면 20% 감소)
      if (dt > 0.034) { if (++slowFrames > 30 && parts.length > o.minParticles) { parts.length = Math.max(o.minParticles, Math.floor(parts.length * 0.8)); slowFrames = 0; } }
      else slowFrames = 0;
      dt = Math.min(dt, 0.05);

      ctx.globalCompositeOperation = 'destination-in';
      ctx.fillStyle = 'rgba(0,0,0,' + o.fade + ')';
      ctx.fillRect(0, 0, W, H);
      ctx.globalCompositeOperation = 'source-over';
      ctx.lineCap = 'round';

      for (const p of parts) {
        const v = o.speedScale * (0.6 + p.t.speed); // 화면에서의 이동 속도 (m/s)
        p.s += v * dt;
        if (p.s > p.t.len) { p.s = Math.random() * Math.min(10, p.t.len); p.px = null; }
        const sp = map.project(posAt(p.t, p.s));
        if (sp.x < -30 || sp.y < -30 || sp.x > W + 30 || sp.y > H + 30) { p.px = null; continue; }
        if (p.px !== null) {
          const w = p.t.level >= 2 ? 2.6 : 2.0;
          ctx.beginPath(); ctx.moveTo(p.px, p.py); ctx.lineTo(sp.x, sp.y);
          ctx.strokeStyle = 'rgba(28,27,24,0.45)'; ctx.lineWidth = w + 1.6; ctx.stroke();
          ctx.strokeStyle = 'rgba(255,255,255,0.95)'; ctx.lineWidth = w; ctx.stroke();
        }
        p.px = sp.x; p.py = sp.y;
      }
    }

    function start() { if (running) return; running = true; lastT = performance.now(); requestAnimationFrame(frame); }
    function stop() { running = false; clear(); }

    map.on('move', () => { if (!moving) { moving = true; clear(); } });
    map.on('moveend', () => { moving = false; lastT = performance.now(); for (const p of parts) p.px = null; });
    map.on('resize', resize);
    resize();
    return { setTracks, start, stop, resize, count: () => parts.length };
  }
  window.Particles = { create };
})();
