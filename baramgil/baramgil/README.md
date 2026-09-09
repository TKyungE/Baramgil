# 바람길 (가칭)

지금 서 있는 길목의 풍속·돌풍·풍향과, 진행 방향 앞 길목의 바람을 지도 위에 보여주는 웹앱(PWA).
아이폰 홈 화면에 추가하면 앱처럼 쓸 수 있다. 서버 없음 — 정적 파일만 올리면 된다.

## 배포 (GitHub Pages, 5분)

1. github.com → **New repository** (이름 예: `baramgil`, Public) 생성
2. 저장소 화면의 **Add file → Upload files** 에 이 폴더 안의 파일·폴더를 전부 끌어다 놓고 **Commit changes**
3. 저장소 **Settings → Pages → Build and deployment**: Source = *Deploy from a branch*, Branch = `main` / `/ (root)` → **Save**
4. 1~2분 뒤 `https://<아이디>.github.io/baramgil/` 에서 열림
5. 아이폰 Safari로 열기 → **공유 → 홈 화면에 추가** → 홈 아이콘으로 실행하면 전체화면

Claude Code에서 하려면 폴더 안에서: `git init && git add -A && git commit -m "바람길" && gh repo create baramgil --public --source=. --push` 후 3번만 웹에서.

> 위치(GPS)는 HTTPS에서만 동작한다. 내 PC에서 그냥 파일을 열면 위치는 안 잡히고 **테스트 모드**로 볼 수 있다.

## 첫 실행

- **위치 사용 시작** → 위치 허용, (iOS) 나침반 허용. 위치는 기기 안에서만 쓰고 어디에도 보내지 않는다.
- **테스트 모드로 보기** → 가산디지털단지역에서 시작, 지도를 탭하면 그 자리로 이동(탭한 방향이 진행 방향).
- 주소 뒤에 붙이는 옵션: `?sim=1` 테스트 모드 강제, `?lat=37.48&lon=126.88` 시작점 지정, `?mock=1` 네트워크 없이 모의 데이터.

## 화면

- 배경 지도는 OpenFreeMap의 밝은 벡터 지도(OpenStreetMap 기반, 키·한도 없음): 도로·건물·지명·상호가 다 나오고 글자는 한국어 이름 우선. 그 위에 OpenStreetMap 건물 윤곽을 층수 기반 높이로 한 번 더 그린다 — 두 손가락으로 위아래로 끌면 기울어져 건물이 입체로 보임.
  - 배경을 바꾸려면 `js/app.js` `CONFIG.basemap`: `'positron'`(기본, 밝음) / `'bright'`(색 있는 지도) / `'osm'`(표준 OSM 래스터) / MapLibre 스타일 URL / XYZ 타일 URL 배열(브이월드 등 키가 필요한 지도는 발급받은 URL을 넣으면 됨).
  - CARTO 래스터 지도는 2026년 8월부터 키 없이 쓰면 "API KEY REQUIRED" 워터마크가 찍혀서 뺐다.
  - 네이버·카카오 지도 그대로는 각 사 SDK·키가 필요해 이 구조로는 못 쓴다. 대신 국토부 브이월드 타일(무료 키)로 한국식 지도를 넣을 수 있다.
  - 건물 3D를 끄려면 `CONFIG.buildings3d = false`.
- 지도 위 길 색 = 그 길목의 단계 (잔잔 <3.4 / 주의 <5.5 / 강풍 <8.0 / 위험 ≥8.0 m/s — Lawson·Penwarden 1976 보행자 바람 영향 표 기준)
- 흰 점선·› = 바람이 흐르는 방향. 센 바람일수록 빨리 흐름. 바람이 길을 가로지르는 곳은 표시 없음(막혀서 잔잔한 곳)
- 위 카드 = 지금 위치의 단계·풍속·돌풍·풍향, 아래 카드 = 진행 방향 150 m 안에서 단계가 달라지는 첫 길목

## 데이터 출처와 정확도 (중요)

