"""
VisADLs export script – version 3 ("record the movement").

Records the people, equipment and movement of the original VisADLs scenes (Unreal Engine 5.5
project ADLs_Final) so they can be rebuilt in the VisADLs web app.

Why version 3: the movement in these scenes is MetaHuman Control Rig keyframes, and Unreal's own
"bake to animation" function failed on them. This version plays each sequence frame by frame – just
like scrubbing the timeline in Sequencer – and writes down where every bone of each person and every
piece of equipment is, 30 times per second.

HOW TO RUN (Unreal Engine 5.5):
  1. Open ADLs_Final.uproject and wait until the editor has fully loaded.
  2. Menu: Tools > Execute Python Script...  and choose this file.
  3. Unreal opens each scene and steps through it. You will see the people move in the viewport.
     The bed transfer is 5 minutes long, so this takes roughly 10-20 minutes in total.
     Leave Unreal in front and don't click anything until the "Finished" message appears.
  4. The output folder opens by itself: <project>/Saved/VisADLsExport_v3
  5. Upload that whole folder to Google Drive.
  6. When you close Unreal, if it asks to save anything, choose "Don't Save".

Output, per scene:
  <scene>_motion.json   names, skeleton, rest pose, equipment, room objects, frame rate
  <scene>_motion.bin    the recorded movement (binary)
  meshes/*.fbx          each person's body, face and clothing; each piece of equipment
Nothing in the project is changed.
"""

import json
import os
import struct
import traceback

import unreal

SCENES = [
    ("P1Turn360", "/Game/P1Turn360", "/Game/Persona1Sequence/P1Turn360"),
    ("P2BedTransfer", "/Game/P2BedTransfer", "/Game/Persona2Sequence/P2BedTransfer"),
    ("P3Hallway", "/Game/P3Hallway", "/Game/Persona3Sequence/P3Hallway"),
]
SAMPLE_FPS = 30      # recorded frames per second
WAIT_TICKS = 2       # editor ticks to wait after moving the timeline, so the pose has updated
TEST_SECONDS = None  # set e.g. to 5 to record only the first 5 seconds of each scene (quick test)

OUT_ROOT = os.path.join(unreal.Paths.convert_relative_path_to_full(unreal.Paths.project_saved_dir()), "VisADLsExport_v3")
log_lines = []


def _save_log():
    try:
        os.makedirs(OUT_ROOT, exist_ok=True)
        with open(os.path.join(OUT_ROOT, "export_log.txt"), "w", encoding="utf-8") as f:
            f.write("\n".join(log_lines))
    except Exception:
        pass


def log(msg):
    unreal.log("[VisADLs export] " + msg)
    log_lines.append(msg)
    _save_log()


def warn(msg):
    unreal.log_warning("[VisADLs export] " + msg)
    log_lines.append("WARNING: " + msg)
    _save_log()


def safe(s):
    return "".join(c if c.isalnum() or c in "-_" else "_" for c in str(s))[:60]


def cls_name(o):
    try:
        return o.get_class().get_name()
    except Exception:
        return type(o).__name__


def tf_list(t):
    """Transform -> [tx,ty,tz, qx,qy,qz,qw, sx,sy,sz] (Unreal units: cm, Z up)."""
    q, p, s = t.rotation, t.translation, t.scale3d
    return [p.x, p.y, p.z, q.x, q.y, q.z, q.w, s.x, s.y, s.z]


# --------------------------------------------------------------------------------------------- meshes

exported_meshes = {}


def export_mesh(mesh, folder):
    path = mesh.get_path_name().split(".")[0]
    if path in exported_meshes:
        return exported_meshes[path]
    fname = os.path.join(folder, safe(mesh.get_name()) + ".fbx")
    os.makedirs(folder, exist_ok=True)
    o = unreal.FbxExportOption()
    o.ascii = False
    o.collision = False
    o.level_of_detail = False
    o.export_morph_targets = True
    o.vertex_color = True
    task = unreal.AssetExportTask()
    task.object = mesh
    task.filename = fname
    task.automated = True
    task.prompt = False
    task.replace_identical = True
    task.options = o
    try:
        ok = unreal.Exporter.run_asset_export_task(task)
    except Exception as e:
        ok = False
        warn(f"mesh {path}: {e}")
    rel = os.path.relpath(fname, OUT_ROOT).replace("\\", "/") if ok else None
    exported_meshes[path] = rel
    if not ok:
        warn(f"could not export mesh {path}")
    return rel


