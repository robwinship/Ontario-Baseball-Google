# Source Access Matrix

| Source | Access | Refresh | Pipeline | Notes |
| --- | --- | --- | --- | --- |
| playoba.ca | Public | Nightly | GitHub Actions | Robots-aware crawler |
| ondeck.baseballontario.com | Authenticated | Manual/local | Local script only | Uses local `.env`, sanitized output |

## User experience
- Shared search URL includes both indexed sources when data exists.
- Result links open in a new tab/window.
- Ondeck live sign-in remains gated until API + CORS feasibility is proven.

## Fallback behavior
- If ondeck live sign-in is unavailable, users can still search the published ondeck index.
- If ondeck index is stale or missing, UI should indicate freshness from metadata.
