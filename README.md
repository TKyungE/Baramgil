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
- 지도 위 길 색 = 그 길목의 단계 (잔잔 <3.4 / 주의 <5.5 / 강풍 <8.0 / 위험 ≥8.0 m/s — Lawson·Penwarden 1976 보행자 바람 영향 표 기준). 색은 단계가 셀수록 어두워지는 순서 배색.
- 길 위를 흐르는 흰 꼬리(입자) = 바람이 가는 방향. 센 바람일수록 빨리 흐름. 바람이 길을 가로지르는 곳(건물에 막혀 잔잔한 곳)은 입자 없음.
- 길을 탭하면 그 길목의 단계·풍속·돌풍·이름이 뜸.
- 위 카드 = 지금 위치의 단계·풍속·돌풍·풍향, 아래 카드 = 진행 방향 150 m 안에서 단계가 달라지는 첫 길목

## 지도 기능 (네이버지도·카카오맵 흐름 참고)

- **검색(자동완성)**: 위 카드의 돋보기 → 두 글자만 쳐도 결과가 뜸, 엔터는 첫 결과 선택. 기본 공급자는 Photon(OpenStreetMap, 키 없음). 최근 검색 10개 기억.
  - **한국 장소·주소 품질을 네이버·카카오 수준으로**: 카카오 로컬로 바꾸면 됨(무료). developers.kakao.com → 앱 만들기 → [앱 키] **JavaScript 키** 복사 → [플랫폼] Web 사이트 도메인에 `https://아이디.github.io` 등록 → `js/app.js` `CONFIG.search.kakaoKey`에 붙여넣기. 검색·주소 찾기 모두 카카오로 바뀌고, 실패하면 자동으로 OpenStreetMap으로 돌아감.
  - Nominatim은 정책상 자동완성 금지·초당 1회라 예비용으로만 남김(`CONFIG.search.provider = 'nominatim'`).
- **장소 시트**: 이름·종류·주소, 내 위치에서 거리, 그 앞 길의 바람 단계·풍속. [도보 길찾기] [공유] (공유 링크를 열면 그 장소가 바로 뜸).
- **길게 누르기 / 우클릭**: 핀을 꽂고 주소를 찾아줌 → 거기로 길찾기.
- **배경 지도 장소(상호·역) 탭**: 이름·종류 시트. **바람 길 탭**: 그 길목의 단계·풍속·돌풍.
- **도보 길찾기**: Valhalla 공개 서버(키 없음, 한국어 안내). 경로를 길목 단계 색으로 칠하고, 단계별 거리 막대와 '노출 점수'(잔잔 0·주의 1·강풍 3·위험 6 × 거리)로 대안 경로 순위를 매김 → **바람 덜 맞는 길 / 가장 빠른 길** 칩으로 전환. 안내 중엔 아래 카드가 '경로 기준 다음 길목'으로 바뀜. (자전거 앱 Headwind·BikeWind가 바람을 고려해 경로를 고르는 것과 같은 발상을 보행자·길목 단위로.)
- **우측 버튼**: 확대·축소·3D 기울이기. 우하단 내 위치.
- 지도 회전·나침반 모드는 일부러 뺐다 — 북쪽 고정이어야 풍향이 그대로 읽힌다.

## 왜 이렇게 그리나 (근거)

- 격자 화살표는 방향·경로 판단 성적이 가장 나빴고, 흐름선(적분곡선)을 보여주는 방식이 가장 좋았다 — Laidlaw et al., *Comparing 2D vector field visualization methods: a user study*, IEEE TVCG 2005. → 길마다 화살표를 찍지 않고 길을 따라 흐르는 선으로 보여줌.
- 정지 화살표·정지 흐름선보다 **움직이는 스트리클릿(짧은 꼬리 입자)**이 패턴 탐지·경로 추적 모두 더 빠르고 정확했다 — Ware et al., *Animated versus static views of steady flow patterns*, ACM SAP 2016. → 캔버스 입자 애니메이션.
- 세기는 굵기·밝기를 바꾸는 것보다 **움직이는 속도**로 보여줄 때 최대치를 가장 잘 찾았다 — *Cartography and Geographic Information Science* 2018. → 입자 속도 ∝ 풍속.
- hint.fm *Wind Map*(Viégas·Wattenberg 2012, MoMA 소장): 표현을 흐르는 꼬리 하나로 제한하고 장식을 뺀 것이 강점으로 평가됨. → 점선·화살표·이중 테두리 제거.
- 무지개식 배색은 크기 판단을 흐린다 — Borland & Taylor, *Rainbow Color Map (Still) Considered Harmful*, IEEE CG&A 2007. → 잔잔→위험이 밝기 순서로 어두워지는 4단계 배색(L* 79→70→55→34).

## 성능

- 지도 엔진은 데이터가 바뀔 때만 다시 그린다(정지 상태 0회/초). 흐름 애니메이션은 별도 캔버스 한 장에서만 돌고, 지도가 움직이는 동안은 멈춤. 프레임이 30fps 아래로 떨어지면 입자 수를 자동으로 줄임(최대 700).
- 길목 조회는 격자 색인(약 110 m 셀)으로 주변만 검사. 나침반은 3° 이상 바뀔 때 초당 최대 4번만 반영.
- 길·건물은 타일에서 80 m 이상 움직였을 때만 다시 꺼내고, 건물은 본 곳을 기억(중심 2.5 km 밖은 버림).

## 데이터 출처와 정확도 (중요)

| 항목 | 지금 | 더 정확하게 하려면 |
|---|---|---|
| 지도 | OpenFreeMap 벡터 지도 (OpenStreetMap) | — |
| 검색·주소 | Photon (OpenStreetMap) — 자동완성 됨, 한국 도로명주소는 OSM에 없는 곳이 있음 | 카카오 로컬(JavaScript 키, 무료) — `CONFIG.search.kakaoKey` 한 줄 |
| 도보 경로 | Valhalla 공개 서버 (OpenStreetMap 보행 네트워크) | — |
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
js/particles.js       길 위를 흐르는 입자 캔버스 (방향·세기)
js/places.js          검색·주소 (Photon / 카카오 / Nominatim), 최근 검색
js/route.js           도보 길찾기 (Valhalla), 경로 바람 프로필·대안 순위
js/nav.js             검색 화면·장소/경로 시트·핀·줌/3D 버튼
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
