"""
Handles all interaction with Google Sheets:
- Reading rows
- Finding the next un-posted row
- Marking a row as posted

Expected sheet columns (edit COLUMN_MAP below if your sheet differs):
    A: product_id      -> Your own ID for the product/post (e.g. "P001"). Used for manual posting.
    B: drive_file_id   -> Google Drive file ID of the image
    C: caption         -> Ready-made caption text
    D: title           -> Product title/headline, shown bold above the caption
    E: link             -> Your website / landing page link
    F: status          -> "" (empty) or "posted"
    G: posted_at       -> Timestamp, filled in automatically
"""

from __future__ import annotations
import datetime
import secrets
from typing import Optional, TypedDict

from google.oauth2 import service_account
from googleapiclient.discovery import build

SCOPES = ["https://www.googleapis.com/auth/spreadsheets"]

COLUMN_MAP = {
    "product_id": 0,
    "drive_file_id": 1,
    "caption": 2,
    "title": 3,
    "link": 4,
    "status": 5,
    "posted_at": 6,
}

SHEET_RANGE = "telegram_bot!A2:G"  # A2 because row 1 is assumed to be a header


class Row(TypedDict):
    row_number: int
    product_id: str
    drive_file_id: str
    caption: str
    title: str
    link: str
    status: str
    posted_at: str


class SheetsClient:
    def __init__(self, service_account_file: str, spreadsheet_id: str):
        creds = service_account.Credentials.from_service_account_file(
            service_account_file, scopes=SCOPES
        )
        self.service = build("sheets", "v4", credentials=creds)
        self.spreadsheet_id = spreadsheet_id

    def _get_all_rows(self) -> list:
        result = (
            self.service.spreadsheets()
            .values()
            .get(spreadsheetId=self.spreadsheet_id, range=SHEET_RANGE)
            .execute()
        )
        return result.get("values", [])

    def _row_to_dict(self, row_number: int, row: list) -> Row:
        def get(key: str) -> str:
            idx = COLUMN_MAP[key]
            return row[idx] if len(row) > idx else ""

        return {
            "row_number": row_number,
            "product_id": get("product_id"),
            "drive_file_id": get("drive_file_id"),
            "caption": get("caption"),
            "title": get("title"),
            "link": get("link"),
            "status": get("status"),
            "posted_at": get("posted_at"),
        }

    def get_next_unposted_row(self) -> Optional[Row]:
        """Return the first row whose status column is empty (not yet posted)."""
        rows = self.get_unposted_rows()
        return rows[0] if rows else None

    def get_unposted_rows(self, exclude_product_id: str = "") -> list[Row]:
        """Return valid rows that have never reached either posting checkpoint."""
        excluded = exclude_product_id.strip()
        candidates: list[Row] = []
        for i, raw_row in enumerate(self._get_all_rows()):
            row = self._row_to_dict(i + 2, raw_row)
            if row["status"].strip():
                continue
            if excluded and row["product_id"].strip() == excluded:
                continue
            if not all(row[field].strip() for field in ("product_id", "drive_file_id", "title")):
                continue
            candidates.append(row)
        return candidates

    def get_random_unposted_row(self, exclude_product_id: str = "") -> Optional[Row]:
        """Choose one never-posted product, optionally excluding the current choice."""
        candidates = self.get_unposted_rows(exclude_product_id)
        return secrets.choice(candidates) if candidates else None

    def get_row_by_product_id(self, product_id: str) -> Optional[Row]:
        """Return the row matching the given product_id, regardless of status.

        Raises ValueError if no row with that ID exists, so the caller can
        surface a clear error (e.g. a mistyped ID) instead of silently doing nothing.
        """
        values = self._get_all_rows()
        for i, row in enumerate(values):
            pid = row[COLUMN_MAP["product_id"]] if len(row) > COLUMN_MAP["product_id"] else ""
            if pid.strip() == product_id.strip():
                return self._row_to_dict(i + 2, row)
        raise ValueError(f"No row found with product_id='{product_id}'")

    def mark_as_posted(self, row_number: int) -> None:
        """Write 'posted' + timestamp into the status/posted_at columns for a row."""
        now = datetime.datetime.utcnow().isoformat()
        body = {"values": [["posted", now]]}
        status_col = chr(ord("A") + COLUMN_MAP["status"])
        posted_at_col = chr(ord("A") + COLUMN_MAP["posted_at"])
        self.service.spreadsheets().values().update(
            spreadsheetId=self.spreadsheet_id,
            range=f"telegram_bot!{status_col}{row_number}:{posted_at_col}{row_number}",
            valueInputOption="RAW",
            body=body,
        ).execute()

    def mark_telegram_posted(self, row_number: int) -> None:
        """Checkpoint Telegram success so a Bale retry does not repost Telegram."""
        status_col = chr(ord("A") + COLUMN_MAP["status"])
        self.service.spreadsheets().values().update(
            spreadsheetId=self.spreadsheet_id,
            range=f"telegram_bot!{status_col}{row_number}",
            valueInputOption="RAW",
            body={"values": [["telegram_posted"]]},
        ).execute()