def mesh_of(comp):
    for prop in ("skeletal_mesh_asset", "skeletal_mesh", "static_mesh"):
        try:
            m = comp.get_editor_property(prop)
            if m:
                return m
        except Exception:
            pass
    return None


# --------------------------------------------------------------------------------------------- scene setup

def level_actors():
    return list(unreal.get_editor_subsystem(unreal.EditorActorSubsystem).get_all_level_actors())


def binding_names(seq):
    names = set()
    for b in seq.get_bindings():
        names.add(str(b.get_display_name()))
    return names


def describe_actor(a, mesh_folder, with_meshes=True):
    """Every mesh component of an actor: mesh file, its transform relative to the actor."""
    comps = []
    for c in list(a.get_components_by_class(unreal.MeshComponent)):
        m = mesh_of(c)
        if not m:
            continue
        mpath = m.get_path_name().split(".")[0]
        if mpath.startswith("/Engine/"):
            continue
        entry = {
            "component": c.get_name(),
            "type": cls_name(c),
            "mesh": mpath,
            "relative": tf_list(c.get_relative_transform()) if hasattr(c, "get_relative_transform") else None,
            "world": tf_list(c.get_world_transform()),
            "visible": bool(c.is_visible()) if hasattr(c, "is_visible") else True,
        }
        try:
            entry["parent"] = c.get_attach_parent().get_name() if c.get_attach_parent() else None
            entry["attach_socket"] = str(c.get_attach_socket_name())
        except Exception:
            pass
        if with_meshes:
            entry["file"] = export_mesh(m, mesh_folder)
        comps.append(entry)
    return comps


class Person:
    def __init__(self, actor, body):
        self.actor, self.body = actor, body
        n = body.get_num_bones()
        self.bones = [str(body.get_bone_name(i)) for i in range(n)]
        self.parents = []
        for b in self.bones:
            try:
                p = str(body.get_parent_bone(b))
            except Exception:
                p = "None"
            self.parents.append(self.bones.index(p) if p in self.bones else -1)
        self.rest = []
        for i in range(n):
            try:
                self.rest.append(tf_list(body.get_ref_pose_transform(i)))
            except Exception:
                self.rest.append(None)
        # bones whose translation is animated as well as rotation
        self.moving = [i for i, b in enumerate(self.bones) if b.lower() in ("root", "pelvis")]


def setup_scene(name, map_path, seq_path):
    seq = unreal.load_asset(seq_path)
    if not isinstance(seq, unreal.LevelSequence):
        raise RuntimeError(f"{seq_path} is not a Level Sequence")
    les = unreal.get_editor_subsystem(unreal.LevelEditorSubsystem)
    if not les.load_level(map_path):
        raise RuntimeError(f"could not open {map_path}")
    before = {a.get_path_name() for a in level_actors()}
    unreal.LevelSequenceEditorBlueprintLibrary.open_level_sequence(seq)
    unreal.LevelSequenceEditorBlueprintLibrary.pause()
    unreal.LevelSequenceEditorBlueprintLibrary.set_current_time(0)
    return seq, before


