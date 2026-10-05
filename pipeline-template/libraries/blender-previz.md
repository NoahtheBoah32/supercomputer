# Blender previz: the motion reference

A previz is a low-poly Blender render of the camera move. Seedance cannot be told "cinebot, lightning fast,
top shot then frontal then push to the label" and get it right; it can follow a clip that shows exactly that.
The previz is that clip. Nobody looks at it for beauty: the shapes are primitives, the lighting is flat, the
only thing that has to be perfect is the motion, the timing and the framing.

Benchmark: Leo's `bottle_cinebot` previz. 200 frames, 24 fps, 1920x1080. A low-poly bottle with a wrapped
label on a two-tier round platform in a round studio, five shots in one continuous camera: top shot, frontal,
push into the label, pull out to the full bottle, a 360 orbit that stops dead on the front face. What makes it
read as a cinebot, and what a stiff previz lacks:

- **Whip moves.** Every move is a quintic ease-in-out over 10 to 12 frames: violent acceleration, top speed
  mid-move, a hard stop. Not a Bezier ease-out from sparse keyframes (that snaps at the start and dribbles in).
- **The camera never sits still.** During every hold it creeps: a slow push of 10 to 35 cm or a few degrees of
  drift over the whole hold. A frozen frame between whips is what reads as "stiff".
- **Motion blur on** (`use_motion_blur = True`, shutter 0.5). It sells the speed of the whips.
- **Orbit space.** The camera is driven by orbit parameters around the subject (distance, elevation, azimuth,
  target height, lens), and the move interpolates those, so a top-to-front whip sweeps around the bottle and
  the 360 is a single whip of the azimuth, not a chain of linear keys.
- **One keyframe per frame.** The script computes the camera state for every frame and keys it; the curves are
  then exactly the easing you wrote, with nothing left to Blender's interpolation.

## How it runs

You write the script. `tools/blender_previz.py` runs it inside Blender in background mode, forces the render
settings, renders the frames and encodes the clip. Read the tool's docstring once for the flags.

```
python tools/blender_previz.py --job jobs/<job> --item scene-NN --version N \
    --script scenes/scene-NN/previz-vN.py --resolution 1080p --fps 24
```

Output, next to the script: `previz-vN.mp4` (the clip), `previz-vN.blend` (the scene, opens in Blender),
`previz-vN.preview.png` (the latest frame while rendering), `previz-vN.run.log` (Blender's output). The clip is
encoded by ffmpeg when the machine has it, else by Blender's own H.264 encoder; either way it is a plain mp4.
Nothing costs credits. Rendering takes about 0.5 to 1.5 s per 1080p frame on a laptop (Eevee, 32 samples,
motion blur); 200 frames is 2 to 5 minutes. Use `--engine workbench` for a fast flat check of the motion, then
Eevee for the version that goes to Seedance.

## The script contract

- First lines: `# Blender: <one or two lines: the shots and the camera moves in order>`. The app shows this
  comment in the approval panel; it is the only description the user sees before the render.
- Start from nothing: the tool loads an empty file for you. Build everything in the script (`bmesh` for the
  shapes, as in the example, or `bpy.ops.mesh.primitive_*`), one camera, lights, a world.
- Set `scene.frame_end` (frame_start is 1). 24 fps unless the job says otherwise.
- Set `scene.camera`. One camera. Several shots in one clip = one camera that whips between them.
- Never render, never save, never set the output path, never call `sys.exit`. The tool refuses scripts that
  contain `render.render(`, `save_as_mainfile` or `sys.exit(`. Engine, resolution, fps, frame range and
  samples come from the tool's flags; motion blur and the view transform are yours (set them as the example
  does).
