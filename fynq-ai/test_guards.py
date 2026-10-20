"""python -m unittest fynq-ai/test_guards.py  (stdlib only)"""
import os
import sys
import unittest

sys.path.insert(0, os.path.dirname(__file__))
from guards import bearer_matches, contains_ssn  # noqa: E402


class SsnGuard(unittest.TestCase):
    def test_blocks_common_ssn_formats(self):
        for text in ["my ssn is 123-45-6789", "123 45 6789 please", "ssn:123456789"]:
            self.assertTrue(contains_ssn(text), text)

    def test_allows_ordinary_questions(self):
        for text in ["What is SAI?", "My Pell Grant is $7,395 for 2026-27", "Call 555-1234", ""]:
            self.assertFalse(contains_ssn(text), text)

    def test_regression_double_escaped_pattern_never_matched(self):
        # The original serve.py used r"\\b\\d{3}..." which only matches literal backslashes.
        import re
        self.assertIsNone(re.search(r"\\b\\d{3}[- ]?\\d{2}[- ]?\\d{4}\\b", "123-45-6789"))


class BearerCheck(unittest.TestCase):
    def test_matches_only_the_configured_secret(self):
        self.assertTrue(bearer_matches("Bearer s3cret", "s3cret"))
        self.assertFalse(bearer_matches("Bearer wrong", "s3cret"))
        self.assertFalse(bearer_matches("s3cret", "s3cret"))

    def test_no_secret_configured_rejects_everything(self):
        self.assertFalse(bearer_matches("Bearer ", ""))
        self.assertFalse(bearer_matches("", ""))


if __name__ == "__main__":
    unittest.main()
