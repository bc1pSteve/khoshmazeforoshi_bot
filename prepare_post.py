"""Select a product from Sheets and ask the Telegram admin for confirmation."""

import os
import sys
import traceback

from src.sheets_client import SheetsClient
from src.telegram_client import TelegramClient


def valid_callback_product_id(value: str) -> bool:
    """Keep callback data within Telegram's 64-byte limit."""
    return bool(value) and ":" not in value and not any(char.isspace() for char in value) \
        and len(value.encode("utf-8")) <= 48


def confirmation_markup(product_id: str) -> dict:
    return {
        "inline_keyboard": [
            [
                {"text": "تایید", "callback_data": f"post:{product_id}"},
                {"text": "لغو", "callback_data": f"cancel:{product_id}"},
            ],
            [
                {
                    "text": "انتخاب محصول دیگر",
                    "callback_data": f"reroll:{product_id}",
                }
            ],
        ]
    }


def run() -> None:
    spreadsheet_id = os.environ["SPREADSHEET_ID"]
    service_account_file = os.environ.get(
        "GOOGLE_SERVICE_ACCOUNT_FILE", "service_account.json"
    )
    bot_token = os.environ["TELEGRAM_BOT_TOKEN"]
    chat_id = os.environ["TELEGRAM_REQUEST_CHAT_ID"].strip()
    requested_product_id = os.environ.get("REQUESTED_PRODUCT_ID", "").strip()
    exclude_product_id = os.environ.get("EXCLUDE_PRODUCT_ID", "").strip()

    if not chat_id:
        raise ValueError("Telegram request chat ID is missing.")
    if not requested_product_id:
        raise ValueError("Requested product ID is missing.")

    sheets = SheetsClient(service_account_file, spreadsheet_id)
    telegram = TelegramClient(bot_token, chat_id)

    if requested_product_id.lower() == "random":
        row = sheets.get_random_unposted_row(exclude_product_id)
        if row is None:
            telegram.send_message("محصول منتشرنشده دیگری برای انتخاب وجود ندارد.")
            return
    else:
        row = sheets.get_row_by_product_id(requested_product_id)

    product_id = row["product_id"].strip()
    title = row["title"].strip()
    if not valid_callback_product_id(product_id):
        raise ValueError("The selected product ID cannot be used in a Telegram button.")
    if not title:
        raise ValueError("The selected product has no title.")

    telegram.send_message(
        f"آیا تایید می‌کنی محصول «{title}» پست بشه؟",
        reply_markup=confirmation_markup(product_id),
    )


if __name__ == "__main__":
    try:
        run()
    except Exception:  # noqa: BLE001
        traceback.print_exc()
        try:
            token = os.environ.get("TELEGRAM_BOT_TOKEN", "")
            chat_id = os.environ.get("TELEGRAM_REQUEST_CHAT_ID", "").strip()
            if token and chat_id:
                TelegramClient(token, chat_id).send_message(
                    "❌ آماده‌سازی محصول انجام نشد. جزئیات در GitHub Actions ثبت شده است."
                )
        except Exception:  # noqa: BLE001
            pass
        sys.exit(1)
