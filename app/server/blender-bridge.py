# Runs INSIDE the Blender GUI (blender.exe file.blend --python blender-bridge.py -- --port N --token T).
# A tiny localhost control socket so the app's Blender panel can drive the open Blender: play, scrub, change the
# view, reload the file the agent just saved, and (on a Mac, where the app cannot mirror the window) take screenshots.
# Mouse clicks and wheel never pass through here: on Windows the app posts them straight to the window.
import bpy, json, os, socket, sys, threading, time, traceback

argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
PORT = int(argv[argv.index("--port") + 1]) if "--port" in argv else 0
TOKEN = argv[argv.index("--token") + 1] if "--token" in argv else ""
inbox, outbox, clients = [], [], []
lock = threading.Lock()


def send_all(obj):
    line = (json.dumps(obj) + "\n").encode("utf-8")
    with lock:
        for c in list(clients):
            try: c.sendall(line)
            except Exception:
                try: c.close()
                except Exception: pass
                clients.remove(c)


def serve():
    srv = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    srv.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
    srv.bind(("127.0.0.1", PORT)); srv.listen(2)
    while True:
        conn, _ = srv.accept()
        threading.Thread(target=client, args=(conn,), daemon=True).start()


def client(conn):
    f = conn.makefile("r", encoding="utf-8")
    authed = not TOKEN
    for line in f:
        try: msg = json.loads(line)
        except Exception: continue
        if not authed:
            if msg.get("token") == TOKEN:
                authed = True
                with lock: clients.append(conn)
                conn.sendall((json.dumps({"k": "hello", "pid": os.getpid(), "version": bpy.app.version_string}) + "\n").encode())
            continue
        with lock: inbox.append(msg)
    with lock:
        if conn in clients: clients.remove(conn)
    try: conn.close()
    except Exception: pass


def view3d():
    win = bpy.context.window_manager.windows[0]
    for area in win.screen.areas:
        if area.type == "VIEW_3D":
            region = next((r for r in area.regions if r.type == "WINDOW"), None)
            return win, area, region
    return win, None, None


def look_through_camera():
    """A previz .blend is saved headless (no UI), so the viewport opens on Blender's default angle. Show the cinebot camera
    instead, with the scene's frame range on the timeline: the user sees the shot the agent built, not the floor."""
    try:
        sc = bpy.context.scene
        if not sc.camera:
            return None
        for win in bpy.context.window_manager.windows:
            for area in win.screen.areas:
                if area.type == "VIEW_3D":
                    for sp in area.spaces:
                        if sp.type == "VIEW_3D":
                            sp.region_3d.view_perspective = "CAMERA"
                            sp.shading.type = "MATERIAL"     # the materials and the label, as the render shows them
                    area.tag_redraw()
                elif area.type == "DOPESHEET_EDITOR":
                    for sp in area.spaces:
                        if sp.type == "DOPESHEET_EDITOR":
                            for reg in area.regions:
                                if reg.type == "WINDOW":
                                    try:
                                        with bpy.context.temp_override(window=win, area=area, region=reg):
                                            bpy.ops.action.view_all()
                                    except Exception:
                                        pass
    except Exception:
        traceback.print_exc()
    return None     # a timer that returns a number re-arms itself; this must run once


def override(fn):
    win, area, region = view3d()
    if area is None: return fn()
    with bpy.context.temp_override(window=win, area=area, region=region, screen=win.screen):
        return fn()


VIEW_AXES = {"top": "TOP", "bottom": "BOTTOM", "front": "FRONT", "back": "BACK", "right": "RIGHT", "left": "LEFT"}
KEYS = {  # the keys the panel forwards; everything else is ignored on purpose (the mouse does the rest)
    "numpad7": ("view", "top"), "numpad1": ("view", "front"), "numpad3": ("view", "right"), "numpad0": ("view", "camera"),
    "home": ("view", "all"), "numpad.": ("view", "selected"), " ": ("playtoggle", None), "space": ("playtoggle", None),
    "arrowleft": ("step", -1), "arrowright": ("step", 1), "arrowup": ("jump", 1), "arrowdown": ("jump", -1),
    "shift+arrowleft": ("jumpend", "start"), "shift+arrowright": ("jumpend", "end"),
    "escape": ("stop", None), "numpad5": ("persp", None), "z": ("shade", None),
}


def view_mode():
    try:
        _, area, _ = view3d()
        for sp in (area.spaces if area else []):
            if sp.type == "VIEW_3D":
                return sp.region_3d.view_perspective + "/" + sp.shading.type
    except Exception:
        pass
    return ""


def state():
    sc = bpy.context.scene
    playing = bool(bpy.context.screen and bpy.context.screen.is_animation_playing)
    try: playing = bool(bpy.context.window_manager.windows[0].screen.is_animation_playing)
    except Exception: pass
    return {"k": "state", "file": bpy.data.filepath, "frame": sc.frame_current, "start": sc.frame_start, "end": sc.frame_end,
            "fps": sc.render.fps, "playing": playing, "camera": sc.camera.name if sc.camera else "", "objects": len(sc.objects), "view": view_mode()}


