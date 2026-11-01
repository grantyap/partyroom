#!/usr/bin/env python3
"""Exercise only the local Mailpit receiver with disposable synthetic messages."""
import json
import smtplib
import sys
import time
import urllib.error
import urllib.request
import uuid
from email.message import EmailMessage
from datetime import datetime, timezone

HOST = '127.0.0.1'
API = f'http://{HOST}:8025/api/v1'
SENDER = 'qa@partyroom.test'


def api(path):
    with urllib.request.urlopen(API + path, timeout=3) as response:
        return json.load(response)


def matches(summary, subjects, recipient, started):
    received = datetime.fromisoformat(summary['Created'].replace('Z', '+00:00'))
    return (summary['Subject'] in subjects and received >= started
            and summary['From']['Address'] == SENDER
            and [a['Address'] for a in summary['To']] == [recipient])


def main():
    run = uuid.uuid4().hex
    recipient = f'{run}@partyroom.test'
    subjects = [f'Verify {run}', f'Reset {run}']
    started = datetime.now(timezone.utc)
    with smtplib.SMTP(HOST, 1025, timeout=3) as smtp:
        for subject in [*subjects, f'Unrelated {run}']:
            msg = EmailMessage()
            msg['From'], msg['To'], msg['Subject'] = SENDER, recipient, subject
            msg.set_content(f'Synthetic message {run}; no credentials or links.')
            smtp.send_message(msg)
    deadline = time.monotonic() + 15
    found = {}
    while time.monotonic() < deadline:
        for summary in api('/messages')['messages'] or []:
            if not matches(summary, subjects, recipient, started):
                continue
            message = api('/message/' + summary['ID'])
            if f'Synthetic message {run}; no credentials or links.' not in message['Text']:
                raise RuntimeError('Captured message content did not match')
            found[summary['Subject']] = summary['ID']
        if len(found) == 2:
            print('Mailpit captured both correlated synthetic messages.')
            return
        time.sleep(0.25)
    raise RuntimeError('Timed out waiting for both correlated messages')


if __name__ == '__main__':
    try:
        main()
    except (OSError, RuntimeError, KeyError, ValueError, urllib.error.URLError) as exc:
        print(f'Mailpit smoke failed: {exc}. Start the local mailpit service and check its health.', file=sys.stderr)
        sys.exit(1)