| 항목 | 지금 | 더 정확하게 하려면 |
|---|---|---|
| 지도 | OpenFreeMap 벡터 지도 (OpenStreetMap) | — |
| 길·건물 | 배경 지도 타일 안의 OpenStreetMap 데이터를 그대로 사용(요청 없음). 래스터 배경일 때만 Overpass API로 받음 | 건물 높이는 OSM에 층수가 없으면 3층으로 가정 |
| 배경 바람 | **Open-Meteo 예보 모델값** (실측 아님, 15분~1시간 단위) | 기상청 AWS 1분 관측 연결 (아래) |
| 길목별 풍속 | **휴리스틱**: 길 축과 바람 각도 + 길 폭 (`js/model.js` `PARAMS`) | windfield.py 래스터 연결 (아래) |

오차의 대부분은 배경 바람과 길목 계수에서 나온다. 순서대로:

1. **휴대용 풍속계로 재서 계수 보정** — `js/model.js` 의 `PARAMS` (골목/일반/큰길 × 길따라/가로질러 비율 6개). 같은 시각 배경 바람 대비 실측 비율을 몇 곳 재면 바로 맞출 수 있다.
2. **기상청 연결** — `js/app.js` `CONFIG.kmaProxyUrl` 에 프록시 주소를 넣으면 우선 사용. 브라우저에서 기상청 API를 직접 못 부르므로(키 노출·CORS) 작은 서버(예: Cloudflare Worker)가 `GET {proxy}?lat=..&lon=..` 요청에 아래 JSON을 `Access-Control-Allow-Origin: *` 로 돌려주면 된다.
   ```json
   { "speed": 4.1, "dir": 315, "gust": 7.2, "time": "2026-09-09T10:42", "source": "기상청 AWS 417" }
   ```
   `speed` 10분 평균(m/s), `dir` 불어오는 방향(도), `gust` 최대 순간풍속(m/s).
3. **정밀 래스터 연결** — `js/app.js` `CONFIG.rasterManifest = 'data/manifest.json'` 로 두고 `data/` 에 방향별 PNG를 넣는다. 형식은 `js/model.js` 의 `Raster` 주석 참고(B 채널 = 보행자 높이 풍속 비율, A=0 건물). 래스터가 덮는 범위 밖은 자동으로 휴리스틱을 쓴다.

## 파일

```
index.html            화면
css/app.css           스타일
js/geo.js             거리·방위 계산
js/wind.js            배경 바람 (Open-Meteo / 기상청 프록시)
js/streets.js         길·건물 데이터 (지도 타일 / Overpass) + 길목 나누기
js/model.js           길목별 풍속·흐름 방향·단계, 래스터 어댑터, 다음 길목 탐색
js/app.js             지도·위치·나침반·카드 (설정은 맨 위 CONFIG)
js/mock.js            모의 데이터 (?mock=1)
vendor/               MapLibre GL JS 5.24 (지도 엔진)
manifest.webmanifest  홈 화면 추가용
sw.js                 앱 파일 캐시 (지도·바람 데이터는 캐시 안 함)
icons/                아이콘
tests/logic.test.js   계산 로직 검사: node tests/logic.test.js
```

## 알아둘 것

- 앱을 닫거나 화면을 끄면 갱신이 멈춘다 (웹앱 한계). 백그라운드 알림이 필요해지면 그때 네이티브/Expo로 감싸면 되고, 계산 로직은 그대로 쓴다.
- 배경 바람은 10분마다 갱신. 길·건물은 화면에 보이는 지도 타일에서 바로 꺼내므로 별도 대기 없음(줌 14 미만에선 골목이 타일에 없어 마지막 결과를 유지).
- 래스터 배경(`'osm'` 등)을 쓸 때만 Overpass API를 쓰며, 무료 서버라 가끔 느리거나 거부된다. 실패하면 1분 뒤 자동 재시도.
- PC에서 파일을 직접 열면(file://) 콘솔에 manifest·서비스워커 관련 경고가 뜰 수 있는데 무시해도 된다. 배경 지도의 'Expected value to be of type number' 경고는 지도 스타일 자체(국가 라벨 필터)에서 나오는 것으로 앱과 무관.
