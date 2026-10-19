import os
import unittest
from unittest.mock import patch

from partyroom_activity_worker import locked_process_command


class ProcessLockTest(unittest.TestCase):
    def test_preserves_command_without_a_lock(self):
        with patch.dict(os.environ, {}, clear=True):
            self.assertEqual(locked_process_command("python3", "-m", "app"), ("python3", "-m", "app"))

    def test_lock_executes_the_tracked_child_without_an_extra_parent(self):
        with patch.dict(os.environ, {"ACTIVITY_PROCESS_LOCK_PATH": "/shared/model.lock"}):
            self.assertEqual(
                locked_process_command("python3", "-m", "app"),
                ("flock", "--no-fork", "/shared/model.lock", "python3", "-m", "app"),
            )
