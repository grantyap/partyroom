"""Pin a commit, queue its deployment, and verify the result."""
import json
import os
import re
import sys
import urllib.request

from check_coolify_deployment import wait_for_deployment


def release(request, app_id, commit):
    if not re.fullmatch(r"[a-z0-9]+", app_id) or not re.fullmatch(r"[0-9a-f]{40}", commit):
        raise ValueError("Invalid application UUID or commit")
    path = f"/applications/{app_id}"
    app = request("GET", path, "read")
    if app.get("git_branch") != "main" or app.get("settings", {}).get("is_auto_deploy_enabled") is not False:
        raise ValueError("Application must track main with automatic Git deployments disabled")
    request("PATCH", path, "write", {"git_commit_sha": commit})
    if request("GET", path, "read").get("git_commit_sha") != commit:
        raise ValueError("Coolify did not retain the requested commit")
    result = request("POST", f"/deploy?uuid={app_id}", "deploy")
    deployments = result.get("deployments", [])
    if len(deployments) != 1 or deployments[0].get("resource_uuid") != app_id:
        raise ValueError("Coolify did not return one matching deployment")
    deployment_id = deployments[0].get("deployment_uuid", "")
    if not re.fullmatch(r"[a-z0-9]+", deployment_id):
        raise ValueError("Coolify returned an invalid deployment UUID")
    print(f"Queued deployment {deployment_id} for commit {commit}", flush=True)
    wait_for_deployment(lambda uuid: request("GET", f"/deployments/{uuid}", "read"),
                        deployment_id, commit, timeout=1800, interval=5)
    print(f"PASS: deployment {deployment_id} finished at commit {commit}")


def main():
    base_url = os.environ["COOLIFY_URL"].rstrip("/")
    if not base_url.startswith("https://"):
        raise ValueError("COOLIFY_URL must use HTTPS")
    tokens = {name: os.environ[f"COOLIFY_{name.upper()}_TOKEN"] for name in ("read", "write", "deploy")}

    def request(method, path, permission, data=None):
        body = json.dumps(data).encode() if data is not None else None
        req = urllib.request.Request(f"{base_url}/api/v1{path}", data=body, method=method,
                                     headers={"Authorization": f"Bearer {tokens[permission]}",
                                              "Accept": "application/json", "Content-Type": "application/json"})
        with urllib.request.urlopen(req, timeout=15) as response:
            return json.load(response)

    release(request, os.environ["COOLIFY_APPLICATION_UUID"], os.environ["RELEASE_SHA"])


if __name__ == "__main__":
    try:
        main()
    except (ValueError, TimeoutError, OSError, KeyError, TypeError):
        print("Coolify release failed; inspect configuration and deployment status", file=sys.stderr)
        sys.exit(1)
