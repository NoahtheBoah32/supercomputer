#!/usr/bin/env python3
"""
blender_previz.py: render a motion previz with Blender, headless, on this machine. No credits.

    python tools/blender_previz.py --job jobs/2026-10-01-bottle --item scene-01 --version 1 \
        --script scenes/scene-01/previz-v1.py --resolution 1080p --fps 24

The agent writes the Blender Python script (the scene, the camera and its animation, the frame range) and this
tool runs it inside Blender in background mode, forces the render settings (engine, resolution, fps, output) and
encodes the frames to an MP4 next to the script:

    <job>/scenes/scene-01/previz-v1.mp4          the clip (H.264, yuv420p)
    <job>/scenes/scene-01/previz-v1.blend        the scene, openable in Blender
    <job>/scenes/scene-01/previz-v1.preview.png  the latest rendered frame while it renders (progress preview)
    <job>/scenes/scene-01/previz-v1.run.log      Blender's own output

The script must set `scene.frame_end` (or pass --seconds, which wins). It must not render, save or set the output
path itself: the tool owns that. Keep the scene low-poly and lit; it is a motion reference, not a final frame.

Blender is found through BLENDER_PATH (the app sets it from Settings > Connections), then the usual install
folders, then PATH. Resolutions: 720p 1280x720, 1080p 1920x1080, 1440p 2560x1440, 4k 3840x2160 (16:9; --aspect
9:16, 1:1, 4:3, 21:9 swap or crop the same height). Engine: eevee (default) or workbench (fastest, flat).

Encoding: the ffmpeg on PATH (or FFMPEG_PATH) when there is one, else Blender's own H.264 encoder (media_type VIDEO)
writes the mp4 straight from Blender. The PNG frames are kept only with --keep-frames.

Progress lines go to stdout as `frame 12/200`. Exit codes: 0 saved | 1 bad arguments or missing file |
3 Blender not found | 5 Blender failed (see the run log) | 6 timeout | 7 frames rendered but no encoder.

The run is logged to <job>/log.csv (model blender-previz, credits 0, note "blender <version>; local").
"""
import argparse, csv, glob, io, os, re, shutil, subprocess, sys, time

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
RES = {"720p": (1280, 720), "1080p": (1920, 1080), "1440p": (2560, 1440), "4k": (3840, 2160), "2k": (2560, 1440)}
ASPECTS = ["16:9", "9:16", "1:1", "4:3", "21:9"]
LOG_HEADER = "run,date,time,item,version,model,prompt_file,refs,settings,output,status,seconds,note,credits,gen_id"


def P(p):
    return p if os.path.isabs(p) else os.path.join(ROOT, p)


def find_blender():
    cands = []
    if os.environ.get("BLENDER_PATH"):
        cands.append(os.environ["BLENDER_PATH"])
    if sys.platform.startswith("win"):
        for root in [os.environ.get("ProgramFiles"), os.environ.get("ProgramFiles(x86)"), os.path.join(os.path.expanduser("~"), "AppData", "Local", "Programs")]:
            if root and os.path.isdir(os.path.join(root, "Blender Foundation")):
                for d in sorted(os.listdir(os.path.join(root, "Blender Foundation")), reverse=True):
                    cands.append(os.path.join(root, "Blender Foundation", d, "blender.exe"))
        cands.append(shutil.which("blender.exe") or "")
    elif sys.platform == "darwin":
        cands += ["/Applications/Blender.app/Contents/MacOS/Blender", os.path.expanduser("~/Applications/Blender.app/Contents/MacOS/Blender")]
        cands.append(shutil.which("blender") or "")
    else:
        cands += ["/usr/bin/blender", "/usr/local/bin/blender", "/snap/bin/blender", shutil.which("blender") or ""]
    for c in cands:
        if c and os.path.isfile(c):
            return c
    return None


def blender_version(exe):
    try:
        out = subprocess.run([exe, "--version"], capture_output=True, text=True, timeout=30).stdout
        m = re.search(r"Blender\s+(\d+\.\d+(?:\.\d+)?)", out)
        return m.group(1) if m else "unknown"
    except Exception:
        return "unknown"


def find_ffmpeg():
    for c in [os.environ.get("FFMPEG_PATH"), shutil.which("ffmpeg"), r"C:\ffmpeg\bin\ffmpeg.exe", "/opt/homebrew/bin/ffmpeg", "/usr/local/bin/ffmpeg"]:
        if c and os.path.isfile(c):
            return c
    return None


