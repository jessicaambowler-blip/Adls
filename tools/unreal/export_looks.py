"""
VisADLs – export what the people look like: skin, eye and clothing colours (textures) and hair.

For each MetaHuman in the Persona 2 scene it saves, in a size the web app can use:
  * the colour textures of the face, body and clothes (reduced to at most 1024 px, PNG)
  * the hair, eyebrow and eyelash "cards" meshes and their textures, where the groom has them
  * a looks.json listing which material uses which texture and the material colour settings

Nothing in the project is changed. Takes a minute or two.

HOW TO RUN (Unreal Engine 5.5, ADLs_Final open):
  Tools > Execute Python Script...  and choose this file.
  Upload the folder that opens (<project>/Saved/VisADLsExport_looks) to Google Drive.
"""

import array
import json
import os
import re
import struct
import traceback
import zlib

import unreal

PEOPLE = ["Persona2", "Persona2Carer"]
MAX_SIDE = 1024
OUT = os.path.join(unreal.Paths.convert_relative_path_to_full(unreal.Paths.project_saved_dir()), "VisADLsExport_looks")
TMP = os.path.join(OUT, "_tmp")
COLOUR = re.compile(r"(base_?colou?r|albedo|diffuse|_bc$|_bc_|_d$|_col$|color|colour|iris|sclera|attribute|coverage)", re.I)
NOT_COLOUR = re.compile(r"(normal|_n$|_nm|rough|cavity|spec|_ao$|occlusion|wrinkle|_wm|mask|_ws|depth|tangent|flow|height|disp|_orm|_mra|_sss|transmission|curvature)", re.I)
log_lines = []
exported = {}  # texture path -> file name


def log(m):
    unreal.log("[VisADLs looks] " + m)
    log_lines.append(m)
    with open(os.path.join(OUT, "export_log.txt"), "w", encoding="utf-8") as f:
        f.write("\n".join(log_lines))


def safe(s):
    return re.sub(r"[^A-Za-z0-9_.-]", "_", s)


# ------------------------------------------------------------------ images (pure Python)

def read_tga(path):
    b = open(path, "rb").read()
    idlen, cmtype, itype = b[0], b[1], b[2]
    w, h = struct.unpack("<HH", b[12:16])
    bpp, desc = b[16], b[17]
    if cmtype != 0 or bpp not in (24, 32) or itype not in (2, 10):
        raise ValueError(f"unsupported TGA (type {itype}, {bpp} bpp)")
    px = bpp // 8
    data = b[18 + idlen:]
    if itype == 10:  # RLE
        out = bytearray()
        i, need = 0, w * h * px
        while len(out) < need:
            c = data[i]; i += 1
            n = (c & 0x7F) + 1
            if c & 0x80:
                out += data[i:i + px] * n; i += px
            else:
                out += data[i:i + n * px]; i += n * px
        data = bytes(out)
    else:
        data = data[:w * h * px]
    if px == 3:  # expand to 4 channels
        rgba = bytearray(w * h * 4)
        rgba[0::4], rgba[1::4], rgba[2::4] = data[0::3], data[1::3], data[2::3]
        rgba[3::4] = b"\xff" * (w * h)
        data = bytes(rgba)
    top_down = bool(desc & 0x20)
    return w, h, data, top_down


def write_png(path, w, h, rgba_rows):
    raw = b"".join(b"\x00" + r for r in rgba_rows)

    def chunk(t, d):
        c = struct.pack(">I", len(d)) + t + d
        return c + struct.pack(">I", zlib.crc32(t + d) & 0xFFFFFFFF)

    png = b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", struct.pack(">IIBBBBB", w, h, 8, 6, 0, 0, 0)) + chunk(b"IDAT", zlib.compress(raw, 9)) + chunk(b"IEND", b"")
    with open(path, "wb") as f:
        f.write(png)


def tga_to_small_png(tga, png):
    w, h, data, top_down = read_tga(tga)
    step = 1
    while max(w, h) // step > MAX_SIDE:
        step *= 2
    nw, nh = w // step, h // step
    pix = array.array("I")
    pix.frombytes(data)
    rows = []
    for y in range(nh):
        sy = y * step if top_down else (h - 1 - y * step)
        row = pix[sy * w: sy * w + w: step][:nw]
        rb = bytearray(row.tobytes())
        rb[0::4], rb[2::4] = rb[2::4], rb[0::4]  # BGRA -> RGBA
        rows.append(bytes(rb))
    write_png(png, nw, nh, rows)
    return w, h, nw, nh


