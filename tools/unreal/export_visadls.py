"""
Export the original VisADLs scenes (people, wheelchairs, beds and their motion capture) from the
Unreal Engine 5.5 project ADLs_Final so they can be used in the VisADLs web app.

HOW TO RUN (Windows or Mac, Unreal Engine 5.5 installed):
  1. Open ADLs_Final.uproject in Unreal Engine 5.5.
  2. Menu: Tools > Execute Python Script...  and choose this file.
     (Or: Window > Output Log, switch the box at the bottom from "Cmd" to "Python",
      and type:  exec(open(r"C:\\path\\to\\export_visadls.py").read())  )
  3. Wait – exporting the bed transfer can take several minutes. Unreal may look frozen.
  4. When it finishes, open the folder it prints at the end (inside the project's "Saved" folder):
       VisADLsExport/
         inventory.txt            <- list of every sequence, animation and model found
         P2BedTransfer/
           P2BedTransfer_scene.fbx     whole scene, every actor animated, in sync
           P2BedTransfer_scene.glb     same, as glTF (if the glTF Exporter plugin is available)
           anim_<Actor>.fbx            each person/wheelchair's animation on its own
         ...
  5. Send the VisADLsExport folder back (e.g. put it in Google Drive). The .glb / .fbx files can
     also be opened straight away in the web app: Room > Import 3D models.

Nothing in the project is changed or saved: the script only reads the project and writes files to
Saved/VisADLsExport. (Baked animations are created in memory under /Game/VisADLsExport_Temp and the
script does not save them; you can say "Don't Save" if Unreal asks when you close.)

This script was written without access to a running copy of Unreal, against the UE 5.5 Python API.
Every step is wrapped so that one failure does not stop the others, and the log says exactly what
worked. If something fails, send the Output Log text back.
"""

import os
import traceback

import unreal

# Scenes in ADLs_Final (map, level sequence). Found in Content/ on Google Drive.
SCENES = [
    ("P1Turn360", "/Game/P1Turn360", "/Game/Persona1Sequence/P1Turn360"),
    ("P2BedTransfer", "/Game/P2BedTransfer", "/Game/Persona2Sequence/P2BedTransfer"),
    ("P3Hallway", "/Game/P3Hallway", "/Game/Persona3Sequence/P3Hallway"),
]

OUT_ROOT = os.path.join(unreal.Paths.convert_relative_path_to_full(unreal.Paths.project_saved_dir()), "VisADLsExport")
TEMP_PKG = "/Game/VisADLsExport_Temp"

log_lines = []


def log(msg):
    unreal.log("[VisADLs export] " + msg)
    log_lines.append(msg)


def warn(msg):
    unreal.log_warning("[VisADLs export] " + msg)
    log_lines.append("WARNING: " + msg)


def safe_name(s):
    return "".join(c if c.isalnum() or c in "-_" else "_" for c in s)[:60]


# --------------------------------------------------------------------------------------------- inventory

def write_inventory():
    """List the project's sequences, animations and meshes so we know what is there."""
    reg = unreal.AssetRegistryHelpers.get_asset_registry()
    classes = [
        ("LevelSequence", "/Script/LevelSequence"),
        ("AnimSequence", "/Script/Engine"),
        ("SkeletalMesh", "/Script/Engine"),
        ("StaticMesh", "/Script/Engine"),
        ("Blueprint", "/Script/Engine"),
        ("World", "/Script/Engine"),
    ]
    lines = []
    for cls, pkg in classes:
        try:
            assets = reg.get_assets_by_class(unreal.TopLevelAssetPath(pkg, cls), True)
        except Exception:
            assets = []
        game = sorted(str(a.package_name) for a in assets if str(a.package_name).startswith("/Game/"))
        if cls == "StaticMesh":
            game = [g for g in game if "/Megascans/" not in g] or game
        lines.append(f"== {cls} ({len(game)}) ==")
        lines += game
        lines.append("")
    path = os.path.join(OUT_ROOT, "inventory.txt")
    with open(path, "w", encoding="utf-8") as f:
        f.write("\n".join(lines))
    log(f"Inventory written: {path}")


