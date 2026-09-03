# file-next-test

Public sandbox for `@vryzel/file-next` against a real S3 or R2 bucket.

Visitors never configure a bucket. Operator env vars stay on the server. Each browser gets an httpOnly cookie tenant (`t/{id}/`). Quota 20 MB, 10 MB per file.

## Quick start

```bash
pnpm install
cp .env.example .env.local
pnpm dev
```

Open http://localhost:3000.

Use a **throwaway** R2 bucket and a token scoped to that bucket only. Set a 24h object-expiration lifecycle on it — tab close is not a delete guarantee.

## Env

See `.env.example`. Minimum for R2: `FILE_NEXT_PROVIDER`, `FILE_NEXT_BUCKET`, `FILE_NEXT_ENDPOINT`, `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`.
