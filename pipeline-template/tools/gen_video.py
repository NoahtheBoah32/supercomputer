# -*- coding: utf-8 -*-
"""One video clip, saved where you say. Renders Seedance through PiAPI (api.piapi.ai, the hosted ByteDance Seedance
API) or through the ElevenLabs Image & Video API (api.elevenlabs.io/v1/flows/video), whichever key is stored: --provider
picks, "auto" (default) takes VIDEO_PROVIDER from the environment, else PiAPI when its key exists, else ElevenLabs.
The clip is made from THE PROMPT PLUS THE APPROVED SHEETS attached as references (Leo's rule): no start frame, no end
frame, no storyboard, unless the user asks for a match cut and passes frames on purpose.

    python tools/gen_video.py --job jobs/2026-09-22-clinic --item scene-01-video --version 1 \
        --prompt-file scenes/scene-01/video.prompt.txt --refs-file scenes/scene-01/video.refs.txt \
        --aspect 16:9 --duration 6 --resolution 1080p [--model seedance-2.5] [--audio on] [--dry-run]

    --refs-file   video.refs.txt: one "@handle  sheets/<sheet>/approved.png" per line, attach order, strongest first.
                  Every @handle in the prompt is rewritten to PiAPI's @image1, @image2, ... in that order, because that
                  is how Seedance names its references. The exact text sent is saved beside the clip as video-vN.prompt.txt.
    --ref         extra reference image (repeatable, after the refs-file ones). Nine references at most (PiAPI's limit).
    --start-frame / --end-frame   a true match cut only, on the user's say-so: switches to first_last_frames mode.
    --provider    auto (default) · piapi · elevenlabs. ElevenLabs sends the sheets inline (no public upload needed) and
                  bills credits from the account (read before and after, like gen_image.py); Kling is not on that API.
    --model       seedance-2.5 (default) · seedance-2 · seedance-2-fast · seedance-2-mini; PiAPI also takes each as
                  -less-restriction; ElevenLabs also takes veo-3.1 and veo-3.1-fast (720p/1080p, 4, 6 or 8 s, no sheets).
    --resolution  480p · 720p · 1080p. PiAPI's Seedance 2.5 tops out at 1080p: 2k / 4k are rendered at 1080p and the tool
                  says so. --duration is 4 to 30 seconds on 2.5 (4 to 15 on the 2.x tiers). --aspect 21:9 16:9 4:3 1:1
                  3:4 9:16 (adaptive is allowed with frames).
    --audio off   the clip is silent; default on (Seedance generates dialogue, ambience and foley in the same pass).
    --upload      where the references are put so PiAPI can fetch them: auto (default) tries PiAPI's own temporary file
                  store first (needs the Creator plan or above) and falls back to litterbox.catbox.moe (public, 24 h,
                  no account); piapi or litterbox force one. Uploads are cached per file in <job>/.uploads.json for 23 h.

Paths are relative to the pipeline root (the folder holding this tools/ directory) or absolute. --item scene-NN is
accepted and logged as scene-NN-video. If --out is omitted the clip lands at <job>/scenes/scene-NN/video-vN.mp4.

Cost: PiAPI charges per second of output (Seedance 2.5: $0.15/s at 480p, $0.35/s at 720p, $0.80/s at 1080p; the
less-restriction tier is 10 % more; a 6 s 1080p clip is $4.80). The estimate is printed before anything is sent, the
account balance is read first (GET /account/info, free) and the run is logged in log.csv with "piapi ~$X.XX" in the
note and PiAPI's own usage figure in the credits column.

Key: PIAPI_API_KEY (or ELEVENLABS_API_KEY) from the environment, then .env in the pipeline root, then
../API-KEYS.local.md. Never printed. Standard library only. PIAPI_BASE / PIAPI_UPLOAD_BASE / PIAPI_LITTERBOX /
ELEVENLABS_BASE override the endpoints (tests).

Exit codes: 0 saved · 1 bad arguments or missing file · 4 request rejected (nothing charged) · 5 generation failed
(check the PiAPI dashboard; PiAPI refunds frozen credits of failed tasks) · 6 poll timeout.
"""
import argparse, base64, csv, hashlib, io, json, os, re, sys, time, urllib.request, urllib.error, uuid

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
BASE = os.environ.get("PIAPI_BASE", "https://api.piapi.ai").rstrip("/")
UPLOAD_BASE = os.environ.get("PIAPI_UPLOAD_BASE", "https://upload.theapi.app").rstrip("/")
LITTERBOX = os.environ.get("PIAPI_LITTERBOX", "https://litterbox.catbox.moe/resources/internals/api.php")
EL_BASE = os.environ.get("ELEVENLABS_BASE", "https://api.elevenlabs.io/v1").rstrip("/")
KEY_ENV = "PIAPI_API_KEY"
EL_KEY_ENV = "ELEVENLABS_API_KEY"
UA = "Supacomputah-pipeline/1.0"
PROVIDERS = ["auto", "piapi", "elevenlabs"]
# ElevenLabs Image & Video: our model name -> (model_id, resolutions, duration range, max reference images)
EL_MODELS = {
    "seedance-2.5": ("bytedance-seedance-v2.5", ["480p", "720p", "1080p"], (4, 30), 30),
    "seedance-2": ("bytedance-seedance-v2", ["480p", "720p", "1080p"], (4, 15), 9),
    "seedance-2-fast": ("bytedance-seedance-v2-fast", ["480p", "720p"], (4, 15), 9),
    "seedance-2-mini": ("bytedance-seedance-v2-mini", ["480p", "720p"], (4, 15), 9),
    "veo-3.1": ("veo-3.1-generate-001", ["720p", "1080p"], (4, 8), 0),
    "veo-3.1-fast": ("veo-3.1-fast-generate-001", ["720p", "1080p"], (4, 8), 0),
}

