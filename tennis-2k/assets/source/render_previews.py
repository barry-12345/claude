"""Blender 5.2 EEVEE studio preview renderer for exported tennis_player.glb.

Imports the actual exported .glb back into Blender to verify visual fidelity
and saves bright daylight studio renders under:
  tennis-2k/docs/review/wp-asset/evidence/v2-round-1/

Usage:
  blender --background --python tennis-2k/assets/source/render_previews.py
"""

from __future__ import annotations

import math
from pathlib import Path
from typing import Dict, Tuple

import bpy
from mathutils import Vector

SCRIPT_DIR = Path(__file__).resolve().parent
REPO_ROOT = SCRIPT_DIR.parent.parent
DEFAULT_GLB = REPO_ROOT / "client" / "public" / "assets" / "models" / "tennis_player.glb"
EVIDENCE_DIR = REPO_ROOT / "docs" / "review" / "wp-asset" / "evidence" / "v2-round-1"


def srgb_to_linear(hex_color: str) -> Tuple[float, float, float, float]:
    h = hex_color.lstrip("#")
    r, g, b = (int(h[i : i + 2], 16) / 255.0 for i in (0, 2, 4))

    def conv(c: float) -> float:
        return c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4

    return (conv(r), conv(g), conv(b), 1.0)


def setup_daylight_studio() -> None:
    scene = bpy.context.scene
    scene.render.engine = "BLENDER_EEVEE"
    scene.render.resolution_x = 1280
    scene.render.resolution_y = 900
    scene.render.resolution_percentage = 100
    scene.view_settings.view_transform = "AgX"
    scene.view_settings.look = "AgX - Medium High Contrast"
    scene.view_settings.exposure = -0.25

    world = bpy.data.worlds.new("DaylightStudio")
    scene.world = world
    world.use_nodes = True
    bg = world.node_tree.nodes.get("Background")
    if bg:
        bg.inputs["Color"].default_value = srgb_to_linear("#DBEAFE")
        bg.inputs["Strength"].default_value = 0.95

    bpy.ops.mesh.primitive_plane_add(size=22.0, location=(0.0, 0.0, 0.0))
    ground = bpy.context.active_object
    ground.name = "StudioGround"
    gmat = bpy.data.materials.new("StudioGroundMat")
    gmat.use_nodes = True
    gbsdf = gmat.node_tree.nodes.get("Principled BSDF")
    if gbsdf:
        gbsdf.inputs["Base Color"].default_value = srgb_to_linear("#3B82F6")
        gbsdf.inputs["Roughness"].default_value = 0.85
    ground.data.materials.append(gmat)

    key_data = bpy.data.lights.new("SunKey", type="SUN")
    key_data.energy = 2.4
    key_data.color = (1.0, 0.97, 0.92)
    key_obj = bpy.data.objects.new("SunKey", key_data)
    scene.collection.objects.link(key_obj)
    key_obj.rotation_euler = (math.radians(52), math.radians(-18), math.radians(145))

    fill_data = bpy.data.lights.new("AreaFill", type="AREA")
    fill_data.energy = 90.0
    fill_data.size = 4.5
    fill_data.color = (0.88, 0.94, 1.0)
    fill_obj = bpy.data.objects.new("AreaFill", fill_data)
    scene.collection.objects.link(fill_obj)
    fill_obj.location = (-2.6, 2.8, 2.2)
    look_at(fill_obj, Vector((0.0, 0.0, 1.0)))

    rim_data = bpy.data.lights.new("RimLight", type="AREA")
    rim_data.energy = 85.0
    rim_data.size = 3.5
    rim_data.color = (1.0, 0.99, 0.95)
    rim_obj = bpy.data.objects.new("RimLight", rim_data)
    scene.collection.objects.link(rim_obj)
    rim_obj.location = (1.8, -2.5, 2.3)
    look_at(rim_obj, Vector((0.0, 0.0, 1.1)))


def look_at(obj: bpy.types.Object, target: Vector) -> None:
    direction = target - obj.location
    rot_quat = direction.to_track_quat("-Z", "Y")
    obj.rotation_euler = rot_quat.to_euler()


