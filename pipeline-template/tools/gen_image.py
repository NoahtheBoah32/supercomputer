# -*- coding: utf-8 -*-
"""One image generation, saved where you say. Renders through ElevenLabs (GPT Image 2), Higgsfield (Soul 2) or fal
(GPT Image 1.5) depending on --provider / the GEN_PROVIDER environment variable (default: elevenlabs).

    python tools/gen_image.py --job jobs/2026-09-22-clinic --item character-01-doctor --version 1 \
        --prompt-file jobs/2026-09-22-clinic/sheets/character-01-doctor/v1.prompt.txt \
        --aspect 3:2 --res 1K --quality high [--ref photo.jpg ...] [--out path.png] [--dry-run]

Paths are relative to the pipeline root (the folder holding this tools/ directory) or absolute.
If --out is omitted the image lands at <job>/sheets/<item>/v<version>.png, or, for items named
scene-NN-storyboard, at <job>/scenes/scene-NN/storyboard-v<version>.png.

Credits: the tool reads the account's used-credit counter (GET /v1/user/subscription, free) before
the request and again after the image lands, and logs the difference in the `credits` column of
log.csv. If the counter has not moved within ten seconds the row says 0 with the note
"credits: no delta reported" so the tally can flag it. The generation id is logged too.

Keys are loaded from, in order: the environment (ELEVENLABS_API_KEY, HIGGSFIELD_API_KEY as KEY_ID:KEY_SECRET,
FAL_KEY), a .env file in the pipeline root, then ../API-KEYS.local.md (a private file outside the repo). They are
never printed. Standard library only. The model per provider is fixed and cannot be changed from the command line.
Higgsfield and fal have no credit counter the tool can read: the credits column logs Higgsfield's own estimate for the
render, or 0 for fal with the USD unit price in the note.

Exit codes: 0 saved · 1 bad arguments or missing file · 4 request rejected (nothing charged) ·
5 generation failed (ElevenLabs: not charged; Higgsfield/fal: check the provider dashboard) · 6 poll timeout.
"""
import argparse, base64, csv, io, json, os, re, sys, time, urllib.request, urllib.error

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
BASE = "https://api.elevenlabs.io/v1"
MODEL = "gpt-image-2"
PROVIDERS = ["elevenlabs", "higgsfield", "fal"]
KEY_ENV = {"elevenlabs": "ELEVENLABS_API_KEY", "higgsfield": "HIGGSFIELD_API_KEY", "fal": "FAL_KEY"}
MODELS = {"elevenlabs": MODEL, "higgsfield": "higgsfield-ai/soul/v2/standard", "fal": "fal-ai/gpt-image-1.5"}
HF_BASE = "https://api.higgsfield.ai"
FAL_QUEUE = "https://queue.fal.run"
FAL_API = "https://api.fal.ai"
UA = "Supacomputah-pipeline/1.0"
ASPECTS = ["1:1", "3:2", "2:3", "16:9", "9:16", "4:3", "3:4", "21:9"]
RES = ["1K", "2K", "4K"]
QUALITY = ["low", "medium", "high"]


def load_key(provider="elevenlabs"):
    name = KEY_ENV[provider]
    k = os.environ.get(name)
    if k:
        return k.strip()
    for path in (os.path.join(ROOT, ".env"), os.path.join(os.path.dirname(ROOT), "API-KEYS.local.md")):
        if os.path.exists(path):
            for line in io.open(path, encoding="utf-8"):
                if line.startswith(name + "="):
                    v = line.split("=", 1)[1].strip().strip('"').strip("'")
                    if v:
                        return v
    sys.exit("no %s key: set %s (Supacomputah: Settings > %s key) or fill in .env" % (provider, name, provider))


def resolve(p):
    return p if os.path.isabs(p) else os.path.normpath(os.path.join(ROOT, p))