# task_type -> (USD per second by resolution, duration range)
MODELS = {
    "seedance-2.5": ({"480p": 0.15, "720p": 0.35, "1080p": 0.80}, (4, 30)),
    "seedance-2.5-less-restriction": ({"480p": 0.165, "720p": 0.385, "1080p": 0.88}, (4, 30)),
    "seedance-2": ({"480p": 0.10, "720p": 0.20, "1080p": 0.50}, (4, 15)),
    "seedance-2-less-restriction": ({"480p": 0.11, "720p": 0.22, "1080p": 0.55}, (4, 15)),
    "seedance-2-fast": ({"480p": 0.048, "720p": 0.096}, (4, 15)),
    "seedance-2-fast-less-restriction": ({"480p": 0.053, "720p": 0.106}, (4, 15)),
    "seedance-2-mini": ({"480p": 0.042, "720p": 0.084}, (4, 15)),
    "seedance-2-mini-less-restriction": ({"480p": 0.046, "720p": 0.092}, (4, 15)),
}
RES_ORDER = ["480p", "720p", "1080p"]
RES_ALIASES = {"480p": "480p", "sd": "480p", "720p": "720p", "hd": "720p", "1080p": "1080p", "fhd": "1080p", "1k": "1080p",
               "2k": "1080p", "1440p": "1080p", "4k": "1080p", "2160p": "1080p", "uhd": "1080p"}
