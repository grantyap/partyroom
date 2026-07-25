import os
import unittest
from unittest.mock import patch

from app.settings import positive_int_setting


class SettingsTest(unittest.TestCase):
    def test_uses_default_and_environment_override(self) -> None:
        with patch.dict(os.environ, {}, clear=True):
            self.assertEqual(positive_int_setting("TOKEN_LIMIT", 1024), 1024)
        with patch.dict(os.environ, {"TOKEN_LIMIT": "512"}):
            self.assertEqual(positive_int_setting("TOKEN_LIMIT", 1024), 512)

    def test_rejects_non_positive_values(self) -> None:
        with patch.dict(os.environ, {"TOKEN_LIMIT": "0"}):
            with self.assertRaisesRegex(ValueError, "must be a positive integer"):
                positive_int_setting("TOKEN_LIMIT", 1024)


if __name__ == "__main__":
    unittest.main()
