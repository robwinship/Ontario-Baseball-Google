# OBA Search

Static search UI for content indexed from:
- https://playoba.ca (public nightly crawl)
- https://ondeck.baseballontario.com (local authenticated crawl)

## Quick start
1. Install dependencies:
   - `npm install`
2. Build public index:
   - `npm run crawl:playoba`
3. Optional local ondeck index build:
   - Copy `.env.example` to `.env`
   - Set `ONDECK_COOKIE` or `ONDECK_BEARER_TOKEN`
   - Run `npm run crawl:ondeck`
4. Merge source indexes:
   - `npm run merge-indexes`

## Run locally
Use any static file server, for example:
- `npx http-server .`
Then open `index.html` through the local server URL.

## Security model
- Ondeck credentials are local-only and never committed.
- `.env` is gitignored.
- `crawl:ondeck` refuses to run in CI.
- Merge step scans for token-like patterns before writing final index.

## GitHub Actions
Workflow `.github/workflows/nightly-public-index.yml`:
- Runs nightly for playoba crawl and index merge
- Commits refreshed data JSON if changed
- Deploys static site to GitHub Pages

## Notes on sign-in page
The UI includes an ondeck sign-in panel placeholder.
- It is currently metadata-gated (`authCapabilities.ondeckBrowserAuth=false`).
- Enable only after confirming ondeck supports browser API auth + CORS for your GitHub Pages origin.