def do(msg):
    k = msg.get("k")
    sc = bpy.context.scene
    if k == "open":
        p = msg.get("path", "")
        if p and os.path.isfile(p):
            bpy.ops.wm.open_mainfile(filepath=p)
            bpy.app.timers.register(look_through_camera, first_interval=0.2)
            return {"k": "opened", "path": p}
        return {"k": "error", "message": "no such file: %s" % p}
    if k == "frame":
        sc.frame_set(max(sc.frame_start, min(sc.frame_end, int(msg.get("n", sc.frame_current)))))
    elif k == "play" or k == "playtoggle" or k == "pause":
        win = bpy.context.window_manager.windows[0]
        playing = win.screen.is_animation_playing
        if (k == "play" and not playing) or (k == "pause" and playing) or k == "playtoggle":
            override(lambda: bpy.ops.screen.animation_play())
    elif k == "stop":
        override(lambda: bpy.ops.screen.animation_cancel(restore_frame=False))
    elif k == "step":
        override(lambda: bpy.ops.screen.frame_offset(delta=int(msg.get("n", 1))))
    elif k == "jump":
        override(lambda: bpy.ops.screen.keyframe_jump(next=int(msg.get("n", 1)) > 0))
    elif k == "jumpend":
        override(lambda: bpy.ops.screen.frame_jump(end=msg.get("to") == "end"))
    elif k == "view":
        v = msg.get("v", "camera")
        if v in VIEW_AXES: override(lambda: bpy.ops.view3d.view_axis(type=VIEW_AXES[v]))
        elif v == "camera": override(lambda: bpy.ops.view3d.view_camera())
        elif v == "all": override(lambda: bpy.ops.view3d.view_all(center=False))
        elif v == "selected": override(lambda: bpy.ops.view3d.view_selected())
    elif k == "persp":
        override(lambda: bpy.ops.view3d.view_persportho())
    elif k == "shade":
        _, area, _ = view3d()
        if area:
            sp = area.spaces.active; sp.shading.type = {"SOLID": "MATERIAL", "MATERIAL": "RENDERED", "RENDERED": "WIREFRAME"}.get(sp.shading.type, "SOLID")
    elif k == "key":
        name = str(msg.get("key", "")).lower()
        if msg.get("shift"): name = "shift+" + name
        act = KEYS.get(name)
        if act:
            a, arg = act
            if a == "view": do({"k": "view", "v": arg})
            elif a == "step": do({"k": "step", "n": arg})
            elif a == "jump": do({"k": "jump", "n": arg})
            elif a == "jumpend": do({"k": "jumpend", "to": arg})
            else: do({"k": a})
    elif k in ("orbit", "pan", "zoom"):   # Mac fallback (no window mirroring): the panel's drags come here as view maths
        _, area, region = view3d()
        if region is None: return None
        r3 = area.spaces.active.region_3d
        from mathutils import Quaternion, Vector, Matrix
        if k == "orbit":
            dx, dy = float(msg.get("dx", 0)), float(msg.get("dy", 0))
            q = r3.view_rotation.copy()
            yaw = Quaternion((0, 0, 1), -dx * 0.01)
            right = (q @ Vector((1, 0, 0))).normalized()
            pitch = Quaternion(right, -dy * 0.01)
            r3.view_rotation = (yaw @ pitch @ q).normalized()
            if r3.view_perspective == "CAMERA": r3.view_perspective = "PERSP"
        elif k == "pan":
            dx, dy = float(msg.get("dx", 0)), float(msg.get("dy", 0))
            q = r3.view_rotation
            r3.view_location += (q @ Vector((-dx, dy, 0))) * r3.view_distance * 0.002
        else:
            r3.view_distance = max(0.05, r3.view_distance * (1.1 ** float(msg.get("d", 0))))
        area.tag_redraw()
    elif k == "shot":   # Mac fallback: a screenshot of the whole window, written where the app asked
        p = msg.get("path")
        if p:
            override(lambda: bpy.ops.screen.screenshot(filepath=p))
            return {"k": "shot", "path": p}
    elif k == "front":
        pass  # handled outside Blender on Windows; on a Mac the app runs `open -a`
    elif k == "state":
        return state()
    return None


last_state = None


def tick():
    global last_state
    with lock:
        msgs = inbox[:]; del inbox[:]
    for m in msgs:
        try:
            r = do(m)
            if r: send_all(r)
        except Exception as e:
            send_all({"k": "error", "message": str(e)[:200]})
            traceback.print_exc()
    try:
        s = state()
        key = json.dumps(s, sort_keys=True)
        if key != last_state:
            last_state = key; send_all(s)
    except Exception:
        pass
    return 0.05


threading.Thread(target=serve, daemon=True).start()
bpy.app.timers.register(tick, persistent=True)
bpy.app.timers.register(look_through_camera, first_interval=0.3)
print("BRIDGE_READY %d" % PORT, flush=True)
