"""Deterministic Blender 5.2.3 LTS generator for stylized tennis player .glb asset.

Implements WP-Asset for Court 2K V2 (CONTRACT.md §4.2 & SPEC.md §3.5):
- Stylized Mario Tennis / Nintendo Switch Sports athletic proportions (~1.76 m)
- Unified smooth-skinned body + clothing + sculpted face + layered hair
- 21-bone Armature with exact CONTRACT hierarchy
- 6 independent named toggleable nodes (Headgear_*, Wristband_*, Racquet)
- 10 runtime-swappable materials + 4 static detail materials
- 8 embedded NLA animation clips (0 bone scale channels)
- Default export: tennis-2k/client/public/assets/models/tennis_player.glb

Usage:
  blender --background --python tennis-2k/assets/source/generate_player_avatar.py
  blender --background --python tennis-2k/assets/source/generate_player_avatar.py -- --output path/to/out.glb
"""

from __future__ import annotations

import argparse
import math
import sys
from pathlib import Path
from typing import Dict, List, Optional, Sequence, Tuple

import bpy
import bmesh
from mathutils import Euler, Matrix, Quaternion, Vector


# ---------------------------------------------------------------------------
# Constants & Contract Specifications
# ---------------------------------------------------------------------------

SCRIPT_DIR = Path(__file__).resolve().parent
REPO_ROOT = SCRIPT_DIR.parent.parent  # tennis-2k/
DEFAULT_OUTPUT_PATH = REPO_ROOT / "client" / "public" / "assets" / "models" / "tennis_player.glb"

FPS = 100  # Exact integer frames for 0.35 s (35), 0.36 s (36), 0.40 s (40)

BONE_SPECS: List[Tuple[str, Optional[str], Tuple[float, float, float], Tuple[float, float, float]]] = [
    ("Hips", None, (0.0, 0.0, 0.90), (0.0, 0.0, 1.03)),
    ("Spine", "Hips", (0.0, 0.0, 1.03), (0.0, 0.0, 1.17)),
    ("Chest", "Spine", (0.0, 0.0, 1.17), (0.0, 0.0, 1.38)),
    ("Neck", "Chest", (0.0, 0.0, 1.38), (0.0, 0.0, 1.445)),
    ("Head", "Neck", (0.0, 0.0, 1.445), (0.0, 0.0, 1.675)),
    ("HeadgearSocket", "Head", (0.0, 0.0, 1.58), (0.0, 0.0, 1.70)),
    # Left Arm (-X)
    ("Shoulder_L", "Chest", (-0.065, 0.0, 1.335), (-0.175, 0.0, 1.33)),
    ("UpperArm_L", "Shoulder_L", (-0.175, 0.0, 1.33), (-0.345, 0.02, 1.14)),
    ("Forearm_L", "UpperArm_L", (-0.345, 0.02, 1.14), (-0.485, 0.06, 0.96)),
    ("Hand_L", "Forearm_L", (-0.485, 0.06, 0.96), (-0.555, 0.08, 0.87)),
    # Right Arm (+X) - Racquet Side
    ("Shoulder_R", "Chest", (0.065, 0.0, 1.335), (0.175, 0.0, 1.33)),
    ("UpperArm_R", "Shoulder_R", (0.175, 0.0, 1.33), (0.345, 0.02, 1.14)),
    ("Forearm_R", "UpperArm_R", (0.345, 0.02, 1.14), (0.485, 0.06, 0.96)),
    ("Hand_R", "Forearm_R", (0.485, 0.06, 0.96), (0.555, 0.08, 0.87)),
    ("RacquetSocket", "Hand_R", (0.525, 0.075, 0.905), (0.525, 0.175, 0.905)),
    # Left Leg (-X)
    ("Thigh_L", "Hips", (-0.086, 0.0, 0.88), (-0.092, 0.01, 0.49)),
    ("Shin_L", "Thigh_L", (-0.092, 0.01, 0.49), (-0.095, -0.01, 0.105)),
    ("Foot_L", "Shin_L", (-0.095, -0.01, 0.105), (-0.095, 0.14, 0.03)),
    # Right Leg (+X)
    ("Thigh_R", "Hips", (0.086, 0.0, 0.88), (0.092, 0.01, 0.49)),
    ("Shin_R", "Thigh_R", (0.092, 0.01, 0.49), (0.095, -0.01, 0.105)),
    ("Foot_R", "Shin_R", (0.095, -0.01, 0.105), (0.095, 0.14, 0.03)),
]

PART_TORSO = 0
PART_ARM_L = 1
PART_ARM_R = 2
PART_LEG_L = 3
PART_LEG_R = 4
PART_HEAD = 5


def parse_args() -> argparse.Namespace:
    argv = sys.argv
    if "--" in argv:
        argv = argv[argv.index("--") + 1 :]
    else:
        argv = []
    parser = argparse.ArgumentParser(description="Generate Court 2K V2 stylized tennis player .glb")
    parser.add_argument(
        "--output",
        type=str,
        default=str(DEFAULT_OUTPUT_PATH),
        help="Destination .glb file path",
    )
    return parser.parse_args(argv)


def srgb_to_linear(hex_color: str) -> Tuple[float, float, float, float]:
    h = hex_color.lstrip("#")
    r, g, b = (int(h[i : i + 2], 16) / 255.0 for i in (0, 2, 4))

    def conv(c: float) -> float:
        return c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4

    return (conv(r), conv(g), conv(b), 1.0)


def make_pbr_material(
    name: str,
    hex_color: str,
    roughness: float = 0.55,
    metallic: float = 0.0,
) -> bpy.types.Material:
    mat = bpy.data.materials.new(name=name)
    mat.use_nodes = True
    bsdf = mat.node_tree.nodes.get("Principled BSDF")
    if bsdf:
        bsdf.inputs["Base Color"].default_value = srgb_to_linear(hex_color)
        bsdf.inputs["Roughness"].default_value = roughness
        bsdf.inputs["Metallic"].default_value = metallic
        if "Specular IOR Level" in bsdf.inputs:
            bsdf.inputs["Specular IOR Level"].default_value = 0.35
    return mat


def create_materials() -> Dict[str, bpy.types.Material]:
    return {
        # 10 Required runtime-swappable materials (CONTRACT.md §4.2)
        "Mat_JerseyPrimary": make_pbr_material("Mat_JerseyPrimary", "#1D4ED8", roughness=0.58),
        "Mat_JerseyAccent": make_pbr_material("Mat_JerseyAccent", "#FFFFFF", roughness=0.52),
        "Mat_Shorts": make_pbr_material("Mat_Shorts", "#1E293B", roughness=0.68),
        "Mat_Skin": make_pbr_material("Mat_Skin", "#E4A885", roughness=0.58),
        "Mat_Hair": make_pbr_material("Mat_Hair", "#2B211D", roughness=0.62),
        "Mat_Socks": make_pbr_material("Mat_Socks", "#F1F5F9", roughness=0.72),
        "Mat_ShoeUpper": make_pbr_material("Mat_ShoeUpper", "#E2E8F0", roughness=0.45),
        "Mat_ShoeSole": make_pbr_material("Mat_ShoeSole", "#1E293B", roughness=0.78),
        "Mat_RacquetFrame": make_pbr_material("Mat_RacquetFrame", "#111827", roughness=0.28, metallic=0.35),
        "Mat_RacquetStrings": make_pbr_material("Mat_RacquetStrings", "#F1F5F9", roughness=0.35),
        # Static non-swapped detail materials
        "Mat_EyeWhite": make_pbr_material("Mat_EyeWhite", "#FFFFFF", roughness=0.14),
        "Mat_EyeIris": make_pbr_material("Mat_EyeIris", "#2563EB", roughness=0.12),
        "Mat_FaceDetail": make_pbr_material("Mat_FaceDetail", "#1B1E28", roughness=0.38),
        "Mat_RacquetGrip": make_pbr_material("Mat_RacquetGrip", "#18181B", roughness=0.85),
    }


# ---------------------------------------------------------------------------
# Armature Construction
# ---------------------------------------------------------------------------

def build_armature() -> bpy.types.Object:
    arm_data = bpy.data.armatures.new("Armature")
    arm_obj = bpy.data.objects.new("Armature", arm_data)
    bpy.context.scene.collection.objects.link(arm_obj)
    bpy.context.view_layer.objects.active = arm_obj

    bpy.ops.object.mode_set(mode="EDIT")
    created: Dict[str, bpy.types.EditBone] = {}
    for name, parent_name, head, tail in BONE_SPECS:
        eb = arm_data.edit_bones.new(name)
        eb.head = Vector(head)
        eb.tail = Vector(tail)
        eb.roll = 0.0
        if parent_name:
            eb.parent = created[parent_name]
        if "UpperArm" in name or "Forearm" in name or "Hand" in name:
            eb.align_roll(Vector((0.0, 1.0, 0.0)))
        elif "Thigh" in name or "Shin" in name or "Foot" in name:
            eb.align_roll(Vector((0.0, 1.0, 0.0)))
        created[name] = eb

    bpy.ops.object.mode_set(mode="OBJECT")
    return arm_obj


# ---------------------------------------------------------------------------
# BMesh Modeling Helpers
# ---------------------------------------------------------------------------

def add_loft_tube(
    bm: bmesh.types.BMesh,
    rings: List[Tuple[Vector, Vector, Vector, float, float, int]],
    mat_indices: List[int],
    part_layer: Optional[bmesh.types.BMLayerItem] = None,
    part_id: int = 0,
    cap_start: bool = False,
    cap_end: bool = False,
    superellipse_p: float = 2.0,
) -> List[List[bmesh.types.BMVert]]:
    all_verts: List[List[bmesh.types.BMVert]] = []
    for center, u_axis, v_axis, ru, rv, segs in rings:
        ring_verts: List[bmesh.types.BMVert] = []
        for i in range(segs):
            theta = (2.0 * math.pi * i) / segs
            ct = math.cos(theta)
            st = math.sin(theta)
            if superellipse_p != 2.0:
                exp = 2.0 / superellipse_p
                ct = math.copysign(abs(ct) ** exp, ct)
                st = math.copysign(abs(st) ** exp, st)
            pt = center + u_axis * (ru * ct) + v_axis * (rv * st)
            v = bm.verts.new(pt)
            if part_layer is not None:
                v[part_layer] = part_id
            ring_verts.append(v)
        all_verts.append(ring_verts)

    for r_idx in range(len(all_verts) - 1):
        r0 = all_verts[r_idx]
        r1 = all_verts[r_idx + 1]
        segs = len(r0)
        m_idx = mat_indices[r_idx]
        for i in range(segs):
            ni = (i + 1) % segs
            f = bm.faces.new((r0[i], r0[ni], r1[ni], r1[i]))
            f.material_index = m_idx
            f.smooth = True

    if cap_start and all_verts:
        f = bm.faces.new(list(reversed(all_verts[0])))
        f.material_index = mat_indices[0]
        f.smooth = True
    if cap_end and all_verts:
        f = bm.faces.new(all_verts[-1])
        f.material_index = mat_indices[-1]
        f.smooth = True

    return all_verts


