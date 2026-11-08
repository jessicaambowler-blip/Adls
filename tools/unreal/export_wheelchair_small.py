"""
VisADLs – export a lighter copy of the original wheelchair for the web app.

The original ElectricWheelchair model is ~80 MB, far too big for a web page. This script makes a
temporary copy, reduces its triangle count until the exported file is under ~6 MB, exports it as
FBX, then deletes the temporary copy. The original asset is not changed.

HOW TO RUN (Unreal Engine 5.5, ADLs_Final open):
  Tools > Execute Python Script...  and choose this file. It can take a minute or two.
  Upload the folder that opens (<project>/Saved/VisADLsExport_wheelchair) to Google Drive.
"""

import os
import traceback

import unreal

SOURCES = ["/Game/Models/P2_Wheelchair/ElectricWheelchair"]
TEMP_DIR = "/Game/VisADLsExport_Temp"
TARGET_BYTES = 6 * 1024 * 1024
STEPS = [0.10, 0.05, 0.025, 0.012, 0.006]  # fraction of triangles kept
OUT = os.path.join(unreal.Paths.convert_relative_path_to_full(unreal.Paths.project_saved_dir()), "VisADLsExport_wheelchair")
log_lines = []


def log(m):
    unreal.log("[VisADLs wheelchair] " + m)
    log_lines.append(m)
    os.makedirs(OUT, exist_ok=True)
    with open(os.path.join(OUT, "export_log.txt"), "w", encoding="utf-8") as f:
        f.write("\n".join(log_lines))


def find_source(path):
    if unreal.EditorAssetLibrary.does_asset_exist(path):
        return path
    reg = unreal.AssetRegistryHelpers.get_asset_registry()
    name = path.split("/")[-1]
    for a in reg.get_assets_by_class(unreal.TopLevelAssetPath("/Script/Engine", "StaticMesh"), True):
        if str(a.asset_name) == name and str(a.package_name).startswith("/Game/"):
            return str(a.package_name)
    return None


def tri_count(mesh):
    try:
        return mesh.get_num_triangles(0)
    except Exception:
        try:
            return unreal.get_editor_subsystem(unreal.StaticMeshEditorSubsystem).get_number_verts(mesh, 0)
        except Exception:
            return -1


def export_fbx(mesh, filename):
    task = unreal.AssetExportTask()
    task.object = mesh
    task.filename = filename
    task.automated = True
    task.prompt = False
    task.replace_identical = True
    task.exporter = unreal.StaticMeshExporterFBX()
    opts = unreal.FbxExportOption()
    for prop, val in (("ascii", False), ("collision", False), ("level_of_detail", False), ("vertex_color", True)):
        try:
            opts.set_editor_property(prop, val)
        except Exception:
            pass
    task.options = opts
    return unreal.Exporter.run_asset_export_task(task)


def reduce_to(mesh, fraction):
    sms = unreal.get_editor_subsystem(unreal.StaticMeshEditorSubsystem)
    try:  # Nanite meshes export their fallback; turn Nanite off so the reduction applies to LOD0
        ns = mesh.get_editor_property("nanite_settings")
        if ns.enabled:
            ns.enabled = False
            mesh.set_editor_property("nanite_settings", ns)
    except Exception:
        pass
    s = unreal.StaticMeshReductionSettings()
    s.percent_triangles = fraction
    s.screen_size = 1.0
    o = unreal.StaticMeshReductionOptions()
    o.auto_compute_lod_screen_size = False
    o.reduction_settings = [s]
    sms.set_lods(mesh, o)


def describe_materials(mesh):
    out = []
    try:
        for i, m in enumerate(mesh.static_materials):
            mat = m.material_interface
            line = f"  slot {i} '{m.material_slot_name}': {mat.get_path_name() if mat else 'none'}"
            try:
                if isinstance(mat, unreal.MaterialInstance):
                    for p in mat.get_editor_property("vector_parameter_values"):
                        v = p.parameter_value
                        line += f" | {p.parameter_info.name}=({v.r:.3f},{v.g:.3f},{v.b:.3f})"
                    for p in mat.get_editor_property("texture_parameter_values"):
                        line += f" | {p.parameter_info.name}={p.parameter_value.get_name() if p.parameter_value else 'none'}"
            except Exception:
                pass
            try:
                tex = unreal.MaterialEditingLibrary.get_used_textures(mat)
                if tex:
                    line += " | textures: " + ", ".join(t.get_name() for t in tex)
            except Exception:
                pass
            out.append(line)
    except Exception as e:
        out.append(f"  (could not read materials: {e})")
    return out


def run(src_path):
    found = find_source(src_path)
    if not found:
        log(f"Could not find {src_path}")
        return
    name = found.split("/")[-1]
    src = unreal.load_asset(found)
    log(f"{found}: {tri_count(src)} triangles")
    for line in describe_materials(src):
        log(line)
    filename = os.path.join(OUT, f"{name}_small.fbx")
    for fraction in STEPS:
        tmp = f"{TEMP_DIR}/{name}_small"
        if unreal.EditorAssetLibrary.does_asset_exist(tmp):
            unreal.EditorAssetLibrary.delete_asset(tmp)
        dup = unreal.EditorAssetLibrary.duplicate_asset(found, tmp)
        try:
            reduce_to(dup, fraction)
            if os.path.exists(filename):
                os.remove(filename)
            ok = export_fbx(dup, filename)
            size = os.path.getsize(filename) if os.path.exists(filename) else 0
            log(f"  kept {fraction * 100:.1f}% -> {tri_count(dup)} triangles, {size / 1048576:.1f} MB, export {'ok' if ok else 'FAILED'}")
        finally:
            unreal.EditorAssetLibrary.delete_asset(tmp)
        if 0 < size <= TARGET_BYTES:
            log(f"Saved {filename}")
            return
    log("Could not get the file small enough – send me export_log.txt")


os.makedirs(OUT, exist_ok=True)
with unreal.ScopedSlowTask(len(SOURCES), "VisADLs: exporting a lighter wheelchair") as task:
    task.make_dialog(True)
    for p in SOURCES:
        task.enter_progress_frame(1)
        try:
            run(p)
        except Exception:
            log(f"FAILED {p}:\n" + traceback.format_exc())
try:
    if unreal.EditorAssetLibrary.does_directory_exist(TEMP_DIR):
        unreal.EditorAssetLibrary.delete_directory(TEMP_DIR)
except Exception:
    pass
try:
    unreal.EditorDialog.show_message("VisADLs", f"Done.\n\nUpload this folder to Google Drive:\n{OUT}", unreal.AppMsgType.OK)
except Exception:
    pass
try:
    if os.name == "nt":
        os.startfile(OUT)
except Exception:
    pass
