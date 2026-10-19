import os
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import AsyncMock, Mock, patch

from app.separator_runtime import SeparatorRuntime


class SeparatorRuntimeTest(unittest.IsolatedAsyncioTestCase):
    async def separate(self, keep_warm):
        with patch.dict(os.environ, {"STEM_KEEP_MODEL_WARM": keep_warm}):
            runtime = SeparatorRuntime()
        runtime._process = SimpleNamespace(
            stdin=SimpleNamespace(write=Mock(), drain=AsyncMock())
        )
        runtime._ensure_started = AsyncMock()
        runtime._read_event = AsyncMock(return_value={"type": "complete"})
        runtime.stop = AsyncMock()
        await runtime.separate(SimpleNamespace(), Path("vocals.wav"), Path("output"))
        return runtime

    async def test_releases_model_when_keep_warm_is_disabled(self):
        runtime = await self.separate("false")
        runtime.stop.assert_awaited_once()

    async def test_preserves_warm_model_when_enabled(self):
        runtime = await self.separate("true")
        runtime.stop.assert_not_awaited()

    async def test_stops_model_on_cancellation(self):
        runtime = SeparatorRuntime()
        runtime._ensure_started = AsyncMock(side_effect=BaseException("cancelled"))
        runtime.stop = AsyncMock()
        with self.assertRaisesRegex(BaseException, "cancelled"):
            await runtime.separate(SimpleNamespace(), Path("vocals.wav"), Path("output"))
        runtime.stop.assert_awaited()
