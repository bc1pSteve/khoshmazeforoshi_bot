# Telegram command controller

This Cloudflare Worker provides a private-chat Telegram UI for public WooCommerce order-status lookups. It also receives admin-only commands and dispatches the existing GitHub Actions workflow.

## Public UI

- `/start` or `/help` shows a persistent **پیگیری وضعیت سفارش** button.
- The bot asks for the order ID and then explicitly asks for the mobile number used when placing that order.
- The bot reads only `id`, `status`, and `billing.phone` from WooCommerce.
- It returns the order status only when the normalized mobile number matches `billing.phone`.
- Missing orders and wrong phone numbers intentionally return the same generic response.
- Public order lookup works only in private chats.

The bot deliberately does not use Telegram's contact-sharing button because a customer's Telegram phone can differ from the phone used at checkout.

## Admin-only commands

- `/post P001` shows confirmation buttons and dispatches the workflow after approval.
- `/last` shows the latest workflow run status.
- `/help` lists commands.

## Worker secrets

Configure these with `wrangler secret put NAME` or in the Cloudflare dashboard:

- `TELEGRAM_BOT_TOKEN`
- `TELEGRAM_WEBHOOK_SECRET` (a new random value containing only letters, numbers, `_` and `-`)
- `TELEGRAM_ADMIN_USER_ID` (the numeric Telegram user ID allowed to run commands)
- `GITHUB_TOKEN` (fine-grained token restricted to this repository with Actions read/write)
- `WOOCOMMERCE_BASE_URL` (canonical HTTPS store URL, for example `https://shop.example.com`)
- `WOOCOMMERCE_CONSUMER_KEY` (WooCommerce REST API key with **Read** permission)
- `WOOCOMMERCE_CONSUMER_SECRET` (matching WooCommerce REST API secret)

Repository and workflow names are non-secret variables in `wrangler.jsonc`.

After deploying, set `WORKER_URL`, `TELEGRAM_BOT_TOKEN`, and `TELEGRAM_WEBHOOK_SECRET` in your local shell and run:

```bash
node scripts/set-webhook.mjs
```

Create the WooCommerce key in **WooCommerce → Settings → Advanced → REST API → Add key** and select **Read** permission. Store all real values as encrypted Worker secrets; never commit or paste them into this directory.
