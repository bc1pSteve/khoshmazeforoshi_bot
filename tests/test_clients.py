import unittest
import sys
from unittest.mock import Mock, patch

# Keep unit tests offline and independent from locally installed packages.
sys.modules.setdefault("requests", Mock())

from src.bale_client import BaleClient
from src.caption_formatter import build_bale_caption, build_caption


class CaptionFormatterTests(unittest.TestCase):
    def test_platform_specific_formatting_keeps_same_content(self):
        telegram = build_caption("توضیحات", "https://example.com", "عنوان")
        bale = build_bale_caption("توضیحات", "https://example.com", "عنوان")

        self.assertEqual(
            telegram,
            "<b>عنوان</b>\n\nتوضیحات\n\n🔗 https://example.com",
        )
        self.assertEqual(
            bale,
            "*عنوان*\n\nتوضیحات\n\n🔗 https://example.com",
        )


class BaleClientTests(unittest.TestCase):
    @patch("src.bale_client.requests.post")
    def test_send_photo_uses_bale_api_and_multipart_upload(self, post: Mock):
        response = Mock()
        response.json.return_value = {"ok": True, "result": {"message_id": 1}}
        post.return_value = response

        result = BaleClient("secret", "@channel").send_photo(b"image", "caption")

        self.assertTrue(result["ok"])
        args, kwargs = post.call_args
        self.assertEqual(args[0], "https://tapi.bale.ai/botsecret/sendPhoto")
        self.assertEqual(kwargs["data"], {"chat_id": "@channel", "caption": "caption"})
        self.assertEqual(kwargs["files"]["photo"][1], b"image")

    @patch("src.bale_client.requests.post")
    def test_api_level_error_is_not_treated_as_success(self, post: Mock):
        response = Mock()
        response.json.return_value = {
            "ok": False,
            "error_code": 400,
            "description": "bad request",
        }
        post.return_value = response

        with self.assertRaisesRegex(RuntimeError, "bad request"):
            BaleClient("secret", "@channel").send_photo(b"image", "caption")


if __name__ == "__main__":
    unittest.main()
