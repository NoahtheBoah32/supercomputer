"""previz_frames.py: turn a previz clip into frames the video director can READ, one per second.

Leo's way of prompting Seedance from a previz: "Write a [x]-second Seedance prompt based on this
video blocking. Read the input video and write out second by second to match the camera moves in
the clip. [x] fps, (aspect ratio) [x]:[x]. [Scene description]". The agent cannot watch an mp4, so
this tool lays the clip out as pictures:

    python tools/previz_frames.py --job jobs/<job> --item scene-NN [--per-second 2] [--file <mp4>]

Reads  scenes/scene-NN/previz-approved.mp4 (or --file), writes next to it:
    previz-frames/t_00.0s.png, t_00.5s.png, ...   one frame every 1/--per-second seconds, the time
                                                   burned into the corner (default 2 per second)
    previz-frames/sheet.png                        a contact sheet of the same frames, 6 per row
and prints one line per frame plus a summary:
    PREVIZ_CLIP fps=24 frames=192 seconds=8.00 size=1920x1080 aspect=16:9
    PREVIZ_FRAME 0.0 previz-frames/t_00.0s.png
    ...
    PREVIZ_SHEET previz-frames/sheet.png
The video director Reads the sheet first (the whole move at a glance), then the single frames
around every cut or whip, and writes the ACTION block one second per line. The clip's fps and
aspect go into the prompt's first line. Uses OpenCV; falls back to ffmpeg when OpenCV is missing.
Exit codes: 0 ok | 2 bad arguments or no clip | 3 the clip could not be read.
"""
import argparse
import math
import os
import shutil
import subprocess
import sys


def aspect_of(w, h):
    g = math.gcd(int(w), int(h)) or 1
    a, b = int(w) // g, int(h) // g
    common = {(16, 9): "16:9", (9, 16): "9:16", (4, 3): "4:3", (3, 4): "3:4", (1, 1): "1:1", (21, 9): "21:9", (64, 27): "21:9", (3, 2): "3:2", (2, 3): "2:3"}
    return common.get((a, b), "%d:%d" % (a, b))


def with_cv2(src, out_dir, per_second):
    import cv2
    cap = cv2.VideoCapture(src)
    if not cap.isOpened():
        return None
    fps = cap.get(cv2.CAP_PROP_FPS) or 24.0
    n = int(cap.get(cv2.CAP_PROP_FRAME_COUNT) or 0)
    w, h = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH)), int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))
    seconds = n / fps if fps else 0
    step = 1.0 / per_second
    times, files, thumbs = [], [], []
    t = 0.0
    while t < seconds - 1e-6:
        idx = min(n - 1, int(round(t * fps)))
        cap.set(cv2.CAP_PROP_POS_FRAMES, idx)
        ok, frame = cap.read()
        if not ok:
            break
        label = "%.1fs  f%d" % (t, idx + 1)
        cv2.rectangle(frame, (0, 0), (18 + 15 * len(label), 40), (0, 0, 0), -1)
        cv2.putText(frame, label, (10, 29), cv2.FONT_HERSHEY_SIMPLEX, 0.9, (255, 255, 255), 2, cv2.LINE_AA)
        name = "t_%04.1fs.png" % t
        p = os.path.join(out_dir, name)
        cv2.imwrite(p, frame)
        times.append(t); files.append(p)
        th = cv2.resize(frame, (320, max(1, int(320 * h / w))))
        cv2.rectangle(th, (0, 0), (14 + 11 * len(label), 26), (0, 0, 0), -1)
        cv2.putText(th, label, (6, 19), cv2.FONT_HERSHEY_SIMPLEX, 0.55, (255, 255, 255), 1, cv2.LINE_AA)
        thumbs.append(th)
        t += step
    cap.release()
    sheet = None
    if thumbs:
        import numpy as np
        cols = 6
        rows = int(math.ceil(len(thumbs) / cols))
        th, tw = thumbs[0].shape[:2]
        canvas = np.zeros((rows * th, cols * tw, 3), dtype=np.uint8)
        for i, im in enumerate(thumbs):
            r, c = divmod(i, cols)
            canvas[r * th:(r + 1) * th, c * tw:(c + 1) * tw] = im
        sheet = os.path.join(out_dir, "sheet.png")
        cv2.imwrite(sheet, canvas)
    return dict(fps=fps, frames=n, seconds=seconds, w=w, h=h, times=times, files=files, sheet=sheet)


