# Telegram command controller

This Cloudflare Worker receives private Telegram commands from one numeric admin user ID and dispatches the existing GitHub Actions workflow.

## Commands

- `/post P001` shows confirmation buttons and dispatches the workflow after approval.
- `/last` shows the latest workflow run status.
- `/help` lists commands.

## Worker secrets

Configure these with `wrangler secret put NAME` or in the Cloudflare dashboard:

- `TELEGRAM_BOT_TOKEN`
- `TELEGRAM_WEBHOOK_SECRET` (a new random value containing only letters, numbers, `_` and `-`)
- `TELEGRAM_ADMIN_USER_ID` (the numeric Telegram user ID allowed to run commands)
- `GITHUB_TOKEN` (fine-grained token restricted to this repository with Actions read/write)

Repository and workflow names are non-secret variables in `wrangler.jsonc`.

After deploying, set `WORKER_URL`, `TELEGRAM_BOT_TOKEN`, and `TELEGRAM_WEBHOOK_SECRET` in your local shell and run:

```bash
node scripts/set-webhook.mjs
```

Never commit or paste real tokens into this directory.
