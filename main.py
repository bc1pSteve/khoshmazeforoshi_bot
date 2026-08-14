"""
Entry point. Run this on a schedule (GitHub Actions cron does this for you).

Flow:
    1. Read the manually selected product row from Sheets
    2. Download the image from Drive
    3. Build platform-compatible captions with the same content
    4. Send the photo + caption to the Telegram channel
    5. Save a Telegram checkpoint, then send the same post to Bale
    6. Mark the row as posted only after both sends succeed
    7. On any failure, send an alert message and exit with a non-zero code
       so GitHub Actions marks the run as failed (and can notify you).
"""

import os
import sys
import traceback

from src.config import (
    SPREADSHEET_ID,
    GOOGLE_SERVICE_ACCOUNT_FILE,
    TELEGRAM_BOT_TOKEN,
    TELEGRAM_CHANNEL_ID,
    TELEGRAM_ADMIN_CHAT_ID,
    BALE_BOT_TOKEN,
    BALE_CHANNEL_ID,
)
from src.sheets_client import SheetsClient
from src.drive_client import DriveClient
from src.telegram_client import TelegramClient
from src.bale_client import BaleClient
from src.caption_formatter import build_bale_caption, build_caption


def run() -> None:
    sheets = SheetsClient(GOOGLE_SERVICE_ACCOUNT_FILE, SPREADSHEET_ID)
    drive = DriveClient(GOOGLE_SERVICE_ACCOUNT_FILE)
    telegram = TelegramClient(TELEGRAM_BOT_TOKEN, TELEGRAM_CHANNEL_ID)
    bale = BaleClient(BALE_BOT_TOKEN, BALE_CHANNEL_ID)

    # PRODUCT_ID must come from an env var (GitHub Actions manual trigger input)
    # or as a plain command-line argument for local runs: `python main.py P001`
    product_id = os.environ.get("PRODUCT_ID", "").strip()
    if not product_id and len(sys.argv) > 1:
        product_id = sys.argv[1].strip()

    if not product_id:
        raise ValueError(
            "No product_id given. This bot only posts manually now -- "
            "pass a product_id (via the Actions 'Run workflow' input, or as a "
            "command-line argument locally: `python main.py P001`)."
        )

    print(f"Manual mode: posting product_id={product_id}")
    row = sheets.get_row_by_product_id(product_id)
    status = row["status"].strip().lower()
    if status == "posted":
        print(f"product_id={product_id} was already posted on {row.get('posted_at', '')}. "
              f"Posting it again since it was explicitly requested.")

    print(f"Posting row {row['row_number']} (product_id={row['product_id']}, drive_file_id={row['drive_file_id']})")

    image_bytes = drive.download_file(row["drive_file_id"])
    telegram_caption = build_caption(row["caption"], row["link"], row["title"])
    bale_caption = build_bale_caption(row["caption"], row["link"], row["title"])

    if status == "telegram_posted":
        print("Telegram was already sent in a previous partial run; skipping it.")
    else:
        telegram.send_photo(image_bytes, telegram_caption)
        sheets.mark_telegram_posted(row["row_number"])
        print("Telegram post succeeded; checkpoint saved.")

    bale.send_photo(image_bytes, bale_caption)
    sheets.mark_as_posted(row["row_number"])

    print(f"Row {row['row_number']} posted to Telegram and Bale, then marked as done.")


if __name__ == "__main__":
    try:
        run()
    except Exception as exc:  # noqa: BLE001
        error_text = f"❌ Auto-poster failed:\n{exc}"
        print(error_text)
        traceback.print_exc()
        try:
            # Best-effort failure alert; don't let this crash mask the real error.
            admin_client = TelegramClient(TELEGRAM_BOT_TOKEN, TELEGRAM_ADMIN_CHAT_ID)
            admin_client.send_message(error_text)
        except Exception:  # noqa: BLE001
            pass
        sys.exit(1)
