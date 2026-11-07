"""
VisADLs export script – version 2.

Exports the people, equipment and recorded movement from the original VisADLs Unreal Engine 5.5
project (ADLs_Final) so they can be used in the VisADLs web app.

HOW TO RUN (Unreal Engine 5.5):
  1. Open ADLs_Final.uproject.
  2. Menu: Tools > Execute Python Script...  and choose this file.
  3. Unreal will open each scene and its sequence in turn and show progress pop-ups. The bed
     transfer is about 5 minutes long and can take several minutes to process. Let it finish.
  4. A message box says "Finished" and the output folder opens by itself:
       <project>/Saved/VisADLsExport_v2
  5. Upload that whole folder to Google Drive.

Version 2 changes (after the first run produced no people):
  * The original scenes create the people and wheelchairs only while their sequence is open
    ("spawnables"), so each sequence is now opened in Sequencer before exporting.
  * A report of every track in each sequence (sequence_report.txt) so we can see how the movement
    is stored.
  * Recorded animations stored inside the sequences are exported directly, with the body attached.
  * Each person's body, face and clothing meshes are exported as models.
  * Then it tries again to bake each person's on-screen movement into an animation file.

Nothing in the project is saved. Unreal may ask to save changed assets when you close it – choose
"Don't Save".

Written without access to a running copy of Unreal, against the UE 5.5 Python API. Every step is
wrapped so one failure does not stop the others, and everything is written to export_log.txt.
"""

import os
import traceback

import unreal

SCENES = [
    ("P1Turn360", "/Game/P1Turn360", "/Game/Persona1Sequence/P1Turn360"),
    ("P2BedTransfer", "/Game/P2BedTransfer", "/Game/Persona2Sequence/P2BedTransfer"),
    ("P3Hallway", "/Game/P3Hallway", "/Game/Persona3Sequence/P3Hallway"),
]

OUT_ROOT = os.path.join(unreal.Paths.convert_relative_path_to_full(unreal.Paths.project_saved_dir()), "VisADLsExport_v2")
TEMP_PKG = "/Game/VisADLsExport_Temp"

log_lines = []
report_lines = []


# --------------------------------------------------------------------------------------------- logging

def _save():
    try:
        os.makedirs(OUT_ROOT, exist_ok=True)
        with open(os.path.join(OUT_ROOT, "export_log.txt"), "w", encoding="utf-8") as f:
            f.write("\n".join(log_lines))
        with open(os.path.join(OUT_ROOT, "sequence_report.txt"), "w", encoding="utf-8") as f:
            f.write("\n".join(report_lines))
    except Exception:
        pass


def log(msg):
    unreal.log("[VisADLs export] " + msg)
    log_lines.append(msg)
    _save()


def warn(msg):
    unreal.log_warning("[VisADLs export] " + msg)
    log_lines.append("WARNING: " + msg)
    _save()


def report(msg):
    report_lines.append(msg)


def safe_name(s):
    return "".join(c if c.isalnum() or c in "-_" else "_" for c in str(s))[:60]


def cls_name(o):
    try:
        return o.get_class().get_name()
    except Exception:
        return type(o).__name__


# --------------------------------------------------------------------------------------------- helpers

def fbx_options(preview_mesh=True):
    o = unreal.FbxExportOption()
    o.ascii = False
    o.collision = False
    o.level_of_detail = False
    o.export_morph_targets = True
    o.export_preview_mesh = preview_mesh
    o.vertex_color = True
    return o


def export_asset_fbx(obj, filename, preview_mesh=True):
    os.makedirs(os.path.dirname(filename), exist_ok=True)
    task = unreal.AssetExportTask()
    task.object = obj
    task.filename = filename
    task.automated = True
    task.prompt = False
    task.replace_identical = True
    task.options = fbx_options(preview_mesh)
    ok = unreal.Exporter.run_asset_export_task(task)
    size = os.path.getsize(filename) if os.path.exists(filename) else 0
    (log if ok and size else warn)(f"  {'wrote' if ok and size else 'FAILED'} {os.path.relpath(filename, OUT_ROOT)} ({size // 1024} KB)")
    return ok