WRAPPER = r'''
import bpy, os, sys, time, json
CFG = json.loads(os.environ["PREVIZ_CFG"])
bpy.ops.wm.read_factory_settings(use_empty=True)
# ---- the agent's script: scene, camera, animation, frame range
exec(compile(open(CFG["script"], encoding="utf-8").read(), CFG["script"], "exec"))
sc = bpy.context.scene
if sc.camera is None:
    cams = [o for o in sc.objects if o.type == "CAMERA"]
    if cams: sc.camera = cams[0]
if sc.camera is None:
    print("PREVIZ_ERROR no camera in the scene"); sys.exit(2)
if sc.world is None:   # a script that forgot the world would render on black
    wd = bpy.data.worlds.new("World"); wd.use_nodes = True
    try: wd.node_tree.nodes["Background"].inputs[0].default_value = (0.18, 0.18, 0.19, 1)
    except Exception: pass
    sc.world = wd
ids = [e.identifier for e in bpy.types.RenderSettings.bl_rna.properties["engine"].enum_items]
want = CFG["engine"]
sc.render.engine = ("BLENDER_WORKBENCH" if want == "workbench" and "BLENDER_WORKBENCH" in ids
                    else "BLENDER_EEVEE_NEXT" if "BLENDER_EEVEE_NEXT" in ids else "BLENDER_EEVEE" if "BLENDER_EEVEE" in ids else ids[0])
sc.render.resolution_x, sc.render.resolution_y = CFG["w"], CFG["h"]
sc.render.resolution_percentage = 100
sc.render.fps = CFG["fps"]; sc.render.fps_base = 1
sc.frame_start = 1
if CFG.get("seconds"): sc.frame_end = int(round(CFG["seconds"] * CFG["fps"]))
if sc.frame_end <= 1: sc.frame_end = CFG["fps"] * 5
if sc.frame_end > CFG["max_frames"]: sc.frame_end = CFG["max_frames"]
try:
    sc.eevee.taa_render_samples = CFG.get("samples", 32)
except Exception: pass
sc.render.film_transparent = False
# motion blur is the script's call (the library says on, shutter 0.5: it sells the speed of a whip move)
try: sc.render.image_settings.color_management = "FOLLOW_SCENE"
except Exception: pass
bpy.ops.wm.save_as_mainfile(filepath=CFG["blend"])
ims = sc.render.image_settings
frames_dir = CFG["frames_dir"]
total = sc.frame_end - sc.frame_start + 1
print("PREVIZ_FRAMES %d" % total, flush=True)
in_blender = False
if CFG.get("encode") == "blender":
    # No ffmpeg on this machine: Blender writes the H.264 itself. Blender 4.5+/5.x hides FFMPEG until media_type is VIDEO.
    try:
        if hasattr(ims, "media_type"): ims.media_type = "VIDEO"
        ims.file_format = "FFMPEG"; ims.color_mode = "RGB"
        sc.render.ffmpeg.format = "MPEG4"; sc.render.ffmpeg.codec = "H264"; sc.render.ffmpeg.constant_rate_factor = "HIGH"
        sc.render.ffmpeg.gopsize = 12; sc.render.ffmpeg.audio_codec = "NONE"
        sc.render.filepath = CFG["mp4"]; sc.render.use_file_extension = False
        in_blender = True
    except Exception as e:
        print("PREVIZ_NOTE blender encoder unavailable (%s); writing frames" % e, flush=True)
if not in_blender:
    os.makedirs(frames_dir, exist_ok=True)
    ims.file_format = "PNG"; ims.color_mode = "RGB"; ims.compression = 15
    sc.render.filepath = os.path.join(frames_dir, "f_")
print("PREVIZ_FFMPEG_IN_BLENDER %d" % int(in_blender), flush=True)
def post(scene, *a):
    n = scene.frame_current - scene.frame_start + 1
    print("frame %d/%d" % (n, total), flush=True)
    if n % 3 == 1 or n == total:
        try:
            tmp = CFG["preview"] + ".part.png"       # written whole, then swapped in: the app may be loading the preview right now
            if in_blender:
                img = bpy.data.images.get("Render Result")
                if img: img.save_render(tmp, scene=scene); os.replace(tmp, CFG["preview"])
            else:
                src = os.path.join(frames_dir, "f_%04d.png" % scene.frame_current)
                if os.path.exists(src):
                    import shutil; shutil.copyfile(src, tmp); os.replace(tmp, CFG["preview"])
        except Exception: pass
bpy.app.handlers.render_write.append(post)
t = time.time()
bpy.ops.render.render(animation=True)
print("PREVIZ_RENDER_SECONDS %.1f" % (time.time() - t), flush=True)
'''