def with_ffmpeg(src, out_dir, per_second):
    ff = shutil.which("ffmpeg"); fp = shutil.which("ffprobe")
    if not ff:
        return None
    fps, n, w, h = 24.0, 0, 0, 0
    if fp:
        try:
            out = subprocess.run([fp, "-v", "error", "-select_streams", "v:0", "-show_entries", "stream=r_frame_rate,nb_frames,width,height", "-of", "csv=p=0", src], capture_output=True, text=True, timeout=60).stdout.strip().split(",")
            w, h = int(out[0]), int(out[1]); num, den = out[2].split("/"); fps = float(num) / float(den or 1); n = int(out[3] or 0)
        except Exception:
            pass
    pattern = os.path.join(out_dir, "t_%04d.png")
    subprocess.run([ff, "-v", "error", "-y", "-i", src, "-vf", "fps=%s,drawtext=text='%%{pts\\:hms}':x=10:y=10:fontsize=28:fontcolor=white:box=1:boxcolor=black" % per_second, pattern], check=False, timeout=600)
    files = sorted(os.path.join(out_dir, f) for f in os.listdir(out_dir) if f.startswith("t_") and f.endswith(".png"))
    times = [i / per_second for i in range(len(files))]
    renamed = []
    for t, p in zip(times, files):
        q = os.path.join(out_dir, "t_%04.1fs.png" % t); os.replace(p, q); renamed.append(q)
    sheet = os.path.join(out_dir, "sheet.png")
    subprocess.run([ff, "-v", "error", "-y", "-i", src, "-vf", "fps=%s,scale=320:-1,tile=6x%d" % (per_second, max(1, int(math.ceil(len(renamed) / 6)))), "-frames:v", "1", sheet], check=False, timeout=600)
    seconds = n / fps if (n and fps) else len(renamed) / per_second
    return dict(fps=fps, frames=n, seconds=seconds, w=w, h=h, times=times, files=renamed, sheet=sheet if os.path.exists(sheet) else None)


def main():
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("--job", required=True, help="jobs/<job>")
    ap.add_argument("--item", required=True, help="scene-NN")
    ap.add_argument("--file", help="a clip other than previz-approved.mp4 (for example previz-v2.mp4)")
    ap.add_argument("--per-second", type=int, default=2, help="frames per second of clip to write (default 2)")
    a = ap.parse_args()
    scene_dir = os.path.join(a.job, "scenes", a.item)
    src = a.file or os.path.join(scene_dir, "previz-approved.mp4")
    if not os.path.isfile(src):
        print("error: no clip at %s (approve the previz first, or pass --file)" % src); sys.exit(2)
    out_dir = os.path.join(os.path.dirname(src), "previz-frames")
    if os.path.isdir(out_dir):
        shutil.rmtree(out_dir, ignore_errors=True)
    os.makedirs(out_dir, exist_ok=True)
    per = max(1, min(8, a.per_second))
    info = None
    try:
        info = with_cv2(src, out_dir, per)
    except ImportError:
        info = None
    if info is None:
        info = with_ffmpeg(src, out_dir, per)
    if not info or not info["files"]:
        print("error: the clip could not be read (no OpenCV and no ffmpeg, or an empty file)"); sys.exit(3)
    print("PREVIZ_CLIP fps=%g frames=%d seconds=%.2f size=%dx%d aspect=%s" % (round(info["fps"], 3), info["frames"], info["seconds"], info["w"], info["h"], aspect_of(info["w"], info["h"]) if info["w"] else "?"))
    for t, p in zip(info["times"], info["files"]):
        print("PREVIZ_FRAME %.1f %s" % (t, os.path.relpath(p, a.job).replace("\\", "/")))
    if info["sheet"]:
        print("PREVIZ_SHEET %s" % os.path.relpath(info["sheet"], a.job).replace("\\", "/"))
    print("%d frames in %s" % (len(info["files"]), os.path.abspath(out_dir)))


if __name__ == "__main__":
    main()