# --------------------------------------------------------------------------------------------- helpers

def load_world(map_path):
    les = unreal.get_editor_subsystem(unreal.LevelEditorSubsystem)
    if not les.load_level(map_path):
        raise RuntimeError(f"could not open map {map_path}")
    return unreal.get_editor_subsystem(unreal.UnrealEditorSubsystem).get_editor_world()


def fbx_options():
    o = unreal.FbxExportOption()
    o.ascii = False
    o.collision = False
    o.level_of_detail = False  # LOD0 only
    o.export_morph_targets = True
    o.export_preview_mesh = True
    o.vertex_color = True
    try:
        o.export_local_time = True
    except Exception:
        pass
    return o


def bound_objects(world, seq, binding):
    try:
        rng = seq.get_playback_range() if hasattr(seq, "get_playback_range") else unreal.SequencerScriptingRange()
        res = unreal.SequencerTools.get_bound_objects(world, seq, [binding], rng)
        out = []
        for r in res:
            out += list(r.bound_objects)
        return out
    except Exception:
        return []


def skeletal_components(obj):
    if isinstance(obj, unreal.SkeletalMeshComponent):
        return [obj]
    if isinstance(obj, unreal.Actor):
        return list(obj.get_components_by_class(unreal.SkeletalMeshComponent))
    return []


def bound_actors(world, seq):
    actors = set()
    for b in seq.get_bindings():
        for o in bound_objects(world, seq, b):
            if isinstance(o, unreal.Actor):
                actors.add(o)
            elif isinstance(o, unreal.ActorComponent):
                owner = o.get_owner()
                if owner:
                    actors.add(owner)
    return actors


# --------------------------------------------------------------------------------------------- exports

def export_scene_fbx(world, seq, out_dir, name):
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
    (log if ok else warn)(f"{name}: whole-scene FBX {'written' if ok else 'FAILED'} -> {params.fbx_file_name}")


def export_scene_gltf(world, seq, out_dir, name):
    if not hasattr(unreal, "GLTFExporter"):
        warn(f"{name}: glTF Exporter plugin not enabled (Edit > Plugins > 'glTF Exporter'); skipped .glb")
        return
    o = unreal.GLTFExportOptions()
    for attr, val in [
        ("export_level_sequences", True),
        ("export_animation_sequences", True),
        ("export_vertex_skin_weights", True),
        ("export_morph_targets", True),
        ("export_lights", False),
        ("export_cameras", False),
        ("export_hidden_in_game", False),
    ]:
        try:
            setattr(o, attr, val)
        except Exception:
            pass
    actors = bound_actors(world, seq)
    path = os.path.join(out_dir, f"{name}_scene.glb")
    try:
        ok = unreal.GLTFExporter.export_to_gltf(world, path, o, set(actors))
    except TypeError:
        ok = unreal.GLTFExporter.export_to_gltf(world, path, o, set(actors), unreal.GLTFExportMessages())
    log(f"{name}: glTF export of {len(actors)} actors -> {path} (result: {ok})")