def log_row(job, item, version, settings, output, status, seconds, note, script):
    log = os.path.join(job, "log.csv")
    new = not os.path.exists(log)
    run = 1
    if not new:
        with io.open(log, encoding="utf-8") as f:
            run = sum(1 for _ in csv.reader(f)) or 1
    with io.open(log, "a", encoding="utf-8", newline="") as f:
        w = csv.writer(f)
        if new:
            w.writerow(LOG_HEADER.split(","))
        now = time.localtime()
        w.writerow([run, time.strftime("%Y-%m-%d", now), time.strftime("%H:%M:%S", now), item + "-previz", "v%s" % version, "blender-previz",
                    os.path.relpath(script, job).replace("\\", "/"), "", settings, os.path.relpath(output, job).replace("\\", "/") if output else "",
                    status, seconds, note, 0, ""])
    return run


def main():
    ap = argparse.ArgumentParser(description="Render a Blender motion previz on this machine.")
    ap.add_argument("--job", required=True)
    ap.add_argument("--item", required=True, help="scene-01")
    ap.add_argument("--version", required=True)
    ap.add_argument("--script", required=True, help="the Blender Python script (relative to the job or the pipeline root)")
    ap.add_argument("--resolution", default="1080p", choices=sorted(RES))
    ap.add_argument("--aspect", default="16:9", choices=ASPECTS)
    ap.add_argument("--fps", type=int, default=24)
    ap.add_argument("--seconds", type=float, default=None, help="overrides the script's frame range")
    ap.add_argument("--engine", default="eevee", choices=["eevee", "workbench"])
    ap.add_argument("--samples", type=int, default=32, help="Eevee render samples (lower = faster)")
    ap.add_argument("--max-frames", type=int, default=1440)
    ap.add_argument("--timeout", type=int, default=3600)
    ap.add_argument("--keep-frames", action="store_true")
    ap.add_argument("--note", default="")
    ap.add_argument("--dry-run", action="store_true", help="check the script and the settings, render nothing")
    a = ap.parse_args()

    job = P(a.job)
    if not os.path.isdir(job):
        print("no such job folder: %s" % job); return 1
    script = a.script if os.path.isabs(a.script) else (os.path.join(job, a.script) if os.path.exists(os.path.join(job, a.script)) else P(a.script))
    if not os.path.isfile(script):
        print("no such script: %s" % script); return 1
    if not re.match(r"^scene-\d\d$", a.item) and not re.match(r"^[a-z0-9_-]+$", a.item):
        print("item should look like scene-01"); return 1
    src = io.open(script, encoding="utf-8").read()
    for bad in ("render.render(", "save_as_mainfile", "sys.exit("):
        if bad in src:
            print("the script must not call %s: the tool renders and saves; remove it" % bad.rstrip("(")); return 1
    w, h = RES[a.resolution]
    if a.aspect == "9:16": w, h = h, w
    elif a.aspect == "1:1": w = h
    elif a.aspect == "4:3": w = int(h * 4 / 3) // 2 * 2
    elif a.aspect == "21:9": w = int(h * 21 / 9) // 2 * 2
    out_dir = os.path.join(job, "scenes", a.item) if a.item.startswith("scene-") else os.path.join(job, "previz", a.item)
    os.makedirs(out_dir, exist_ok=True)
    stem = os.path.join(out_dir, "previz-v%s" % a.version)
    mp4, blend, preview, frames_dir, runlog = stem + ".mp4", stem + ".blend", stem + ".preview.png", stem + "-frames", stem + ".run.log"
    settings = "%s %s %dfps%s %s" % (a.aspect, a.resolution, a.fps, (" %gs" % a.seconds) if a.seconds else "", a.engine)

    exe = find_blender()
    if not exe:
        print("Blender not found: connect it in Settings > Connections (or install it from blender.org)"); return 3
    ver = blender_version(exe)
    ffmpeg = find_ffmpeg()
    if a.dry_run:
        print("blender %s at %s" % (ver, exe))
        print("script %s (%d lines) ok" % (script, src.count("\n") + 1))
        print("settings: %s, %dx%d, output %s" % (settings, w, h, mp4))
        print("encoder: %s" % ("ffmpeg at %s" % ffmpeg if ffmpeg else "Blender's own H.264 (no ffmpeg on this machine)"))
        print("would save %s  (no credits, renders on this machine)" % mp4)
        return 0

    if os.path.isdir(frames_dir):
        shutil.rmtree(frames_dir, ignore_errors=True)
    for p in (mp4, preview):
        if os.path.exists(p): os.remove(p)
    wrapper = stem + ".run.py"
    io.open(wrapper, "w", encoding="utf-8").write(WRAPPER)
    import json
    env = dict(os.environ)
    env["PREVIZ_CFG"] = json.dumps({"script": script, "w": w, "h": h, "fps": a.fps, "seconds": a.seconds, "engine": a.engine, "samples": a.samples,
                                    "blend": blend, "frames_dir": frames_dir, "preview": preview, "max_frames": a.max_frames,
                                    "mp4": mp4, "encode": "ffmpeg" if ffmpeg else "blender"})
    env["PYTHONUNBUFFERED"] = "1"
    print("rendering with Blender %s (%s, %dx%d, %d fps)" % (ver, a.engine, w, h, a.fps), flush=True)
    t0 = time.time()
    total = None
    lines = []
    try:
        p = subprocess.Popen([exe, "-b", "--python", wrapper], stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True, env=env, cwd=job, encoding="utf-8", errors="replace")
        while True:
            line = p.stdout.readline()
            if not line:
                if p.poll() is not None: break
                continue
            lines.append(line)
            if line.startswith("PREVIZ_FRAMES "): total = int(line.split()[1])
            elif line.startswith("frame "): print(line.strip(), flush=True)
            elif line.startswith("PREVIZ_ERROR") or "Error" in line or "Traceback" in line: print(line.strip(), flush=True)
            if time.time() - t0 > a.timeout:
                p.kill(); io.open(runlog, "w", encoding="utf-8").write("".join(lines)); print("timeout after %d s" % a.timeout); log_row(job, a.item, a.version, settings, None, "timeout", int(time.time() - t0), "blender %s; local" % ver, script); return 6
    except OSError as e:
        print("could not start Blender: %s" % e); return 3
    io.open(runlog, "w", encoding="utf-8").write("".join(lines))
    frames = sorted(glob.glob(os.path.join(frames_dir, "f_*.png")))
    in_blender = any(l.startswith("PREVIZ_FFMPEG_IN_BLENDER 1") for l in lines)
    if in_blender and os.path.exists(mp4) and os.path.getsize(mp4) > 0:
        frames = [None] * sum(1 for l in lines if l.startswith("frame "))
    if p.returncode != 0 or not frames:
        err = next((l.strip() for l in reversed(lines) if "Error" in l or "PREVIZ_ERROR" in l), "Blender exited %s" % p.returncode)
        print("Blender failed: %s  (log: %s)" % (err[:300], runlog))
        log_row(job, a.item, a.version, settings, None, "failed", int(time.time() - t0), "blender %s; %s" % (ver, err[:120]), script); return 5
    if total and len(frames) < total:
        print("note: %d of %d frames rendered" % (len(frames), total))
    # ---- encode
    if in_blender:
        pass                                   # Blender wrote the mp4 itself
    elif ffmpeg:
        first = int(re.search(r"f_(\d+)\.png$", frames[0]).group(1))
        cmd = [ffmpeg, "-y", "-v", "error", "-framerate", str(a.fps), "-start_number", str(first), "-i", os.path.join(frames_dir, "f_%04d.png"),
               "-c:v", "libx264", "-pix_fmt", "yuv420p", "-crf", "18", "-movflags", "+faststart", mp4]
        r = subprocess.run(cmd, capture_output=True, text=True)
        if r.returncode != 0 or not os.path.exists(mp4):
            print("ffmpeg failed: %s" % r.stderr[-300:]); log_row(job, a.item, a.version, settings, None, "failed", int(time.time() - t0), "encode failed", script); return 7
    else:
        print("frames rendered to %s but nothing could encode them: install ffmpeg (or set FFMPEG_PATH)" % frames_dir)
        log_row(job, a.item, a.version, settings, None, "no-encoder", int(time.time() - t0), "blender %s; frames only" % ver, script); return 7
    if not a.keep_frames:
        shutil.rmtree(frames_dir, ignore_errors=True)
    secs = int(time.time() - t0)
    run = log_row(job, a.item, a.version, settings + " %df" % len(frames), mp4, "completed", secs, ("blender %s; local" % ver) + ("; " + a.note if a.note else ""), script)
    kb = os.path.getsize(mp4) // 1024
    print("saved %s  (%d KB, %d frames, %d s, run #%d, blender %s, credits: 0)" % (mp4, kb, len(frames), secs, run, ver))
    return 0


if __name__ == "__main__":
    sys.exit(main())
