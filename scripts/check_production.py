"""Read-only production topology/readiness smoke test; run on the Docker host."""
import argparse
import json
import re
import subprocess
import urllib.request

SERVICES = ("web", "backend", "dashboard", "media-worker", "stem-worker", "lyrics-worker", "metadata-worker", "annotations-worker")
JOBS = ("backend-deploy", "queue-release")


def check_containers(containers, resource):
    # Compose project IDs change per deploy. Search across projects, including orphans.
    owned = [c for c in containers if any(
        c["Name"].lstrip("/").startswith(f"{service}-{resource}-")
        for service in SERVICES + JOBS
    )]
    running = [c for c in owned if c["State"]["Status"] == "running"]
    projects = set()
    for service in SERVICES:
        instances = [c for c in running if c["Config"]["Labels"].get("com.docker.compose.service") == service]
        if len(instances) != 1:
            names = ", ".join(c["Name"] for c in instances) or "none"
            raise ValueError(f"Expected one running {service}; found {len(instances)}: {names}")
        container = instances[0]
        if container["State"].get("Health", {}).get("Status") != "healthy":
            raise ValueError(f"Not healthy: {container['Name']}")
        project = container["Config"]["Labels"].get("com.docker.compose.project")
        if not project:
            raise ValueError(f"Missing Compose project: {container['Name']}")
        projects.add(project)
    if len(projects) != 1:
        raise ValueError("Production services span multiple Compose projects")
    project = projects.pop()
    for service in JOBS:
        jobs = [c for c in owned if c["Config"]["Labels"].get("com.docker.compose.project") == project
                and c["Config"]["Labels"].get("com.docker.compose.service") == service]
        if len(jobs) != 1 or jobs[0]["State"]["Status"] != "exited" or jobs[0]["State"].get("ExitCode") != 0:
            raise ValueError(f"{service} must have completed successfully in the active project")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("resource", help="Coolify application UUID, not a Compose project ID")
    parser.add_argument("--origin", required=True, help="Public web origin, e.g. https://partyroom.lol")
    args = parser.parse_args()
    if not re.fullmatch(r"[a-z0-9]+", args.resource):
        parser.error("Invalid Coolify application UUID")
    ids = subprocess.check_output(
        ["docker", "ps", "-aq", "--filter", f"name=-{args.resource}-"], text=True, timeout=15,
    ).split()
    if not ids:
        raise ValueError("No production containers found")
    # Inspect output includes secrets; keep it in memory and print only readiness results.
    containers = json.loads(subprocess.check_output(["docker", "inspect", *ids], text=True, timeout=15))
    check_containers(containers, args.resource)
    print("PASS: one healthy stack; deployment jobs exited 0")
    origin = args.origin.rstrip("/")
    for path in ("/login", "/api/auth/get-session"):
        with urllib.request.urlopen(origin + path, timeout=15) as response:
            if response.status != 200 or response.url != origin + path:
                raise ValueError(f"Unexpected status or redirect for {path}")
            body = response.read()
            if path == "/login" and b'type="password"' not in body:
                raise ValueError("Login form did not render")
            if path == "/api/auth/get-session" and json.loads(body) is not None:
                raise ValueError("Anonymous session endpoint returned unexpected data")
    print("PASS: public login and session endpoints")


if __name__ == "__main__":
    main()