def open_scene(map_path, seq):
    les = unreal.get_editor_subsystem(unreal.LevelEditorSubsystem)
    if not les.load_level(map_path):
        raise RuntimeError(f"could not open map {map_path}")
    world = unreal.get_editor_subsystem(unreal.UnrealEditorSubsystem).get_editor_world()
    # Opening the sequence in Sequencer spawns its people and equipment into the level.
    unreal.LevelSequenceEditorBlueprintLibrary.open_level_sequence(seq)
    try:
        unreal.LevelSequenceEditorBlueprintLibrary.set_current_time(0)
        unreal.LevelSequenceEditorBlueprintLibrary.refresh_current_level_sequence()
    except Exception:
        pass
    return world


def all_bindings(seq):
    """Every object binding, including child bindings (e.g. a MetaHuman's Body and Face)."""
    seen, out = set(), []

    def add(b):
        key = str(b.get_id()) if hasattr(b, "get_id") else str(b.get_display_name())
        if key in seen:
            return
        seen.add(key)
        out.append(b)
        try:
            for c in b.get_child_possessables():
                add(c)
        except Exception:
            pass

    for b in seq.get_bindings():
        add(b)
    try:
        for b in seq.get_spawnables():
            add(b)
        for b in seq.get_possessables():
            add(b)
    except Exception:
        pass
    return out


def bound_objects(world, seq, binding):
    objs = []
    try:
        objs = list(unreal.LevelSequenceEditorBlueprintLibrary.get_bound_objects(binding))
    except Exception:
        pass
    if not objs:
        try:
            rng = seq.get_playback_range() if hasattr(seq, "get_playback_range") else unreal.SequencerScriptingRange()
            for r in unreal.SequencerTools.get_bound_objects(world, seq, [binding], rng):
                objs += list(r.bound_objects)
        except Exception:
            pass
    return objs


def skeletal_components(obj):
    if isinstance(obj, unreal.SkeletalMeshComponent):
        return [obj]
    if isinstance(obj, unreal.Actor):
        return list(obj.get_components_by_class(unreal.SkeletalMeshComponent))
    return []


def mesh_of(comp):
    for prop in ("skeletal_mesh_asset", "skeletal_mesh"):
        try:
            m = comp.get_editor_property(prop)
            if m:
                return m
        except Exception:
            pass
    return None


# --------------------------------------------------------------------------------------------- steps

def describe_sequence(world, seq, name):
    """Write what the sequence contains: bindings, tracks, sections and the assets they use."""
    report(f"\n===== {name} =====")
    try:
        rng = (seq.get_playback_start_seconds(), seq.get_playback_end_seconds())
        report(f"playback: {rng[0]:.2f}s .. {rng[1]:.2f}s, display rate {seq.get_display_rate().numerator}/{seq.get_display_rate().denominator}")
    except Exception:
        pass
    try:
        for t in seq.get_tracks():
            report(f"[master track] {cls_name(t)} '{t.get_display_name()}' sections={len(t.get_sections())}")
    except Exception:
        pass
    embedded = []
    for b in all_bindings(seq):
        objs = bound_objects(world, seq, b)
        report(f"binding '{b.get_display_name()}' -> {[f'{cls_name(o)}:{o.get_name()}' for o in objs][:6]}")
        for t in b.get_tracks():
            secs = t.get_sections()
            report(f"    track {cls_name(t)} '{t.get_display_name()}' sections={len(secs)}")
            for s in secs[:12]:
                line = f"        section {cls_name(s)}"
                try:
                    line += f" {s.get_start_frame_seconds():.2f}s..{s.get_end_frame_seconds():.2f}s"
                except Exception:
                    pass
                if isinstance(s, unreal.MovieSceneSkeletalAnimationSection):
                    try:
                        anim = s.get_editor_property("params").get_editor_property("animation")
                        if anim:
                            line += f" anim={anim.get_path_name()} ({anim.get_play_length():.1f}s)"
                            embedded.append((b, anim))
                    except Exception as e:
                        line += f" (anim unreadable: {e})"
                try:
                    if "ControlRig" in cls_name(s):
                        cr = s.get_editor_property("control_rig")
                        line += f" control_rig={cls_name(cr) if cr else None}"
                except Exception:
                    pass
                report(line)
    _save()
    return embedded