def ensure_camera(loc: Tuple[float, float, float], target: Tuple[float, float, float], lens: float = 52.0) -> bpy.types.Object:
    cam = bpy.data.objects.get("PreviewCam")
    if cam is None:
        cam_data = bpy.data.cameras.new("PreviewCam")
        cam = bpy.data.objects.new("PreviewCam", cam_data)
        bpy.context.scene.collection.objects.link(cam)
    cam.data.lens = lens
    cam.location = Vector(loc)
    look_at(cam, Vector(target))
    bpy.context.scene.camera = cam
    return cam


def import_avatar(offset_x: float = 0.0) -> Tuple[bpy.types.Object, Dict[str, bpy.types.Object]]:
    before = set(bpy.data.objects)
    bpy.ops.import_scene.gltf(filepath=str(DEFAULT_GLB))
    new_objs = [o for o in bpy.data.objects if o not in before]
    by_name: Dict[str, bpy.types.Object] = {}
    arm = None
    for o in new_objs:
        base = o.name.split(".")[0]
        by_name[base] = o
        if o.type == "ARMATURE":
            arm = o
    if arm:
        arm.location.x += offset_x
    return arm, by_name


def configure_archetype(by_name: Dict[str, bpy.types.Object], arm: bpy.types.Object, arch_id: str) -> None:
    specs = {
        "power": {
            "primary": "#C62828",
            "accent": "#FFFFFF",
            "shorts": "#1E293B",
            "hair": "#3E2723",
            "skin": "#DF9F7A",
            "headgear": "headband",
            "wristbands": True,
            "shoulder": 1.10,
            "z_scale": 1.0,
        },
        "allcourt": {
            "primary": "#1D4ED8",
            "accent": "#FFFFFF",
            "shorts": "#1E293B",
            "hair": "#2B211D",
            "skin": "#E4A885",
            "headgear": "none",
            "wristbands": True,
            "shoulder": 1.00,
            "z_scale": 1.0,
        },
        "serve_volley": {
            "primary": "#F8FAFC",
            "accent": "#15803D",
            "shorts": "#CBD5E1",
            "hair": "#8C5D32",
            "skin": "#ECBA98",
            "headgear": "visor",
            "wristbands": False,
            "shoulder": 1.03,
            "z_scale": 1.0,
        },
        "defender": {
            "primary": "#65A30D",
            "accent": "#18181B",
            "shorts": "#18181B",
            "hair": "#1C1917",
            "skin": "#D89772",
            "headgear": "cap_backwards",
            "wristbands": False,
            "shoulder": 0.94,
            "z_scale": 0.94,
        },
    }
    cfg = specs[arch_id]

    cloned: Dict[str, bpy.types.Material] = {}
    color_map = {
        "Mat_JerseyPrimary": cfg["primary"],
        "Mat_JerseyAccent": cfg["accent"],
        "Mat_Shorts": cfg["shorts"],
        "Mat_Hair": cfg["hair"],
        "Mat_Skin": cfg["skin"],
    }
    for obj in by_name.values():
        if obj.type != "MESH":
            continue
        for idx, slot in enumerate(obj.material_slots):
            if not slot.material:
                continue
            base_mat_name = slot.material.name.split(".")[0]
            if base_mat_name not in cloned:
                m_copy = slot.material.copy()
                if base_mat_name in color_map:
                    bsdf = m_copy.node_tree.nodes.get("Principled BSDF")
                    if bsdf:
                        bsdf.inputs["Base Color"].default_value = srgb_to_linear(color_map[base_mat_name])
                cloned[base_mat_name] = m_copy
            obj.data.materials[idx] = cloned[base_mat_name]

    for node_name, vis in [
        ("Headgear_Headband", cfg["headgear"] == "headband"),
        ("Headgear_Visor", cfg["headgear"] == "visor"),
        ("Headgear_CapBackwards", cfg["headgear"] == "cap_backwards"),
        ("Wristband_L", bool(cfg["wristbands"])),
        ("Wristband_R", bool(cfg["wristbands"])),
        ("Racquet", True),
    ]:
        if node_name in by_name:
            by_name[node_name].hide_render = not vis
            by_name[node_name].hide_viewport = not vis

    if arm and "Chest" in arm.pose.bones:
        pb = arm.pose.bones["Chest"]
        pb.scale = Vector((cfg["shoulder"], 1.0, cfg["z_scale"]))


