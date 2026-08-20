import unittest
import sys
import json
import os
from unittest.mock import Mock, patch

# Keep unit tests offline and independent from locally installed packages.
sys.modules.setdefault("requests", Mock())
sys.modules.setdefault("google", Mock())
sys.modules.setdefault("google.oauth2", Mock())
sys.modules.setdefault("googleapiclient", Mock())
sys.modules.setdefault("googleapiclient.discovery", Mock())

from prepare_post import confirmation_markup, run as prepare_post
from src.bale_client import BaleClient
from src.caption_formatter import build_bale_caption, build_caption
from src.sheets_client import SheetsClient
from src.telegram_client import TelegramClient


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


class SheetsClientTests(unittest.TestCase):
    def make_client(self, rows):
        client = SheetsClient.__new__(SheetsClient)
        client._get_all_rows = Mock(return_value=rows)
        return client

    @patch("src.sheets_client.secrets.choice", side_effect=lambda rows: rows[0])
    def test_random_product_only_uses_never_posted_complete_rows(self, _choice: Mock):
        client = self.make_client([
            ["P001", "drive-1", "caption", "اول", "link", "posted"],
            ["P002", "drive-2", "caption", "دوم", "link", "telegram_posted"],
            ["P003", "drive-3", "caption", "سوم", "link", ""],
            ["P004", "", "caption", "بدون تصویر", "link", ""],
        ])

        row = client.get_random_unposted_row()

        self.assertEqual(row["product_id"], "P003")

    @patch("src.sheets_client.secrets.choice", side_effect=lambda rows: rows[0])
    def test_random_product_can_exclude_the_current_choice(self, _choice: Mock):
        client = self.make_client([
            ["P001", "drive-1", "caption", "اول", "link", ""],
            ["P002", "drive-2", "caption", "دوم", "link", ""],
        ])

        row = client.get_random_unposted_row("P001")

        self.assertEqual(row["product_id"], "P002")

    def test_random_product_returns_none_when_no_candidate_exists(self):
        client = self.make_client([
            ["P001", "drive-1", "caption", "اول", "link", "posted"],
            ["P002", "drive-2", "caption", "دوم", "link", "telegram_posted"],
        ])

        self.assertIsNone(client.get_random_unposted_row())


class TelegramClientTests(unittest.TestCase):
    @patch("src.telegram_client.requests.post")
    def test_send_message_serializes_inline_keyboard(self, post: Mock):
        response = Mock()
        response.json.return_value = {"ok": True, "result": {"message_id": 1}}
        post.return_value = response
        markup = confirmation_markup("P001")

        TelegramClient("secret", "42").send_message("تایید؟", markup)

        data = post.call_args.kwargs["data"]
        self.assertEqual(data["chat_id"], "42")
        self.assertEqual(json.loads(data["reply_markup"]), markup)
        self.assertEqual(
            [button["text"] for row in markup["inline_keyboard"] for button in row],
            ["تایید", "لغو", "انتخاب محصول دیگر"],
        )


class PreparePostTests(unittest.TestCase):
    @patch("prepare_post.TelegramClient")
    @patch("prepare_post.SheetsClient")
    def test_confirmation_uses_product_title_and_three_actions(
        self, sheets_class: Mock, telegram_class: Mock
    ):
        sheets_class.return_value.get_row_by_product_id.return_value = {
            "product_id": "P001",
            "title": "محصول تستی",
        }
        environment = {
            "SPREADSHEET_ID": "sheet-id",
            "GOOGLE_SERVICE_ACCOUNT_FILE": "service-account.json",
            "TELEGRAM_BOT_TOKEN": "token",
            "TELEGRAM_REQUEST_CHAT_ID": "42",
            "REQUESTED_PRODUCT_ID": "P001",
            "EXCLUDE_PRODUCT_ID": "",
        }

        with patch.dict(os.environ, environment, clear=True):
            prepare_post()

        text, = telegram_class.return_value.send_message.call_args.args
        markup = telegram_class.return_value.send_message.call_args.kwargs["reply_markup"]
        self.assertEqual(text, "آیا تایید می‌کنی محصول «محصول تستی» پست بشه؟")
        self.assertEqual(markup, confirmation_markup("P001"))

    @patch("prepare_post.TelegramClient")
    @patch("prepare_post.SheetsClient")
    def test_random_preparation_excludes_previous_product(
        self, sheets_class: Mock, telegram_class: Mock
    ):
        sheets_class.return_value.get_random_unposted_row.return_value = {
            "product_id": "P002",
            "title": "محصول دوم",
        }
        environment = {
            "SPREADSHEET_ID": "sheet-id",
            "GOOGLE_SERVICE_ACCOUNT_FILE": "service-account.json",
            "TELEGRAM_BOT_TOKEN": "token",
            "TELEGRAM_REQUEST_CHAT_ID": "42",
            "REQUESTED_PRODUCT_ID": "random",
            "EXCLUDE_PRODUCT_ID": "P001",
        }

        with patch.dict(os.environ, environment, clear=True):
            prepare_post()

        sheets_class.return_value.get_random_unposted_row.assert_called_once_with("P001")
        telegram_class.return_value.send_message.assert_called_once()


if __name__ == "__main__":
    unittest.main()