def frame_from_dir(direction: Vector, ref_forward: Vector = Vector((0.0, 1.0, 0.0))) -> Tuple[Vector, Vector]:
    d = direction.normalized()
    u = d.cross(ref_forward)
    if u.length < 1e-4:
        u = d.cross(Vector((1.0, 0.0, 0.0)))
    u.normalize()
    v = u.cross(d).normalized()
    return u, v


def add_sculpted_ellipsoid(
    bm: bmesh.types.BMesh,
    center: Vector,
    radii: Tuple[float, float, float],
    mat_idx: int,
    part_layer: Optional[bmesh.types.BMLayerItem] = None,
    part_id: int = 0,
    subdiv: int = 2,
    rot_euler: Optional[Tuple[float, float, float]] = None,
    smooth: bool = True,
) -> List[bmesh.types.BMVert]:
    ret = bmesh.ops.create_icosphere(bm, subdivisions=subdiv, radius=1.0)
    verts = ret["verts"]
    rot_mat = Euler(rot_euler, "XYZ").to_matrix() if rot_euler else Matrix.Identity(3)
    for v in verts:
        p = Vector((v.co.x * radii[0], v.co.y * radii[1], v.co.z * radii[2]))
        v.co = center + (rot_mat @ p)
        if part_layer is not None:
            v[part_layer] = part_id
    vert_set = set(verts)
    for f in bm.faces:
        if all(v in vert_set for v in f.verts):
            f.material_index = mat_idx
            f.smooth = smooth
    return verts


def add_torus_band(
    bm: bmesh.types.BMesh,
    center: Vector,
    major_rx: float,
    major_ry: float,
    minor_r: float,
    major_segs: int,
    minor_segs: int,
    mat_idx: int,
    part_layer: Optional[bmesh.types.BMLayerItem] = None,
    part_id: int = 0,
    rot_euler: Optional[Tuple[float, float, float]] = None,
    arc_start: float = 0.0,
    arc_end: float = 2.0 * math.pi,
    closed_loop: bool = True,
) -> List[bmesh.types.BMVert]:
    rot_mat = Euler(rot_euler, "XYZ").to_matrix() if rot_euler else Matrix.Identity(3)
    rings: List[List[bmesh.types.BMVert]] = []
    steps = major_segs if closed_loop else major_segs + 1
    for i in range(steps):
        t = i / major_segs
        ang = arc_start + (arc_end - arc_start) * t
        ca, sa = math.cos(ang), math.sin(ang)
        ring_center = Vector((major_rx * ca, major_ry * sa, 0.0))
        outward = Vector((ca / max(major_rx, 1e-4), sa / max(major_ry, 1e-4), 0.0)).normalized()
        up = Vector((0.0, 0.0, 1.0))
        ring_vs: List[bmesh.types.BMVert] = []
        for j in range(minor_segs):
            phi = (2.0 * math.pi * j) / minor_segs
            local_p = ring_center + outward * (minor_r * math.cos(phi)) + up * (minor_r * math.sin(phi))
            v = bm.verts.new(center + (rot_mat @ local_p))
            if part_layer is not None:
                v[part_layer] = part_id
            ring_vs.append(v)
        rings.append(ring_vs)

    created_verts = [v for r in rings for v in r]
    for i in range(major_segs):
        r0 = rings[i]
        r1 = rings[(i + 1) % len(rings)] if closed_loop else rings[i + 1]
        for j in range(minor_segs):
            nj = (j + 1) % minor_segs
            f = bm.faces.new((r0[j], r1[j], r1[nj], r0[nj]))
            f.material_index = mat_idx
            f.smooth = True

    if not closed_loop and rings:
        f0 = bm.faces.new(list(reversed(rings[0])))
        f0.material_index = mat_idx
        f0.smooth = True
        f1 = bm.faces.new(rings[-1])
        f1.material_index = mat_idx
        f1.smooth = True

    return created_verts


# ---------------------------------------------------------------------------
# Main Stylized Character Body Builder (Unified SkinnedMesh)
# ---------------------------------------------------------------------------