def export_texture(tex):
    path = tex.get_path_name()
    if path in exported:
        return exported[path]
    name = safe(tex.get_name())
    tga = os.path.join(TMP, name + ".tga")
    task = unreal.AssetExportTask()
    task.object = tex
    task.filename = tga
    task.automated = True
    task.prompt = False
    task.replace_identical = True
    task.exporter = unreal.TextureExporterTGA()
    ok = unreal.Exporter.run_asset_export_task(task)
    if not ok or not os.path.exists(tga):
        log(f"    could not export texture {path}")
        exported[path] = None
        return None
    try:
        w, h, nw, nh = tga_to_small_png(tga, os.path.join(OUT, name + ".png"))
        log(f"    texture {tex.get_name()}: {w}x{h} -> {nw}x{nh}")
        exported[path] = name + ".png"
    except Exception as e:
        log(f"    could not convert {path}: {e}")
        exported[path] = None
    finally:
        try:
            os.remove(tga)
        except Exception:
            pass
    return exported[path]


# ------------------------------------------------------------------ materials

def material_info(mat):
    info = {"material": mat.get_path_name() if mat else None, "textures": {}, "colours": {}, "scalars": {}}
    if not mat:
        return info
    m = mat
    while m is not None:  # parameters from the instance chain
        try:
            for p in m.get_editor_property("vector_parameter_values"):
                n = str(p.parameter_info.name)
                if n not in info["colours"]:
                    v = p.parameter_value
                    info["colours"][n] = [round(v.r, 4), round(v.g, 4), round(v.b, 4), round(v.a, 4)]
            for p in m.get_editor_property("scalar_parameter_values"):
                n = str(p.parameter_info.name)
                if n not in info["scalars"]:
                    info["scalars"][n] = round(p.parameter_value, 4)
            for p in m.get_editor_property("texture_parameter_values"):
                n = str(p.parameter_info.name)
                t = p.parameter_value
                if t and n not in info["textures"] and (COLOUR.search(n) or COLOUR.search(t.get_name())) and not NOT_COLOUR.search(t.get_name()):
                    info["textures"][n] = export_texture(t)
        except Exception:
            pass
        try:
            m = m.get_editor_property("parent") if isinstance(m, unreal.MaterialInstance) else None
        except Exception:
            m = None
    if not info["textures"]:
        try:
            for t in unreal.MaterialEditingLibrary.get_used_textures(mat) or []:
                if COLOUR.search(t.get_name()) and not NOT_COLOUR.search(t.get_name()):
                    info["textures"][t.get_name()] = export_texture(t)
        except Exception:
            pass
    return info


def skeletal_materials(mesh):
    out = []
    for i, sm in enumerate(mesh.get_editor_property("materials")):
        mi = material_info(sm.material_interface)
        mi["slot"] = str(sm.material_slot_name)
        mi["index"] = i
        log(f"  slot {i} {mi['slot']}: {mi['material']} textures={list(mi['textures'].values())}")
        out.append(mi)
    return out


def export_static_mesh(mesh, filename):
    task = unreal.AssetExportTask()
    task.object = mesh
    task.filename = filename
    task.automated = True
    task.prompt = False
    task.replace_identical = True
    task.exporter = unreal.StaticMeshExporterFBX()
    return unreal.Exporter.run_asset_export_task(task)


# ------------------------------------------------------------------ people

def components_of(bp):
    sub = unreal.get_engine_subsystem(unreal.SubobjectDataSubsystem)
    out = []
    for h in sub.k2_gather_subobject_data_for_blueprint(bp):
        data = unreal.SubobjectDataBlueprintFunctionLibrary.get_data(h)
        obj = unreal.SubobjectDataBlueprintFunctionLibrary.get_object(data)
        if obj is not None:
            out.append(obj)
    return out