def collect_targets(name, seq, before):
    """After the sequence has spawned its actors: people (with a Body) and moving equipment."""
    out_dir = os.path.join(OUT_ROOT, name)
    mesh_dir = os.path.join(out_dir, "meshes")
    names = binding_names(seq)
    actors = level_actors()
    spawned = [a for a in actors if a.get_path_name() not in before]
    named = [a for a in actors if a.get_actor_label() in names or cls_name(a).replace("_C", "") in names]
    targets = []
    for a in spawned + [a for a in named if a not in spawned]:
        if a not in targets:
            targets.append(a)
    people, props = [], []
    for a in targets:
        body = None
        for c in a.get_components_by_class(unreal.SkeletalMeshComponent):
            if c.get_name().lower() == "body":
                body = c
        meta = {"label": a.get_actor_label(), "class": cls_name(a), "components": describe_actor(a, mesh_dir)}
        if body:
            people.append((Person(a, body), meta))
        elif meta["components"]:
            props.append((a, meta))
    # static room objects (bed, door, furniture) that are part of the level, not the sequence
    room = []
    for a in actors:
        if a in targets:
            continue
        comps = describe_actor(a, mesh_dir, with_meshes=False)
        comps = [c for c in comps if c["visible"]]
        if not comps:
            continue
        entry = {"label": a.get_actor_label(), "class": cls_name(a), "components": comps}
        try:
            origin, extent = a.get_actor_bounds(False)
            entry["bounds"] = {"origin": [origin.x, origin.y, origin.z], "extent": [extent.x, extent.y, extent.z]}
        except Exception:
            pass
        # export the furniture/equipment models (not the large scanned surfaces)
        for c in comps:
            if c["mesh"].startswith("/Game/Models/"):
                m = unreal.load_asset(c["mesh"])
                if m:
                    c["file"] = export_mesh(m, mesh_dir)
        room.append(entry)
    log(f"{name}: {len(people)} person(s), {len(props)} moving object(s), {len(room)} room object(s)")
    for p, meta in people:
        log(f"   person {meta['label']}: {len(p.bones)} bones, meshes {[c['mesh'].split('/')[-1] for c in meta['components']]}")
    for a, meta in props:
        log(f"   moving object {meta['label']} ({meta['class']})")
    return people, props, room


# --------------------------------------------------------------------------------------------- recorder

