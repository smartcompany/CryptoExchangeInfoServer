# CryptoExchangeInfoServer

| 플랫폼 | 역할 | 진입점 |
|--------|------|--------|
| **Vercel** (기본 API) | Serverless API | `api/*.js` + `vercel.json` |
| **Standalone / PM2** (푸시 폴러) | 상시 Node HTTP + poller | `standalone-server.js` (`npm start`) |

**Vercel URL:** https://cryptoexchangeinfoserver.vercel.app  

거래소 이벤트·Earn·이미지는 Flutter가 거래소 공개 API를 **직접** 호출합니다.  
서버는 settings / AI 분석 / push-register 를 담당합니다.  
푸시 폴링은 Vercel에서 돌릴 수 없어 **라즈베리 등 로컬 PM2**에서 `standalone-server.js`로 돌립니다.

## 엔드포인트

| Method | Path | 설명 |
|--------|------|------|
| `GET` | `/api/settings` | AdMob·다운로드 URL·거래소 레퍼럴 |
| `POST` | `/api/event-analyze` | Gemini 이벤트 분석 (`Bearer` 필요) |
| `POST` | `/api/push-register` | FCM 토큰 → Supabase |
| `GET` | `/privacy` | 개인정보 처리방침 |
| `GET` | `/health` | 헬스체크 (standalone) |
| `GET` | `/api/cex-probe` | Binance·Bybit·OKX 접근 스모크 (`Bearer` 필요) |

### CEX 프로브 (푸시 폴링 전 확인)

```bash
curl -sS "https://cryptoexchangeinfoserver.vercel.app/api/cex-probe?exchange=all" \
  -H "Authorization: Bearer $EXORA_API_TOKEN" | jq .

# 로컬 / Pi standalone
curl -sS "http://127.0.0.1:3010/api/cex-probe?exchange=binance" \
  -H "Authorization: Bearer $EXORA_API_TOKEN"
```

응답의 `results.*.ok` 가 `true`이면 해당 호스트에서 폴링 가능.

## 환경 변수 / Secrets

| 이름 | 용도 |
|------|------|
| `GEMINI_API_KEY` | event-analyze |
| `EXORA_API_TOKEN` | `Authorization: Bearer <token>` |
| `DOWNLOAD_URL` | `settings.down_load_url` (선택) |
| `IOS_*` / `ANDROID_*` | AdMob 유닛 덮어쓰기 (선택) |
| `FIREBASE_SERVICE_ACCOUNT_JSON` | FCM 전송 (standalone poller) |
| `SUPABASE_URL` / `SUPABASE_SERVICE_ROLE_KEY` | push-register |

---

## Vercel

- Root directory: `server`
- `vercel.json` / `api/` 유지
- 환경 변수는 Vercel 대시보드에 등록

```bash
cd server
npx vercel --prod
```

---

## Standalone / PM2 (푸시 폴러)

```bash
cd server
npm install --omit=dev
./pm2-push-poller.sh
```

기본 포트: `3010` (ecosystem 설정). Health: `GET /health`

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