def play_clip_at(arm: bpy.types.Object, clip_name: str, frame: int) -> None:
    """Assign NLA strip's action directly to arm.animation_data.action for exact frame preview."""
    if not arm or not arm.animation_data:
        return
    for tr in arm.animation_data.nla_tracks:
        tr.mute = True
        if tr.name == clip_name and tr.strips:
            arm.animation_data.action = tr.strips[0].action
            if tr.strips[0].action_slot:
                arm.animation_data.action_slot = tr.strips[0].action_slot
            break
    bpy.context.scene.frame_set(frame)


def render_to(filename: str) -> None:
    out = EVIDENCE_DIR / filename
    bpy.context.scene.render.filepath = str(out)
    bpy.ops.render.render(write_still=True)
    print(f"[Preview] Rendered {out}")


def main() -> None:
    EVIDENCE_DIR.mkdir(parents=True, exist_ok=True)
    bpy.context.scene.render.fps = 100

    # Pass 1: Single-character studio shots (front, back, 3/4 face/upper, shoes)
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.context.scene.render.fps = 100
    setup_daylight_studio()
    arm, by_name = import_avatar(0.0)
    configure_archetype(by_name, arm, "allcourt")
    play_clip_at(arm, "idle", 1)

    ensure_camera((0.0, 3.65, 1.02), (0.0, 0.0, 0.88), lens=50.0)
    render_to("01_front_full.png")

    ensure_camera((0.0, -3.65, 1.02), (0.0, 0.0, 0.88), lens=50.0)
    render_to("02_back_full.png")

    ensure_camera((0.95, 1.48, 1.52), (0.02, 0.02, 1.38), lens=62.0)
    render_to("03_closeup_face_upper.png")

    ensure_camera((0.88, 1.18, 0.34), (0.0, 0.05, 0.20), lens=58.0)
    render_to("04_closeup_shoes.png")

    # Pass 2: Action poses (forehand contact + serve_toss trophy pose at exact peak frames)
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.context.scene.render.fps = 100
    setup_daylight_studio()
    arm_fh, map_fh = import_avatar(-0.85)
    configure_archetype(map_fh, arm_fh, "power")
    arm_st, map_st = import_avatar(0.85)
    configure_archetype(map_st, arm_st, "serve_volley")

    # Clear active action, mute other NLA tracks, and align peak frames to scene frame 20
    for a_obj, cname, frac in [(arm_fh, "forehand", 0.555), (arm_st, "serve_toss", 0.98)]:
        a_obj.animation_data.action = None
        for tr in a_obj.animation_data.nla_tracks:
            if tr.name == cname and tr.strips:
                tr.mute = False
                st = tr.strips[0]
                dur = max(1.0, st.frame_end - st.frame_start)
                st.frame_start = 20.0 - dur * frac
                st.frame_end = st.frame_start + dur
            else:
                tr.mute = True
    bpy.context.scene.frame_set(20)
    ensure_camera((0.40, 4.25, 1.15), (0.0, 0.0, 0.96), lens=45.0)
    render_to("05_action_forehand_and_serve.png")

    # Pass 3: All 4 Archetypes Lineup
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.context.scene.render.fps = 100
    setup_daylight_studio()
    lineup = [
        ("power", -1.55),
        ("allcourt", -0.52),
        ("serve_volley", 0.52),
        ("defender", 1.55),
    ]
    for arch_id, ox in lineup:
        a, m = import_avatar(ox)
        configure_archetype(m, a, arch_id)
        a.animation_data.action = None
        for tr in a.animation_data.nla_tracks:
            tr.mute = tr.name != "idle"
    bpy.context.scene.frame_set(1)
    ensure_camera((0.0, 5.95, 1.08), (0.0, 0.0, 0.88), lens=45.0)
    render_to("06_archetypes_lineup.png")


if __name__ == "__main__":
    main()
