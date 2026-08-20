"""
Minimal wrapper around the Telegram Bot API's sendPhoto method.
No external Telegram library needed -- plain HTTP is enough for this use case.
"""

from __future__ import annotations
import json
import requests


class TelegramClient:
    def __init__(self, bot_token: str, channel_id: str):
        self.base_url = f"https://api.telegram.org/bot{bot_token}"
        self.channel_id = channel_id

    @staticmethod
    def _validated_json(response: requests.Response) -> dict:
        response.raise_for_status()
        payload = response.json()
        if not payload.get("ok", False):
            description = payload.get("description", "Unknown Telegram API error")
            error_code = payload.get("error_code", "unknown")
            raise RuntimeError(f"Telegram API error {error_code}: {description}")
        return payload

    def send_photo(self, photo_bytes: bytes, caption: str) -> dict:
        response = requests.post(
            f"{self.base_url}/sendPhoto",
            data={
                "chat_id": self.channel_id,
                "caption": caption,
                "parse_mode": "HTML",
            },
            files={"photo": ("image.jpg", photo_bytes)},
            timeout=60,
        )
        return self._validated_json(response)

    def send_message(self, text: str, reply_markup: dict | None = None) -> dict:
        """Used for error notifications to yourself / an admin chat."""
        data = {"chat_id": self.channel_id, "text": text}
        if reply_markup is not None:
            data["reply_markup"] = json.dumps(reply_markup, ensure_ascii=False)
        response = requests.post(
            f"{self.base_url}/sendMessage",
            data=data,
            timeout=30,
        )
        return self._validated_json(response)
