"""Minimal wrapper around Bale's Bot API."""

from __future__ import annotations

import requests


class BaleClient:
    def __init__(self, bot_token: str, channel_id: str):
        self.base_url = f"https://tapi.bale.ai/bot{bot_token}"
        self.channel_id = channel_id

    @staticmethod
    def _validated_json(response: requests.Response) -> dict:
        response.raise_for_status()
        payload = response.json()
        if not payload.get("ok", False):
            description = payload.get("description", "Unknown Bale API error")
            error_code = payload.get("error_code", "unknown")
            raise RuntimeError(f"Bale API error {error_code}: {description}")
        return payload

    def send_photo(self, photo_bytes: bytes, caption: str) -> dict:
        response = requests.post(
            f"{self.base_url}/sendPhoto",
            data={"chat_id": self.channel_id, "caption": caption},
            files={"photo": ("image.jpg", photo_bytes, "image/jpeg")},
            timeout=60,
        )
        return self._validated_json(response)

    def send_message(self, text: str) -> dict:
        response = requests.post(
            f"{self.base_url}/sendMessage",
            data={"chat_id": self.channel_id, "text": text},
            timeout=30,
        )
        return self._validated_json(response)