def bake_and_export_anims(world, seq, out_dir, name):
    """Bake each animated skeletal mesh (people, articulated wheelchairs) to its own animation + FBX."""
    tools = unreal.AssetToolsHelpers.get_asset_tools()
    count = 0
    for b in seq.get_bindings():
        label = safe_name(str(b.get_display_name()))
        comps = []
        for o in bound_objects(world, seq, b):
            comps += skeletal_components(o)
        for i, comp in enumerate(comps):
            mesh = comp.get_editor_property("skeletal_mesh_asset") if hasattr(comp, "get_editor_property") else None
            if mesh is None:
                try:
                    mesh = comp.skeletal_mesh
                except Exception:
                    mesh = None
            if mesh is None:
                continue
            skel = mesh.get_editor_property("skeleton")
            asset_name = f"{name}_{label}_{i}"
            try:
                factory = unreal.AnimSequenceFactory()
                factory.set_editor_property("target_skeleton", skel)
                anim = tools.create_asset(asset_name, TEMP_PKG, unreal.AnimSequence, factory)
                ok = unreal.SequencerTools.export_anim_sequence(world, seq, anim, unreal.AnimSeqExportOption(), b, False)
                if not ok:
                    warn(f"{name}: could not bake animation for {label}")
                    continue
                task = unreal.AssetExportTask()
                task.object = anim
                task.filename = os.path.join(out_dir, f"anim_{label}_{i}.fbx")
                task.automated = True
                task.prompt = False
                task.replace_identical = True
                task.options = fbx_options()
                ok = unreal.Exporter.run_asset_export_task(task)
                (log if ok else warn)(f"{name}: animation for '{label}' ({mesh.get_name()}) {'written' if ok else 'FAILED'} -> {task.filename}")
                count += 1
            except Exception as e:
                warn(f"{name}: baking {label} failed: {e}")
    log(f"{name}: {count} separate animation file(s)")


def export_meshes():
    """Export the props (beds, wheelchairs, hoist, door) as individual models."""
    out_dir = os.path.join(OUT_ROOT, "Models")
    os.makedirs(out_dir, exist_ok=True)
    reg = unreal.AssetRegistryHelpers.get_asset_registry()
    for folder in ["/Game/Models/P1_Wheelchair", "/Game/Models/P2_Wheelchair", "/Game/Models/P3_Wheelchair",
                   "/Game/Models/P2_Bed", "/Game/Models/Hoist", "/Game/Models/Door"]:
        assets = reg.get_assets_by_path(folder, True)
        for a in assets:
            cls = str(a.asset_class_path.asset_name)
            if cls not in ("StaticMesh", "SkeletalMesh"):
                continue
            obj = unreal.load_asset(str(a.package_name))
            sub = os.path.join(out_dir, folder.split("/")[-1])
            os.makedirs(sub, exist_ok=True)
            task = unreal.AssetExportTask()
            task.object = obj
            task.filename = os.path.join(sub, f"{a.asset_name}.fbx")
            task.automated = True
            task.prompt = False
            task.replace_identical = True
            task.options = fbx_options()
            try:
                ok = unreal.Exporter.run_asset_export_task(task)
                (log if ok else warn)(f"model {a.package_name} {'written' if ok else 'FAILED'}")
            except Exception as e:
                warn(f"model {a.package_name}: {e}")


# --------------------------------------------------------------------------------------------- main

def main():
    os.makedirs(OUT_ROOT, exist_ok=True)
    log(f"Output folder: {OUT_ROOT}")
    try:
        write_inventory()
    except Exception:
        warn("inventory failed:\n" + traceback.format_exc())

    for name, map_path, seq_path in SCENES:
        out_dir = os.path.join(OUT_ROOT, name)
        os.makedirs(out_dir, exist_ok=True)
        seq = unreal.load_asset(seq_path)
        if not isinstance(seq, unreal.LevelSequence):
            warn(f"{name}: {seq_path} is not a Level Sequence ({type(seq).__name__ if seq else 'missing'}); check inventory.txt")
            continue
        try:
            world = load_world(map_path)
        except Exception as e:
            warn(f"{name}: {e}")
            continue
        for step in (export_scene_fbx, export_scene_gltf, bake_and_export_anims):
            with unreal.ScopedSlowTask(1, f"VisADLs: {name} – {step.__name__}") as t:
                t.make_dialog(True)
                try:
                    step(world, seq, out_dir, name)
                except Exception:
                    warn(f"{name}: {step.__name__} failed:\n" + traceback.format_exc())

    try:
        export_meshes()
    except Exception:
        warn("model export failed:\n" + traceback.format_exc())

    with open(os.path.join(OUT_ROOT, "export_log.txt"), "w", encoding="utf-8") as f:
        f.write("\n".join(log_lines))
    log("DONE. Send the whole folder back: " + OUT_ROOT)


main()
