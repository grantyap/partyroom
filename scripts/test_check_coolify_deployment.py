import unittest
import io
from unittest.mock import patch

from check_coolify_deployment import main, wait_for_deployment


class DeploymentCheckTest(unittest.TestCase):
    def check(self, states, expected="a" * 40, timeout=5):
        now = [0]
        iterator = iter(states)
        return wait_for_deployment(
            lambda _: next(iterator), "abc123", expected, timeout=timeout, interval=1,
            clock=lambda: now[0], sleep=lambda seconds: now.__setitem__(0, now[0] + seconds),
        )

    def test_queued_then_finished_at_expected_commit(self):
        self.check([{"deployment_uuid": "abc123", "status": "queued"},
                    {"deployment_uuid": "abc123", "status": "finished", "commit": "a" * 40}])

    def test_rejects_mismatch_and_failure(self):
        for state in (
            {"deployment_uuid": "abc123", "status": "finished", "commit": "b" * 40},
            {"deployment_uuid": "abc123", "status": "failed"},
            {"deployment_uuid": "other", "status": "finished", "commit": "a" * 40},
        ):
            with self.subTest(state=state), self.assertRaises(ValueError):
                self.check([state])

    def test_timeout(self):
        with self.assertRaises(TimeoutError):
            self.check([{"deployment_uuid": "abc123", "status": "in_progress"}] * 5)

    def test_api_uses_a_user_agent_accepted_by_cloudflare(self):
        response = io.BytesIO(b'{"deployment_uuid":"abc123","status":"finished","commit":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"}')
        with patch.dict("os.environ", {"COOLIFY_URL": "https://example.com", "COOLIFY_TOKEN": "token"}), \
             patch("sys.argv", ["check", "abc123", "a" * 40]), \
             patch("urllib.request.urlopen", return_value=response) as urlopen:
            main()
        self.assertEqual(urlopen.call_args.args[0].get_header("User-agent"), "Mozilla/5.0")


if __name__ == "__main__":
    unittest.main()