def build_body_mesh(arm_obj: bpy.types.Object, mats: Dict[str, bpy.types.Material]) -> bpy.types.Object:
    mesh = bpy.data.meshes.new("Avatar_Body")
    obj = bpy.data.objects.new("Avatar_Body", mesh)
    bpy.context.scene.collection.objects.link(obj)

    mat_order = [
        "Mat_JerseyPrimary",
        "Mat_JerseyAccent",
        "Mat_Shorts",
        "Mat_Skin",
        "Mat_Hair",
        "Mat_Socks",
        "Mat_ShoeUpper",
        "Mat_ShoeSole",
        "Mat_EyeWhite",
        "Mat_EyeIris",
        "Mat_FaceDetail",
    ]
    mat_idx = {name: i for i, name in enumerate(mat_order)}
    for name in mat_order:
        obj.data.materials.append(mats[name])

    bm = bmesh.new()
    part_layer = bm.verts.layers.int.new("part_id")

    # -----------------------------------------------------------------------
    # 1. Torso + Tailored Shorts Pelvis + Collar + Neck
    # -----------------------------------------------------------------------
    torso_profile = [
        (0.765, 0.000, 0.145, 0.106, "Mat_Shorts", 2.1),         # Bottom pelvis block
        (0.835, -0.004, 0.162, 0.118, "Mat_Shorts", 2.1),        # Smooth hip curve
        (0.895, -0.004, 0.158, 0.115, "Mat_Shorts", 2.1),        # Upper hip
        (0.935, 0.002, 0.148, 0.109, "Mat_Shorts", 2.1),         # Shorts waistband
        (0.948, 0.004, 0.151, 0.111, "Mat_JerseyPrimary", 2.1),  # Jersey bottom hem
        (1.035, 0.008, 0.140, 0.105, "Mat_JerseyPrimary", 2.1),  # Athletic waist
        (1.135, 0.010, 0.158, 0.114, "Mat_JerseyPrimary", 2.15), # Lower ribcage
        (1.185, 0.012, 0.170, 0.120, "Mat_JerseyAccent", 2.2),   # Chest accent stripe
        (1.228, 0.014, 0.178, 0.122, "Mat_JerseyPrimary", 2.2),  # Upper chest
        (1.312, 0.010, 0.178, 0.114, "Mat_JerseyPrimary", 2.2),  # Shoulder yoke (blends cleanly into arms)
        (1.362, 0.006, 0.128, 0.092, "Mat_JerseyPrimary", 2.1),  # Trapezius slope
        (1.380, 0.006, 0.070, 0.066, "Mat_JerseyAccent", 2.0),   # Collar rim
        (1.402, 0.008, 0.064, 0.062, "Mat_Skin", 2.0),           # Collar top -> neck
        (1.390, 0.008, 0.049, 0.050, "Mat_Skin", 2.0),           # Neck base inside collar
        (1.430, 0.006, 0.048, 0.049, "Mat_Skin", 2.0),           # Mid neck (athletic, shorter)
        (1.468, 0.006, 0.052, 0.054, "Mat_Skin", 2.0),           # Upper neck into jaw
    ]
    torso_segs = 20
    torso_rings = []
    torso_mats = []
    for i, (z, y_off, rx, ry, m_name, p_exp) in enumerate(torso_profile):
        ring_verts = []
        for s in range(torso_segs):
            th = (2.0 * math.pi * s) / torso_segs
            ct, st = math.cos(th), math.sin(th)
            exp = 2.0 / p_exp
            ct = math.copysign(abs(ct) ** exp, ct)
            st = math.copysign(abs(st) ** exp, st)
            pt = Vector((rx * ct, y_off + ry * st, z))
            v = bm.verts.new(pt)
            v[part_layer] = PART_TORSO
            ring_verts.append(v)
        torso_rings.append(ring_verts)
        if i < len(torso_profile) - 1:
            torso_mats.append(mat_idx[m_name])

    for i in range(len(torso_rings) - 1):
        r0, r1 = torso_rings[i], torso_rings[i + 1]
        m = torso_mats[i]
        for s in range(torso_segs):
            ns = (s + 1) % torso_segs
            f = bm.faces.new((r0[s], r0[ns], r1[ns], r1[s]))
            f.material_index = m
            f.smooth = True

    bm.faces.new(list(reversed(torso_rings[0]))).material_index = mat_idx["Mat_Shorts"]
    bm.faces.new(torso_rings[-1]).material_index = mat_idx["Mat_Skin"]

    # Crisp Collar Ring
    add_torus_band(
        bm,
        Vector((0.0, 0.007, 1.388)),
        0.066,
        0.063,
        0.011,
        18,
        6,
        mat_idx["Mat_JerseyAccent"],
        part_layer=part_layer,
        part_id=PART_TORSO,
        rot_euler=(0.08, 0.0, 0.0),
    )

    # -----------------------------------------------------------------------
    # 2. Arms: Smooth Deltoid Sleeve -> Skin Arm -> Sculpted Hand
    # -----------------------------------------------------------------------
    for side_sign, part_id in ((-1.0, PART_ARM_L), (1.0, PART_ARM_R)):
        p_sh_in = Vector((side_sign * 0.132, 0.006, 1.300))
        p_sh = Vector((side_sign * 0.178, 0.004, 1.305))
        p_ua_mid = Vector((side_sign * 0.258, 0.010, 1.235))
        p_ua_cuff = Vector((side_sign * 0.275, 0.012, 1.215))
        p_el = Vector((side_sign * 0.345, 0.020, 1.140))
        p_fa_mid = Vector((side_sign * 0.422, 0.042, 1.042))
        p_wr = Vector((side_sign * 0.485, 0.060, 0.960))
        p_palm = Vector((side_sign * 0.518, 0.070, 0.915))
        p_fingers = Vector((side_sign * 0.545, 0.082, 0.872))

        arm_stations = [
            (p_sh_in, 0.068, 0.068, "Mat_JerseyPrimary"),
            (p_sh, 0.066, 0.064, "Mat_JerseyPrimary"),
            (p_ua_mid, 0.060, 0.058, "Mat_JerseyAccent"),
            (p_ua_cuff, 0.062, 0.060, "Mat_Skin"),
            (p_ua_cuff - Vector((side_sign * 0.008, 0.0, -0.008)), 0.046, 0.045, "Mat_Skin"),
            (p_el, 0.042, 0.040, "Mat_Skin"),
            (p_fa_mid, 0.043, 0.041, "Mat_Skin"),
            (p_wr, 0.032, 0.028, "Mat_Skin"),
            (p_palm, 0.038, 0.024, "Mat_Skin"),
            (p_fingers, 0.030, 0.018, "Mat_Skin"),
        ]
        arm_rings = []
        arm_mats = []
        arm_segs = 12
        for i, (pt, ru, rv, m_name) in enumerate(arm_stations):
            if i == 0:
                tangent = arm_stations[1][0] - pt
            elif i == len(arm_stations) - 1:
                tangent = pt - arm_stations[-2][0]
            else:
                tangent = arm_stations[i + 1][0] - arm_stations[i - 1][0]
            u, v = frame_from_dir(tangent, Vector((0.0, 1.0, 0.0)))
            arm_rings.append((pt, u, v, ru, rv, arm_segs))
            if i < len(arm_stations) - 1:
                arm_mats.append(mat_idx[m_name])

        add_loft_tube(
            bm, arm_rings, arm_mats,
            part_layer=part_layer, part_id=part_id,
            cap_start=True, cap_end=True, superellipse_p=2.1,
        )

        # Sculpted Thumb
        thumb_dir = Vector((-side_sign * 0.012, 0.028, -0.022))
        thumb_base = p_palm + Vector((0.0, 0.020, 0.005))
        u_t, v_t = frame_from_dir(thumb_dir, Vector((side_sign, 0.0, 0.0)))
        add_loft_tube(
            bm,
            [
                (thumb_base, u_t, v_t, 0.013, 0.012, 8),
                (thumb_base + thumb_dir * 0.6, u_t, v_t, 0.012, 0.011, 8),
                (thumb_base + thumb_dir, u_t, v_t, 0.008, 0.008, 8),
            ],
            [mat_idx["Mat_Skin"], mat_idx["Mat_Skin"]],
            part_layer=part_layer, part_id=part_id,
            cap_start=True, cap_end=True,
        )

    # -----------------------------------------------------------------------
    # 3. Legs: Smooth Tailored Shorts -> Thigh -> Knee -> Calf -> Sock -> Shoe
    # -----------------------------------------------------------------------
    for side_sign, part_id in ((-1.0, PART_LEG_L), (1.0, PART_LEG_R)):
        x_hip = side_sign * 0.084
        x_knee = side_sign * 0.092
        x_ankle = side_sign * 0.095
        leg_stations = [
            (Vector((x_hip, -0.002, 0.875)), 0.076, 0.092, "Mat_Shorts"),       # Tucked smoothly inside pelvis
            (Vector((x_hip * 1.04, 0.001, 0.780)), 0.084, 0.092, "Mat_Shorts"), # Smooth shorts leg
            (Vector((x_hip * 1.06, 0.004, 0.680)), 0.088, 0.092, "Mat_Skin"),   # Shorts hem
            (Vector((x_hip * 1.06, 0.004, 0.695)), 0.070, 0.072, "Mat_Skin"),   # Tucked thigh
            (Vector((x_knee, 0.008, 0.560)), 0.063, 0.065, "Mat_Skin"),         # Lower thigh
            (Vector((x_knee, 0.012, 0.485)), 0.056, 0.058, "Mat_Skin"),         # Knee
            (Vector((x_ankle, -0.004, 0.365)), 0.061, 0.065, "Mat_Skin"),       # Athletic calf
            (Vector((x_ankle, -0.006, 0.275)), 0.052, 0.054, "Mat_JerseyAccent"),
            (Vector((x_ankle, -0.007, 0.252)), 0.053, 0.055, "Mat_Socks"),
            (Vector((x_ankle, -0.008, 0.175)), 0.046, 0.048, "Mat_Socks"),
            (Vector((x_ankle, -0.010, 0.095)), 0.045, 0.048, "Mat_Socks"),
        ]
        leg_rings = []
        leg_mats = []
        leg_segs = 14
        for i, (pt, ru, rv, m_name) in enumerate(leg_stations):
            if i == 0:
                tangent = leg_stations[1][0] - pt
            elif i == len(leg_stations) - 1:
                tangent = pt - leg_stations[-2][0]
            else:
                tangent = leg_stations[i + 1][0] - leg_stations[i - 1][0]
            u, v = frame_from_dir(tangent, Vector((0.0, 1.0, 0.0)))
            leg_rings.append((pt, u, v, ru, rv, leg_segs))
            if i < len(leg_stations) - 1:
                leg_mats.append(mat_idx[m_name])

        add_loft_tube(
            bm, leg_rings, leg_mats,
            part_layer=part_layer, part_id=part_id,
            cap_start=True, cap_end=True, superellipse_p=2.05,
        )

        # Flush Shorts Side Accent Stripe
        add_sculpted_ellipsoid(
            bm,
            Vector((x_hip * 1.05 + side_sign * 0.084, 0.002, 0.770)),
            (0.004, 0.011, 0.078),
            mat_idx["Mat_JerseyAccent"],
            part_layer=part_layer,
            part_id=part_id,
            subdiv=1,
        )

        # Sculpted Streamlined Tennis Sneaker (flat sole bottom at z = 0.000 m, clean silhouette)
        shoe_slices = [
            (-0.062, 0.003, 0.088, 0.042),
            (-0.042, 0.000, 0.105, 0.049),
            (0.005,  0.000, 0.108, 0.052),
            (0.065,  0.000, 0.086, 0.053),
            (0.130,  0.000, 0.064, 0.055),
            (0.182,  0.002, 0.048, 0.047),
            (0.206,  0.012, 0.032, 0.026),
        ]
        sole_h = 0.023
        shoe_rings: List[List[bmesh.types.BMVert]] = []
        for sy, zb, zt, hw in shoe_slices:
            z_mid_sole = zb + sole_h
            pts_2d = [
                (0.0, zb),
                (hw * 0.72, zb),
                (hw * 0.96, zb + 0.005),
                (hw * 1.00, z_mid_sole),
                (hw * 0.90, z_mid_sole + (zt - z_mid_sole) * 0.45),
                (hw * 0.55, z_mid_sole + (zt - z_mid_sole) * 0.85),
                (0.0, zt),
                (-hw * 0.55, z_mid_sole + (zt - z_mid_sole) * 0.85),
                (-hw * 0.90, z_mid_sole + (zt - z_mid_sole) * 0.45),
                (-hw * 1.00, z_mid_sole),
                (-hw * 0.96, zb + 0.005),
                (-hw * 0.72, zb),
            ]
            ring_v = []
            for px, pz in pts_2d:
                v = bm.verts.new(Vector((x_ankle + px, sy, pz)))
                v[part_layer] = part_id
                ring_v.append(v)
            shoe_rings.append(ring_v)

        n_ring = len(shoe_rings[0])
        for i in range(len(shoe_rings) - 1):
            r0, r1 = shoe_rings[i], shoe_rings[i + 1]
            for j in range(n_ring):
                nj = (j + 1) % n_ring
                f = bm.faces.new((r0[j], r0[nj], r1[nj], r1[j]))
                if j in (0, 1, 2, 9, 10, 11):
                    f.material_index = mat_idx["Mat_ShoeSole"]
                else:
                    f.material_index = mat_idx["Mat_ShoeUpper"]
                f.smooth = True

        f_heel = bm.faces.new(list(reversed(shoe_rings[0])))
        f_heel.material_index = mat_idx["Mat_ShoeUpper"]
        f_heel.smooth = True
        f_toe = bm.faces.new(shoe_rings[-1])
        f_toe.material_index = mat_idx["Mat_ShoeSole"]
        f_toe.smooth = True

        # Flush sleek accent bar along outer shoe sidewall
        add_sculpted_ellipsoid(
            bm,
            Vector((x_ankle + side_sign * 0.049, 0.068, 0.042)),
            (0.003, 0.046, 0.008),
            mat_idx["Mat_JerseyAccent"],
            part_layer=part_layer,
            part_id=part_id,
            subdiv=1,
            rot_euler=(0.12, 0.0, 0.0),
        )

    # -----------------------------------------------------------------------
    # 4. Sculpted Head, Jaw, Nose, Ears, Eyes, Brows & Smile (natural neck height!)
    # -----------------------------------------------------------------------
    head_center = Vector((0.0, 0.008, 1.562))
    ret_head = bmesh.ops.create_icosphere(bm, subdivisions=3, radius=1.0)
    head_verts = ret_head["verts"]
    for v in head_verts:
        p = v.co.copy()
        rx, ry, rz = 0.104, 0.111, 0.121
        if p.z < 0.0:
            t = min(1.0, abs(p.z))
            rx *= (1.0 - 0.30 * (t ** 1.35))
            ry *= (1.0 - 0.18 * (t ** 1.5))
            if p.y > 0.25 and p.z < -0.25:
                p.y += 0.06 * (1.0 - abs(p.x))
        if p.y > 0.35:
            ry *= 0.94
        v.co = head_center + Vector((p.x * rx, p.y * ry, p.z * rz))
        v[part_layer] = PART_HEAD

    head_set = set(head_verts)
    for f in bm.faces:
        if all(v in head_set for v in f.verts):
            f.material_index = mat_idx["Mat_Skin"]
            f.smooth = True

    # Sculpted Cute Stylized Nose
    add_sculpted_ellipsoid(
        bm,
        Vector((0.0, 0.114, 1.539)),
        (0.012, 0.015, 0.013),
        mat_idx["Mat_Skin"],
        part_layer=part_layer,
        part_id=PART_HEAD,
        subdiv=2,
        rot_euler=(-0.18, 0.0, 0.0),
    )

    # Sculpted Rounded Ears
    for side_sign in (-1.0, 1.0):
        add_sculpted_ellipsoid(
            bm,
            Vector((side_sign * 0.102, -0.004, 1.547)),
            (0.014, 0.020, 0.027),
            mat_idx["Mat_Skin"],
            part_layer=part_layer,
            part_id=PART_HEAD,
            subdiv=2,
            rot_euler=(0.0, 0.0, side_sign * -0.18),
        )

    # Expressive Stylized Eyes + Brows
    for side_sign in (-1.0, 1.0):
        ex = side_sign * 0.039
        ey = 0.102
        ez = 1.569
        tilt_z = side_sign * -0.24
        tilt_x = 0.06

        add_sculpted_ellipsoid(
            bm, Vector((ex, ey, ez)), (0.0165, 0.0085, 0.0205),
            mat_idx["Mat_EyeWhite"], part_layer=part_layer, part_id=PART_HEAD, subdiv=2, rot_euler=(tilt_x, 0.0, tilt_z)
        )
        add_sculpted_ellipsoid(
            bm, Vector((ex * 0.96, ey + 0.0055, ez - 0.001)), (0.0112, 0.0055, 0.0145),
            mat_idx["Mat_EyeIris"], part_layer=part_layer, part_id=PART_HEAD, subdiv=2, rot_euler=(tilt_x, 0.0, tilt_z)
        )
        add_sculpted_ellipsoid(
            bm, Vector((ex * 0.95, ey + 0.0088, ez - 0.001)), (0.0062, 0.0038, 0.0082),
            mat_idx["Mat_FaceDetail"], part_layer=part_layer, part_id=PART_HEAD, subdiv=1, rot_euler=(tilt_x, 0.0, tilt_z)
        )
        add_sculpted_ellipsoid(
            bm, Vector((ex * 0.95 - 0.0045, ey + 0.0110, ez + 0.0060)), (0.0032, 0.0022, 0.0036),
            mat_idx["Mat_EyeWhite"], part_layer=part_layer, part_id=PART_HEAD, subdiv=1
        )
        add_sculpted_ellipsoid(
            bm, Vector((ex, ey + 0.0035, ez + 0.0175)), (0.0175, 0.0075, 0.0040),
            mat_idx["Mat_FaceDetail"], part_layer=part_layer, part_id=PART_HEAD, subdiv=1, rot_euler=(tilt_x, side_sign * -0.10, tilt_z)
        )
        add_sculpted_ellipsoid(
            bm, Vector((ex * 1.03, ey + 0.0015, ez + 0.032)), (0.021, 0.006, 0.0048),
            mat_idx["Mat_Hair"], part_layer=part_layer, part_id=PART_HEAD, subdiv=1, rot_euler=(0.0, side_sign * 0.14, tilt_z)
        )

    # Friendly Smile Arc
    smile_segs = 8
    smile_rings = []
    smile_mats = []
    for i in range(smile_segs + 1):
        t = (i / smile_segs) * 2.0 - 1.0
        sx = t * 0.023
        sy = 0.106 - 0.006 * (t * t)
        sz = 1.498 + 0.0055 * (t * t)
        r_tube = 0.0024 * (1.0 - 0.35 * (t * t))
        smile_rings.append(
            (Vector((sx, sy, sz)), Vector((0.0, 1.0, 0.0)), Vector((0.0, 0.0, 1.0)), r_tube, r_tube, 6)
        )
        if i < smile_segs:
            smile_mats.append(mat_idx["Mat_FaceDetail"])
    add_loft_tube(
        bm, smile_rings, smile_mats,
        part_layer=part_layer, part_id=PART_HEAD,
        cap_start=True, cap_end=True,
    )

    # -----------------------------------------------------------------------
    # 5. Layered Stylized Athletic Hair (total height ~1.76 m)
    # -----------------------------------------------------------------------
    ret_hair = bmesh.ops.create_icosphere(bm, subdivisions=2, radius=1.0)
    hair_verts = ret_hair["verts"]
    hair_center = Vector((0.0, -0.006, 1.580))
    for v in hair_verts:
        p = v.co.copy()
        if p.y > 0.12 and p.z < 0.36:
            p.y = min(p.y, 0.12 + max(0.0, (p.z - 0.15) * 0.8))
            p.z = max(p.z, 0.28)
        rx, ry, rz = 0.114, 0.122, 0.125
        if p.z < -0.28:
            p.z = max(p.z, -0.52)
            rx *= 0.90
            ry *= 0.96
        v.co = hair_center + Vector((p.x * rx, p.y * ry, p.z * rz))
        v[part_layer] = PART_HEAD

    hair_set = set(hair_verts)
    for f in bm.faces:
        if all(v in hair_set for v in f.verts):
            f.material_index = mat_idx["Mat_Hair"]
            f.smooth = True

    # Swept Front Bangs / Fringe Tufts
    bang_specs = [
        (-0.068, 1.665, -0.095, 1.582, 0.088, 0.022, 0.015),
        (-0.045, 1.679, -0.058, 1.615, 0.106, 0.024, 0.015),
        (-0.010, 1.685, -0.016, 1.619, 0.114, 0.025, 0.015),
        (0.024,  1.685, 0.036,  1.617, 0.112, 0.024, 0.015),
        (0.056,  1.673, 0.080,  1.609, 0.098, 0.022, 0.014),
        (0.078,  1.657, 0.098,  1.575, 0.082, 0.020, 0.014),
    ]
    for xs, zs, xe, ze, yp, rx, rz in bang_specs:
        mid = Vector(((xs + xe) * 0.5, yp + 0.012, (zs + ze) * 0.5 + 0.008))
        start = Vector((xs, yp * 0.72, zs))
        end = Vector((xe, yp * 0.95, ze))
        u0, v0 = frame_from_dir(mid - start, Vector((0.0, 1.0, 0.0)))
        u1, v1 = frame_from_dir(end - mid, Vector((0.0, 1.0, 0.0)))
        add_loft_tube(
            bm,
            [
                (start, u0, v0, rx * 0.9, rz * 0.9, 8),
                (mid, u0, v0, rx, rz, 8),
                (end, u1, v1, rx * 0.25, rz * 0.25, 8),
            ],
            [mat_idx["Mat_Hair"], mat_idx["Mat_Hair"]],
            part_layer=part_layer, part_id=PART_HEAD,
            cap_start=True, cap_end=True,
        )

    # Crown & Back Layered Volume Tufts (maxZ ~ 1.758 m -> height ~ 1.758 m)
    crown_tufts = [
        (Vector((0.0, 0.02, 1.695)), Vector((0.025, -0.06, 1.753)), 0.034, 0.022),
        (Vector((-0.04, 0.01, 1.685)), Vector((-0.065, -0.075, 1.722)), 0.030, 0.019),
        (Vector((0.04, 0.01, 1.685)), Vector((0.068, -0.075, 1.722)), 0.030, 0.019),
        (Vector((0.0, -0.07, 1.618)), Vector((0.0, -0.125, 1.572)), 0.034, 0.020),
    ]
    for p0, p1, r0, r1 in crown_tufts:
        u, v = frame_from_dir(p1 - p0, Vector((0.0, 0.0, 1.0)))
        add_loft_tube(
            bm,
            [
                (p0, u, v, r0, r1, 8),
                ((p0 + p1) * 0.5, u, v, r0 * 0.85, r1 * 0.85, 8),
                (p1, u, v, r0 * 0.2, r1 * 0.2, 8),
            ],
            [mat_idx["Mat_Hair"], mat_idx["Mat_Hair"]],
            part_layer=part_layer, part_id=PART_HEAD,
            cap_start=True, cap_end=True,
        )

    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    bm.verts.ensure_lookup_table()
    bm.verts.index_update()
    part_ids = [v[part_layer] for v in bm.verts]

    bm.to_mesh(mesh)
    bm.free()

    assign_body_weights(obj, arm_obj, part_ids)

    obj.parent = arm_obj
    mod = obj.modifiers.new(name="Armature", type="ARMATURE")
    mod.object = arm_obj
    mod.use_vertex_groups = True
    return obj