def b64ref(path):
    ext = os.path.splitext(path)[1].lower()
    mime = {".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".webp": "image/webp"}.get(ext)
    if not mime:
        sys.exit("reference must be png, jpg or webp: " + path)
    with open(path, "rb") as f:
        return {"type": "inline_base64", "content_base64": base64.b64encode(f.read()).decode(), "mime_type": mime}


def call(key, method, path, body=None, timeout=120):
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(BASE + path, data=data, method=method,
                                 headers={"xi-api-key": key, "Content-Type": "application/json"})
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            return r.status, json.loads(r.read().decode() or "{}")
    except urllib.error.HTTPError as e:
        txt = e.read().decode(errors="replace")
        try:
            txt = json.loads(txt)
        except ValueError:
            pass
        return e.code, txt


def http_json(method, url, headers, body=None, timeout=120):
    """JSON request for Higgsfield / fal. Returns (status, parsed-or-text). Never prints headers."""
    data = json.dumps(body).encode() if body is not None else None
    h = dict(headers)
    h["User-Agent"] = UA  # Cloudflare in front of api.higgsfield.ai bans the stock Python-urllib signature
    if data is not None:
        h["Content-Type"] = "application/json"
    req = urllib.request.Request(url, data=data, method=method, headers=h)
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            txt = r.read().decode() or "{}"
            try:
                return r.status, json.loads(txt)
            except ValueError:
                return r.status, txt
    except urllib.error.HTTPError as e:
        txt = e.read().decode(errors="replace")
        try:
            txt = json.loads(txt)
        except ValueError:
            pass
        return e.code, txt
    except (urllib.error.URLError, OSError) as e:
        return 0, "connection error: %s" % getattr(e, "reason", e)


def poll_until(fetch, done_states, deadline, first=2.0, cap=10.0):
    """Call fetch() until it returns a status in done_states or the deadline passes. Returns (status, body) or (None, body)."""
    interval = first
    while True:
        st, body = fetch()
        s = body.get("status") if isinstance(body, dict) else None
        if not 200 <= st < 300:  # fal answers 202 while a request is queued or running
            return "http-%s" % st, body
        if s in done_states:
            return s, body
        if time.time() > deadline:
            return None, body
        time.sleep(interval)
        interval = min(interval * 1.5, cap)


def data_uri(path):
    ref = b64ref(path)
    return "data:%s;base64,%s" % (ref["mime_type"], ref["content_base64"])


# ---------- Higgsfield (Soul 2) ----------
# Auth: "Authorization: Key KEY_ID:KEY_SECRET". Submit POST /<model>, poll GET /requests/<id>/status,
# result in images[0].url. References must be public URLs: uploaded first via /files/generate-upload-url.
HF_ASPECTS = {"1:1": "1:1", "16:9": "16:9", "9:16": "9:16", "4:3": "4:3", "3:4": "3:4", "21:9": "21:9", "3:2": "4:3", "2:3": "3:4"}


def hf_headers(key):
    return {"Authorization": "Key " + key, "Accept": "application/json"}


def hf_upload(key, path):
    mime = b64ref(path)["mime_type"]
    st, body = http_json("POST", HF_BASE + "/files/generate-upload-url", hf_headers(key), {"content_type": mime}, timeout=60)
    if st != 200 or not isinstance(body, dict) or "upload_url" not in body:
        return None, "upload url %s: %s" % (st, json.dumps(body)[:200] if not isinstance(body, str) else body[:200])
    with open(path, "rb") as f:
        data = f.read()
    hdrs = dict(body.get("upload_headers") or {})
    hdrs.setdefault("Content-Type", mime)
    hdrs.setdefault("User-Agent", UA)
    req = urllib.request.Request(body["upload_url"], data=data, method="PUT", headers=hdrs)
    try:
        with urllib.request.urlopen(req, timeout=300) as r:
            r.read()
    except urllib.error.HTTPError as e:
        return None, "upload failed %s" % e.code
    return body.get("public_url"), ""


def run_higgsfield(key, prompt, refs, aspect, res, quality):
    """Returns (ok, image_bytes_or_reason, gen_id, credits). Nothing is charged for failed/nsfw renders."""
    # the free estimate doubles as the auth probe, so a bad key fails here before any reference is uploaded
    est_st, est = http_json("POST", HF_BASE + "/estimate/" + MODELS["higgsfield"], hf_headers(key), {"prompt": prompt}, timeout=30)
    if est_st in (401, 403) or est_st == 0:
        return False, "rejected %s: %s" % (est_st, (json.dumps(est) if not isinstance(est, str) else est)[:300]), "", 0
    credits = 0
    if est_st == 200 and isinstance(est, dict):
        try:
            credits = float(est.get("credits") or 0)
        except (TypeError, ValueError):
            credits = 0
    urls = []
    for r in refs:
        u, err = hf_upload(key, r)
        if not u:
            return False, "rejected: reference " + os.path.basename(r) + " " + err, "", 0
        urls.append(u)
    body = {"prompt": prompt, "num_images": 1, "aspect_ratio": HF_ASPECTS.get(aspect, "16:9"),
            "resolution": "720p" if quality == "low" else "1080p", "quality": "premium" if quality == "high" else "standard"}
    if urls:
        body["image_urls"] = urls
    st, resp = http_json("POST", HF_BASE + "/" + MODELS["higgsfield"], hf_headers(key), body)
    if st != 200 or not isinstance(resp, dict) or "request_id" not in resp:
        return False, "rejected %s: %s" % (st, (json.dumps(resp) if not isinstance(resp, str) else resp)[:600]), "", 0
    gen_id = resp["request_id"]
    status_url = resp.get("status_url") or (HF_BASE + "/requests/%s/status" % gen_id)
    s, done = poll_until(lambda: http_json("GET", status_url, hf_headers(key), timeout=60), ("completed", "failed", "nsfw", "canceled"), time.time() + 30 * 60)
    if s is None:
        return False, "timeout", gen_id, 0
    if s != "completed":
        return False, "failed: %s" % (done.get("error") if isinstance(done, dict) else s), gen_id, 0
    imgs = done.get("images") or []
    if not imgs or not imgs[0].get("url"):
        return False, "failed: no image url in result", gen_id, 0
    return True, urllib.request.urlopen(imgs[0]["url"], timeout=300).read(), gen_id, credits


# ---------- fal (GPT Image 1.5) ----------
# Auth: "Authorization: Key FAL_KEY". Queue: POST https://queue.fal.run/<model>, poll the returned status_url,
# fetch response_url; images[0].url. References go in as data URIs (accepted by fal, fine at sheet sizes).
def fal_headers(key):
    return {"Authorization": "Key " + key, "Accept": "application/json"}


def fal_size(aspect):
    if aspect == "1:1":
        return "1024x1024"
    w, h = (int(x) for x in aspect.split(":"))
    return "1536x1024" if w > h else "1024x1536"


def run_fal(key, prompt, refs, aspect, res, quality):
    """Returns (ok, image_bytes_or_reason, gen_id, usd_note)."""
    model = MODELS["fal"] + ("/edit" if refs else "")
    body = {"prompt": prompt, "num_images": 1, "quality": quality, "image_size": fal_size(aspect), "output_format": "png"}
    if refs:
        body["image_urls"] = [data_uri(r) for r in refs]
        body["input_fidelity"] = "high"
    note = ""
    pst, price = http_json("GET", FAL_API + "/v1/models/pricing?endpoint_id=" + MODELS["fal"], fal_headers(key), timeout=30)
    if pst in (401, 403) or pst == 0:  # bad key or no network: say so before uploading references
        return False, "rejected %s: %s" % (pst, (json.dumps(price) if not isinstance(price, str) else price)[:300]), "", note
    if pst == 200 and isinstance(price, dict) and price.get("prices"):
        p0 = price["prices"][0]
        note = "fal ~$%s/%s" % (p0.get("unit_price"), p0.get("unit", "image"))
    st, resp = http_json("POST", FAL_QUEUE + "/" + model, fal_headers(key), body)
    if st not in (200, 201, 202) or not isinstance(resp, dict) or "request_id" not in resp:
        return False, "rejected %s: %s" % (st, (json.dumps(resp) if not isinstance(resp, str) else resp)[:600]), "", note
    gen_id = resp["request_id"]
    status_url = resp.get("status_url") or (FAL_QUEUE + "/%s/requests/%s/status" % (model, gen_id))
    response_url = resp.get("response_url") or (FAL_QUEUE + "/%s/requests/%s" % (model, gen_id))
    s, done = poll_until(lambda: http_json("GET", status_url, fal_headers(key), timeout=60), ("COMPLETED",), time.time() + 30 * 60)
    if s is None:
        return False, "timeout", gen_id, note
    if s != "COMPLETED":
        return False, "failed: %s" % (json.dumps(done)[:300] if not isinstance(done, str) else done[:300]), gen_id, note
    rst, result = http_json("GET", response_url, fal_headers(key), timeout=120)
    imgs = result.get("images") if isinstance(result, dict) else None
    if rst != 200 or not imgs or not imgs[0].get("url"):
        return False, "failed: result %s had no image (%s)" % (rst, (json.dumps(result) if not isinstance(result, str) else result)[:300]), gen_id, note
    return True, urllib.request.urlopen(imgs[0]["url"], timeout=300).read(), gen_id, note


def default_out(job, item, version):
    m = re.match(r"^(scene-\d\d)-([a-z]+)$", item)
    if m:
        return os.path.join(job, "scenes", m.group(1), "%s-v%d.png" % (m.group(2), version))
    return os.path.join(job, "sheets", item, "v%d.png" % version)


HEADER = ["run", "date", "time", "item", "version", "model", "prompt_file", "refs",
          "settings", "output", "status", "seconds", "note", "credits", "gen_id"]


def log_row(job, row):
    """Append one row. Upgrades an older log.csv (no credits/gen_id columns) in place."""
    logp = os.path.join(job, "log.csv")
    rows = []
    if os.path.exists(logp):
        with io.open(logp, encoding="utf-8", newline="") as f:
            rows = [r for r in csv.reader(f) if r]
    if rows and rows[0] != HEADER:
        rows = [HEADER] + [r + [""] * (len(HEADER) - len(r)) for r in rows[1:]]
        with io.open(logp, "w", encoding="utf-8", newline="") as f:
            csv.writer(f).writerows(rows)
    nums = [int(r[0]) for r in rows[1:] if r[0].isdigit()]
    run = (max(nums) + 1) if nums else 1
    row = row + [""] * (len(HEADER) - 1 - len(row))
    with io.open(logp, "a", encoding="utf-8", newline="") as f:
        w = csv.writer(f)
        if not rows:
            w.writerow(HEADER)
        w.writerow([run] + row)
    return run


def credits_used(key):
    """The account's used-credit counter, or None if the endpoint did not answer."""
    st, body = call(key, "GET", "/user/subscription", timeout=30)
    if st == 200 and isinstance(body, dict) and isinstance(body.get("character_count"), int):
        return body["character_count"]
    return None


def credits_delta(key, before):
    """Poll the counter for up to ten seconds after a generation; returns (delta, note)."""
    if before is None:
        return "", "credits: counter unavailable"
    for _ in range(5):
        after = credits_used(key)
        if after is not None and after != before:
            return after - before, ""
        time.sleep(2)
    return 0, "credits: no delta reported"


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--job", required=True, help="job folder, e.g. jobs/2026-09-22-clinic")
    ap.add_argument("--item", required=True, help="e.g. character-01-doctor or scene-01-still")
    ap.add_argument("--version", type=int, required=True)
    ap.add_argument("--prompt-file", required=True)
    ap.add_argument("--aspect", default="16:9", choices=ASPECTS)
    ap.add_argument("--res", default="1K", choices=RES)
    ap.add_argument("--quality", default="high", choices=QUALITY)
    ap.add_argument("--ref", action="append", default=[], help="reference image, repeatable, order kept (max 10)")
    ap.add_argument("--out", help="output png path; default follows FOLDER-PROTOCOL.md")
    ap.add_argument("--note", default="", help="free text for the log row")
    ap.add_argument("--dry-run", action="store_true", help="print the request (no base64) and send nothing")
    ap.add_argument("--provider", default=os.environ.get("GEN_PROVIDER", "elevenlabs"), choices=PROVIDERS,
                    help="which API renders it (default: GEN_PROVIDER env, else elevenlabs)")
    a = ap.parse_args()

    job = resolve(a.job)
    prompt_path = resolve(a.prompt_file)
    if not os.path.isdir(job):
        sys.exit("job folder not found: " + job)
    if not os.path.exists(prompt_path):
        sys.exit("prompt file not found: " + prompt_path)
    prompt = io.open(prompt_path, encoding="utf-8").read().strip()
    if not prompt:
        sys.exit("prompt file is empty: " + prompt_path)
    if len(a.ref) > 10:
        sys.exit("gpt-image-2 takes at most 10 reference images")
    refs = [resolve(r) for r in a.ref]
    for r in refs:
        if not os.path.exists(r):
            sys.exit("reference not found: " + r)
    out = resolve(a.out) if a.out else default_out(job, a.item, a.version)
    if os.path.exists(out):
        sys.exit("refusing to overwrite an existing version: " + out + "  (bump --version)")
    os.makedirs(os.path.dirname(out), exist_ok=True)

    body = {"model_id": MODEL, "prompt": prompt, "aspect_ratio": a.aspect, "resolution": a.res, "quality": a.quality}
    if refs:
        body["images"] = [("file", r) for r in refs]
    settings = "%s %s %s" % (a.aspect, a.res, a.quality)
    rel = lambda p: os.path.relpath(p, job).replace("\\", "/")
    model_name = MODELS[a.provider]
    if a.provider != "elevenlabs":
        body = {"provider": a.provider, "model": model_name, "prompt": prompt, "aspect_ratio": a.aspect, "quality": a.quality}

    if a.dry_run:
        shown = dict(body)
        shown["prompt"] = prompt[:200] + ("..." if len(prompt) > 200 else "")
        shown["images"] = ["<file %s>" % os.path.basename(r) for r in refs]
        print(json.dumps(shown, indent=2, ensure_ascii=False))
        print("would save:", out)
        return

    key = load_key(a.provider)
    t0 = time.time()
    if a.provider != "elevenlabs":
        runner = run_higgsfield if a.provider == "higgsfield" else run_fal
        ok, payload, gen_id, extra = runner(key, prompt, refs, a.aspect, a.res, a.quality)
        secs = int(time.time() - t0)
        if not ok:
            reason = str(payload)
            status = "rejected" if reason.startswith("rejected") else ("timeout" if reason == "timeout" else "failed")
            log_row(job, [time.strftime("%Y-%m-%d"), time.strftime("%H:%M:%S"), a.item, "v%d" % a.version, model_name,
                          rel(prompt_path), ";".join(rel(r) for r in refs), settings, "", status, secs, reason[:200], 0, gen_id])
            if status == "rejected":
                print("rejected (nothing charged), %s: %s" % (a.provider, reason[:600]))
                sys.exit(4)
            if status == "timeout":
                sys.exit(6)
            print("generation failed (%s): %s" % (a.provider, reason[:600]))
            sys.exit(5)
        with open(out, "wb") as f:
            f.write(payload)
        credits = extra if a.provider == "higgsfield" else 0
        note = (a.note + " " + (extra if a.provider == "fal" else "")).strip()
        run = log_row(job, [time.strftime("%Y-%m-%d"), time.strftime("%H:%M:%S"), a.item, "v%d" % a.version, model_name,
                            rel(prompt_path), ";".join(rel(r) for r in refs), settings, rel(out), "completed", secs, note, credits, gen_id])
        print("saved %s  (%d KB, %d s, run #%d, %s, credits: %s)" % (out, len(payload) // 1024, secs, run, a.provider, credits))
        return
    if refs:
        body["images"] = [b64ref(r) for r in refs]
    before = credits_used(key)
    status, resp = call(key, "POST", "/flows/image", body)
    if status != 200:
        msg = json.dumps(resp, ensure_ascii=False) if not isinstance(resp, str) else resp
        log_row(job, [time.strftime("%Y-%m-%d"), time.strftime("%H:%M:%S"), a.item, "v%d" % a.version, MODEL,
                      rel(prompt_path), ";".join(rel(r) for r in refs), settings, "", "rejected %s" % status, 0, msg[:200], 0, ""])
        print("rejected (nothing charged), HTTP %s: %s" % (status, msg[:600]))
        sys.exit(4)
    gen_id = resp["id"]
    interval, deadline = 3, time.time() + 30 * 60
    while True:
        st, body2 = call(key, "GET", "/flows/image/" + gen_id)
        if st != 200:
            sys.exit("poll failed %s" % st)
        s = body2.get("status")
        if s in ("completed", "failed"):
            break
        if time.time() > deadline:
            log_row(job, [time.strftime("%Y-%m-%d"), time.strftime("%H:%M:%S"), a.item, "v%d" % a.version, MODEL,
                          rel(prompt_path), ";".join(rel(r) for r in refs), settings, "", "timeout", int(time.time() - t0), "", "", gen_id])
            sys.exit(6)
        time.sleep(interval)
        interval = min(interval * 1.5, 20)
    secs = int(time.time() - t0)
    if s != "completed":
        reason = "%s: %s" % (body2.get("failure_reason"), body2.get("error_message"))
        delta, cnote = credits_delta(key, before)
        log_row(job, [time.strftime("%Y-%m-%d"), time.strftime("%H:%M:%S"), a.item, "v%d" % a.version, MODEL,
                      rel(prompt_path), ";".join(rel(r) for r in refs), settings, "", "failed", secs, reason[:200], delta, gen_id])
        print("generation failed (credits charged: %s):" % delta, reason)
        sys.exit(5)
    data = urllib.request.urlopen(body2["content_url"], timeout=300).read()
    with open(out, "wb") as f:
        f.write(data)
    delta, cnote = credits_delta(key, before)
    note = (a.note + " " + cnote).strip()
    run = log_row(job, [time.strftime("%Y-%m-%d"), time.strftime("%H:%M:%S"), a.item, "v%d" % a.version, MODEL,
                        rel(prompt_path), ";".join(rel(r) for r in refs), settings, rel(out), "completed", secs, note, delta, gen_id])
    print("saved %s  (%d KB, %d s, run #%d, credits: %s)" % (out, len(data) // 1024, secs, run, delta))


if __name__ == "__main__":
    main()