def groom_cards(groom, label):
    result = []
    for prop in ("hair_groups_cards", "hair_groups_meshes"):
        try:
            groups = groom.get_editor_property(prop)
        except Exception:
            continue
        for gi, g in enumerate(groups):
            mesh = None
            for mp in ("imported_mesh", "procedural_mesh", "mesh"):
                try:
                    mesh = g.get_editor_property(mp)
                    if mesh:
                        break
                except Exception:
                    pass
            if not mesh:
                continue
            fn = safe(f"{label}_{mesh.get_name()}.fbx")
            ok = export_static_mesh(mesh, os.path.join(OUT, fn))
            entry = {"kind": prop, "group": gi, "lod": None, "mesh": fn if ok else None, "textures": {}}
            try:
                entry["lod"] = g.get_editor_property("level_of_detail")
            except Exception:
                pass
            try:
                tex = g.get_editor_property("textures")
                for tn in ("coverage_texture", "attribute_texture", "material_texture", "auxilary_data_texture", "depth_texture", "tangent_texture"):
                    try:
                        t = tex.get_editor_property(tn)
                        if t and tn in ("coverage_texture", "attribute_texture", "material_texture"):
                            entry["textures"][tn] = export_texture(t)
                    except Exception:
                        pass
                try:
                    for i, t in enumerate(tex.get_editor_property("textures") or []):
                        if t:
                            entry["textures"][f"tex{i}_{t.get_name()}"] = export_texture(t)
                except Exception:
                    pass
            except Exception:
                pass
            try:
                mat = mesh.get_material(0)
                entry["material"] = material_info(mat)
            except Exception:
                pass
            log(f"   {prop} group {gi}: {mesh.get_name()} -> {entry['mesh']} textures={list(entry['textures'].values())}")
            result.append(entry)
    return result


def find_bp(person):
    reg = unreal.AssetRegistryHelpers.get_asset_registry()
    for a in reg.get_assets_by_path(f"/Game/MetaHumans/{person}", False):
        if str(a.asset_name) == f"BP_{person}":
            return unreal.load_asset(str(a.package_name))
    return None


def export_person(person):
    log(f"== {person}")
    bp = find_bp(person)
    if bp is None:
        log(f"  could not find /Game/MetaHumans/{person}/BP_{person}")
        return None
    entry = {"meshes": {}, "grooms": {}}
    for comp in components_of(bp):
        cname = comp.get_name().replace("_GEN_VARIABLE", "")
        try:
            if isinstance(comp, unreal.SkeletalMeshComponent):
                mesh = None
                for prop in ("skeletal_mesh_asset", "skeletal_mesh"):
                    try:
                        mesh = comp.get_editor_property(prop)
                        if mesh:
                            break
                    except Exception:
                        pass
                if mesh:
                    log(f" {cname}: {mesh.get_path_name()}")
                    entry["meshes"][cname] = {"mesh": mesh.get_path_name(), "overrides": [], "materials": skeletal_materials(mesh)}
                    try:
                        for i, om in enumerate(comp.get_editor_property("override_materials") or []):
                            if om:
                                mi = material_info(om); mi["index"] = i
                                entry["meshes"][cname]["overrides"].append(mi)
                                log(f"  override slot {i}: {mi['material']} textures={list(mi['textures'].values())}")
                    except Exception:
                        pass
            elif comp.get_class().get_name() == "GroomComponent":
                groom = comp.get_editor_property("groom_asset")
                if groom:
                    log(f" {cname}: groom {groom.get_path_name()}")
                    g = {"groom": groom.get_path_name(), "cards": groom_cards(groom, f"{person}_{cname}")}
                    try:
                        g["material"] = material_info(comp.get_material(0))
                    except Exception:
                        pass
                    entry["grooms"][cname] = g
        except Exception:
            log(f" {cname}: " + traceback.format_exc().splitlines()[-1])
    return entry


os.makedirs(TMP, exist_ok=True)
looks = {}
with unreal.ScopedSlowTask(len(PEOPLE), "VisADLs: exporting how the people look") as task:
    task.make_dialog(True)
    for p in PEOPLE:
        task.enter_progress_frame(1, p)
        try:
            looks[p] = export_person(p)
        except Exception:
            log(f"FAILED {p}:\n" + traceback.format_exc())
with open(os.path.join(OUT, "looks.json"), "w", encoding="utf-8") as f:
    json.dump(looks, f, indent=1)
try:
    os.rmdir(TMP)
except Exception:
    pass
log("done")
try:
    unreal.EditorDialog.show_message("VisADLs", f"Done.\n\nUpload this folder to Google Drive:\n{OUT}", unreal.AppMsgType.OK)
except Exception:
    pass
try:
    if os.name == "nt":
        os.startfile(OUT)
except Exception:
    pass