def closest_segment_t(p: Vector, a: Vector, b: Vector) -> Tuple[float, float]:
    ab = b - a
    len_sq = ab.length_squared
    if len_sq < 1e-8:
        return 0.0, (p - a).length
    t = max(0.0, min(1.0, (p - a).dot(ab) / len_sq))
    proj = a + ab * t
    return t, (p - proj).length


def smoothstep(edge0: float, edge1: float, x: float) -> float:
    if abs(edge1 - edge0) < 1e-6:
        return 1.0 if x >= edge1 else 0.0
    t = max(0.0, min(1.0, (x - edge0) / (edge1 - edge0)))
    return t * t * (3.0 - 2.0 * t)


def assign_body_weights(
    mesh_obj: bpy.types.Object,
    arm_obj: bpy.types.Object,
    part_ids: List[int],
) -> None:
    vgroups: Dict[str, bpy.types.VertexGroup] = {
        bone.name: mesh_obj.vertex_groups.new(name=bone.name)
        for bone in arm_obj.data.bones
    }
    bone_pts = {name: (Vector(h), Vector(t)) for name, _, h, t in BONE_SPECS}

    for v in mesh_obj.data.vertices:
        p = v.co
        pid = part_ids[v.index]
        weights: Dict[str, float] = {}

        if pid == PART_HEAD:
            if p.z >= 1.480:
                weights["Head"] = 1.0
            else:
                w_head = smoothstep(1.440, 1.480, p.z)
                weights["Head"] = w_head
                weights["Neck"] = 1.0 - w_head

        elif pid in (PART_ARM_L, PART_ARM_R):
            side = "L" if pid == PART_ARM_L else "R"
            _, d_sh = closest_segment_t(p, *bone_pts[f"Shoulder_{side}"])
            t_ua, d_ua = closest_segment_t(p, *bone_pts[f"UpperArm_{side}"])
            t_fa, d_fa = closest_segment_t(p, *bone_pts[f"Forearm_{side}"])
            _, d_ha = closest_segment_t(p, *bone_pts[f"Hand_{side}"])

            if abs(p.x) < 0.195 and d_sh < 0.095:
                w_ua = smoothstep(0.145, 0.195, abs(p.x))
                w_sh = smoothstep(0.115, 0.165, abs(p.x)) * (1.0 - w_ua)
                w_ch = max(0.0, 1.0 - w_ua - w_sh)
                if w_ch > 0:
                    weights["Chest"] = w_ch
                if w_sh > 0:
                    weights[f"Shoulder_{side}"] = w_sh
                if w_ua > 0:
                    weights[f"UpperArm_{side}"] = w_ua
            elif d_ha < d_fa + 0.015 and t_fa > 0.72:
                w_ha = smoothstep(0.74, 0.96, t_fa)
                weights[f"Hand_{side}"] = w_ha
                weights[f"Forearm_{side}"] = 1.0 - w_ha
            elif d_fa < d_ua + 0.012 and t_ua > 0.72:
                w_fa = smoothstep(0.75, 1.0, t_ua)
                weights[f"Forearm_{side}"] = w_fa
                weights[f"UpperArm_{side}"] = 1.0 - w_fa
            else:
                weights[f"UpperArm_{side}"] = 1.0

        elif pid in (PART_LEG_L, PART_LEG_R):
            side = "L" if pid == PART_LEG_L else "R"
            if p.z > 0.815:
                w_hips = smoothstep(0.815, 0.895, p.z)
                weights["Hips"] = w_hips
                weights[f"Thigh_{side}"] = 1.0 - w_hips
            elif p.z > 0.455:
                w_shin = smoothstep(0.525, 0.455, p.z)
                weights[f"Shin_{side}"] = w_shin
                weights[f"Thigh_{side}"] = 1.0 - w_shin
            elif p.z > 0.115:
                weights[f"Shin_{side}"] = 1.0
            else:
                if p.y > 0.04 or p.z < 0.080:
                    weights[f"Foot_{side}"] = 1.0
                else:
                    w_shin = smoothstep(0.080, 0.118, p.z)
                    weights[f"Shin_{side}"] = w_shin
                    weights[f"Foot_{side}"] = 1.0 - w_shin

        else:  # PART_TORSO
            z = p.z
            if z < 0.945:
                weights["Hips"] = 1.0
            elif z < 1.020:
                w_sp = smoothstep(0.955, 1.020, z)
                weights["Spine"] = w_sp
                weights["Hips"] = 1.0 - w_sp
            elif z < 1.155:
                w_ch = smoothstep(1.095, 1.155, z)
                weights["Chest"] = w_ch
                weights["Spine"] = 1.0 - w_ch
            elif z < 1.375:
                if abs(p.x) > 0.120 and z > 1.250:
                    w_sh = smoothstep(0.120, 0.175, abs(p.x))
                    side = "R" if p.x > 0 else "L"
                    weights[f"Shoulder_{side}"] = w_sh
                    weights["Chest"] = 1.0 - w_sh
                else:
                    weights["Chest"] = 1.0
            elif z < 1.415:
                w_nk = smoothstep(1.365, 1.405, z)
                weights["Neck"] = w_nk
                weights["Chest"] = 1.0 - w_nk
            else:
                w_hd = smoothstep(1.435, 1.470, z)
                weights["Head"] = w_hd
                weights["Neck"] = 1.0 - w_hd

        total = sum(weights.values())
        if total <= 1e-6:
            weights = {"Hips": 1.0}
            total = 1.0
        for gname, w in weights.items():
            if w > 1e-4:
                vgroups[gname].add([v.index], w / total, "REPLACE")


