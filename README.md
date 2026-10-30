# JUKEBOX v2 — 웹사이트 배포 안내

좋아하는 앨범과 곡을 5개 이상 담으면 취향을 분석해 영수증 모양으로 추천해 주는 사이트입니다.
Claude에서 확인한 영수증 디자인과 기능을 그대로 옮겼고, 비용은 들지 않습니다.

## 무엇으로 돌아가나요

| 역할 | 서비스 | 비용 |
|---|---|---|
| 사이트 + 서버 기능 | Cloudflare Pages (+ Functions) | 무료 |
| 회원·목록·소식·오늘의 추천·방명록 | Cloudflare D1 | 무료 |
| 추천 문장 | Google Gemini API 무료 등급 | 무료 (결제 정보를 연결하지 않으면 청구되지 않음) |
| 앨범 검색·커버·실제 수록곡 확인 | Apple iTunes Search API + Deezer API | 무료, 키 불필요 |
| 검색창의 '지금 많이 듣는 앨범' | Apple Music 차트 RSS | 무료, 키 불필요 |
| 발매 연도·장르·국가, 수록곡 보조 확인 | MusicBrainz / Cover Art Archive | 무료, 키 불필요 |

---

## 1. GitHub 저장소의 파일 바꾸기

기존 `jukebox` 저장소를 그대로 씁니다.

1. 저장소 화면에서 **Add file → Upload files**를 누릅니다.
2. 압축을 푼 폴더 **안의 내용물 전부**(`public`, `functions`, `schema.sql`, `README.md`)를 끌어다 놓고 **Commit changes**를 누릅니다. 같은 이름의 파일은 새 파일로 바뀝니다.
3. 올린 뒤 저장소에서 `functions/api/[[path]].js`가 이 경로와 이름 그대로 있는지 확인합니다.
4. (선택) 더 이상 쓰지 않는 `public/bg-old.jpg`, `public/bg-young.jpg`, `wrangler.toml.example`은 지워도 됩니다.

## 2. 데이터베이스 새로 만들기 (기존 데이터 삭제)

1. Cloudflare 대시보드 → **Storage & Databases → D1 SQL Database → jukebox → Console**.
2. `schema.sql` 내용을 **전부** 복사해 붙여넣고 **Execute**를 누릅니다.
   - 이전 버전의 회원·목록·방명록이 **모두 지워지고** 새 표가 만들어집니다.

## 3. 설정값 확인 (Pages 프로젝트 → Settings)

**Bindings**: D1 `DB` 연결은 그대로 둡니다.

**Variables and Secrets**

| 이름 | 종류 | 값 |
|---|---|---|
| `GEMINI_API_KEY` | Secret | 지금 쓰는 키 그대로 |
| `PIN_PEPPER` | Secret | 지금 값 그대로 |
| `ADMIN_USERS` | **Text, 새로 추가** | 관리자로 쓸 Username. 여러 명이면 쉼표로: `myname,friend` |
| `GEMINI_FAST_MODEL` | Text (선택) | 평소 추천에 쓰는 빠른 모델. 기본값 `gemini-3.6-flash` |
| `GEMINI_MODEL` | Text (선택) | **깊게 분석**을 켰을 때 쓰는 모델. 기본값 `gemini-3.8-flash` |
| `GEMINI_FALLBACKS` | Text (선택) | 예비 모델. 기본값 `gemini-3.5-flash-lite` |

> 이전 버전에서 `GEMINI_MODEL`을 `gemini-3.8-flash`로 직접 넣어 두었다면 그대로 두어도 됩니다. 이제 이 값은 '깊게 분석'에만 쓰입니다.
| `REC_DAILY_LIMIT` | Text (선택) | 한 사람(IP)이 하루에 받을 수 있는 추천 횟수, 기본값 `20` |

`TMDB_API_KEY`는 영화 탭이 없어져 더 이상 쓰지 않으니 지워도 됩니다.

설정을 바꾼 뒤에는 **Deployments → 가장 최근 배포 → … → Retry deployment**를 한 번 눌러야 적용됩니다.
GitHub에 파일을 올리면 새 배포는 자동으로 시작됩니다.

## 4. 작동 확인

1. `https://(내 사이트).pages.dev/api/health` 를 엽니다.
   - `"version":2`, `"db":"ok"`, `"gemini_key":true`, `"pin_pepper":true`, `"admins":1` 이면 준비 완료입니다.
   - `"db":"tables_missing…"` 이면 2단계를 다시 실행하세요.
2. 같은 주소 끝에 `?ai=1` 을 붙여 엽니다.
   - `"ai_test":{"ok":true,…}` 이면 추천 엔진이 연결된 것입니다.
   - `ok:false` 이면 `notes`에 이유가 나옵니다 (키 거부, 모델 이름 오류, 한도 초과 등).
3. 사이트에서 `ADMIN_USERS`에 적은 Username으로 Join하면 이름 옆에 `*ADMIN*`이 붙습니다.
4. 같은 주소 끝에 `?up=1` 을 붙이면 서버에서 Apple·Deezer·MusicBrainz에 연결되는지 시험합니다.
   - `"catalogues":{"apple":200,"deezer":200,"musicbrainz":200}` 이면 정상입니다. 200이 아닌 곳은 그 서비스가 막힌 것입니다.

검색·커버·아티스트 앨범은 브라우저에서 먼저 찾고, 안 되면 서버(`/api/search`, `/api/cover`, `/api/artist`)가 대신 찾습니다.
서버 결과는 Cloudflare가 기억해 두므로(커버 7일, 아티스트 1일, 검색 1시간) 같은 요청이 반복돼도 빠릅니다.

