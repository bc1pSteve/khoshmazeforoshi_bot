"""
Downloads image files from Google Drive by file ID, using the same
service account used for Sheets (make sure the service account has
at least Viewer access to the Drive folder / files).
"""

from __future__ import annotations
import io
import re

from google.oauth2 import service_account
from googleapiclient.discovery import build
from googleapiclient.http import MediaIoBaseDownload

SCOPES = ["https://www.googleapis.com/auth/drive.readonly"]


def extract_file_id(value: str) -> str:
    """Accepts either a bare Drive file ID or a full Drive URL and
    always returns just the file ID.

    Handles the common URL shapes:
        https://drive.google.com/file/d/FILE_ID/view?usp=sharing
        https://drive.google.com/open?id=FILE_ID
        https://drive.google.com/uc?id=FILE_ID
    """
    value = (value or "").strip()

    match = re.search(r"/d/([a-zA-Z0-9_-]+)", value)
    if match:
        return match.group(1)

    match = re.search(r"[?&]id=([a-zA-Z0-9_-]+)", value)
    if match:
        return match.group(1)

    # Not a URL -- assume it's already a bare file ID.
    return value


class DriveClient:
    def __init__(self, service_account_file: str):
        creds = service_account.Credentials.from_service_account_file(
            service_account_file, scopes=SCOPES
        )
        self.service = build("drive", "v3", credentials=creds)

    def download_file(self, file_id: str) -> bytes:
        file_id = extract_file_id(file_id)
        request = self.service.files().get_media(fileId=file_id)
        buffer = io.BytesIO()
        downloader = MediaIoBaseDownload(buffer, request)
        done = False
        while not done:
            _, done = downloader.next_chunk()
        buffer.seek(0)
        return buffer.read()
