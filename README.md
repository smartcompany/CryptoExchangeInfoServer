# CryptoExchangeInfoServer

같은 Git 저장소에서 **Vercel**과 **Cloudflare Workers** 둘 다 배포할 수 있습니다.

| 플랫폼 | 역할 | 진입점 |
|--------|------|--------|
| **Vercel** (기존) | Node API | `api/*.js` + `vercel.json` |
| **Cloudflare Workers** | 동일 API의 Workers 런타임 | `workers/index.js` + `wrangler.toml` |
| **Railway** | 상시 Node HTTP | `railway-server.js` (`npm start`) |

**Vercel URL:** https://cryptoexchangeinfoserver.vercel.app  

거래소 이벤트·Earn·이미지는 Flutter가 거래소 공개 API를 **직접** 호출합니다.  
서버는 settings / AI 분석만 담당합니다.

## 엔드포인트 (Vercel · Workers 공통)

| Method | Path | 설명 |
|--------|------|------|
| `GET` | `/api/settings` | AdMob·다운로드 URL·거래소 레퍼럴 |
| `POST` | `/api/event-analyze` | Gemini 이벤트 분석 (`Bearer` 필요) |
| `GET` | `/privacy` | 개인정보 처리방침 (스토어 URL) |
| `GET` | `/health` | Workers 헬스체크 |

## 환경 변수 / Secrets

| 이름 | 용도 |
|------|------|
| `GEMINI_API_KEY` | event-analyze |
| `EXORA_API_TOKEN` | `Authorization: Bearer <token>` |
| `DOWNLOAD_URL` | `settings.down_load_url` (선택) |
| `IOS_*` / `ANDROID_*` | AdMob 유닛 덮어쓰기 (선택) |

---

## 당신이 할 일 (Cloudflare Workers)

### 1) 코드 push
이 변경(`wrangler.toml`, `workers/`)이 들어간 커밋을 GitHub에 push 합니다.

### 2) Cloudflare에서 **Workers**로 연결 (Pages 아님)
이전 실패 로그는 Pages/정적 배포처럼 잡혀서 났습니다.  
**Workers & Pages → Create → Connect to Git** 에서:

- 프로젝트 유형: **Worker**
- Repository: 이 모노레포
- **Root directory:** `server`
- **Build command:** `npm install` (또는 비움)
- **Deploy command:** `npx wrangler deploy` 또는 `npm run cf:deploy`  
  (Workers에서는 `npm start`를 쓰지 마세요 — Railway용 상시 서버입니다)

### Railway

- **Root directory:** `server`
- **Start command:** `npm start` → `node railway-server.js`
- Variables: `EXORA_API_TOKEN`, `GEMINI_API_KEY`, (선택) `DOWNLOAD_URL`, AdMob vars
- Health: `GET /health`

이미 Pages로 만들어 둔 프로젝트가 있으면 지우고 **Worker**로 다시 만들거나,  
기존 Worker 프로젝트의 Root/Deploy 커맨드만 위처럼 고칩니다.

### 3) Secrets 등록
Workers 프로젝트 → **Settings → Variables and Secrets**:

- `EXORA_API_TOKEN` (Secret)
- `GEMINI_API_KEY` (Secret)
- 필요 시 `DOWNLOAD_URL`, AdMob 관련 vars

로컬에서도 가능:

```bash
cd server
npx wrangler secret put EXORA_API_TOKEN
npx wrangler secret put GEMINI_API_KEY
```

### 4) 배포 확인
배포 후 Workers URL 예:

- `https://exora-api.<your-subdomain>.workers.dev/health`
- `https://exora-api.<your-subdomain>.workers.dev/api/settings`

### 5) (선택) 앱이 Workers를 쓰게 하려면
Flutter의 `ExchangeEventsService.productionApiBaseUrl` / AI·settings base URL을  
Workers URL로 바꾸면 됩니다.  
바꾸지 않으면 앱은 계속 **Vercel**을 씁니다. 두 배포는 독립적으로 살아 있습니다.

### 로컬 Workers 실행

```bash
cd server
npm install
npm run cf:dev
```

---

## Vercel (기존, 그대로)

- Root: `server`
- 기존 `vercel.json` / `api/` 유지
- 환경 변수는 Vercel 대시보드에 이미 있는 값 유지

---

## `settings.referrals` 예

```json
"referrals": {
  "binance": "GRO_28502_DHEX0",
  "bybit": "4LMVJ",
  "okx": "LYPMI7KH",
  "gate": "VVUXULXECQ",
  "mexc": "4E6ZD",
  "bitget": "ZNUN2HX5",
  "kucoin": "L2ZXN45F",
  "coinbase": "SWD7NTZ"
}
```