# ---------------------------------------------------------------------------
# Independent Named Attachment Nodes (NEVER merged into Avatar_Body)
# ---------------------------------------------------------------------------

def attach_to_bone(
    obj: bpy.types.Object,
    arm_obj: bpy.types.Object,
    bone_name: str,
) -> None:
    bpy.ops.object.select_all(action="DESELECT")
    obj.select_set(True)
    arm_obj.select_set(True)
    bpy.context.view_layer.objects.active = arm_obj
    arm_obj.data.bones.active = arm_obj.data.bones[bone_name]
    bpy.ops.object.parent_set(type="BONE", keep_transform=True)


def build_headgear_headband(arm_obj: bpy.types.Object, mats: Dict[str, bpy.types.Material]) -> bpy.types.Object:
    mesh = bpy.data.meshes.new("Headgear_Headband")
    obj = bpy.data.objects.new("Headgear_Headband", mesh)
    bpy.context.scene.collection.objects.link(obj)
    obj.data.materials.append(mats["Mat_JerseyAccent"])

    bm = bmesh.new()
    add_torus_band(
        bm,
        Vector((0.0, -0.002, 1.622)),
        0.118,
        0.124,
        0.016,
        18,
        6,
        0,
        rot_euler=(-0.16, 0.0, 0.0),
    )
    for sx, len_z in ((-0.015, 0.085), (0.016, 0.072)):
        p0 = Vector((sx, -0.126, 1.604))
        p1 = Vector((sx * 1.4, -0.152, 1.604 - len_z * 0.5))
        p2 = Vector((sx * 1.7, -0.172, 1.604 - len_z))
        u, v = frame_from_dir(p2 - p0, Vector((0.0, 1.0, 0.0)))
        add_loft_tube(
            bm,
            [
                (p0, u, v, 0.011, 0.005, 6),
                (p1, u, v, 0.013, 0.005, 6),
                (p2, u, v, 0.008, 0.003, 6),
            ],
            [0, 0],
            cap_start=True,
            cap_end=True,
        )

    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    bm.to_mesh(mesh)
    bm.free()
    attach_to_bone(obj, arm_obj, "HeadgearSocket")
    return obj


def build_headgear_visor(arm_obj: bpy.types.Object, mats: Dict[str, bpy.types.Material]) -> bpy.types.Object:
    mesh = bpy.data.meshes.new("Headgear_Visor")
    obj = bpy.data.objects.new("Headgear_Visor", mesh)
    bpy.context.scene.collection.objects.link(obj)
    obj.data.materials.append(mats["Mat_JerseyPrimary"])
    obj.data.materials.append(mats["Mat_JerseyAccent"])

    bm = bmesh.new()
    add_torus_band(
        bm,
        Vector((0.0, -0.002, 1.616)),
        0.118,
        0.125,
        0.016,
        18,
        6,
        0,
        rot_euler=(-0.12, 0.0, 0.0),
    )

    brim_segs = 12
    inner_r = 0.114
    outer_r = 0.210
    rings: List[List[bmesh.types.BMVert]] = []
    for i in range(brim_segs + 1):
        t = i / brim_segs
        ang = math.pi * (0.20 + 0.60 * t)
        ca, sa = math.cos(ang), math.sin(ang)
        arch_z = 1.614 + 0.012 * math.sin(t * math.pi)
        tip_drop = -0.016 * math.sin(t * math.pi)
        v_in_top = bm.verts.new(Vector((inner_r * ca, inner_r * sa + 0.002, arch_z + 0.004)))
        v_in_bot = bm.verts.new(Vector((inner_r * ca, inner_r * sa + 0.002, arch_z - 0.004)))
        v_out_top = bm.verts.new(Vector((outer_r * ca, outer_r * sa + 0.004, arch_z + tip_drop + 0.003)))
        v_out_bot = bm.verts.new(Vector((outer_r * ca, outer_r * sa + 0.004, arch_z + tip_drop - 0.003)))
        rings.append([v_in_top, v_out_top, v_out_bot, v_in_bot])

    for i in range(brim_segs):
        r0, r1 = rings[i], rings[i + 1]
        for j in range(4):
            nj = (j + 1) % 4
            f = bm.faces.new((r0[j], r1[j], r1[nj], r0[nj]))
            f.material_index = 1
            f.smooth = True
    bm.faces.new(list(reversed(rings[0]))).material_index = 1
    bm.faces.new(rings[-1]).material_index = 1

    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    bm.to_mesh(mesh)
    bm.free()
    attach_to_bone(obj, arm_obj, "HeadgearSocket")
    return obj


def build_headgear_cap_backwards(arm_obj: bpy.types.Object, mats: Dict[str, bpy.types.Material]) -> bpy.types.Object:
    mesh = bpy.data.meshes.new("Headgear_CapBackwards")
    obj = bpy.data.objects.new("Headgear_CapBackwards", mesh)
    bpy.context.scene.collection.objects.link(obj)
    obj.data.materials.append(mats["Mat_JerseyAccent"])   # 0: crown
    obj.data.materials.append(mats["Mat_JerseyPrimary"])  # 1: backwards brim

    bm = bmesh.new()
    ret = bmesh.ops.create_icosphere(bm, subdivisions=2, radius=1.0)
    crown_verts = ret["verts"]
    cap_center = Vector((0.0, -0.006, 1.606))
    for v in crown_verts:
        p = v.co.copy()
        if p.z < 0.0:
            p.z = max(p.z, -0.05) * 0.4
        v.co = cap_center + Vector((p.x * 0.123, p.y * 0.130, p.z * 0.112))
    crown_set = set(crown_verts)
    for f in bm.faces:
        if all(v in crown_set for v in f.verts):
            f.material_index = 0
            f.smooth = True

    add_sculpted_ellipsoid(bm, Vector((0.0, -0.006, 1.718)), (0.011, 0.011, 0.006), 1, subdiv=1)

    brim_segs = 12
    inner_r = 0.116
    outer_r = 0.216
    rings: List[List[bmesh.types.BMVert]] = []
    for i in range(brim_segs + 1):
        t = i / brim_segs
        ang = -math.pi * (0.20 + 0.60 * t)
        ca, sa = math.cos(ang), math.sin(ang)
        arch_z = 1.608 + 0.010 * math.sin(t * math.pi)
        tip_drop = -0.014 * math.sin(t * math.pi)
        v_in_top = bm.verts.new(Vector((inner_r * ca, inner_r * sa - 0.006, arch_z + 0.004)))
        v_in_bot = bm.verts.new(Vector((inner_r * ca, inner_r * sa - 0.006, arch_z - 0.004)))
        v_out_top = bm.verts.new(Vector((outer_r * ca, outer_r * sa - 0.008, arch_z + tip_drop + 0.003)))
        v_out_bot = bm.verts.new(Vector((outer_r * ca, outer_r * sa - 0.008, arch_z + tip_drop - 0.003)))
        rings.append([v_in_top, v_out_top, v_out_bot, v_in_bot])

    for i in range(brim_segs):
        r0, r1 = rings[i], rings[i + 1]
        for j in range(4):
            nj = (j + 1) % 4
            f = bm.faces.new((r0[j], r1[j], r1[nj], r0[nj]))
            f.material_index = 1
            f.smooth = True
    bm.faces.new(list(reversed(rings[0]))).material_index = 1
    bm.faces.new(rings[-1]).material_index = 1

    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    bm.to_mesh(mesh)
    bm.free()
    attach_to_bone(obj, arm_obj, "HeadgearSocket")
    return obj