- Keep it under ~220 lines. Low poly on purpose: 16 to 32 segments, flat shading, no subdivision, no textures.
- Materials: Principled BSDF with a base colour, roughness, metallic; nothing else. Give the hero object one
  clear colour, the rest soft neutrals. A label on a bottle is a thin cylinder band plus text wrapped onto the
  cylinder (the example's `wrapped_text`), so the "push to the label" shot has something to land on.
- Studio: a round floor that curves up into a wall all the way around (the example's `Studio` lathe), so a
  360 orbit never sees an edge, plus a soft world colour. Never a flat plane with a black horizon.
- Lights: a big soft key, a rim from behind, a low fill. That is all.
- Framing: a "full bottle" shot shows the whole bottle, cap included, and the platform, with air above the cap
  (at 50 mm on the default 36 mm sensor a 16:9 frame is 0.405 x the camera distance tall). The top shot fills
  the frame with the platform. The label shot lands on the text. Look at the preview frames the app shows
  while it renders; a cropped cap is a redo.
- Depth of field is optional; motion blur is not.

## The camera engine (copy it, change only the positions and the TIMELINE)

The camera is described by orbit parameters around the subject, not by raw coordinates:

| key | meaning |
|---|---|
| `r` | distance from the subject, metres |
| `el` | height angle in degrees (90 = straight down, 0 = level) |
| `az` | angle around the subject in degrees (-90 = front) |
| `tz` | the height the camera aims at |
| `lens` | focal length in mm |

Named positions (`TOP`, `FRONT`, `LABEL`, `FULL`, ...) are dicts of those keys. `TIMELINE` strings them
together as `(end frame, state reached at that frame, easing of the segment leading to it)`:

- `"whip"` = a cinebot move. 10 to 12 frames for a reposition, 36 to 42 frames for a full 360 (the azimuth
  goes from -90 to 270, one turn that lands back on the front). Fewer frames = faster.
- `"drift"` = a hold. Always give the hold a `creep(STATE, r=-0.3, az=10)` so the camera keeps moving slowly.
- Holds are 18 to 30 frames; the last segment settles for 20 to 30 frames after the orbit stops.

`state_at(f)` interpolates between the two states around frame `f` with that easing; the loop at the end keys
the camera's location, rotation and lens on every frame. A drone fly-through, a crane down, a dolly in: same
engine, different states (a flight path is a list of states with `"whip"` or `"drift"` segments).

## Worked example: the bottle on a platform (Leo's prompt, Leo's benchmark)

```python
# Blender: cinebot product shot of a low-poly bottle on a round platform. 1 top shot with a slow creep, 2 whip to
# a frontal of the full bottle, 3 snap push into the label, 4 snap pull out to the full bottle, 5 a 360 orbit in
# 1.75 s that stops dead on the front face. Whips are quintic with motion blur; every hold creeps. 200 frames, 24 fps.
import bpy, bmesh, math
from mathutils import Matrix, Vector

scene = bpy.context.scene
FPS = 24

def mat(name, rgb, rough=0.6, metal=0.0):
    m = bpy.data.materials.new(name); m.use_nodes = True
    bsdf = m.node_tree.nodes["Principled BSDF"]
    bsdf.inputs["Base Color"].default_value = (*rgb, 1); bsdf.inputs["Roughness"].default_value = rough; bsdf.inputs["Metallic"].default_value = metal
    return m

def mesh_obj(name, bm, material):
    me = bpy.data.meshes.new(name); bm.to_mesh(me); bm.free()
    for p in me.polygons: p.use_smooth = False          # flat shading = the low-poly look
    me.materials.append(material)
    o = bpy.data.objects.new(name, me); scene.collection.objects.link(o); return o

def cylinder(name, material, r, z0, h, segs, caps=True, rot=0.0):
    bm = bmesh.new()
    m = Matrix.Translation((0, 0, z0 + h / 2)) @ Matrix.Rotation(rot, 4, "Z")
    bmesh.ops.create_cone(bm, cap_ends=caps, segments=segs, radius1=r, radius2=r, depth=h, matrix=m)
    if not caps: bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    return mesh_obj(name, bm, material)

def lathe(name, material, profile, segs, rot=0.0):
    """Revolve a (radius, z) profile around Z, capped top and bottom."""
    bm = bmesh.new(); rings = []
    for r, z in profile:
        rings.append([bm.verts.new((r * math.cos(rot + 2 * math.pi * i / segs), r * math.sin(rot + 2 * math.pi * i / segs), z)) for i in range(segs)])
    for a, b in zip(rings, rings[1:]):
        for i in range(segs):
            j = (i + 1) % segs; bm.faces.new((a[i], a[j], b[j], b[i]))
    bm.faces.new(list(reversed(rings[0]))); bm.faces.new(rings[-1])
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    return mesh_obj(name, bm, material)

# --- palette ---
M_BACK = mat("Backdrop", (0.93, 0.72, 0.6), rough=0.9)
M_PLAT_TOP = mat("PlatformTop", (0.96, 0.94, 0.9), rough=0.5)
M_PLAT_BASE = mat("PlatformBase", (0.82, 0.76, 0.7), rough=0.6)
M_GLASS = mat("BottleGlass", (0.06, 0.42, 0.4), rough=0.12)
M_CAP = mat("Cap", (0.85, 0.64, 0.25), rough=0.3, metal=1.0)
M_LABEL = mat("Label", (0.96, 0.93, 0.85), rough=0.7)
M_STRIPE = mat("Stripe", (0.85, 0.38, 0.26), rough=0.6)
M_INK = mat("Ink", (0.07, 0.1, 0.18), rough=0.5)

# --- round studio: floor curving up into a wall all the way around (clean 360 orbit) ---
cyc = [(0.001, 0.0), (8.0, 0.0)]
for i in range(1, 9):
    a = math.pi / 2 * i / 8; cyc.append((8 + 4 * math.sin(a), 4 * (1 - math.cos(a))))
cyc.append((12.0, 25.0))
lathe("Studio", M_BACK, cyc, 64)

# --- platform: two-tier disc ---
cylinder("PlatformBase", M_PLAT_BASE, 1.15, 0.0, 0.12, 24)
cylinder("PlatformTop", M_PLAT_TOP, 0.95, 0.12, 0.10, 24)
BASE_Z = 0.22

# --- bottle: a (radius, height) profile spun into 3D, base to neck ---
SEG = 16
lathe("Bottle", M_GLASS, [(r, BASE_Z + z) for r, z in [
    (0.30, 0.0), (0.36, 0.04), (0.36, 0.95), (0.33, 1.08), (0.22, 1.22),
    (0.13, 1.32), (0.12, 1.50), (0.135, 1.52), (0.135, 1.54)]], SEG, rot=math.pi / SEG)
cylinder("Cap", M_CAP, 0.148, BASE_Z + 1.50, 0.15, 12)

LABEL_R = 0.366
LABEL_Z0, LABEL_Z1 = BASE_Z + 0.30, BASE_Z + 0.80
LABEL_MID = (LABEL_Z0 + LABEL_Z1) / 2
cylinder("Label", M_LABEL, LABEL_R, LABEL_Z0, LABEL_Z1 - LABEL_Z0, 32, caps=False)
cylinder("StripeLow", M_STRIPE, LABEL_R + 0.002, LABEL_Z0 + 0.03, 0.03, 32, caps=False)
cylinder("StripeHigh", M_STRIPE, LABEL_R + 0.002, LABEL_Z1 - 0.06, 0.03, 32, caps=False)

def wrapped_text(name, body, size, z_centre, spacing=1.0):
    """Text mesh bent around the label cylinder, centred on the bottle's front (-Y)."""
    cu = bpy.data.curves.new(name, "FONT")
    cu.body, cu.size, cu.extrude = body, size, 0.0015
    cu.align_x, cu.align_y = "CENTER", "CENTER"; cu.space_character = spacing
    tmp = bpy.data.objects.new(name + "_tmp", cu); scene.collection.objects.link(tmp)
    dg = bpy.context.evaluated_depsgraph_get()
    me = bpy.data.meshes.new_from_object(tmp.evaluated_get(dg)); bpy.data.objects.remove(tmp)
    r0 = LABEL_R + 0.004
    for v in me.vertices:
        x, y, z = v.co; a, r = x / r0, r0 + z
        v.co = (r * math.sin(a), -r * math.cos(a), z_centre + y)
    me.materials.append(M_INK)
    o = bpy.data.objects.new(name, me); scene.collection.objects.link(o); return o

wrapped_text("Brand", "AURA", 0.17, LABEL_MID + 0.04, spacing=1.15)
wrapped_text("Tagline", "SPARKLING WATER", 0.045, LABEL_MID - 0.11, spacing=1.2)

# --- lighting: big soft key, rim, fill ---
TARGET = Vector((0, 0, BASE_Z + 0.8))
def area(name, loc, power, size, color=(1, 1, 1)):
    ld = bpy.data.lights.new(name, "AREA"); ld.energy, ld.size, ld.color = power, size, color
    o = bpy.data.objects.new(name, ld); o.location = loc
    o.rotation_euler = (TARGET - Vector(loc)).to_track_quat("-Z", "Y").to_euler()
    scene.collection.objects.link(o)
area("Key", (-3.2, -3.0, 4.0), 260, 3.0, (1.0, 0.96, 0.9))
area("Rim", (2.8, 3.2, 3.2), 220, 2.0, (0.85, 0.92, 1.0))
area("Fill", (3.5, -3.5, 1.6), 70, 3.0)

world = bpy.data.worlds.new("World"); world.use_nodes = True
world.node_tree.nodes["Background"].inputs["Color"].default_value = (0.93, 0.75, 0.65, 1)
world.node_tree.nodes["Background"].inputs["Strength"].default_value = 0.25
scene.world = world

# --- cinebot camera: driven by orbit parameters around the bottle ---
cam_data = bpy.data.cameras.new("Cinebot"); cam_data.clip_start = 0.05
cam = bpy.data.objects.new("Cinebot", cam_data); scene.collection.objects.link(cam); scene.camera = cam

FULL_Z = BASE_Z + 0.52   # frame centre for full-bottle shots (keeps the platform in view, air above the cap)
TOP = dict(r=3.8, el=90, az=-90, tz=FULL_Z, lens=50)
FRONT = dict(r=6.0, el=8, az=-90, tz=FULL_Z, lens=50)
LABEL = dict(r=1.4, el=3, az=-90, tz=LABEL_MID, lens=50)
FULL = dict(r=6.3, el=10, az=-90, tz=FULL_Z, lens=50)

def creep(state, **delta):  # the slow drift a rig does while "holding"
    s = dict(state)
    for k, v in delta.items(): s[k] += v
    return s

# (end frame, state at the end frame, easing of the segment leading to it)
# "whip" = cinebot move: violent acceleration, hard stop.  "drift" = slow hold that keeps creeping.
TIMELINE = [
    (1, TOP, None),
    (28, creep(TOP, r=-0.35, az=12), "drift"),                     # 1  top shot, creeping in and turning
    (40, FRONT, "whip"),                                            #    whip down to the front in 12 frames
    (64, creep(FRONT, r=-0.25), "drift"),                           # 2  frontal, slow push
    (74, LABEL, "whip"),                                            #    snap into the label in 10 frames
    (100, creep(LABEL, r=-0.12), "drift"),                          # 3  label, slow push
    (110, FULL, "whip"),                                            #    snap out in 10 frames
    (128, creep(FULL, r=-0.2), "drift"),                            # 4  full bottle, slow push
    (170, dict(r=6.0, el=8, az=270, tz=FULL_Z, lens=50), "whip"),   # 5  360 orbit in 42 frames, lands on the front
    (200, dict(r=5.8, el=8, az=270, tz=FULL_Z, lens=50), "drift"),  #    settle on the front face
]
FRAMES = TIMELINE[-1][0]
scene.frame_start, scene.frame_end = 1, FRAMES

def ease(kind, t):
    if kind == "whip":  # quintic in-out: near-instant mid-move speed, snap stop
        return 16 * t ** 5 if t < 0.5 else 1 - (-2 * t + 2) ** 5 / 2
    return t * t * (3 - 2 * t) if kind == "settle" else t

def state_at(f):
    for (f0, s0, _), (f1, s1, kind) in zip(TIMELINE, TIMELINE[1:]):
        if f0 <= f <= f1:
            t = ease(kind, (f - f0) / (f1 - f0))
            return {k: s0[k] + (s1[k] - s0[k]) * t for k in s0}
    return TIMELINE[-1][1]

def apply(s):
    el, az = math.radians(s["el"]), math.radians(s["az"])
    cam.location = (s["r"] * math.cos(el) * math.cos(az), s["r"] * math.cos(el) * math.sin(az), s["tz"] + s["r"] * math.sin(el))
    cam.rotation_euler = (math.pi / 2 - el, 0, az + math.pi / 2)   # look at the target: tilt by elevation, pan by azimuth
    cam_data.lens = s["lens"]

for f in range(1, FRAMES + 1):     # one key per frame: the curves are exactly the easing above
    apply(state_at(f))
    cam.keyframe_insert("location", frame=f); cam.keyframe_insert("rotation_euler", frame=f); cam_data.keyframe_insert("lens", frame=f)

# --- look: motion blur sells the whips; Standard view keeps the colours as written ---
scene.render.use_motion_blur = True
scene.render.motion_blur_shutter = 0.5
scene.view_settings.view_transform = "Standard"
```

What the user sees: the script streams into the chat while you write it, the approval panel shows the
`# Blender:` lines with the resolution, fps and engine, the card shows the latest rendered frame while Blender
works, then the clip. If Blender is open in the side panel it reloads the new `.blend` by itself.
