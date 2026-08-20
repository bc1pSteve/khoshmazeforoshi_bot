# Telegram and Bale bot controller

This Cloudflare Worker provides private-chat Telegram and Bale UIs for public WooCommerce order-status lookups. It also receives Telegram admin-only commands and dispatches the existing GitHub Actions workflow.

## Public UI

- `/start` or `/help` shows inline **پیگیری سفارش** and **ارتباط با ادمین** buttons.
- The bot asks for the order ID and then explicitly asks for the mobile number used when placing that order.
- The bot reads only `id`, `status`, and `billing.phone` from WooCommerce.
- It returns the order status only when the normalized mobile number matches `billing.phone`.
- Missing orders and wrong phone numbers intentionally return the same generic response.
- Public order lookup works only in private Telegram or Bale chats.

The bot deliberately does not use Telegram's contact-sharing button because a customer's Telegram phone can differ from the phone used at checkout.

## Admin-only commands

- `/post P001` reads the product title from Sheets and shows **تایید**، **لغو** and **انتخاب محصول دیگر** buttons before dispatching the posting workflow.
- `/post random` chooses a random product whose Sheet status is empty. Choosing another product excludes the current candidate and repeats the confirmation step.
- `/last` shows the latest workflow run status.
- `/help` lists commands.

## Worker secrets

Configure these with `wrangler secret put NAME` or in the Cloudflare dashboard:

- `TELEGRAM_BOT_TOKEN`
- `TELEGRAM_WEBHOOK_SECRET` (a new random value containing only letters, numbers, `_` and `-`)
- `TELEGRAM_ADMIN_USER_ID` (the numeric Telegram user ID allowed to run commands)
- `BALE_BOT_TOKEN`
- `BALE_WEBHOOK_SECRET` (a separate random value containing only letters, numbers, `_` and `-`)
- `GITHUB_TOKEN` (fine-grained token restricted to this repository with Actions read/write)
- `WOOCOMMERCE_BASE_URL` (canonical HTTPS store URL, for example `https://shop.example.com`)
- `WOOCOMMERCE_CONSUMER_KEY` (WooCommerce REST API key with **Read** permission)
- `WOOCOMMERCE_CONSUMER_SECRET` (matching WooCommerce REST API secret)

Repository and workflow names, including `GITHUB_WORKFLOW` and `GITHUB_PREPARE_WORKFLOW`, are non-secret variables in `wrangler.jsonc`. The `ORDER_SESSIONS` KV binding stores Bale's short-lived order lookup step for 15 minutes; it never stores WooCommerce credentials or complete order data.

After deploying, set `WORKER_URL`, `TELEGRAM_BOT_TOKEN`, and `TELEGRAM_WEBHOOK_SECRET` in your local shell and run:

```bash
node scripts/set-webhook.mjs
```

Register Bale's webhook by adding `BALE_BOT_TOKEN` and `BALE_WEBHOOK_SECRET` to GitHub Actions secrets, then manually run **Configure Bale Webhook** from the Actions tab. The same `BALE_BOT_TOKEN` and `BALE_WEBHOOK_SECRET` values must also be encrypted Worker secrets in Cloudflare.

Create the WooCommerce key in **WooCommerce → Settings → Advanced → REST API → Add key** and select **Read** permission. Store all real values as encrypted Worker secrets; never commit or paste them into this directory.