def build_wristband(
    name: str,
    bone_name: str,
    side_sign: float,
    arm_obj: bpy.types.Object,
    mats: Dict[str, bpy.types.Material],
) -> bpy.types.Object:
    mesh = bpy.data.meshes.new(name)
    obj = bpy.data.objects.new(name, mesh)
    bpy.context.scene.collection.objects.link(obj)
    obj.data.materials.append(mats["Mat_JerseyAccent"])

    bm = bmesh.new()
    p_wr = Vector((side_sign * 0.485, 0.060, 0.960))
    p_el = Vector((side_sign * 0.345, 0.020, 1.140))
    axis = (p_wr - p_el).normalized()
    u, v = frame_from_dir(axis, Vector((0.0, 1.0, 0.0)))
    c_mid = p_wr - axis * 0.038
    add_loft_tube(
        bm,
        [
            (c_mid - axis * 0.028, u, v, 0.039, 0.037, 12),
            (c_mid - axis * 0.020, u, v, 0.044, 0.042, 12),
            (c_mid + axis * 0.020, u, v, 0.042, 0.040, 12),
            (c_mid + axis * 0.028, u, v, 0.037, 0.035, 12),
        ],
        [0, 0, 0],
        cap_start=True,
        cap_end=True,
    )
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    bm.to_mesh(mesh)
    bm.free()
    attach_to_bone(obj, arm_obj, bone_name)
    return obj


def build_racquet(arm_obj: bpy.types.Object, mats: Dict[str, bpy.types.Material]) -> bpy.types.Object:
    mesh = bpy.data.meshes.new("Racquet")
    obj = bpy.data.objects.new("Racquet", mesh)
    bpy.context.scene.collection.objects.link(obj)
    obj.data.materials.append(mats["Mat_RacquetFrame"])
    obj.data.materials.append(mats["Mat_RacquetStrings"])
    obj.data.materials.append(mats["Mat_RacquetGrip"])

    bm = bmesh.new()
    origin = Vector((0.525, 0.075, 0.905))
    rot = Euler((-math.radians(50.0), math.radians(28.0), math.radians(-16.0)), "XYZ").to_matrix()

    def to_world(lx: float, ly: float, lz: float) -> Vector:
        return origin + (rot @ Vector((lx, ly, lz)))

    grip_pts = [
        (-0.095, 0.020, 0.023),
        (-0.082, 0.016, 0.019),
        (0.110,  0.014, 0.017),
        (0.120,  0.015, 0.018),
    ]
    u_g = rot @ Vector((1.0, 0.0, 0.0))
    v_g = rot @ Vector((0.0, 1.0, 0.0))
    add_loft_tube(
        bm,
        [(to_world(0.0, 0.0, gz), u_g, v_g, rx, ry, 8) for (gz, rx, ry) in grip_pts],
        [2, 2, 2],
        cap_start=True,
        cap_end=True,
        superellipse_p=2.3,
    )

    for sx in (-1.0, 1.0):
        t0 = to_world(sx * 0.008, 0.0, 0.115)
        t1 = to_world(sx * 0.038, 0.0, 0.215)
        t2 = to_world(sx * 0.082, 0.0, 0.312)
        ut, vt = frame_from_dir(t2 - t0, rot @ Vector((0.0, 1.0, 0.0)))
        add_loft_tube(
            bm,
            [
                (t0, ut, vt, 0.011, 0.009, 8),
                (t1, ut, vt, 0.009, 0.008, 8),
                (t2, ut, vt, 0.009, 0.009, 8),
            ],
            [0, 0],
            cap_start=True,
            cap_end=True,
        )
    b_l = to_world(-0.072, 0.0, 0.295)
    b_r = to_world(0.072, 0.0, 0.295)
    ub, vb = frame_from_dir(b_r - b_l, rot @ Vector((0.0, 1.0, 0.0)))
    add_loft_tube(
        bm,
        [(b_l, ub, vb, 0.008, 0.008, 6), (b_r, ub, vb, 0.008, 0.008, 6)],
        [0],
        cap_start=True,
        cap_end=True,
    )

    hoop_cz = 0.448
    hoop_rx = 0.126
    hoop_rz = 0.162
    hoop_segs = 22
    minor_segs = 6
    hoop_rings: List[List[bmesh.types.BMVert]] = []
    for i in range(hoop_segs):
        ang = (2.0 * math.pi * i) / hoop_segs
        ca, sa = math.cos(ang), math.sin(ang)
        c_local = Vector((hoop_rx * ca, 0.0, hoop_cz + hoop_rz * sa))
        outward_local = Vector((ca / hoop_rx, 0.0, sa / hoop_rz)).normalized()
        normal_local = Vector((0.0, 1.0, 0.0))
        r_verts = []
        for j in range(minor_segs):
            phi = (2.0 * math.pi * j) / minor_segs
            off_l = outward_local * (0.0095 * math.cos(phi)) + normal_local * (0.0115 * math.sin(phi))
            r_verts.append(bm.verts.new(origin + (rot @ (c_local + off_l))))
        hoop_rings.append(r_verts)
    for i in range(hoop_segs):
        r0, r1 = hoop_rings[i], hoop_rings[(i + 1) % hoop_segs]
        for j in range(minor_segs):
            nj = (j + 1) % minor_segs
            f = bm.faces.new((r0[j], r1[j], r1[nj], r0[nj]))
            f.material_index = 0
            f.smooth = True

    s_thick = 0.0014
    for x_norm in (-0.75, -0.56, -0.37, -0.18, 0.0, 0.18, 0.37, 0.56, 0.75):
        lx = x_norm * (hoop_rx - 0.007)
        max_dz = (hoop_rz - 0.007) * math.sqrt(max(0.0, 1.0 - x_norm * x_norm))
        v0 = bm.verts.new(to_world(lx - s_thick, 0.001, hoop_cz - max_dz))
        v1 = bm.verts.new(to_world(lx + s_thick, 0.001, hoop_cz - max_dz))
        v2 = bm.verts.new(to_world(lx + s_thick, 0.001, hoop_cz + max_dz))
        v3 = bm.verts.new(to_world(lx - s_thick, 0.001, hoop_cz + max_dz))
        bm.faces.new((v0, v1, v2, v3)).material_index = 1
        vb0 = bm.verts.new(to_world(lx - s_thick, -0.001, hoop_cz - max_dz))
        vb1 = bm.verts.new(to_world(lx + s_thick, -0.001, hoop_cz - max_dz))
        vb2 = bm.verts.new(to_world(lx + s_thick, -0.001, hoop_cz + max_dz))
        vb3 = bm.verts.new(to_world(lx - s_thick, -0.001, hoop_cz + max_dz))
        bm.faces.new((vb3, vb2, vb1, vb0)).material_index = 1

    for z_norm in (-0.82, -0.65, -0.49, -0.33, -0.16, 0.0, 0.16, 0.33, 0.49, 0.65, 0.82):
        lz = hoop_cz + z_norm * (hoop_rz - 0.007)
        max_dx = (hoop_rx - 0.007) * math.sqrt(max(0.0, 1.0 - z_norm * z_norm))
        v0 = bm.verts.new(to_world(-max_dx, 0.0012, lz - s_thick))
        v1 = bm.verts.new(to_world(max_dx, 0.0012, lz - s_thick))
        v2 = bm.verts.new(to_world(max_dx, 0.0012, lz + s_thick))
        v3 = bm.verts.new(to_world(-max_dx, 0.0012, lz + s_thick))
        bm.faces.new((v0, v1, v2, v3)).material_index = 1
        vb0 = bm.verts.new(to_world(-max_dx, -0.0012, lz - s_thick))
        vb1 = bm.verts.new(to_world(max_dx, -0.0012, lz - s_thick))
        vb2 = bm.verts.new(to_world(max_dx, -0.0012, lz + s_thick))
        vb3 = bm.verts.new(to_world(-max_dx, -0.0012, lz + s_thick))
        bm.faces.new((vb3, vb2, vb1, vb0)).material_index = 1

    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    bm.to_mesh(mesh)
    bm.free()
    attach_to_bone(obj, arm_obj, "RacquetSocket")
    return obj


# ---------------------------------------------------------------------------
# 8 Athletic Tennis NLA Animations (ZERO bone scale tracks!)
# ---------------------------------------------------------------------------

def set_pose_euler(
    arm_obj: bpy.types.Object,
    bone_poses: Dict[str, Tuple[float, float, float]],
    hips_offset: Optional[Tuple[float, float, float]] = None,
) -> None:
    """Apply world-space XYZ delta rotations (degrees) cleanly mapped into each bone's local frame."""
    for pb in arm_obj.pose.bones:
        pb.rotation_mode = "QUATERNION"
        if pb.name in bone_poses:
            rx, ry, rz = bone_poses[pb.name]
            world_rot = Euler((math.radians(rx), math.radians(ry), math.radians(rz)), "XYZ").to_matrix()
            bone_rot = pb.bone.matrix_local.to_3x3()
            local_rot = bone_rot.inverted() @ world_rot @ bone_rot
            pb.rotation_quaternion = local_rot.to_quaternion()
        else:
            pb.rotation_quaternion = Quaternion((1.0, 0.0, 0.0, 0.0))
        if pb.name == "Hips":
            pb.location = Vector(hips_offset) if hips_offset else Vector((0.0, 0.0, 0.0))


def keyframe_pose(arm_obj: bpy.types.Object, frame: int, animated_bones: Sequence[str], key_hips_loc: bool) -> None:
    for bname in animated_bones:
        pb = arm_obj.pose.bones[bname]
        pb.keyframe_insert(data_path="rotation_quaternion", frame=frame)
    if key_hips_loc:
        arm_obj.pose.bones["Hips"].keyframe_insert(data_path="location", frame=frame)


