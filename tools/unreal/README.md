# Exporting the original VisADLs assets from Unreal

The original project (`ADLs_Final.uproject`, Unreal Engine **5.5**) is in Google Drive under
*ADLS files / ADLs_Final / ADLs_Final*. Its `.uasset` files can only be opened by Unreal, so the
people, wheelchairs, beds and motion capture must be exported from Unreal once, on a computer with
Unreal Engine 5.5 installed.

What is in the project (from the Drive listing):

| Scene | Map | Level sequence | People (Content/MetaHumans) | Equipment (Content/Models) |
|---|---|---|---|---|
| Persona 1 – turning 360° | `P1Turn360` | `Persona1Sequence/P1Turn360` | `Persona1` | `P1_Wheelchair` |
| Persona 2 – bed transfer | `P2BedTransfer` | `Persona2Sequence/P2BedTransfer` (374 MB) | `Persona2`, `Persona2Carer` | `P2_Wheelchair` (`ElectricWheelchair`), `P2_Bed`, `Hoist` |
| Persona 3 – hallway | `P3Hallway` | `Persona3Sequence/P3Hallway` | `Persona3` | `P3_Wheelchair` (`Active_Wheelchair_lowpoly`), `Door` |

## Steps

1. Open `ADLs_Final.uproject` in Unreal Engine 5.5 and wait until the editor has fully loaded.
2. Menu **Tools → Execute Python Script…** and choose `export_visadls.py`.
3. Unreal opens each of the three scenes and steps through it frame by frame (you will see the
   people move). The bed transfer is five minutes of recording, so this takes roughly 10–20 minutes.
   Leave Unreal in front and don't click anything.
4. A **"Finished"** message appears and the output folder opens by itself
   (`<project folder>/Saved/VisADLsExport_v3`).
5. Upload that whole `VisADLsExport_v3` folder to Google Drive.
6. When you close Unreal it may ask to save changes – choose **Don't Save**.

### Results so far

* Version 1 exported the equipment but not the people (the scenes only create them while their
  sequence is open).
* Version 2 exported the people's bodies and faces and a report of the sequences: each person is
  moved by MetaHuman Control Rig keyframes (P1Turn360 21 s, P2BedTransfer 299 s, P3Hallway 12 s),
  and Unreal's "bake to animation" function failed on them ("ObjectInstance is null").
* Version 3 records the movement itself: it steps through each sequence and writes every bone's
  rotation, each person's position and each piece of equipment's position 30 times a second
  (`<scene>_motion.json` + `<scene>_motion.bin`), plus the room objects and all meshes.

### Results of the first run (version 1)

The equipment exported, but the people did not: the original scenes create the people and
wheelchairs only while their sequence is open, and version 1 did not open it. Version 2 opens each
sequence first and also writes `sequence_report.txt`, describing how the movement is stored.

## Then

The exported `.glb`/`.fbx` files can be imported in the web app straight away (*Room → Import 3D
models*; animated files play on the timeline). Next development steps: compress them for tablets
(MetaHumans are heavy; hair/groom does not export), and attach the recorded motion to the app's own
wheelchair and bed so authentic sequences can be placed in any room.

Check the MetaHuman licence terms and the research participants' consent before sharing exported
avatars or motion capture outside the project.
