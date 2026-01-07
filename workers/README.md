# Aurora Capture Translation Worker

This Worker proxies DeepL API calls for the frontend `Trans` toggle.

## Endpoints
- `POST /api/translate`
  - Body: `{ "texts": ["中文1", "中文2"], "target": "EN-GB", "source": "ZH" }`
  - Response: `{ "ok": true, "target": "EN-GB", "texts": ["...", "..."] }`
- `GET /api/languages`
  - Response: `{ "ok": true, "targets": ["EN", "EN-GB", "PT-BR"] }`

## Environment Variables
- `DEEPL_API_KEY` (required)
- `DEEPL_API_URL` (optional, default `https://api-free.deepl.com`)
- `ALLOW_ORIGIN` (optional, CORS allowlist; default `*`)

## Deploy (Cloudflare Workers)
1. Create a new Worker and bind the above env vars.
2. Deploy `workers/index.js`.
3. Set `window.TRANS_CONFIG.apiBase` in `index.html` to your Worker origin.