def build_nla_clip(
    arm_obj: bpy.types.Object,
    clip_name: str,
    end_frame: int,
    keyframes: List[Tuple[int, Dict[str, Tuple[float, float, float]], Optional[Tuple[float, float, float]]]],
) -> None:
    act = bpy.data.actions.new(name=clip_name)
    arm_obj.animation_data.action = act
    used_bones = sorted({b for _, bp, _ in keyframes for b in bp.keys()})
    has_hips_loc = any(hloc is not None for _, _, hloc in keyframes)

    for frame, bone_poses, hips_off in keyframes:
        set_pose_euler(arm_obj, bone_poses, hips_off)
        keyframe_pose(arm_obj, frame, used_bones, has_hips_loc)

    set_pose_euler(arm_obj, {}, None)
    track = arm_obj.animation_data.nla_tracks.new()
    track.name = clip_name
    strip = track.strips.new(clip_name, 0, act)
    strip.frame_start = 0
    strip.frame_end = end_frame
    arm_obj.animation_data.action = None


def create_all_animations(arm_obj: bpy.types.Object) -> None:
    """Author all 8 tennis clips in world-space right-hand-rule delta Euler degrees:
    - +X: tilts +Y->+Z (so for downward -Z limbs, -X swings FORWARD toward +Y, +X swings BACKWARD)
    - +Y: tilts +Z->+X (so +Y lifts Left Arm -X UP toward +Z; -Y lifts Right Arm +X UP toward +Z)
    - +Z: yaw CCW looking down (+Z turns front +Y toward Left -X; -Z turns toward Right +X)
    """
    arm_obj.animation_data_create()

    # Sleek, compact athletic ready stance: elbows bent comfortably forward, racquet poised up-right at +X
    ready_a = {
        "Hips": (-4, 0, 0),
        "Spine": (-6, 0, 0),
        "Chest": (-6, 0, 4),
        "Head": (12, 0, -4),
        "UpperArm_L": (28, -6, -8),
        "Forearm_L": (29, 35, -32),
        "UpperArm_R": (16, 2, 19),
        "Forearm_R": (41, -18, 18),
        "Hand_R": (6, -12, -17),
        "Thigh_L": (-16, 0, 4),
        "Shin_L": (28, 0, 0),
        "Foot_L": (-12, 0, 0),
        "Thigh_R": (-16, 0, -4),
        "Shin_R": (28, 0, 0),
        "Foot_R": (-12, 0, 0),
    }
    ready_b = {
        "Hips": (-5, 0, 0),
        "Spine": (-7, 0, 0),
        "Chest": (-7, 0, 2),
        "Head": (14, 0, -2),
        "UpperArm_L": (30, -5, -10),
        "Forearm_L": (32, 36, -34),
        "UpperArm_R": (19, 2, 17),
        "Forearm_R": (45, -18, 16),
        "Hand_R": (8, -12, -17),
        "Thigh_L": (-20, 0, 4),
        "Shin_L": (34, 0, 0),
        "Foot_L": (-14, 0, 0),
        "Thigh_R": (-20, 0, -4),
        "Shin_R": (34, 0, 0),
        "Foot_R": (-14, 0, 0),
    }

    # 1. idle (1.20 s)
    build_nla_clip(
        arm_obj,
        "idle",
        120,
        [
            (0, ready_a, (0.0, 0.0, -0.032)),
            (30, ready_b, (0.0, 0.0, -0.052)),
            (60, ready_a, (0.0, 0.0, -0.032)),
            (90, ready_b, (0.0, 0.0, -0.052)),
            (120, ready_a, (0.0, 0.0, -0.032)),
        ],
    )

    # 2. run (0.56 s)
    run_r_fwd = {
        "Hips": (-6, 0, -6),
        "Spine": (-8, 0, 4),
        "Chest": (-8, 0, 10),
        "Head": (14, 0, -8),
        "UpperArm_L": (-28, -10, -8),
        "Forearm_L": (48, 18, -14),
        "UpperArm_R": (26, 8, 12),
        "Forearm_R": (44, -12, 12),
        "Hand_R": (6, -10, -12),
        "Thigh_L": (34, 0, 2),
        "Shin_L": (48, 0, 0),
        "Foot_L": (-16, 0, 0),
        "Thigh_R": (-46, 0, -2),
        "Shin_R": (26, 0, 0),
        "Foot_R": (10, 0, 0),
    }
    run_l_fwd = {
        "Hips": (-6, 0, 6),
        "Spine": (-8, 0, -4),
        "Chest": (-8, 0, -10),
        "Head": (14, 0, 8),
        "UpperArm_L": (42, -10, -12),
        "Forearm_L": (52, 18, -16),
        "UpperArm_R": (-8, 8, 14),
        "Forearm_R": (40, -12, 14),
        "Hand_R": (6, -10, -12),
        "Thigh_L": (-46, 0, 2),
        "Shin_L": (26, 0, 0),
        "Foot_L": (10, 0, 0),
        "Thigh_R": (34, 0, -2),
        "Shin_R": (48, 0, 0),
        "Foot_R": (-16, 0, 0),
    }
    run_mid = {
        "Hips": (-5, 0, 0),
        "Spine": (-7, 0, 0),
        "Chest": (-7, 0, 0),
        "Head": (12, 0, 0),
        "UpperArm_L": (10, -10, -12),
        "Forearm_L": (50, 18, -14),
        "UpperArm_R": (16, 8, 12),
        "Forearm_R": (42, -12, 12),
        "Hand_R": (6, -10, -12),
        "Thigh_L": (-12, 0, 2),
        "Shin_L": (42, 0, 0),
        "Foot_L": (-8, 0, 0),
        "Thigh_R": (-12, 0, -2),
        "Shin_R": (42, 0, 0),
        "Foot_R": (-8, 0, 0),
    }
    build_nla_clip(
        arm_obj,
        "run",
        56,
        [
            (0, run_r_fwd, (0.0, 0.0, -0.025)),
            (14, run_mid, (0.0, 0.0, -0.065)),
            (28, run_l_fwd, (0.0, 0.0, -0.025)),
            (42, run_mid, (0.0, 0.0, -0.065)),
            (56, run_r_fwd, (0.0, 0.0, -0.025)),
        ],
    )

    # 3. slide (0.50 s)
    slide_pose = {
        "Hips": (-10, -8, -18),
        "Spine": (-8, 4, 8),
        "Chest": (-10, 6, 16),
        "Head": (18, 0, -10),
        "UpperArm_L": (24, 28, -18),
        "Forearm_L": (28, 12, -16),
        "UpperArm_R": (26, -18, 16),
        "Forearm_R": (42, -14, 14),
        "Hand_R": (4, -8, -10),
        "Thigh_L": (16, 22, 12),
        "Shin_L": (52, 0, 0),
        "Foot_L": (-18, 0, 0),
        "Thigh_R": (-56, -18, -16),
        "Shin_R": (36, 0, 0),
        "Foot_R": (-10, 0, 0),
    }
    build_nla_clip(
        arm_obj,
        "slide",
        50,
        [
            (0, ready_a, (0.0, 0.0, -0.04)),
            (14, slide_pose, (0.0, 0.0, -0.17)),
            (38, slide_pose, (0.0, 0.0, -0.17)),
            (50, ready_a, (0.0, 0.0, -0.04)),
        ],
    )

    # 4. serve_toss (0.35 s = 35 frames EXACT): Left arm tosses skyward (+Y roll), Right arm cocks into trophy pose (-Y roll)!
    toss_load = {
        "Hips": (-8, 0, -12),
        "Spine": (-6, 0, -10),
        "Chest": (4, 0, -14),
        "Head": (4, 0, 14),
        "UpperArm_L": (42, 10, -10),
        "Forearm_L": (24, 0, -12),
        "UpperArm_R": (16, -20, 24),
        "Forearm_R": (56, 0, 10),
        "Thigh_L": (-26, 0, 4),
        "Shin_L": (44, 0, 0),
        "Foot_L": (-16, 0, 0),
        "Thigh_R": (-24, 0, -4),
        "Shin_R": (42, 0, 0),
        "Foot_R": (-16, 0, 0),
    }
    toss_trophy = {
        "Hips": (4, 0, -18),
        "Spine": (8, 0, -12),
        "Chest": (14, -8, -16),
        "Head": (24, 0, 18),
        "Shoulder_L": (0, 20, 0),
        "UpperArm_L": (-22, 128, -10),  # Left arm reaches high skyward for ball toss!
        "Forearm_L": (-10, 0, -6),
        "Shoulder_R": (0, -16, 0),
        "UpperArm_R": (16, -84, -22),   # Right arm raised & cocked behind right shoulder!
        "Forearm_R": (-82, -16, 18),
        "Hand_R": (-10, 0, 10),
        "Thigh_L": (-6, 0, 4),
        "Shin_L": (10, 0, 0),
        "Foot_L": (-4, 0, 0),
        "Thigh_R": (-6, 0, -4),
        "Shin_R": (10, 0, 0),
        "Foot_R": (-4, 0, 0),
    }
    build_nla_clip(
        arm_obj,
        "serve_toss",
        35,
        [
            (0, ready_a, (0.0, 0.0, -0.04)),
            (12, toss_load, (0.0, 0.0, -0.10)),
            (35, toss_trophy, (0.0, 0.0, 0.02)),
        ],
    )

    # 5. forehand (0.36 s = 36 frames EXACT)
    fh_prep = {
        "Hips": (-6, 0, -28),
        "Spine": (-6, 0, -20),
        "Chest": (-8, 0, -26),
        "Head": (12, 0, 38),
        "UpperArm_L": (38, 12, -26),
        "Forearm_L": (44, 18, -22),
        "Shoulder_R": (0, 0, -16),
        "UpperArm_R": (-22, -18, -32),
        "Forearm_R": (38, -12, -16),
        "Hand_R": (6, -12, -16),
        "Thigh_L": (-24, 0, 6),
        "Shin_L": (40, 0, 0),
        "Foot_L": (-14, 0, 0),
        "Thigh_R": (-26, 0, -8),
        "Shin_R": (42, 0, 0),
        "Foot_R": (-14, 0, 0),
    }
    fh_contact = {
        "Hips": (-4, 0, 18),
        "Spine": (-6, 0, 14),
        "Chest": (-8, 0, 22),
        "Head": (12, 0, -24),
        "UpperArm_L": (28, 14, -12),
        "Forearm_L": (56, 18, -20),
        "Shoulder_R": (0, 0, 14),
        "UpperArm_R": (56, 12, 28),
        "Forearm_R": (36, -14, 22),
        "Hand_R": (10, -14, -14),
        "Thigh_L": (-18, 0, 6),
        "Shin_L": (28, 0, 0),
        "Foot_L": (-10, 0, 0),
        "Thigh_R": (-16, 0, -6),
        "Shin_R": (26, 0, 0),
        "Foot_R": (-10, 0, 0),
    }
    fh_follow = {
        "Hips": (-4, 0, 30),
        "Spine": (-5, 0, 22),
        "Chest": (-6, 0, 28),
        "Head": (10, 0, -34),
        "UpperArm_L": (18, 22, -6),
        "Forearm_L": (50, 18, -18),
        "Shoulder_R": (0, 0, 18),
        "UpperArm_R": (84, 24, 42),
        "Forearm_R": (64, -18, 26),
        "Hand_R": (10, -12, -10),
        "Thigh_L": (-16, 0, 4),
        "Shin_L": (24, 0, 0),
        "Foot_L": (-8, 0, 0),
        "Thigh_R": (-14, 0, -4),
        "Shin_R": (24, 0, 0),
        "Foot_R": (-8, 0, 0),
    }
    build_nla_clip(
        arm_obj,
        "forehand",
        36,
        [
            (0, ready_a, (0.0, 0.0, -0.04)),
            (10, fh_prep, (0.0, 0.0, -0.07)),
            (20, fh_contact, (0.0, 0.0, -0.02)),
            (30, fh_follow, (0.0, 0.0, -0.02)),
            (36, ready_a, (0.0, 0.0, -0.04)),
        ],
    )

    # 6. backhand (0.36 s = 36 frames EXACT)
    bh_prep = {
        "Hips": (-6, 0, 26),
        "Spine": (-6, 0, 20),
        "Chest": (-8, 0, 28),
        "Head": (12, 0, -38),
        "UpperArm_L": (42, 10, -14),
        "Forearm_L": (52, 16, -22),
        "Shoulder_R": (0, 0, 14),
        "UpperArm_R": (44, 18, 42),
        "Forearm_R": (52, -14, 24),
        "Hand_R": (6, -10, 10),
        "Thigh_L": (-26, 0, 8),
        "Shin_L": (42, 0, 0),
        "Foot_L": (-14, 0, 0),
        "Thigh_R": (-24, 0, -6),
        "Shin_R": (40, 0, 0),
        "Foot_R": (-14, 0, 0),
    }
    bh_contact = {
        "Hips": (-4, 0, -10),
        "Spine": (-6, 0, -10),
        "Chest": (-6, 0, -16),
        "Head": (12, 0, 20),
        "UpperArm_L": (12, 18, -22),
        "Forearm_L": (40, 14, -16),
        "Shoulder_R": (0, 0, -8),
        "UpperArm_R": (52, -14, -12),
        "Forearm_R": (28, 0, -16),
        "Hand_R": (8, -8, -12),
        "Thigh_L": (-18, 0, 4),
        "Shin_L": (28, 0, 0),
        "Foot_L": (-10, 0, 0),
        "Thigh_R": (-18, 0, -4),
        "Shin_R": (28, 0, 0),
        "Foot_R": (-10, 0, 0),
    }
    bh_follow = {
        "Hips": (-4, 0, -24),
        "Spine": (-5, 0, -16),
        "Chest": (-4, 0, -22),
        "Head": (10, 0, 32),
        "UpperArm_L": (-14, 24, -24),
        "Forearm_L": (30, 12, -12),
        "Shoulder_R": (0, 0, -16),
        "UpperArm_R": (68, -28, -44),
        "Forearm_R": (22, 0, -18),
        "Hand_R": (8, -8, -8),
        "Thigh_L": (-14, 0, 4),
        "Shin_L": (24, 0, 0),
        "Foot_L": (-8, 0, 0),
        "Thigh_R": (-16, 0, -4),
        "Shin_R": (24, 0, 0),
        "Foot_R": (-8, 0, 0),
    }
    build_nla_clip(
        arm_obj,
        "backhand",
        36,
        [
            (0, ready_a, (0.0, 0.0, -0.04)),
            (10, bh_prep, (0.0, 0.0, -0.07)),
            (20, bh_contact, (0.0, 0.0, -0.02)),
            (30, bh_follow, (0.0, 0.0, -0.02)),
            (36, ready_a, (0.0, 0.0, -0.04)),
        ],
    )

    # 7. lob (0.40 s = 40 frames EXACT)
    lob_low = {
        "Hips": (-12, 0, -14),
        "Spine": (-10, 0, -10),
        "Chest": (-10, 0, -14),
        "Head": (18, 0, 18),
        "UpperArm_L": (34, 18, -22),
        "Forearm_L": (42, 12, -22),
        "UpperArm_R": (18, 12, -18),
        "Forearm_R": (20, 0, -12),
        "Hand_R": (-12, 0, -12),
        "Thigh_L": (-34, 0, 6),
        "Shin_L": (56, 0, 0),
        "Foot_L": (-20, 0, 0),
        "Thigh_R": (-34, 0, -6),
        "Shin_R": (56, 0, 0),
        "Foot_R": (-20, 0, 0),
    }
    lob_lift = {
        "Hips": (4, 0, 12),
        "Spine": (6, 0, 10),
        "Chest": (10, 0, 14),
        "Head": (-10, 0, -16),
        "UpperArm_L": (28, 18, -16),
        "Forearm_L": (48, 12, -20),
        "Shoulder_R": (0, 0, 14),
        "UpperArm_R": (102, -14, 16),
        "Forearm_R": (36, -12, 14),
        "Hand_R": (10, -10, -10),
        "Thigh_L": (-10, 0, 4),
        "Shin_L": (16, 0, 0),
        "Foot_L": (-6, 0, 0),
        "Thigh_R": (-10, 0, -4),
        "Shin_R": (16, 0, 0),
        "Foot_R": (-6, 0, 0),
    }
    build_nla_clip(
        arm_obj,
        "lob",
        40,
        [
            (0, ready_a, (0.0, 0.0, -0.04)),
            (13, lob_low, (0.0, 0.0, -0.12)),
            (28, lob_lift, (0.0, 0.0, 0.01)),
            (40, ready_a, (0.0, 0.0, -0.04)),
        ],
    )

    # 8. celebrate (1.00 s = 100 frames loop)
    cel_dip = {
        "Hips": (-8, 0, 0),
        "Spine": (-8, 0, 0),
        "Chest": (-6, 0, 0),
        "Head": (10, 0, 0),
        "UpperArm_L": (36, 14, -14),
        "Forearm_L": (54, 16, -18),
        "UpperArm_R": (36, -14, 14),
        "Forearm_R": (54, -16, 18),
        "Thigh_L": (-32, 0, 6),
        "Shin_L": (54, 0, 0),
        "Foot_L": (-20, 0, 0),
        "Thigh_R": (-32, 0, -6),
        "Shin_R": (54, 0, 0),
        "Foot_R": (-20, 0, 0),
    }
    cel_peak = {
        "Hips": (4, 0, -6),
        "Spine": (8, 0, 0),
        "Chest": (10, 0, 8),
        "Head": (12, 0, -4),
        "Shoulder_L": (0, 14, 0),
        "UpperArm_L": (20, 118, -16),
        "Forearm_L": (56, 12, -10),
        "Shoulder_R": (0, -14, 0),
        "UpperArm_R": (24, -124, 14),
        "Forearm_R": (34, -12, 8),
        "Thigh_L": (-10, 0, 8),
        "Shin_L": (26, 0, 0),
        "Foot_L": (14, 0, 0),
        "Thigh_R": (-10, 0, -8),
        "Shin_R": (26, 0, 0),
        "Foot_R": (14, 0, 0),
    }
    build_nla_clip(
        arm_obj,
        "celebrate",
        100,
        [
            (0, cel_dip, (0.0, 0.0, -0.09)),
            (25, cel_peak, (0.0, 0.0, 0.22)),
            (55, cel_dip, (0.0, 0.0, -0.08)),
            (80, cel_peak, (0.0, 0.0, 0.16)),
            (100, cel_dip, (0.0, 0.0, -0.09)),
        ],
    )


