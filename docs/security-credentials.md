# Credential and Secret Rules

## Required policy
- Store ondeck credentials only in local `.env` on this computer.
- Never commit `.env` or credential files to git.
- Never run `crawl:ondeck` in CI.
- Never print token/cookie values in script logs.

## Local setup
1. Copy `.env.example` to `.env`.
2. Fill `ONDECK_COOKIE` or `ONDECK_BEARER_TOKEN`.
3. Run `npm run crawl:ondeck` locally.
4. Review generated `data/ondeck-index.json` before commit.

## Pre-commit safety checks (recommended)
- Add a secret scanning hook before commit.
- Reject commits containing strings like `ONDECK_COOKIE=` or `authorization:`.

## Rotation
- Rotate ondeck credentials on any suspected exposure.
- Prefer read-only credentials for indexing.
