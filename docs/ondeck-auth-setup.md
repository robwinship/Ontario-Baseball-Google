# Ondeck Local Auth Setup

Use this guide to get local-only auth values for `npm run crawl:ondeck`.

## Important safety rules
- Keep values only in local `.env`.
- Never paste cookie/token values into GitHub, issues, or chat.
- If exposed, rotate credentials immediately.

## 1) Create local .env
1. Copy `.env.example` to `.env`.
2. Fill at least one of:
   - `ONDECK_COOKIE`
   - `ONDECK_BEARER_TOKEN`

You can set both. The crawler will send both headers.

If your copied request is `https://api.mobilecoach.org/api/auth` with a JSON body like
`{"token":"...","appKey":"BO"}`, that is also supported by this project.

## 2) Option A: Get session cookie from browser (most common)
1. Sign into `https://ondeck.baseballontario.com` in your browser.
2. Open DevTools (F12) -> Network.
3. Refresh the page.
4. Click a request to ondeck (document or API request).
5. In Request Headers, find `Cookie`.
6. Copy the full cookie header value into `.env` as:
   - `ONDECK_COOKIE=...`

Notes:
- Keep it on one line.
- Do not include the text `Cookie:`; paste only the value.

## 3) Option B: Get bearer token (if ondeck uses token auth)
1. In DevTools -> Network, click an authenticated API request.
2. Find `Authorization: Bearer ...` in Request Headers.
3. Copy only the token part after `Bearer `.
4. Save as:
   - `ONDECK_BEARER_TOKEN=...`

## 4) Validate before crawling
Run:
- `npm run auth:ondeck`

Expected result:
- `Auth appears valid. You can run: npm run crawl:ondeck`

If invalid:
- Re-login and capture a fresh cookie/token.
- Confirm you are copying request headers (not response headers).
- Confirm `ONDECK_BASE_URL` matches the signed-in domain.

## Optional shortcut: import from DevTools cURL
1. In DevTools Network, right-click an authenticated ondeck request.
2. Click Copy -> Copy as cURL.
3. Run:
   - `npm run auth:import-curl`
4. Paste the full cURL text and press Enter on an empty line.
5. The script updates local `.env` with detected auth keys.
6. Run `npm run auth:ondeck` to confirm validity.

The importer can read all of these cURL patterns:
- Request header `Cookie: ...`
- Request header `Authorization: Bearer ...`
- JSON payload token flow: `--data-raw '{"token":"...","appKey":"..."}'`

## 5) Crawl
Run:
- `npm run crawl:ondeck`
- `npm run merge-indexes`

Then review generated files in `data/` before commit.