# ---------------------------------------------------------------------------
# Export Pipeline
# ---------------------------------------------------------------------------

def generate_glb(output_path: Path) -> None:
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.context.scene.render.fps = FPS
    bpy.context.scene.render.fps_base = 1.0

    mats = create_materials()
    arm_obj = build_armature()
    build_body_mesh(arm_obj, mats)

    build_headgear_headband(arm_obj, mats)
    build_headgear_visor(arm_obj, mats)
    build_headgear_cap_backwards(arm_obj, mats)
    build_wristband("Wristband_L", "Forearm_L", -1.0, arm_obj, mats)
    build_wristband("Wristband_R", "Forearm_R", 1.0, arm_obj, mats)
    build_racquet(arm_obj, mats)

    create_all_animations(arm_obj)

    output_path.parent.mkdir(parents=True, exist_ok=True)
    bpy.ops.export_scene.gltf(
        filepath=str(output_path),
        export_format="GLB",
        export_yup=True,
        export_texcoords=False,
        export_normals=True,
        export_tangents=False,
        export_materials="EXPORT",
        export_apply=False,
        export_skins=True,
        export_influence_nb=4,
        export_all_influences=False,
        export_def_bones=False,
        export_leaf_bone=False,
        export_animations=True,
        export_animation_mode="NLA_TRACKS",
        export_nla_strips=True,
        export_force_sampling=True,
        export_frame_step=1,
        export_optimize_animation_size=True,
        export_optimize_animation_keep_anim_armature=False,
        export_draco_mesh_compression_enable=False,
    )
    size_kb = output_path.stat().st_size / 1024.0
    print(f"[WP-Asset] Exported {output_path} ({size_kb:.2f} KB)")


if __name__ == "__main__":
    args = parse_args()
    generate_glb(Path(args.output).resolve())
