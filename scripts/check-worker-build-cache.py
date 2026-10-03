"""Build twice with a local source edit; assert dependency layers stay cached.

Run: python3 scripts/check-worker-build-cache.py
Uses the host's Docker architecture. On Apple silicon, this checks layering and
local imports without installing the x86-only CUDA dependencies.
"""
import re
import shutil
import subprocess
import tempfile
from pathlib import Path

root = Path(__file__).resolve().parents[1]
image = 'partyroom-stem-cache-check'


def build(context):
    result = subprocess.run(
        ['docker', 'build', '--progress=plain', '-f', 'apps/stem-worker/Dockerfile.nvidia',
         '-t', image, str(context)], cwd=context, capture_output=True, text=True,
    )
    assert result.returncode == 0, result.stdout + result.stderr
    return result.stdout + result.stderr


with tempfile.TemporaryDirectory(prefix='partyroom-cache-check-') as directory:
    context = Path(directory)
    for relative in ('apps/stem-worker', 'packages/activity-worker-python'):
        shutil.copytree(root / relative, context / relative,
                        ignore=shutil.ignore_patterns('.venv', '__pycache__', '.pytest_cache'))
    build(context)
    # Change only the isolated build context, never the repository's source.
    source = context / 'packages/activity-worker-python/partyroom_activity_worker/__init__.py'
    source.write_text(source.read_text() + '\n# Cache regression check.\n')
    output = build(context)
    headers = dict(re.findall(r'^#(\d+) \[[^\]]+\] (.+)$', output, re.M))
    cached = set(re.findall(r'^#(\d+) CACHED$', output, re.M))
    for fragment in ('--no-install-package partyroom-activity-worker',
                     'COPY --from=dependencies /workspace/apps/stem-worker/.venv'):
        steps = [step for step, text in headers.items() if fragment in text]
        assert steps and all(step in cached for step in steps), output
    local = [step for step, text in headers.items() if '--link-mode=copy' in text]
    assert local and all(step not in cached for step in local), output
    subprocess.run(
        ['docker', 'run', '--rm', '--network=none', image, 'python3', '-c',
         'import partyroom_activity_worker; '
         'from importlib.metadata import version; '
         'assert version("partyroom-activity-worker") == "0.1.0"'], check=True,
    )
print('PASS: source edit reuses dependency install and environment copy; local package imports.')
