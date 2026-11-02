# CryptoExchangeInfoServer

Vercel에 배포된 Node API입니다.

**배포 URL:** https://cryptoexchangeinfoserver.vercel.app

## 엔드포인트

| Method | Path | 설명 |
|--------|------|------|
| `GET` | `/api/settings` | AdMob·다운로드 URL 등 앱 설정 |
| `POST` | `/api/event-analyze` | Gemini 기반 이벤트 분석 |

CORS는 `/api/*`에 `Access-Control-Allow-Origin: *` 로 열려 있습니다.

## 환경 변수

`.env.example` 참고:

- `GEMINI_API_KEY` — event-analyze (`gemini-3.5-flash-lite` 고정)
- `DOWNLOAD_URL` — `settings.down_load_url` (기본 `https://cryptoexchangeinfoserver.vercel.app/applink`)
- `IOS_*` / `ANDROID_*` — AdMob 유닛 ID 덮어쓰기

## 로컬

```bash
# Vercel CLI 등으로 실행하거나, Flutter 개발 시에는
# client/proxy (localhost:8787) 를 사용하세요.
```