## Community 소식

- 목록에 음악을 담을 때는 소식이 올라가지 않습니다.
- ANALYZE & RECOMMEND를 누르면 두 가지 소식이 올라갑니다.
  - "(username)님의 취향 및 추천": 분석 요약과 추천 음악
  - "(username)님이 담은 음악": 그때 목록에 있던 음악(5개 이상) 한 세트. 하루에 한 세트만 남고, 같은 날 다시 누르면 최신 목록으로 바뀝니다.
- 피드의 `[yyyy.mm.dd]` 상자를 누르면 그날 담겨 있던 음악 전체가 펼쳐집니다. 유저 팝업의 [담은 음악]에서도 `[지금]`과 날짜 상자로 번갈아 볼 수 있습니다.
- FEED와 MY ACTIVITY는 최근 10개씩 보이고, [더보기]를 누를 때마다 10개씩 더 불러옵니다.
- 이전 버전의 음악 하나하나 담을 때 올라간 소식과 "찾은 음악" 소식은 화면에 나오지 않습니다.

## 관리자가 할 수 있는 것

- Community 아래쪽 **ADMIN** 칸: 유저 삭제(계정·목록·소식·오늘의 추천·방명록 전부), 잠긴 계정 풀기
- 피드의 아무 소식이나 **관리자 삭제**
- 관리자 지정은 사이트 안에서 바꿀 수 없고 `ADMIN_USERS` 설정으로만 바꿉니다.

## 보안과 규칙

- 남의 소식·방명록 삭제, 관리자 기능 같은 규칙은 모두 서버에서 검사합니다.
- Username + 숫자 4자리 코드로 입장합니다. 같은 Username으로 5번 틀리면 15분 잠김, 한 IP에서 1시간에 30번 넘게 시도하면 차단됩니다.
- 코드는 원문이 아니라 `PIN_PEPPER`와 섞은 해시로만 저장합니다.

## 추천 속도

- 평소에는 빠른 모델(`gemini-3.6-flash`)이 먼저 답합니다. 보통 5~15초 안에 첫 추천이 찍힙니다.
- 6초가 지나도 글자가 오지 않으면 예비 모델이 동시에 출발하고, 먼저 답한 쪽을 씁니다.
- 중간에 14초 넘게 멈춘 응답은 기다리지 않고 버립니다. 화면에는 경과 시간이 초 단위로 표시됩니다.
- 옵션의 **깊게 분석**을 켜면 `gemini-3.8-flash`가 먼저 답합니다. 더 꼼꼼하지만 30초~1분 걸립니다.

## 추천 정확도

- 모델에게는 고른 개수보다 1~2개 더 받아 둡니다(예비).
- 추천마다 실제로 있는지 확인합니다.
  - **있다**고 보는 경우: Apple Music(미국·한국)에서 찾았을 때, 또는 MusicBrainz(전 세계 음반 기록)에 있을 때.
  - **지어낸 것**으로 보고 빼는 경우: Apple이 "없다"고 답하고 MusicBrainz도 "없다"고 답할 때(MusicBrainz에 연결이 안 되면 Apple의 답으로 판단).
  - 둘 다 연결이 안 되면 판단하지 않고 그대로 둡니다.
- 서버(Cloudflare)가 Apple에 연결되지 않으면, 이 확인은 사용자 브라우저가 Apple에 직접 해서 처리합니다.
- "먼저 들어볼 곡"은 그 앨범의 실제 트랙리스트(Apple)에 있을 때만 보여 줍니다. 없으면 트랙리스트 안에서 다시 고르고, 트랙리스트를 확인할 수 없으면 아예 표시하지 않습니다.
- 빠진 만큼은 예비로 채우고, 그래도 모자라면 "이 작품들은 없었다"는 목록을 붙여 다시 요청합니다(최대 두 번).
- Deezer는 서비스하는 나라에서만 검색 결과가 온전합니다. 한국처럼 Deezer가 열려 있지 않은 곳에서는 엉뚱한 결과가 오므로 검색과 확인에 쓰지 않습니다(`/api/health?up=1`의 `deezer_here`).

## 글꼴 라이선스 — 꼭 읽어 주세요

- **Galmuri**(한글): SIL Open Font License. 상업적 사용 포함 자유롭게 쓸 수 있습니다 (`public/fonts/GALMURI-OFL.txt`).
- **Merchant Copy**(영문·숫자): 제작자가 **개인적·비상업적 사용만 무료**로 허락한 글꼴입니다.
  광고·유료 기능 등 수익이 생기면 제작사(Cumberland Fontworks, fontworks@cumberlandgames.com)에 문의하거나 다른 글꼴로 바꿔야 합니다.
  바꾸려면 `public/fonts.css`의 Merchant Copy 두 줄을 지우면 영문도 Galmuri로 표시됩니다.

## 이용 조건

- Apple 앨범 아트는 작품 소개 용도로만 쓰고, 근처에 Apple Music 링크가 있어야 합니다. 추천 항목마다 링크가 붙어 있습니다.
- Gemini 무료 등급에서는 입력한 목록이 Google 서비스 개선에 쓰일 수 있습니다 (사이트 하단에 안내되어 있습니다).

## 폴더 구조

```
public/            화면 (index.html, style.css, fonts.css, app.js, paper.js, fonts/)
functions/api/     서버 기능 — /api/* 주소로 동작
schema.sql         데이터베이스 표 만들기 (실행하면 기존 데이터가 지워집니다)
```
