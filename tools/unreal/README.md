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

1. Copy the whole `ADLs_Final` folder (with `Content`, `Config` and `ADLs_Final.uproject`) from Drive
   to the computer and open `ADLs_Final.uproject` with Unreal Engine 5.5.
2. Optional but recommended: *Edit > Plugins*, search **glTF Exporter**, tick it, restart.
3. *Tools > Execute Python Script…* and choose [`export_visadls.py`](export_visadls.py).
4. When it finishes, upload the folder `Saved/VisADLsExport` back to Google Drive.

The script only reads the project. It writes, for each scene, a whole-scene FBX (everyone animated
together, so the person, carer, wheelchair and bed stay in sync), a `.glb` if the glTF Exporter is
on, one animation file per animated person/wheelchair, every prop as its own model, an
`inventory.txt` of all sequences/animations/meshes, and `export_log.txt`.

The script has not been run yet (Unreal is not available in the environment it was written in), so
the first run may need adjusting – the log says which step failed.

## Then

The exported `.glb`/`.fbx` files can be imported in the web app straight away (*Room → Import 3D
models*; animated files play on the timeline). Next development steps: compress them for tablets
(MetaHumans are heavy; hair/groom does not export), and attach the recorded motion to the app's own
wheelchair and bed so authentic sequences can be placed in any room.

Check the MetaHuman licence terms and the research participants' consent before sharing exported
avatars or motion capture outside the project.
