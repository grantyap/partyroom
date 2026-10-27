import unittest

from release_coolify import release


class ReleaseTest(unittest.TestCase):
    def test_pin_before_queue_and_verify(self):
        calls = []
        def request(method, path, permission, data=None):
            calls.append((method, path, permission, data))
            if method == "PATCH":
                return {}
            if method == "POST":
                return {"deployments": [{"resource_uuid": "app123", "deployment_uuid": "deploy123"}]}
            if path.startswith("/deployments/"):
                return {"deployment_uuid": "deploy123", "status": "finished", "commit": "a" * 40}
            return {"git_branch": "main", "settings": {"is_auto_deploy_enabled": False}, "git_commit_sha": "a" * 40}
        release(request, "app123", "a" * 40)
        self.assertEqual([c[0] for c in calls], ["GET", "PATCH", "GET", "POST", "GET"])

    def test_rejects_enabled_webhook_before_mutating(self):
        calls = []
        def request(*args):
            calls.append(args)
            return {"git_branch": "main", "settings": {"is_auto_deploy_enabled": True}}
        with self.assertRaises(ValueError):
            release(request, "app123", "a" * 40)
        self.assertEqual(len(calls), 1)

    def test_rejects_unpinned_commit_before_deploy(self):
        calls = []
        def request(*args):
            calls.append(args)
            return {"git_branch": "main", "settings": {"is_auto_deploy_enabled": False}, "git_commit_sha": "HEAD"}
        with self.assertRaises(ValueError):
            release(request, "app123", "a" * 40)
        self.assertNotIn("POST", [c[0] for c in calls])


if __name__ == "__main__":
    unittest.main()
