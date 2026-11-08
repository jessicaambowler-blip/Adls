"""
VisADLs – save baked animations in a compact form.

Run this AFTER baking each person's movement in Sequencer (right-click "Body" > Bake Animation
Sequence). It finds every baked animation in the project, reads the main body, hand and finger
bones 30 times per second, and saves them compressed – a few MB per person instead of hundreds –
so they can be uploaded and used in the VisADLs web app.

HOW TO RUN (Unreal Engine 5.5, ADLs_Final project open):
  Tools > Execute Python Script...  and choose this file. It takes about a minute.
  The folder <project>/Saved/VisADLsExport_anims opens when it is done: upload it to Google Drive.

It does not play anything and does not change the project.
"""

import json
import os
import struct
import traceback
import zlib

import unreal

FPS = 30
MAX_PART_BYTES = 9 * 1024 * 1024  # keep each file under the 10 MB Drive transfer limit

OUT = os.path.join(unreal.Paths.convert_relative_path_to_full(unreal.Paths.project_saved_dir()), "VisADLsExport_anims")

# MetaHuman body bones kept (the rest are small corrective bones that only refine skin shape)
SIDE = ["clavicle", "upperarm", "lowerarm", "hand",
        "upperarm_twist_01", "upperarm_twist_02", "lowerarm_twist_01", "lowerarm_twist_02",
        "thumb_01", "thumb_02", "thumb_03",
        "index_metacarpal", "index_01", "index_02", "index_03",
        "middle_metacarpal", "middle_01", "middle_02", "middle_03",
        "ring_metacarpal", "ring_01", "ring_02", "ring_03",
        "pinky_metacarpal", "pinky_01", "pinky_02", "pinky_03",
        "thigh", "calf", "foot", "ball",
        "thigh_twist_01", "thigh_twist_02", "calf_twist_01", "calf_twist_02"]
BONES = (["root", "pelvis", "spine_01", "spine_02", "spine_03", "spine_04", "spine_05",
          "neck_01", "neck_02", "head"]
         + [f"{b}_l" for b in SIDE] + [f"{b}_r" for b in SIDE])
TRANSLATED = ["root", "pelvis"]

lines = []


def log(m):
    unreal.log("[VisADLs anims] " + m)
    lines.append(m)
    try:
        os.makedirs(OUT, exist_ok=True)
        with open(os.path.join(OUT, "export_log.txt"), "w", encoding="utf-8") as f:
            f.write("\n".join(lines))
    except Exception:
        pass


def baked_animations():
    reg = unreal.AssetRegistryHelpers.get_asset_registry()
    assets = reg.get_assets_by_class(unreal.TopLevelAssetPath("/Script/Engine", "AnimSequence"), True)
    out = []
    for a in assets:
        p = str(a.package_name)
        if not p.startswith("/Game/") or p.startswith("/Game/VisADLsExport_Temp"):
            continue
        # The MetaHumans folder holds stock animations; keep only bakes saved there by mistake
        # (Unreal's default bake name is "<skeleton>_Sequence<n>").
        if p.startswith("/Game/MetaHumans/") and "_Sequence" not in p.split("/")[-1]:
            continue
        out.append(p)
    return sorted(out)


def poses_at(anim, names, t, mesh):
    try:
        return list(unreal.AnimationLibrary.get_bone_poses_for_time(anim, names, t, False, mesh))
    except TypeError:
        return list(unreal.AnimationLibrary.get_bone_poses_for_time(anim, names, t, False))
    except AttributeError:
        return [unreal.AnimationLibrary.get_bone_pose_for_time(anim, n, t, False) for n in names]


def export_one(path):
    anim = unreal.load_asset(path)
    length = anim.get_play_length()
    mesh = None
    try:
        mesh = anim.get_preview_mesh()
    except Exception:
        pass
    name = anim.get_name()
    frames = int(length * FPS) + 1
    log(f"{path}: {length:.1f} s, preview mesh {mesh.get_path_name() if mesh else 'none'}, {frames} frames")
    names = [unreal.Name(b) for b in BONES]
    raw = bytearray()
    with unreal.ScopedSlowTask(frames, f"Reading {name}") as task:
        task.make_dialog(True)
        for f in range(frames):
            if task.should_cancel():
                break
            task.enter_progress_frame(1)
            t = min(length, f / FPS)
            poses = poses_at(anim, names, t, mesh)
            for b in TRANSLATED:
                tr = poses[BONES.index(b)].translation
                raw += struct.pack("<3f", tr.x, tr.y, tr.z)
            for p in poses:
                q = p.rotation
                raw += struct.pack("<4h", *(max(-32767, min(32767, int(round(v * 32767)))) for v in (q.x, q.y, q.z, q.w)))
    packed = zlib.compress(bytes(raw), 9)
    parts = [packed[i:i + MAX_PART_BYTES] for i in range(0, len(packed), MAX_PART_BYTES)] or [b""]
    base = "".join(c if c.isalnum() or c in "-_" else "_" for c in name)
    for i, part in enumerate(parts):
        with open(os.path.join(OUT, f"{base}.part{i + 1}.z"), "wb") as fh:
            fh.write(part)
    meta = {
        "animation": path, "name": name, "length_seconds": length, "fps": FPS, "frames": frames,
        "preview_mesh": mesh.get_path_name().split(".")[0] if mesh else None,
        "skeleton": anim.get_editor_property("skeleton").get_path_name() if anim.get_editor_property("skeleton") else None,
        "bones": BONES, "translated_bones": TRANSLATED,
        "units": "Unreal: centimetres, Z up; local (parent-relative) bone transforms",
        "layout": "zlib-compressed; join the .partN.z files in order, then decompress. Per frame: "
                  "translation of each translated bone (3 float32), then the rotation of every bone (4 int16 / 32767, x y z w).",
        "parts": len(parts), "compressed_bytes": len(packed), "raw_bytes": len(raw),
    }
    with open(os.path.join(OUT, f"{base}.json"), "w", encoding="utf-8") as fh:
        json.dump(meta, fh, indent=1)
    log(f"  saved {base}: {len(packed) // 1024} KB in {len(parts)} file(s)")


def main():
    os.makedirs(OUT, exist_ok=True)
    anims = baked_animations()
    log(f"Found {len(anims)} baked animation(s): {anims}")
    for p in anims:
        try:
            export_one(p)
        except Exception:
            log(f"FAILED {p}:\n" + traceback.format_exc())
    msg = (f"Done: {len(anims)} animation(s) saved to\n{OUT}\n\nUpload the 'VisADLsExport_anims' folder to Google Drive."
           if anims else "No baked animations were found. Bake each person first: in Sequencer, right-click Body > Bake Animation Sequence.")
    try:
        unreal.EditorDialog.show_message("VisADLs animations", msg, unreal.AppMsgType.OK)
    except Exception:
        pass
    try:
        if os.name == "nt":
            os.startfile(OUT)
    except Exception:
        pass


main()