def export_embedded_anims(world, seq, name, embedded, out_dir):
    log(f"{name}: {len(embedded)} recorded animation section(s) found in the sequence")
    done = set()
    for b, anim in embedded:
        if anim.get_path_name() in done:
            continue
        done.add(anim.get_path_name())
        mesh = None
        for o in bound_objects(world, seq, b):
            for c in skeletal_components(o):
                m = mesh_of(c)
                if m and m.get_editor_property("skeleton") == anim.get_editor_property("skeleton"):
                    mesh = m
                    break
        if mesh:
            try:
                anim.set_preview_skeletal_mesh(mesh)
            except Exception:
                pass
        export_asset_fbx(anim, os.path.join(out_dir, f"recorded_{safe_name(b.get_display_name())}_{safe_name(anim.get_name())}.fbx"))


def export_people_meshes(world, seq, name, out_dir):
    """Body, face, clothing and wheelchair skeletal meshes of everything in the sequence."""
    done = set()
    for b in all_bindings(seq):
        for o in bound_objects(world, seq, b):
            for c in skeletal_components(o):
                m = mesh_of(c)
                if not m or m.get_path_name() in done:
                    continue
                done.add(m.get_path_name())
                owner = c.get_owner()
                who = safe_name(owner.get_actor_label() if owner else b.get_display_name())
                export_asset_fbx(m, os.path.join(out_dir, "meshes", f"{who}__{safe_name(m.get_name())}.fbx"), preview_mesh=False)
    log(f"{name}: exported {len(done)} skeletal mesh(es)")


def bake_movement(world, seq, name, out_dir):
    """Bake what each skeletal mesh does on screen (whatever drives it) into an animation."""
    tools = unreal.AssetToolsHelpers.get_asset_tools()
    n = 0
    for b in all_bindings(seq):
        label = safe_name(b.get_display_name())
        for o in bound_objects(world, seq, b):
            for i, comp in enumerate(skeletal_components(o)):
                mesh = mesh_of(comp)
                if not mesh:
                    continue
                if isinstance(o, unreal.Actor) and "body" not in comp.get_name().lower() and len(skeletal_components(o)) > 1:
                    continue  # for a MetaHuman actor binding, only bake the Body here
                skel = mesh.get_editor_property("skeleton")
                try:
                    factory = unreal.AnimSequenceFactory()
                    factory.set_editor_property("target_skeleton", skel)
                    factory.set_editor_property("preview_skeletal_mesh", mesh)
                except Exception:
                    pass
                try:
                    anim = tools.create_asset(f"{name}_{label}_{i}", TEMP_PKG, unreal.AnimSequence, factory)
                    opt = unreal.AnimSeqExportOption()
                    for attr, val in [("export_transforms", True), ("export_morph_targets", True), ("export_curves", True),
                                      ("record_in_world_space", False), ("evaluate_all_skeletal_mesh_components", True)]:
                        try:
                            opt.set_editor_property(attr, val)
                        except Exception:
                            pass
                    ok = unreal.SequencerTools.export_anim_sequence(world, seq, anim, opt, b, False)
                    if not ok:
                        warn(f"{name}: baking '{label}' / {comp.get_name()} returned False")
                        continue
                    try:
                        anim.set_preview_skeletal_mesh(mesh)
                    except Exception:
                        pass
                    export_asset_fbx(anim, os.path.join(out_dir, f"baked_{label}_{safe_name(comp.get_name())}.fbx"))
                    n += 1
                except Exception as e:
                    warn(f"{name}: baking '{label}' failed: {e}")
    log(f"{name}: baked {n} animation(s)")