class Recorder:
    def __init__(self):
        self.queue = list(SCENES)
        self.state = "next"
        self.handle = None
        self.wait = 0

    def start(self):
        try:
            s = unreal.get_default_object(unreal.EditorPerformanceSettings)
            s.set_editor_property("throttle_cpu_when_not_foreground", False)
        except Exception:
            pass
        self.handle = unreal.register_slate_post_tick_callback(self.tick)

    def stop(self):
        if self.handle is not None:
            unreal.unregister_slate_post_tick_callback(self.handle)
            self.handle = None

    # one step per editor tick, so Unreal keeps updating the poses between frames
    def tick(self, dt):
        try:
            if self.wait > 0:
                self.wait -= 1
                return
            if self.state == "next":
                self.begin_scene()
            elif self.state == "spawned":
                self.after_spawn()
            elif self.state == "sampling":
                self.sample()
        except Exception:
            warn("recording stopped unexpectedly:\n" + traceback.format_exc())
            self.end_scene(failed=True)

    def begin_scene(self):
        if not self.queue:
            self.finish()
            return
        self.name, map_path, seq_path = self.queue.pop(0)
        log(f"--- {self.name}: opening scene")
        try:
            self.seq, self.before = setup_scene(self.name, map_path, seq_path)
        except Exception:
            warn(f"{self.name}: " + traceback.format_exc())
            return
        self.state = "spawned"
        self.wait = 10  # let Sequencer spawn its people and equipment

    def after_spawn(self):
        self.people, self.props, self.room = collect_targets(self.name, self.seq, self.before)
        rate = self.seq.get_display_rate()
        self.display_fps = rate.numerator / rate.denominator
        start = self.seq.get_playback_start_seconds()
        end = self.seq.get_playback_end_seconds()
        if TEST_SECONDS:
            end = min(end, start + TEST_SECONDS)
        self.times = [start + i / SAMPLE_FPS for i in range(int((end - start) * SAMPLE_FPS) + 1)]
        self.frame = 0
        self.data = bytearray()
        self.last_pose = None
        self.static_frames = 0
        log(f"{self.name}: recording {len(self.times)} frames ({end - start:.1f} s at {SAMPLE_FPS} fps)")
        self.goto(0)
        self.state = "sampling"

    def goto(self, i):
        f = int(round(self.times[i] * self.display_fps))
        unreal.LevelSequenceEditorBlueprintLibrary.set_current_time(f)
        self.wait = WAIT_TICKS

    def sample(self):
        buf = self.data
        mark = None
        for k, (p, _) in enumerate(self.people):
            buf += struct.pack("<10f", *tf_list(p.body.get_world_transform()))
            for i in p.moving:
                t = p.body.get_socket_transform(p.bones[i], unreal.RelativeTransformSpace.RTS_PARENT_BONE_SPACE).translation
                buf += struct.pack("<3f", t.x, t.y, t.z)
            if k == 0:
                mark = len(buf)
            for b in p.bones:
                q = p.body.get_socket_transform(b, unreal.RelativeTransformSpace.RTS_PARENT_BONE_SPACE).rotation
                vals = (q.x, q.y, q.z, q.w)
                buf += struct.pack("<4h", *(max(-32767, min(32767, int(round(v * 32767)))) for v in vals))
        # check that the poses really change from frame to frame
        if mark is not None:
            sig = bytes(buf[mark:mark + len(self.people[0][0].bones) * 8])
            if sig == self.last_pose:
                self.static_frames += 1
            self.last_pose = sig
        for a, _ in self.props:
            buf += struct.pack("<10f", *tf_list(a.get_actor_transform()))
        self.frame += 1
        if self.frame % (SAMPLE_FPS * 10) == 0:
            log(f"{self.name}: {self.frame}/{len(self.times)} frames recorded")
        if self.frame < len(self.times):
            self.goto(self.frame)
        else:
            self.end_scene()

    def end_scene(self, failed=False):
        out_dir = os.path.join(OUT_ROOT, self.name)
        os.makedirs(out_dir, exist_ok=True)
        if getattr(self, "people", None) is not None and not failed:
            meta = {
                "scene": self.name,
                "units": "Unreal: centimetres, Z up, left-handed (X forward, Y right)",
                "fps": SAMPLE_FPS,
                "frames": self.frame,
                "start_seconds": self.times[0] if self.times else 0,
                "frame_layout": "per frame: for each person [world transform of Body: 10 float32] "
                                "[translation of 'moving' bones: 3 float32 each] [local rotation of every bone: 4 int16 /32767]; "
                                "then for each moving object [world transform: 10 float32]. "
                                "Transforms are tx,ty,tz,qx,qy,qz,qw,sx,sy,sz.",
                "people": [{
                    "label": m["label"], "class": m["class"], "components": m["components"],
                    "bones": p.bones, "parents": p.parents, "rest_local": p.rest,
                    "moving_bones": [p.bones[i] for i in p.moving],
                } for p, m in self.people],
                "moving_objects": [m for _, m in self.props],
                "room": self.room,
            }
            with open(os.path.join(out_dir, f"{self.name}_motion.json"), "w", encoding="utf-8") as f:
                json.dump(meta, f)
            with open(os.path.join(out_dir, f"{self.name}_motion.bin"), "wb") as f:
                f.write(self.data)
            log(f"{self.name}: saved {self.frame} frames ({len(self.data) // 1024} KB)")
            if self.people and self.frame > 10 and self.static_frames > 0.9 * self.frame:
                warn(f"{self.name}: the people's poses hardly changed between frames ({self.static_frames}/{self.frame} identical). "
                     "Unreal may not have updated them in time - try again with WAIT_TICKS = 4 at the top of the script.")
            else:
                log(f"{self.name}: {self.static_frames} of {self.frame} frames had the same pose as the frame before")
        try:
            unreal.LevelSequenceEditorBlueprintLibrary.close_level_sequence()
        except Exception:
            pass
        self.people = None
        self.state = "next"
        self.wait = 5

    def finish(self):
        self.stop()
        log("DONE")
        problems = [l for l in log_lines if l.startswith("WARNING")]
        msg = (f"Finished recording.\n\nThe results are in:\n{OUT_ROOT}\n\n"
               "That folder will now open. Upload the whole 'VisADLsExport_v3' folder to Google Drive.")
        if problems:
            msg += f"\n\n{len(problems)} problem(s) were noted in export_log.txt."
        try:
            unreal.EditorDialog.show_message("VisADLs export", msg, unreal.AppMsgType.OK)
        except Exception:
            pass
        try:
            if os.name == "nt":
                os.startfile(OUT_ROOT)
        except Exception:
            pass


os.makedirs(OUT_ROOT, exist_ok=True)
log(f"Output folder: {OUT_ROOT}")
log("Recording runs in the background while Unreal plays each scene. Wait for the 'Finished' message.")
_recorder = Recorder()
_recorder.start()