ASPECTS = ["21:9", "16:9", "4:3", "1:1", "3:4", "9:16"]
FRAME_ASPECTS = ASPECTS + ["adaptive", "auto"]
MODES = ["auto", "text_to_video", "omni_reference", "first_last_frames"]
MAX_REFS = 9
IMG_MIME = {".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".webp": "image/webp"}
HEADER = ["run", "date", "time", "item", "version", "model", "prompt_file", "refs",
          "settings", "output", "status", "seconds", "note", "credits", "gen_id"]


def find_key(env_name):
    k = os.environ.get(env_name)
    if k and k.strip():
        return k.strip()
    for path in (os.path.join(ROOT, ".env"), os.path.join(os.path.dirname(ROOT), "API-KEYS.local.md")):
        if os.path.exists(path):
            for line in io.open(path, encoding="utf-8"):
                if line.startswith(env_name + "="):
                    v = line.split("=", 1)[1].strip().strip('"').strip("'")
                    if v:
                        return v
    return None


def load_key(provider="piapi"):
    env = KEY_ENV if provider == "piapi" else EL_KEY_ENV
    k = find_key(env)
    if k:
        return k
    if provider == "piapi":
        sys.exit("no PiAPI key: set %s (Supacomputah: Settings > PiAPI key) or fill in .env" % KEY_ENV)
    sys.exit("no ElevenLabs key: set %s (Supacomputah: Settings > ElevenLabs key) or fill in .env" % EL_KEY_ENV)


def pick_provider(asked):
    """auto: VIDEO_PROVIDER from the environment, else the first key found (PiAPI, then ElevenLabs)."""
    if asked != "auto":
        return asked
    env = os.environ.get("VIDEO_PROVIDER", "").strip().lower()
    if env in ("piapi", "elevenlabs"):
        return env
    if find_key(KEY_ENV):
        return "piapi"
    if find_key(EL_KEY_ENV):
        return "elevenlabs"
    sys.exit("no video key: add a PiAPI key (Settings > PiAPI key, see its Docs) or an ElevenLabs key, or fill in .env")


def el_headers(key):
    return {"xi-api-key": key, "Accept": "application/json"}


def el_credits_used(key):
    """ElevenLabs: the account's used-credit counter (free call), or None."""
    st, body = http_json("GET", EL_BASE + "/user/subscription", el_headers(key), timeout=30)
    if st == 200 and isinstance(body, dict) and isinstance(body.get("character_count"), int):
        return body["character_count"], body.get("character_limit")
    return None, None


def el_error(body):
    if isinstance(body, dict):
        d = body.get("detail")
        if isinstance(d, dict):
            return "%s (%s)" % (d.get("message") or d, d.get("status") or d.get("code") or "")
        if isinstance(d, list):
            return "; ".join("%s: %s" % (".".join(map(str, x.get("loc", []))), x.get("msg")) for x in d if isinstance(x, dict))[:400]
        if d:
            return str(d)[:400]
    return short(body, 400)


def inline_ref(path):
    with open(path, "rb") as f:
        return {"type": "inline_base64", "content_base64": base64.b64encode(f.read()).decode(), "mime_type": IMG_MIME[os.path.splitext(path)[1].lower()]}


def resolve(p):
    return p if os.path.isabs(p) else os.path.normpath(os.path.join(ROOT, p))


def http_json(method, url, headers, body=None, timeout=120, raw=None):
    """Returns (status, parsed-or-text). 0 = connection error. Never prints headers."""
    data = raw if raw is not None else (json.dumps(body).encode() if body is not None else None)
    h = dict(headers)
    h["User-Agent"] = UA
    if body is not None:
        h["Content-Type"] = "application/json"
    req = urllib.request.Request(url, data=data, method=method, headers=h)
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            txt = r.read().decode(errors="replace") or "{}"
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


def short(x, n=300):
    s = json.dumps(x, ensure_ascii=False) if not isinstance(x, str) else x
    return s[:n]


def headers(key):
    return {"x-api-key": key, "Accept": "application/json"}


# ---------- references: local file -> public URL ----------
def sha(path):
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def cache_load(job):
    p = os.path.join(job, ".uploads.json")
    try:
        return json.load(io.open(p, encoding="utf-8"))
    except (OSError, ValueError):
        return {}


def cache_save(job, cache):
    p = os.path.join(job, ".uploads.json")
    io.open(p, "w", encoding="utf-8").write(json.dumps(cache, indent=1))


def upload_piapi(key, path):
    """PiAPI temporary file store: 24 h, base64 JSON, Creator plan or above. Returns (url, reason)."""
    name = re.sub(r"[^A-Za-z0-9._-]", "_", os.path.basename(path))[-100:]
    with open(path, "rb") as f:
        data = base64.b64encode(f.read()).decode()
    st, body = http_json("POST", UPLOAD_BASE + "/api/ephemeral_resource", headers(key), {"file_name": name, "file_data": data}, timeout=180)
    url = body.get("data", {}).get("url") if isinstance(body, dict) and isinstance(body.get("data"), dict) else None
    if st == 200 and url:
        return url, ""
    return None, "piapi upload %s: %s" % (st, short(body, 160))


def upload_litterbox(path):
    """litterbox.catbox.moe: anonymous temporary host, 24 h, answers with the plain URL. Returns (url, reason)."""
    boundary = "----supacomputah" + uuid.uuid4().hex
    mime = IMG_MIME.get(os.path.splitext(path)[1].lower(), "application/octet-stream")
    with open(path, "rb") as f:
        content = f.read()
    parts = []
    for k, v in (("reqtype", "fileupload"), ("time", "24h")):
        parts.append(("--%s\r\nContent-Disposition: form-data; name=\"%s\"\r\n\r\n%s\r\n" % (boundary, k, v)).encode())
    parts.append(("--%s\r\nContent-Disposition: form-data; name=\"fileToUpload\"; filename=\"%s\"\r\nContent-Type: %s\r\n\r\n"
                  % (boundary, os.path.basename(path), mime)).encode() + content + b"\r\n")
    parts.append(("--%s--\r\n" % boundary).encode())
    raw = b"".join(parts)
    st, body = http_json("POST", LITTERBOX, {"Content-Type": "multipart/form-data; boundary=" + boundary}, raw=raw, timeout=180)
    if st == 200 and isinstance(body, str) and body.strip().startswith("http"):
        return body.strip(), ""
    return None, "litterbox %s: %s" % (st, short(body, 160))


def public_url(key, path, job, how, cache):
    """A URL PiAPI can fetch for a local image, cached per file content for 23 hours."""
    digest = sha(path)
    hit = cache.get(digest)
    if hit and hit.get("expires", 0) > time.time() and hit.get("url"):
        return hit["url"], hit.get("host", "cache"), ""
    reasons = []
    hosts = ["piapi", "litterbox"] if how == "auto" else [how]
    for host in hosts:
        url, why = upload_piapi(key, path) if host == "piapi" else upload_litterbox(path)
        if url:
            cache[digest] = {"url": url, "host": host, "expires": time.time() + 23 * 3600, "file": os.path.basename(path)}
            cache_save(job, cache)
            return url, host, ""
        reasons.append(why)
    return None, None, "; ".join(reasons)


# ---------- the prompt: @handles -> @imageN ----------
def resolve_ref(p, job):
    """A reference path as the roles write it: relative to the job folder (sheets/x/approved.png), else to the pipeline
    root, else absolute."""
    p = p.strip('"').strip("'")
    if os.path.isabs(p):
        return os.path.normpath(p)
    in_job = os.path.normpath(os.path.join(job, p))
    return in_job if os.path.exists(in_job) else resolve(p)


def read_refs_file(path, job):
    """Lines of "@handle  sheets/x/approved.png". Comments and blanks skipped. Returns [(handle, abs_path)]."""
    out = []
    for raw in io.open(path, encoding="utf-8"):
        line = raw.strip()
        if not line or line.startswith("#"):
            continue
        m = re.match(r"^(@[\w-]+)\s+(.+?)\s*$", line)
        if not m:
            sys.exit("refs file line not understood (want '@handle  path'): " + line)
        out.append((m.group(1), resolve_ref(m.group(2), job)))
    return out


def rewrite_handles(prompt, handles):
    """@handle -> @imageN by attach order. Returns (text, mapping, unknown_tags)."""
    mapping = {}
    for i, h in enumerate(handles):
        mapping[h] = "@image%d" % (i + 1)
    text = prompt
    for h in sorted(mapping, key=len, reverse=True):  # longest first so @loc_apartment wins over @loc
        text = re.sub(re.escape(h) + r"(?![\w-])", mapping[h], text)
    unknown = sorted(set(t for t in re.findall(r"@[A-Za-z][\w-]*", text) if not re.match(r"^@(image|video|audio)\d+$", t)))
    return text, mapping, unknown


def default_out(job, item, version):
    m = re.match(r"^(scene-\d\d)-([a-z]+)$", item)
    if m:
        return os.path.join(job, "scenes", m.group(1), "%s-v%d.mp4" % (m.group(2), version))
    return os.path.join(job, "clips", item, "v%d.mp4" % version)


def log_row(job, row):
    """Append one row. Upgrades an older log.csv (no credits/gen_id columns) in place. Same format as gen_image.py."""
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


def account_balance(key):
    """GET /account/info is free. Returns (ok, usd_or_None, note). Field names vary; look for the usual ones."""
    st, body = http_json("GET", BASE + "/account/info", headers(key), timeout=30)
    if st in (401, 403):
        return False, None, "rejected %s: %s" % (st, short(body, 200))
    if st == 0:
        return False, None, short(body, 200)
    if st != 200 or not isinstance(body, dict):
        return True, None, "balance unavailable (HTTP %s)" % st
    d = body.get("data") if isinstance(body.get("data"), dict) else body
    for k in ("equivalent_in_usd", "balance_usd", "usd", "balance", "credits", "remaining_credits", "quota"):
        v = d.get(k)
        if isinstance(v, (int, float)):
            return True, float(v), k
        if isinstance(v, str):
            try:
                return True, float(v.replace("$", "").replace(",", "")), k
            except ValueError:
                pass
    return True, None, "balance field not found"


def find_video_url(output):
    """PiAPI puts the clip at output.video; be tolerant of other shapes."""
    if not isinstance(output, dict):
        return None
    for k in ("video", "video_url", "url"):
        v = output.get(k)
        if isinstance(v, str) and v.startswith("http"):
            return v
        if isinstance(v, dict):
            for kk in ("url", "resource", "resource_without_watermark"):
                if isinstance(v.get(kk), str) and v[kk].startswith("http"):
                    return v[kk]
    for v in output.values():
        if isinstance(v, list):
            for item in v:
                u = find_video_url(item) if isinstance(item, dict) else (item if isinstance(item, str) and item.startswith("http") else None)
                if u:
                    return u
        elif isinstance(v, dict):
            u = find_video_url(v)
            if u:
                return u
    return None


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--job", required=True, help="job folder, e.g. jobs/2026-09-22-clinic")
    ap.add_argument("--item", required=True, help="scene-NN-video (scene-NN is accepted)")
    ap.add_argument("--version", type=int, required=True)
    ap.add_argument("--prompt-file", required=True, help="the sealed video prompt (video.prompt.txt)")
    ap.add_argument("--refs-file", help="video.refs.txt: '@handle  path' per line, attach order")
    ap.add_argument("--ref", action="append", default=[], help="extra reference image, repeatable, order kept")
    ap.add_argument("--start-frame", help="match cut only: the first frame (first_last_frames mode)")
    ap.add_argument("--end-frame", help="match cut only: the last frame (needs --start-frame)")
    ap.add_argument("--provider", default="auto", choices=PROVIDERS, help="auto (VIDEO_PROVIDER, else the key found), piapi or elevenlabs")
    ap.add_argument("--model", default="seedance-2.5", choices=sorted(set(MODELS) | set(EL_MODELS)), help="seedance-2.5 (default) and the other tiers; veo-3.1[-fast] on ElevenLabs only")
    ap.add_argument("--mode", default="auto", choices=MODES, help="auto: frames -> first_last_frames, refs -> omni_reference, else text_to_video")
    ap.add_argument("--aspect", default="16:9", help="21:9 16:9 4:3 1:1 3:4 9:16 (adaptive with frames)")
    ap.add_argument("--duration", type=int, default=6, help="seconds, 4-30 on Seedance 2.5")
    ap.add_argument("--resolution", default="1080p", help="480p 720p 1080p (2k/4k render at 1080p, PiAPI's ceiling)")
    ap.add_argument("--audio", default="on", choices=["on", "off"], help="generate sound in the same pass (default on)")
    ap.add_argument("--upload", default="auto", choices=["auto", "piapi", "litterbox"], help="where references are hosted for PiAPI")
    ap.add_argument("--out", help="output mp4 path; default follows FOLDER-PROTOCOL.md")
    ap.add_argument("--wait", type=int, default=25, help="minutes to wait for the clip (default 25)")
    ap.add_argument("--note", default="", help="free text for the log row")
    ap.add_argument("--dry-run", action="store_true", help="print the request (URLs not uploaded) and send nothing")
    a = ap.parse_args()
    provider = pick_provider(a.provider)
    if provider == "piapi" and a.model not in MODELS:
        sys.exit("%s is not on PiAPI; PiAPI models: %s" % (a.model, ", ".join(sorted(MODELS))))
    if provider == "elevenlabs" and a.model not in EL_MODELS:
        sys.exit("%s is not on the ElevenLabs API; ElevenLabs models: %s (Kling is not offered there)" % (a.model, ", ".join(sorted(EL_MODELS))))

    job = resolve(a.job)
    if not os.path.isdir(job):
        sys.exit("job folder not found: " + job)
    prompt_path = resolve_ref(a.prompt_file, job)
    if not os.path.exists(prompt_path):
        sys.exit("prompt file not found: " + prompt_path)
    prompt = io.open(prompt_path, encoding="utf-8").read().strip()
    if not prompt:
        sys.exit("prompt file is empty: " + prompt_path)
    if len(prompt) > 4000:
        sys.exit("prompt is %d characters; PiAPI's Seedance limit is 4000. Cut blocks the shot does not need." % len(prompt))
    item = a.item
    if re.match(r"^scene-\d\d$", item):
        item += "-video"

    # references
    handles, ref_paths = [], []
    if a.refs_file:
        rf = resolve_ref(a.refs_file, job)
        if not os.path.exists(rf):
            sys.exit("refs file not found: " + rf)
        for h, p in read_refs_file(rf, job):
            handles.append(h)
            ref_paths.append(p)
    for r in a.ref:
        ref_paths.append(resolve_ref(r, job))
    frames = [resolve_ref(p, job) for p in (a.start_frame, a.end_frame) if p]
    if a.end_frame and not a.start_frame:
        sys.exit("--end-frame needs --start-frame (PiAPI takes the frames as first, then last)")
    for p in ref_paths + frames:
        if not os.path.exists(p):
            sys.exit("reference not found: " + p)
        if os.path.splitext(p)[1].lower() not in IMG_MIME:
            sys.exit("reference must be png, jpg or webp: " + p)
    if frames and ref_paths:
        sys.exit("frames and references cannot be combined in one PiAPI task: pass --start-frame/--end-frame alone, or the references alone")
    max_refs = MAX_REFS if provider == "piapi" else EL_MODELS[a.model][3]
    if len(ref_paths) > max_refs:
        if max_refs == 0:
            sys.exit("%s on ElevenLabs takes no reference sheets (frames only); pick a Seedance tier for a prompt + sheets clip" % a.model)
        sys.exit("%s takes at most %d reference images; %d given. Drop the handles this shot does not need." % ("PiAPI" if provider == "piapi" else a.model, max_refs, len(ref_paths)))
    mode = a.mode
    if mode == "auto":
        mode = "first_last_frames" if frames else ("omni_reference" if ref_paths else "text_to_video")
    if mode == "first_last_frames" and not frames:
        sys.exit("first_last_frames mode needs --start-frame (and usually --end-frame)")
    if mode == "omni_reference" and not ref_paths:
        sys.exit("omni_reference mode needs at least one reference (--refs-file or --ref)")
    if mode == "text_to_video" and (ref_paths or frames):
        sys.exit("text_to_video mode takes no references or frames")

    # settings
    if provider == "piapi":
        prices, (dmin, dmax) = MODELS[a.model]
        tiers = list(prices)
        who = "PiAPI's Seedance"
    else:
        el_id, tiers, (dmin, dmax), _ = EL_MODELS[a.model]
        prices = {}
        who = a.model + " on ElevenLabs"
    res_key = a.resolution.lower()
    if res_key not in RES_ALIASES:
        sys.exit("resolution must be one of 480p, 720p, 1080p (2k/4k are rendered at 1080p)")
    res = RES_ALIASES[res_key]
    notes = []
    if res != a.resolution.lower() and a.resolution.lower() not in ("1080p",):
        notes.append("%s asked, %s ceiling is 1080p: rendered at 1080p" % (a.resolution, who))
    while res not in tiers:
        res = RES_ORDER[RES_ORDER.index(res) - 1] if RES_ORDER.index(res) > 0 else tiers[0]
        notes.append("%s has no %s tier: rendered at %s" % (a.model, a.resolution, res))
        if res in tiers:
            break
    if not dmin <= a.duration <= dmax:
        sys.exit("duration for %s is %d to %d seconds" % (a.model, dmin, dmax))
    if provider == "elevenlabs" and a.model.startswith("veo") and a.duration not in (4, 6, 8):
        sys.exit("Veo takes 4, 6 or 8 seconds")
    aspect = a.aspect.lower()
    allowed = FRAME_ASPECTS if (mode == "first_last_frames" or provider == "elevenlabs") else ASPECTS
    if aspect not in allowed:
        sys.exit("aspect must be one of %s" % ", ".join(allowed))
    if aspect == "adaptive":
        aspect = "auto"
    if provider == "elevenlabs" and a.model.startswith("veo") and aspect not in ("16:9", "9:16"):
        aspect = "16:9"
        notes.append("Veo takes 16:9 or 9:16: rendered at 16:9")
    usd = round(prices[res] * a.duration, 3) if prices else None
    settings = "%s %s %ds" % (a.aspect if aspect != "auto" else "auto", res, a.duration)

    out = resolve(a.out) if a.out else default_out(job, item, a.version)
    if os.path.exists(out):
        sys.exit("refusing to overwrite an existing version: " + out + " already exists; use the next version number")
    os.makedirs(os.path.dirname(out), exist_ok=True)

    # the prompt PiAPI sees
    sent, mapping, unknown = rewrite_handles(prompt, handles)
    if not handles and ref_paths:
        mapping = {"(ref %d)" % (i + 1): "@image%d" % (i + 1) for i in range(len(ref_paths))}
    if unknown:
        notes.append("tags not in the refs list, sent as plain text: " + " ".join(unknown))
    rel = lambda p: os.path.relpath(p, job).replace("\\", "/")

    body = {"model": "seedance", "task_type": a.model,
            "input": {"prompt": sent, "mode": mode, "duration": a.duration, "resolution": res, "aspect_ratio": aspect, "audio": a.audio == "on"}}

    if provider == "elevenlabs":
        return run_elevenlabs(a, job, item, prompt_path, ref_paths, frames, handles, mapping, sent, res, aspect, settings, notes, out, rel)

    if a.dry_run:
        shown = json.loads(json.dumps(body))
        shown["input"]["prompt"] = sent[:400] + ("..." if len(sent) > 400 else "")
        if ref_paths:
            shown["input"]["image_urls"] = ["<upload %s as %s>" % (os.path.basename(p), mapping.get(h, "@image%d" % (i + 1))) for i, (h, p) in enumerate(zip(handles + [""] * len(ref_paths), ref_paths))]
        if frames:
            shown["input"]["image_urls"] = ["<upload %s as %s frame>" % (os.path.basename(p), n) for p, n in zip(frames, ("first", "last"))]
        print(json.dumps(shown, indent=2, ensure_ascii=False))
        print("estimated cost: $%.2f (%s, %s, %d s at $%.3f/s)" % (usd, a.model, res, a.duration, prices[res]))
        for n in notes:
            print("note:", n)
        print("would save:", out)
        return

    key = load_key()
    t0 = time.time()
    ok, bal, bnote = account_balance(key)
    if not ok and bnote.startswith("rejected"):
        log_row(job, [time.strftime("%Y-%m-%d"), time.strftime("%H:%M:%S"), item, "v%d" % a.version, a.model,
                      rel(prompt_path), ";".join(rel(p) for p in ref_paths + frames), settings, "", "rejected", 0, bnote[:200], "", ""])
        print("rejected (nothing charged), piapi: " + bnote)
        sys.exit(4)
    if bal is not None:
        print("PiAPI balance: $%.2f · this clip about $%.2f" % (bal, usd))
        if bal < usd:
            notes.append("balance $%.2f is below the estimate $%.2f" % (bal, usd))
            print("warning: the balance may not cover this clip; PiAPI will reject it if so (nothing charged)")

    # references -> URLs
    cache = cache_load(job)
    image_urls = []
    for p in (frames if frames else ref_paths):
        url, host, why = public_url(key, p, job, a.upload, cache)
        if not url:
            reason = "reference %s could not be hosted for PiAPI (%s)" % (os.path.basename(p), why)
            log_row(job, [time.strftime("%Y-%m-%d"), time.strftime("%H:%M:%S"), item, "v%d" % a.version, a.model,
                          rel(prompt_path), ";".join(rel(x) for x in ref_paths + frames), settings, "", "rejected", int(time.time() - t0), reason[:200], "", ""])
            print("rejected (nothing charged), piapi: " + reason)
            sys.exit(4)
        image_urls.append(url)
    if image_urls:
        body["input"]["image_urls"] = image_urls
    io.open(os.path.splitext(out)[0] + ".prompt.txt", "w", encoding="utf-8", newline="\n").write(sent + "\n")

    # submit
    st, resp = http_json("POST", BASE + "/api/v1/task", headers(key), body, timeout=120)
    data = resp.get("data") if isinstance(resp, dict) and isinstance(resp.get("data"), dict) else {}
    task_id = data.get("task_id")
    if st != 200 or not task_id:
        # PiAPI's own words when it gives them ("prompt rejected by moderation"), the raw body otherwise
        msg = short(resp, 600)
        if isinstance(resp, dict):
            m = resp.get("message") or (resp.get("data") or {}).get("error", {}).get("message") if isinstance(resp.get("data"), dict) else resp.get("message")
            if m and str(m).strip() and str(m).strip().lower() != "success":
                msg = str(m).strip()
        status = "rejected" if st and st < 500 else "failed"
        log_row(job, [time.strftime("%Y-%m-%d"), time.strftime("%H:%M:%S"), item, "v%d" % a.version, a.model,
                      rel(prompt_path), ";".join(rel(p) for p in ref_paths + frames), settings, "", "%s %s" % (status, st), int(time.time() - t0), msg[:200], "", ""])
        if status == "rejected":
            print("rejected (nothing charged), HTTP %s: %s" % (st, msg))
            sys.exit(4)
        print("generation failed (piapi did not accept the task, HTTP %s): %s" % (st, msg))
        sys.exit(5)
    print("PiAPI task %s accepted (%s, %s, %d s, ~$%.2f). Waiting..." % (task_id, a.model, res, a.duration, usd))

    # poll
    first = float(os.environ.get("PIAPI_POLL_FIRST", "4"))
    interval, deadline = first, time.time() + a.wait * 60
    final = None
    while True:
        pst, pbody = http_json("GET", BASE + "/api/v1/task/" + task_id, headers(key), timeout=60)
        pdata = pbody.get("data") if isinstance(pbody, dict) and isinstance(pbody.get("data"), dict) else {}
        s = str(pdata.get("status") or "").lower()
        if pst == 200 and s in ("completed", "failed"):
            final = pdata
            break
        if pst in (401, 403):
            print("poll failed %s: %s" % (pst, short(pbody, 300)))
            sys.exit(5)
        if time.time() > deadline:
            log_row(job, [time.strftime("%Y-%m-%d"), time.strftime("%H:%M:%S"), item, "v%d" % a.version, a.model,
                          rel(prompt_path), ";".join(rel(p) for p in ref_paths + frames), settings, "", "timeout", int(time.time() - t0),
                          "piapi ~$%.2f; still %s after %d min" % (usd, s or "unknown", a.wait), "", task_id])
            print("timeout: PiAPI task %s is still %s after %d minutes; check the PiAPI workspace" % (task_id, s or "unknown", a.wait))
            sys.exit(6)
        time.sleep(interval)
        interval = min(interval * 1.5, 15)
    secs = int(time.time() - t0)
    usage = final.get("meta", {}).get("usage", {}) if isinstance(final.get("meta"), dict) else {}
    consume = usage.get("consume") if isinstance(usage, dict) else None
    credits = int(consume) if isinstance(consume, (int, float)) and consume > 0 else ""
    if final.get("status", "").lower() != "completed":
        err = final.get("error") if isinstance(final.get("error"), dict) else {}
        reason = "%s %s" % (err.get("code", ""), err.get("message") or final.get("detail") or "no reason given")
        log_row(job, [time.strftime("%Y-%m-%d"), time.strftime("%H:%M:%S"), item, "v%d" % a.version, a.model,
                      rel(prompt_path), ";".join(rel(p) for p in ref_paths + frames), settings, "", "failed", secs,
                      ("piapi ~$%.2f; " % usd + reason)[:200], credits, task_id])
        print("generation failed (piapi task %s): %s" % (task_id, reason.strip()[:600]))
        sys.exit(5)
    url = find_video_url(final.get("output"))
    if not url:
        log_row(job, [time.strftime("%Y-%m-%d"), time.strftime("%H:%M:%S"), item, "v%d" % a.version, a.model,
                      rel(prompt_path), ";".join(rel(p) for p in ref_paths + frames), settings, "", "failed", secs, "completed but no video url in output", credits, task_id])
        print("generation failed (piapi task %s): completed but no video url in %s" % (task_id, short(final.get("output"), 300)))
        sys.exit(5)
    req = urllib.request.Request(url, headers={"User-Agent": UA})
    with urllib.request.urlopen(req, timeout=600) as r:
        payload = r.read()
    with open(out, "wb") as f:
        f.write(payload)
    note = " ".join(x for x in [a.note, "piapi ~$%.2f" % usd] + ["; " + n for n in notes] if x).strip()
    run = log_row(job, [time.strftime("%Y-%m-%d"), time.strftime("%H:%M:%S"), item, "v%d" % a.version, a.model,
                        rel(prompt_path), ";".join(rel(p) for p in ref_paths + frames), settings, rel(out), "completed", secs, note, credits, task_id])
    for n in notes:
        print("note:", n)
    print("saved %s  (%d KB, %d s, run #%d, piapi %s, ~$%.2f, credits: %s)" % (out, len(payload) // 1024, secs, run, a.model, usd, credits if credits != "" else "not reported"))


def run_elevenlabs(a, job, item, prompt_path, ref_paths, frames, handles, mapping, sent, res, aspect, settings, notes, out, rel):
    """The same clip through the ElevenLabs Image & Video API: sheets go inline as base64 (no public upload), the cost
    is the account counter's delta (credits), the log row names the ElevenLabs model id."""
    el_id = EL_MODELS[a.model][0]
    body = {"model_id": el_id, "prompt": sent, "duration_secs": a.duration, "resolution": res, "generate_audio": a.audio == "on"}
    if not frames:
        body["aspect_ratio"] = aspect if aspect != "auto" else "16:9"
    refs_note = ";".join(rel(p) for p in ref_paths + frames)
    if a.dry_run:
        shown = dict(body)
        shown["prompt"] = sent[:400] + ("..." if len(sent) > 400 else "")
        if ref_paths:
            shown["images"] = ["<inline %s as %s>" % (os.path.basename(p), mapping.get(h, "@image%d" % (i + 1))) for i, (h, p) in enumerate(zip(handles + [""] * len(ref_paths), ref_paths))]
        if frames:
            shown["start_frame"] = "<inline %s>" % os.path.basename(frames[0])
            if len(frames) > 1:
                shown["end_frame"] = "<inline %s>" % os.path.basename(frames[1])
        print(json.dumps(shown, indent=2, ensure_ascii=False))
        print("estimated cost: ElevenLabs credits, measured after the clip (%s, %s, %d s; the account counter is read before and after)" % (el_id, res, a.duration))
        for n in notes:
            print("note:", n)
        print("would save:", out)
        return
    key = load_key("elevenlabs")
    t0 = time.time()
    before, limit = el_credits_used(key)
    if before is not None and limit:
        print("ElevenLabs credits left: %s" % format(max(0, limit - before), ","))
    if ref_paths:
        body["images"] = [inline_ref(p) for p in ref_paths]
    if frames:
        body["start_frame"] = inline_ref(frames[0])
        if len(frames) > 1:
            body["end_frame"] = inline_ref(frames[1])
    io.open(os.path.splitext(out)[0] + ".prompt.txt", "w", encoding="utf-8", newline="\n").write(sent + "\n")
    st, resp = http_json("POST", EL_BASE + "/flows/video", el_headers(key), body, timeout=180)
    gen_id = resp.get("id") if isinstance(resp, dict) else None
    if st != 200 or not gen_id:
        msg = el_error(resp) if st else short(resp, 300)
        status = "rejected" if st and st < 500 else "failed"
        log_row(job, [time.strftime("%Y-%m-%d"), time.strftime("%H:%M:%S"), item, "v%d" % a.version, el_id,
                      rel(prompt_path), refs_note, settings, "", "%s %s" % (status, st), int(time.time() - t0), ("elevenlabs; " + msg)[:200], "", ""])
        if status == "rejected":
            print("rejected (nothing charged), HTTP %s: %s" % (st, msg))
            sys.exit(4)
        print("generation failed (elevenlabs did not accept the request, HTTP %s): %s" % (st, msg))
        sys.exit(5)
    print("ElevenLabs generation %s accepted (%s, %s, %d s). Waiting..." % (gen_id, el_id, res, a.duration))
    first = float(os.environ.get("VIDEO_POLL_FIRST", os.environ.get("PIAPI_POLL_FIRST", "8")))
    interval, deadline = first, time.time() + a.wait * 60
    final = None
    while True:
        pst, pbody = http_json("GET", EL_BASE + "/flows/video/" + gen_id, el_headers(key), timeout=60)
        s = str(pbody.get("status") or "").lower() if isinstance(pbody, dict) else ""
        if pst == 200 and s in ("completed", "failed"):
            final = pbody
            break
        if pst in (401, 403):
            print("poll failed %s: %s" % (pst, el_error(pbody)))
            sys.exit(5)
        if time.time() > deadline:
            log_row(job, [time.strftime("%Y-%m-%d"), time.strftime("%H:%M:%S"), item, "v%d" % a.version, el_id,
                          rel(prompt_path), refs_note, settings, "", "timeout", int(time.time() - t0), "elevenlabs; still %s after %d min" % (s or "unknown", a.wait), "", gen_id])
            print("timeout: ElevenLabs generation %s is still %s after %d minutes; check elevenlabs.io" % (gen_id, s or "unknown", a.wait))
            sys.exit(6)
        time.sleep(interval)
        interval = min(interval * 1.5, 20)
    secs = int(time.time() - t0)
    after, _ = el_credits_used(key)
    credits = (after - before) if (before is not None and after is not None and after >= before) else ""
    if final.get("status") != "completed":
        reason = "%s: %s" % (final.get("failure_reason") or "failed", final.get("error_message") or "no reason given")
        log_row(job, [time.strftime("%Y-%m-%d"), time.strftime("%H:%M:%S"), item, "v%d" % a.version, el_id,
                      rel(prompt_path), refs_note, settings, "", "failed", secs, ("elevenlabs; " + reason)[:200], credits, gen_id])
        print("generation failed (elevenlabs generation %s): %s" % (gen_id, reason[:600]))
        sys.exit(5)
    url = final.get("content_url")
    if not url:
        log_row(job, [time.strftime("%Y-%m-%d"), time.strftime("%H:%M:%S"), item, "v%d" % a.version, el_id,
                      rel(prompt_path), refs_note, settings, "", "failed", secs, "elevenlabs; completed but no content_url", credits, gen_id])
        print("generation failed (elevenlabs generation %s): completed but no content_url" % gen_id)
        sys.exit(5)
    req = urllib.request.Request(url, headers={"User-Agent": UA})
    with urllib.request.urlopen(req, timeout=600) as r:
        payload = r.read()
    with open(out, "wb") as f:
        f.write(payload)
    note = " ".join(x for x in [a.note, "elevenlabs"] + ["; " + n for n in notes] if x).strip()
    run = log_row(job, [time.strftime("%Y-%m-%d"), time.strftime("%H:%M:%S"), item, "v%d" % a.version, el_id,
                        rel(prompt_path), refs_note, settings, rel(out), "completed", secs, note, credits, gen_id])
    for n in notes:
        print("note:", n)
    print("saved %s  (%d KB, %d s, run #%d, elevenlabs %s, credits: %s)" % (out, len(payload) // 1024, secs, run, el_id, format(credits, ",") if credits != "" else "not reported"))


if __name__ == "__main__":
    main()
