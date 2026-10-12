r"""One-time complimentary Stripe import; keep the private CSV and credentials out of Git.

From the repository root:
    python3 scripts/import-early-access.py '/path/to/Form Responses 1.csv'
    python3 scripts/import-early-access.py '/path/to/Form Responses 1.csv' --apply

Dry run is the default; --apply requires a sandbox Stripe price. Live import is separate:
    python3 scripts/import-early-access.py '/path/to/Form Responses 1.csv' --apply --live \
        --env-file /path/to/production-connection.env

The connection file supplies CONVEX_SELF_HOSTED_URL and CONVEX_SELF_HOSTED_ADMIN_KEY.
The Stripe key stays in Convex; recipients are sent over stdin, not command-line arguments.
Retries skip existing grants, including canceled ones; duplicate Stripe customers require review.
"""
import argparse
import csv
import json
from pathlib import Path
import re
import subprocess

parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
parser.add_argument("csv", type=Path)
parser.add_argument("--apply", action="store_true", help="Import into the configured Convex/Stripe sandbox")
parser.add_argument("--live", action="store_true", help="Explicitly require a live Stripe price")
parser.add_argument("--env-file", default=".env.local", help="Convex CLI connection file in packages/backend")
args = parser.parse_args()

with args.csv.open(encoding="utf-8-sig", newline="") as source:
    reader = csv.DictReader(source)
    if not reader.fieldnames or "Email Address" not in reader.fieldnames:
        parser.error("CSV must contain an Email Address column")
    recipients = {}
    for row_number, row in enumerate(reader, 2):
        email = (row.get("Email Address") or "").strip().lower()
        if not re.fullmatch(r"[^\s@]+@[^\s@]+\.[^\s@]+", email):
            parser.error(f"Invalid or missing email at CSV row {row_number}")
        recipients[email] = {"email": email, "name": (row.get("Name") or "").strip()}

print(f"{len(recipients)} unique recipients; target: {'live' if args.live else 'sandbox'}.")
if args.apply:
    backend = Path(__file__).resolve().parents[1] / "packages" / "backend"
    values = list(recipients.values())
    for offset in range(0, len(values), 100):
        result = subprocess.run(
            ["bun", "--env-file", args.env_file, "-e", """
import { ConvexHttpClient } from 'convex/browser';
import { makeFunctionReference } from 'convex/server';
const { CONVEX_SELF_HOSTED_URL: url, CONVEX_SELF_HOSTED_ADMIN_KEY: key } = process.env;
if (!url || !key) throw new Error('Configure the self-hosted Convex URL and admin key');
const client = new ConvexHttpClient(url);
client.setAdminAuth(key);
console.log(await client.function(makeFunctionReference('billingStripe:importEarlyAccess'), undefined, JSON.parse(await Bun.stdin.text())));
"""],
            cwd=backend,
            input=json.dumps({"recipients": values[offset:offset + 100], "expectedLivemode": args.live}),
            text=True,
        )
        if result.returncode:
            raise SystemExit(result.returncode)
else:
    print("Dry run only. Add --apply to import; add --live only for the production import.")
