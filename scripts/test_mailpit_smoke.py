import importlib.util
import unittest
from datetime import datetime, timedelta, timezone
from pathlib import Path

spec = importlib.util.spec_from_file_location('mailpit_smoke', Path(__file__).with_name('mailpit-smoke.py'))
smoke = importlib.util.module_from_spec(spec)
spec.loader.exec_module(smoke)


class MatchingTest(unittest.TestCase):
    def test_only_fresh_exact_messages_match(self):
        now = datetime.now(timezone.utc)
        summary = {'Created': now.isoformat(), 'Subject': 'Verify',
                   'From': {'Address': smoke.SENDER}, 'To': [{'Address': 'run@partyroom.test'}]}
        def matches(item):
            return smoke.matches(item, ['Verify', 'Reset'], 'run@partyroom.test', now)
        self.assertTrue(matches(summary))
        for change in (
            {'Created': (now - timedelta(seconds=1)).isoformat()},
            {'Subject': 'Unrelated'},
            {'From': {'Address': 'other@partyroom.test'}},
            {'To': [{'Address': 'other@partyroom.test'}]},
        ):
            with self.subTest(change=change):
                self.assertFalse(matches({**summary, **change}))


if __name__ == '__main__':
    unittest.main()
