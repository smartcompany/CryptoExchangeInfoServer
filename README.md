# CryptoExchangeInfoServer

Vercel에 배포된 Node API입니다.

**배포 URL:** https://cryptoexchangeinfoserver.vercel.app

## 엔드포인트

| Method | Path | 설명 |
|--------|------|------|
| `GET` | `/api/settings` | AdMob·다운로드 URL 등 앱 설정 |
| `POST` | `/api/event-analyze` | Gemini 기반 이벤트 분석 |

거래소 이벤트·Earn·이미지는 Flutter 앱이 거래소 공개 API를 직접 호출합니다.

## 환경 변수

- `GEMINI_API_KEY` — event-analyze (`gemini-3.5-flash-lite` 고정)
- `DOWNLOAD_URL` — `settings.down_load_url` (기본 `https://cryptoexchangeinfoserver.vercel.app/applink`)
- `IOS_*` / `ANDROID_*` — AdMob 유닛 ID 덮어쓰기
