"""
VisADLs – export where everything is over time (positions/rotations keyed in each sequence).

Reads the keyframes of every Transform and Attach track in the three VisADLs sequences – the people,
their bodies, the wheelchairs and the hoist – directly from the sequence data. Nothing is played and
nothing is changed. Takes a few seconds.

HOW TO RUN (Unreal Engine 5.5, ADLs_Final open):
  Tools > Execute Python Script...  and choose this file.
  Upload the folder that opens (<project>/Saved/VisADLsExport_transforms) to Google Drive.
"""

import json
import os
import traceback
import zlib

import unreal

SEQUENCES = [
    "/Game/Persona1Sequence/P1Turn360",
    "/Game/Persona2Sequence/P2BedTransfer",
    "/Game/Persona3Sequence/P3Hallway",
]
OUT = os.path.join(unreal.Paths.convert_relative_path_to_full(unreal.Paths.project_saved_dir()), "VisADLsExport_transforms")
log_lines = []


def log(m):
    unreal.log("[VisADLs transforms] " + m)
    log_lines.append(m)
    os.makedirs(OUT, exist_ok=True)
    with open(os.path.join(OUT, "export_log.txt"), "w", encoding="utf-8") as f:
        f.write("\n".join(log_lines))


def rate(fr):
    return fr.numerator / fr.denominator


def frame_seconds(t, tick):
    try:
        fn = t.frame_number.value if hasattr(t, "frame_number") else t.value
        sub = getattr(t, "sub_frame", 0.0) or 0.0
    except Exception:
        fn, sub = t, 0.0
    return (fn + sub) / tick


def channel_data(ch, tick):
    out = {"name": str(getattr(ch, "channel_name", "")), "keys": []}
    try:
        if ch.has_default():
            out["default"] = ch.get_default()
    except Exception:
        pass
    try:
        for k in ch.get_keys():
            out["keys"].append([round(frame_seconds(k.get_time(), tick), 5), k.get_value()])
    except Exception as e:
        out["error"] = str(e)
    return out


def all_bindings(seq):
    seen, out = set(), []

    def add(b, parent):
        key = str(b.get_id())
        if key in seen:
            return
        seen.add(key)
        out.append((b, parent))
        try:
            for c in b.get_child_possessables():
                add(c, b)
        except Exception:
            pass

    for b in seq.get_bindings():
        add(b, None)
    return out


def export(seq_path):
    seq = unreal.load_asset(seq_path)
    tick = rate(seq.get_tick_resolution())
    result = {
        "sequence": seq_path,
        "display_rate": rate(seq.get_display_rate()),
        "tick_resolution": tick,
        "playback": [seq.get_playback_start_seconds(), seq.get_playback_end_seconds()],
        "units": "Unreal: cm, degrees (Rotation channels X=roll, Y=pitch, Z=yaw), Z up",
        "bindings": [],
    }
    for b, parent in all_bindings(seq):
        entry = {
            "name": str(b.get_display_name()),
            "id": str(b.get_id()),
            "parent": str(parent.get_id()) if parent else None,
            "parent_name": str(parent.get_display_name()) if parent else None,
            "tracks": [],
        }
        try:
            entry["possessed_class"] = str(b.get_possessed_object_class().get_name())
        except Exception:
            pass
        for t in b.get_tracks():
            cls = t.get_class().get_name()
            if cls not in ("MovieScene3DTransformTrack", "MovieScene3DAttachTrack", "MovieSceneSpawnTrack"):
                continue
            tr = {"type": cls, "sections": []}
            for s in t.get_sections():
                sec = {}
                try:
                    sec["range"] = [s.get_start_frame_seconds() if s.has_start_frame() else None,
                                    s.get_end_frame_seconds() if s.has_end_frame() else None]
                except Exception:
                    pass
                try:
                    sec["channels"] = [channel_data(c, tick) for c in s.get_all_channels()]
                except Exception as e:
                    sec["error"] = str(e)
                if cls == "MovieScene3DAttachTrack":
                    for prop in ("attach_socket_name", "attach_component_name", "attach_rule", "detach_rule"):
                        try:
                            sec[prop] = str(s.get_editor_property(prop))
                        except Exception:
                            pass
                    try:
                        cb = s.get_editor_property("constraint_binding_id")
                        sec["attach_to"] = str(cb.get_editor_property("guid"))
                    except Exception:
                        pass
                try:
                    sec["blend"] = str(s.get_blend_type().blend_type) if hasattr(s, "get_blend_type") else None
                except Exception:
                    pass
                tr["sections"].append(sec)
            entry["tracks"].append(tr)
        result["bindings"].append(entry)
    name = seq_path.split("/")[-1]
    raw = json.dumps(result).encode("utf-8")
    with open(os.path.join(OUT, f"{name}_transforms.json.z"), "wb") as f:
        f.write(zlib.compress(raw, 9))
    n_keys = sum(len(c["keys"]) for e in result["bindings"] for t in e["tracks"] for s in t["sections"] for c in s.get("channels", []))
    log(f"{name}: {len(result['bindings'])} bindings, {n_keys} keys, {len(raw) // 1024} KB")


os.makedirs(OUT, exist_ok=True)
for p in SEQUENCES:
    try:
        export(p)
    except Exception:
        log(f"FAILED {p}:\n" + traceback.format_exc())
try:
    unreal.EditorDialog.show_message("VisADLs", f"Done.\n\nUpload this folder to Google Drive:\n{OUT}", unreal.AppMsgType.OK)
except Exception:
    pass
try:
    if os.name == "nt":
        os.startfile(OUT)
except Exception:
    pass
