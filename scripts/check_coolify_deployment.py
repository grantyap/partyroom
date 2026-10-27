"""Wait for one Coolify deployment and verify its commit without exposing its logs."""
import argparse
import json
import os
import re
import sys
import time
import urllib.request


def wait_for_deployment(fetch, deployment_id, expected_commit, *, timeout, interval, clock=time.monotonic, sleep=time.sleep):
    deadline = clock() + timeout
    while clock() < deadline:
        deployment = fetch(deployment_id)
        if deployment.get("deployment_uuid") != deployment_id:
            raise ValueError("Coolify returned a different deployment UUID")
        status = deployment.get("status")
        commit = deployment.get("commit")
        if status == "finished":
            if commit != expected_commit:
                raise ValueError("Completed deployment commit does not match requested commit")
            return
        if status not in ("queued", "in_progress"):
            raise ValueError(f"Deployment did not succeed (status: {status!r})")
        sleep(min(interval, max(0, deadline - clock())))
    raise TimeoutError("Timed out waiting for Coolify deployment")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("deployment_id")
    parser.add_argument("commit")
    parser.add_argument("--timeout", type=int, default=1800)
    args = parser.parse_args()
    if not re.fullmatch(r"[a-z0-9]+", args.deployment_id):
        parser.error("Invalid deployment UUID")
    if not re.fullmatch(r"[0-9a-f]{40}", args.commit):
        parser.error("Expected a full lowercase commit SHA")
    if args.timeout <= 0:
        parser.error("Timeout must be positive")
    base_url = os.environ["COOLIFY_URL"].rstrip("/")
    if not base_url.startswith("https://"):
        parser.error("COOLIFY_URL must use HTTPS")
    token = os.environ["COOLIFY_TOKEN"]

    def fetch(deployment_id):
        request = urllib.request.Request(
            f"{base_url}/api/v1/deployments/{deployment_id}",
            headers={"Authorization": f"Bearer {token}", "Accept": "application/json", "User-Agent": "Mozilla/5.0"},
        )
        with urllib.request.urlopen(request, timeout=15) as response:
            return json.load(response)

    wait_for_deployment(fetch, args.deployment_id, args.commit, timeout=args.timeout, interval=5)
    print(f"PASS: deployment {args.deployment_id} finished at commit {args.commit}")


if __name__ == "__main__":
    try:
        main()
    except (ValueError, TimeoutError, OSError, KeyError) as error:
        print(f"Deployment check failed: {error}", file=sys.stderr)
        sys.exit(1)
