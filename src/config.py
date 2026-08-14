"""
All configuration comes from environment variables so nothing
sensitive is ever hardcoded or committed to git.

Locally: create a .env file (see .env.example) and load it with a tool
like python-dotenv, or export the variables in your shell.

In GitHub Actions: these are injected from repository Secrets
(see .github/workflows/post.yml).
"""

import os

SPREADSHEET_ID = os.environ["SPREADSHEET_ID"]
GOOGLE_SERVICE_ACCOUNT_FILE = os.environ.get(
    "GOOGLE_SERVICE_ACCOUNT_FILE", "service_account.json"
)
TELEGRAM_BOT_TOKEN = os.environ["TELEGRAM_BOT_TOKEN"]
TELEGRAM_CHANNEL_ID = os.environ["TELEGRAM_CHANNEL_ID"]
BALE_BOT_TOKEN = os.environ["BALE_BOT_TOKEN"]
BALE_CHANNEL_ID = os.environ["BALE_CHANNEL_ID"]

# Optional private destinations for completion and error notifications.
# TELEGRAM_REQUEST_CHAT_ID is supplied by the interactive Telegram controller.
TELEGRAM_ADMIN_CHAT_ID = os.environ.get("TELEGRAM_ADMIN_CHAT_ID", "").strip()
TELEGRAM_REQUEST_CHAT_ID = os.environ.get("TELEGRAM_REQUEST_CHAT_ID", "").strip()
TELEGRAM_NOTIFICATION_CHAT_ID = TELEGRAM_REQUEST_CHAT_ID or TELEGRAM_ADMIN_CHAT_ID
