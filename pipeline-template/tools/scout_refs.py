#!/usr/bin/env python3
"""scout_refs.py · find reference images for one thing the prompt needs, through the Supacomputah browser panel.

    python tools/scout_refs.py --for "@morning_table" --query "walnut table morning window light interior" --count 3 --job jobs/2026-09-26-mug
    python tools/scout_refs.py --for "@mug" --query "matte black ceramic mug product photo" --count 2 --exclude ref-01-a1b2c3.jpg

What happens: the app opens its own Chrome in the side panel, looks on Pinterest, Google Images and Bing the
way a person would (scroll, hover, open a pin), saves the pictures it found into the job's refs/scout folder
and shows them to the user with Approve / Keep searching buttons. This script prints the saved files and
exits. It does NOT wait for the user: end your turn and ask which to keep; the user's choice comes back as
their next message (which files to use, which to drop, whether to keep searching).

Needs the app running (it sets SUPACOMPUTA_CHAT and SUPACOMPUTA_URL in the environment). Exit codes:
0 found some · 2 nothing found or stopped by the user · 3 not running inside Supacomputah · 4 the app refused.
"""
import argparse
import json
import os
import sys
import urllib.error
import urllib.request


def main():
    ap = argparse.ArgumentParser(description="scout reference images through the Supacomputah browser panel")
    ap.add_argument("--for", dest="label", required=True, help="what these references are for, e.g. @morning_table or 'the mug'")
    ap.add_argument("--query", required=True, help="the search phrase a person would type")
    ap.add_argument("--count", type=int, default=6, help="how many to bring back (1-10); spread evenly over the sites")
    ap.add_argument("--sites", default="pinterest,pexels,google", help="comma list, visited in turn with a share each: pinterest, pexels, google, bing, unsplash")
    ap.add_argument("--exclude", action="append", default=[], help="file name or URL never to show again (repeatable)")
    ap.add_argument("--job", default="", help="this chat's job (jobs/<name> or <name>); the files go to its refs/scout folder")
    ap.add_argument("--out", default="", help="folder for the files; default jobs/<job>/refs/scout or refs-inbox/<chat>")
    a = ap.parse_args()

    chat = os.environ.get("SUPACOMPUTA_CHAT")
    base = os.environ.get("SUPACOMPUTA_URL", "http://127.0.0.1:8797")
    if not chat:
        print("not running inside Supacomputah: SUPACOMPUTA_CHAT is not set", file=sys.stderr)
        return 3
    body = {"chatId": chat, "label": a.label, "query": a.query, "count": max(1, min(10, a.count)),
            "sites": [s.strip() for s in a.sites.split(",") if s.strip()], "exclude": a.exclude, "out": a.out, "job": a.job}
    req = urllib.request.Request(base + "/api/scout/run", data=json.dumps(body).encode("utf-8"),
                                 headers={"content-type": "application/json"}, method="POST")
    try:
        with urllib.request.urlopen(req, timeout=170) as r:
            res = json.loads(r.read().decode("utf-8"))
    except urllib.error.HTTPError as e:
        try:
            msg = json.loads(e.read().decode("utf-8")).get("error", "")
        except Exception:
            msg = ""
        print(f"the app refused the scout ({e.code}): {msg}", file=sys.stderr)
        return 4
    except Exception as e:  # noqa: BLE001
        print(f"could not reach the app: {e}", file=sys.stderr)
        return 4

    items = res.get("items", [])
    if not items:
        print("stopped by the user before anything was found" if res.get("stopped") else "nothing usable found; try a different query or site")
        return 2
    print(f"found {len(items)} of {body['count']} for {a.label} (query: {a.query}){' · stopped early by the user' if res.get('stopped') else ''}")
    for it in items:
        print(f"  {it['n']}. {it['path']}  ({it['source']}{' · ' + it['title'] if it.get('title') else ''})")
    print("shown to the user in the side panel with Approve / Keep searching. Scout the next thing if there is one, then end your"
          " turn and ask which to keep; the answer arrives as the next message with ready-made --ref flags for gen_image.py.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