def export_scene_fbx(world, seq, name, out_dir):
    params = unreal.SequencerExportFBXParams()
    params.world = world
    params.sequence = seq
    params.root_sequence = seq
    params.bindings = seq.get_bindings()
    try:
        params.tracks = seq.get_tracks()
    except Exception:
        pass
    params.override_options = fbx_options()
    params.fbx_file_name = os.path.join(out_dir, f"{name}_scene.fbx")
    ok = unreal.SequencerTools.export_level_sequence_fbx(params)
    size = os.path.getsize(params.fbx_file_name) // 1024 if os.path.exists(params.fbx_file_name) else 0
    (log if ok else warn)(f"{name}: whole-scene FBX {'written' if ok else 'FAILED'} ({size} KB)")


# --------------------------------------------------------------------------------------------- main

def open_folder(path):
    try:
        if os.name == "nt":
            os.startfile(path)
        else:
            import subprocess
            subprocess.Popen(["open" if os.uname().sysname == "Darwin" else "xdg-open", path])
    except Exception:
        pass


def finish_message():
    files = []
    for root, _, names in os.walk(OUT_ROOT):
        for n in names:
            if n.lower().endswith((".fbx", ".glb")):
                files.append(n)
    problems = [l for l in log_lines if l.startswith("WARNING")]
    msg = (f"Finished. {len(files)} file(s) were written to:\n\n{OUT_ROOT}\n\n"
           "That folder will now open. Upload the whole 'VisADLsExport_v2' folder to Google Drive.")
    if problems:
        msg += f"\n\n{len(problems)} step(s) had problems; they are listed in export_log.txt."
    try:
        unreal.EditorDialog.show_message("VisADLs export", msg, unreal.AppMsgType.OK)
    except Exception:
        unreal.log(msg)
    open_folder(OUT_ROOT)


def main():
    os.makedirs(OUT_ROOT, exist_ok=True)
    log(f"Output folder: {OUT_ROOT}")
    for name, map_path, seq_path in SCENES:
        out_dir = os.path.join(OUT_ROOT, name)
        os.makedirs(out_dir, exist_ok=True)
        seq = unreal.load_asset(seq_path)
        if not isinstance(seq, unreal.LevelSequence):
            warn(f"{name}: {seq_path} is not a Level Sequence")
            continue
        try:
            world = open_scene(map_path, seq)
        except Exception:
            warn(f"{name}: could not open scene:\n" + traceback.format_exc())
            continue
        embedded = []
        steps = [
            ("describing the sequence", lambda: embedded.extend(describe_sequence(world, seq, name) or [])),
            ("exporting recorded animations", lambda: export_embedded_anims(world, seq, name, embedded, out_dir)),
            ("exporting people and equipment", lambda: export_people_meshes(world, seq, name, out_dir)),
            ("baking movement", lambda: bake_movement(world, seq, name, out_dir)),
            ("exporting the whole scene", lambda: export_scene_fbx(world, seq, name, out_dir)),
        ]
        for label, fn in steps:
            with unreal.ScopedSlowTask(1, f"VisADLs: {name} – {label}") as t:
                t.make_dialog(True)
                try:
                    fn()
                except Exception:
                    warn(f"{name}: {label} failed:\n" + traceback.format_exc())
        try:
            unreal.LevelSequenceEditorBlueprintLibrary.close_level_sequence()
        except Exception:
            pass
    log("DONE")


try:
    main()
except Exception:
    warn("The export stopped unexpectedly:\n" + traceback.format_exc())
finish_message()
