"""Deterministic Blender 5.2.3 LTS generator for stylized tennis player .glb asset (V2 Round 2).

Implements WP-Asset for Court 2K V2 (CONTRACT.md §4.2 & SPEC.md §3.5):
- Mario Tennis / Nintendo Switch Sports stylized athletic proportions (~1.76 m)
- Unified seamless smooth-skinned body + shorts/jersey/socks/layered sneakers
- Flush curved facial features + cohesive layered hair + 3 zero-clipping headgears
- 21-bone Armature with exact CONTRACT hierarchy
- 6 independent named toggleable nodes (Headgear_*, Wristband_*, Racquet)
- 10 runtime-swappable materials + 4 static detail materials
- 8 embedded NLA animation clips (0 bone scale channels, zero clipping)
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


SCRIPT_DIR = Path(__file__).resolve().parent
REPO_ROOT = SCRIPT_DIR.parent.parent  # tennis-2k/
DEFAULT_OUTPUT_PATH = REPO_ROOT / "client" / "public" / "assets" / "models" / "tennis_player.glb"

FPS = 100  # Exact integer frames for 0.35 s (35), 0.36 s (36), 0.40 s (40)
MODEL_SCALE = 1.038  # Calibrates total character height cleanly into 1.75–1.80 m (~1.767 m)

BONE_SPECS: List[Tuple[str, Optional[str], Tuple[float, float, float], Tuple[float, float, float]]] = [
    ("Hips", None, (0.0, 0.0, 0.90), (0.0, 0.0, 1.03)),
    ("Spine", "Hips", (0.0, 0.0, 1.03), (0.0, 0.0, 1.17)),
    ("Chest", "Spine", (0.0, 0.0, 1.17), (0.0, 0.0, 1.38)),
    ("Neck", "Chest", (0.0, 0.0, 1.38), (0.0, 0.0, 1.445)),
    ("Head", "Neck", (0.0, 0.0, 1.445), (0.0, 0.0, 1.675)),
    ("HeadgearSocket", "Head", (0.0, 0.0, 1.58), (0.0, 0.0, 1.70)),
    # Left Arm (-X)
    ("Shoulder_L", "Chest", (-0.065, 0.0, 1.335), (-0.172, 0.0, 1.325)),
    ("UpperArm_L", "Shoulder_L", (-0.172, 0.0, 1.325), (-0.340, 0.02, 1.140)),
    ("Forearm_L", "UpperArm_L", (-0.340, 0.02, 1.140), (-0.480, 0.06, 0.960)),
    ("Hand_L", "Forearm_L", (-0.480, 0.06, 0.960), (-0.550, 0.08, 0.875)),
    # Right Arm (+X) - Racquet Side
    ("Shoulder_R", "Chest", (0.065, 0.0, 1.335), (0.172, 0.0, 1.325)),
    ("UpperArm_R", "Shoulder_R", (0.172, 0.0, 1.325), (0.340, 0.02, 1.140)),
    ("Forearm_R", "UpperArm_R", (0.340, 0.02, 1.140), (0.480, 0.06, 0.960)),
    ("Hand_R", "Forearm_R", (0.480, 0.06, 0.960), (0.550, 0.08, 0.875)),
    ("RacquetSocket", "Hand_R", (0.520, 0.075, 0.905), (0.520, 0.175, 0.905)),
    # Left Leg (-X)
    ("Thigh_L", "Hips", (-0.088, 0.0, 0.88), (-0.094, 0.01, 0.49)),
    ("Shin_L", "Thigh_L", (-0.094, 0.01, 0.49), (-0.095, -0.01, 0.105)),
    ("Foot_L", "Shin_L", (-0.095, -0.01, 0.105), (-0.095, 0.14, 0.03)),
    # Right Leg (+X)
    ("Thigh_R", "Hips", (0.088, 0.0, 0.88), (0.094, 0.01, 0.49)),
    ("Shin_R", "Thigh_R", (0.094, 0.01, 0.49), (0.095, -0.01, 0.105)),
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
            bsdf.inputs["Specular IOR Level"].default_value = 0.34
    return mat


def create_materials() -> Dict[str, bpy.types.Material]:
    return {
        # 10 Required runtime-swappable materials (CONTRACT.md §4.2)
        "Mat_JerseyPrimary": make_pbr_material("Mat_JerseyPrimary", "#1D4ED8", roughness=0.58),
        "Mat_JerseyAccent": make_pbr_material("Mat_JerseyAccent", "#FFFFFF", roughness=0.52),
        "Mat_Shorts": make_pbr_material("Mat_Shorts", "#1E293B", roughness=0.68),
        "Mat_Skin": make_pbr_material("Mat_Skin", "#E7AF8C", roughness=0.56),
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
        eb.head = Vector(head) * MODEL_SCALE
        eb.tail = Vector(tail) * MODEL_SCALE
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

def frame_from_dir(direction: Vector, ref_forward: Vector = Vector((0.0, 1.0, 0.0))) -> Tuple[Vector, Vector]:
    d = direction.normalized()
    u = d.cross(ref_forward)
    if u.length < 1e-4:
        u = d.cross(Vector((1.0, 0.0, 0.0)))
    u.normalize()
    v = u.cross(d).normalized()
    return u, v


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
    minor_r_rad: float,
    minor_r_z: float,
    major_segs: int,
    minor_segs: int,
    mat_idx: int,
    part_layer: Optional[bmesh.types.BMLayerItem] = None,
    part_id: int = 0,
    rot_euler: Optional[Tuple[float, float, float]] = None,
) -> List[bmesh.types.BMVert]:
    rot_mat = Euler(rot_euler, "XYZ").to_matrix() if rot_euler else Matrix.Identity(3)
    rings: List[List[bmesh.types.BMVert]] = []
    for i in range(major_segs):
        ang = (2.0 * math.pi * i) / major_segs
        ca, sa = math.cos(ang), math.sin(ang)
        ring_center = Vector((major_rx * ca, major_ry * sa, 0.0))
        outward = Vector((ca / max(major_rx, 1e-4), sa / max(major_ry, 1e-4), 0.0)).normalized()
        up = Vector((0.0, 0.0, 1.0))
        ring_vs: List[bmesh.types.BMVert] = []
        for j in range(minor_segs):
            phi = (2.0 * math.pi * j) / minor_segs
            local_p = ring_center + outward * (minor_r_rad * math.cos(phi)) + up * (minor_r_z * math.sin(phi))
            v = bm.verts.new(center + (rot_mat @ local_p))
            if part_layer is not None:
                v[part_layer] = part_id
            ring_vs.append(v)
        rings.append(ring_vs)

    created_verts = [v for r in rings for v in r]
    for i in range(major_segs):
        r0 = rings[i]
        r1 = rings[(i + 1) % major_segs]
        for j in range(minor_segs):
            nj = (j + 1) % minor_segs
            f = bm.faces.new((r0[j], r1[j], r1[nj], r0[nj]))
            f.material_index = mat_idx
            f.smooth = True

    return created_verts


def add_curved_head_patch(
    bm: bmesh.types.BMesh,
    head_center: Vector,
    rx: float,
    ry: float,
    rz: float,
    u_center: float,
    v_center: float,
    u_half: float,
    v_half: float,
    nu: int,
    nv: int,
    thick_offset: float,
    mat_idx: int,
    part_layer: bmesh.types.BMLayerItem,
    part_id: int,
    tilt_deg: float = 0.0,
) -> None:
    """Create a flush curved surface patch conforming cleanly to the face ellipsoid (zero protruding balls!)."""
    tilt = math.radians(tilt_deg)
    ct, st = math.cos(tilt), math.sin(tilt)
    grid: List[List[bmesh.types.BMVert]] = []
    for iv in range(nv + 1):
        tv = (iv / nv) * 2.0 - 1.0
        row: List[bmesh.types.BMVert] = []
        for iu in range(nu + 1):
            tu = (iu / nu) * 2.0 - 1.0
            # Rounded almond boundary via radial clamp
            r_norm = math.sqrt(tu * tu + tv * tv)
            scale = min(1.0, 1.0 / max(r_norm, 1.0)) if r_norm > 0.92 else 1.0
            lu = tu * scale * u_half
            lv = tv * scale * v_half
            # Rotate local (lu, lv) by tilt
            ru = lu * ct - lv * st
            rv = lu * st + lv * ct
            az = u_center + ru
            el = v_center + rv
            ce = math.cos(el)
            nx = ce * math.sin(az)
            ny = ce * math.cos(az)
            nz = math.sin(el)
            # Apply same lower-face taper as head
            eff_rx, eff_ry = rx, ry
            if nz < 0.0:
                t = min(1.0, abs(nz))
                eff_rx *= (1.0 - 0.28 * (t ** 1.35))
                eff_ry *= (1.0 - 0.16 * (t ** 1.5))
            if ny > 0.35:
                eff_ry *= 0.94
            pos = head_center + Vector((nx * eff_rx, ny * eff_ry, nz * rz))
            pos += Vector((nx, ny, nz)).normalized() * thick_offset
            v = bm.verts.new(pos)
            v[part_layer] = part_id
            row.append(v)
        grid.append(row)

    for iv in range(nv):
        for iu in range(nu):
            f = bm.faces.new((grid[iv][iu], grid[iv][iu + 1], grid[iv + 1][iu + 1], grid[iv + 1][iu]))
            f.material_index = mat_idx
            f.smooth = True


def add_smile_arc(
    bm: bmesh.types.BMesh,
    head_center: Vector,
    rx: float,
    ry: float,
    rz: float,
    mat_idx: int,
    part_layer: bmesh.types.BMLayerItem,
    part_id: int,
) -> None:
    """Create a cheerful curved smile line cleanly resting on the lower face surface."""
    segs = 8
    rings = []
    mats = []
    for i in range(segs + 1):
        t = (i / segs) * 2.0 - 1.0  # [-1, 1]
        az = t * 0.21
        el = -0.40 + 0.065 * (t * t)  # Cheerful upturned smile corners
        ce = math.cos(el)
        nx = ce * math.sin(az)
        ny = ce * math.cos(az)
        nz = math.sin(el)
        eff_rx = rx * (1.0 - 0.28 * (abs(nz) ** 1.35))
        eff_ry = ry * (1.0 - 0.16 * (abs(nz) ** 1.5)) * 0.94
        surf = head_center + Vector((nx * eff_rx, ny * eff_ry, nz * rz))
        surf += Vector((nx, ny, nz)).normalized() * 0.0022
        r_tube = 0.0022 * (1.0 - 0.30 * (t * t))
        rings.append(
            (surf, Vector((0.0, 1.0, 0.0)), Vector((0.0, 0.0, 1.0)), r_tube, r_tube, 6)
        )
        if i < segs:
            mats.append(mat_idx)
    add_loft_tube(bm, rings, mats, part_layer=part_layer, part_id=part_id, cap_start=True, cap_end=True)


# ---------------------------------------------------------------------------
# Main Stylized Character Body Builder (Unified Seamless SkinnedMesh)
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
    # 1. Torso + Seamless Pelvis Shorts + Collar + Athletic Neck
    #    NOTE: Bottom ends smoothly inside hips (z=0.810, rounded crotch) -
    #    ZERO boxy flat bottom protruding through white shorts!
    # -----------------------------------------------------------------------
    torso_profile = [
        (0.790, 0.000, 0.055, 0.068, "Mat_Shorts", 2.0),         # Smooth rounded crotch bridge (fully inside shorts)
        (0.845, -0.004, 0.148, 0.110, "Mat_Shorts", 2.1),        # Pelvis base
        (0.900, -0.004, 0.155, 0.114, "Mat_Shorts", 2.1),        # Upper hip
        (0.935, 0.002, 0.148, 0.109, "Mat_Shorts", 2.1),         # Waistband
        (0.948, 0.004, 0.151, 0.111, "Mat_JerseyPrimary", 2.1),  # Jersey hem
        (1.035, 0.008, 0.140, 0.105, "Mat_JerseyPrimary", 2.1),  # Trim athletic waist
        (1.135, 0.010, 0.158, 0.114, "Mat_JerseyPrimary", 2.15), # Ribcage
        (1.185, 0.012, 0.170, 0.119, "Mat_JerseyAccent", 2.2),   # Chest stripe
        (1.228, 0.014, 0.174, 0.118, "Mat_JerseyPrimary", 2.2),  # Upper chest
        (1.288, 0.011, 0.173, 0.112, "Mat_JerseyPrimary", 2.15), # Upper chest / armpit level
        (1.330, 0.008, 0.146, 0.098, "Mat_JerseyPrimary", 2.1),  # Rounded shoulder slope
        (1.362, 0.006, 0.104, 0.080, "Mat_JerseyPrimary", 2.05), # Trapezius slope
        (1.380, 0.006, 0.072, 0.068, "Mat_JerseyAccent", 2.0),   # Collar rim
        (1.402, 0.008, 0.064, 0.062, "Mat_Skin", 2.0),           # Collar top -> neck
        (1.392, 0.008, 0.056, 0.056, "Mat_Skin", 2.0),           # Neck base inside collar (sturdier!)
        (1.428, 0.006, 0.053, 0.054, "Mat_Skin", 2.0),           # Mid neck
        (1.464, 0.006, 0.056, 0.058, "Mat_Skin", 2.0),           # Upper neck blending cleanly under jaw
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

    # Crisp Polo Collar Ring
    add_torus_band(
        bm,
        Vector((0.0, 0.007, 1.388)),
        0.068,
        0.065,
        0.011,
        0.011,
        18,
        6,
        mat_idx["Mat_JerseyAccent"],
        part_layer=part_layer,
        part_id=PART_TORSO,
        rot_euler=(0.08, 0.0, 0.0),
    )

    # -----------------------------------------------------------------------
    # 2. Arms: Rounded Deltoid Sleeve -> Tucked Skin Arm -> Sculpted Hand
    #    No deep protruding inner cap -> zero armpit spikes when arms raise!
    # -----------------------------------------------------------------------
    for side_sign, part_id in ((-1.0, PART_ARM_L), (1.0, PART_ARM_R)):
        p_sh_root = Vector((side_sign * 0.128, 0.008, 1.278))
        p_sh_in = Vector((side_sign * 0.160, 0.008, 1.268))
        p_sh_cap = Vector((side_sign * 0.194, 0.009, 1.250))
        p_ua_mid = Vector((side_sign * 0.246, 0.010, 1.220))
        p_ua_cuff = Vector((side_sign * 0.268, 0.012, 1.204))
        p_el = Vector((side_sign * 0.340, 0.020, 1.140))
        p_fa_mid = Vector((side_sign * 0.418, 0.042, 1.042))
        p_wr = Vector((side_sign * 0.480, 0.060, 0.960))
        p_palm = Vector((side_sign * 0.514, 0.070, 0.916))
        p_fingers = Vector((side_sign * 0.542, 0.082, 0.875))

        arm_stations = [
            (p_sh_root, 0.044, 0.052, "Mat_JerseyPrimary"),
            (p_sh_in, 0.051, 0.056, "Mat_JerseyPrimary"),
            (p_sh_cap, 0.051, 0.055, "Mat_JerseyPrimary"),
            (p_ua_mid, 0.052, 0.053, "Mat_JerseyAccent"),
            (p_ua_cuff, 0.053, 0.053, "Mat_Skin"),
            (p_ua_cuff - Vector((side_sign * 0.007, 0.0, -0.007)), 0.044, 0.044, "Mat_Skin"),
            (p_el, 0.041, 0.040, "Mat_Skin"),
            (p_fa_mid, 0.043, 0.041, "Mat_Skin"),
            (p_wr, 0.031, 0.028, "Mat_Skin"),
            (p_palm, 0.037, 0.023, "Mat_Skin"),
            (p_fingers, 0.028, 0.017, "Mat_Skin"),
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
        thumb_base = p_palm + Vector((0.0, 0.019, 0.005))
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
    # 3. Legs: Clean Shorts Leg -> Thigh -> Knee -> Calf -> Sock -> Layered Sneaker
    # -----------------------------------------------------------------------
    for side_sign, part_id in ((-1.0, PART_LEG_L), (1.0, PART_LEG_R)):
        x_hip = side_sign * 0.082
        x_knee = side_sign * 0.092
        x_ankle = side_sign * 0.095
        leg_stations = [
            (Vector((x_hip, -0.002, 0.875)), 0.072, 0.086, "Mat_Shorts"),       # Tucked neatly inside pelvis
            (Vector((x_hip * 1.05, 0.001, 0.785)), 0.082, 0.090, "Mat_Shorts"), # Smooth shorts leg
            (Vector((x_hip * 1.08, 0.004, 0.685)), 0.086, 0.090, "Mat_Skin"),   # Shorts hem
            (Vector((x_hip * 1.08, 0.004, 0.700)), 0.068, 0.070, "Mat_Skin"),   # Tucked thigh
            (Vector((x_knee, 0.008, 0.560)), 0.063, 0.065, "Mat_Skin"),         # Lower thigh
            (Vector((x_knee, 0.012, 0.485)), 0.056, 0.058, "Mat_Skin"),         # Knee
            (Vector((x_ankle, -0.004, 0.365)), 0.061, 0.065, "Mat_Skin"),       # Athletic calf
            (Vector((x_ankle, -0.006, 0.275)), 0.052, 0.054, "Mat_JerseyAccent"),
            (Vector((x_ankle, -0.007, 0.252)), 0.053, 0.055, "Mat_Socks"),
            (Vector((x_ankle, -0.008, 0.175)), 0.046, 0.048, "Mat_Socks"),
            (Vector((x_ankle, -0.010, 0.088)), 0.044, 0.047, "Mat_Socks"),      # Inside sneaker collar
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

        # Flush Shorts Side Piping
        add_sculpted_ellipsoid(
            bm,
            Vector((x_hip * 1.06 + side_sign * 0.083, 0.002, 0.775)),
            (0.004, 0.011, 0.075),
            mat_idx["Mat_JerseyAccent"],
            part_layer=part_layer,
            part_id=part_id,
            subdiv=1,
        )

        # Multi-layered Pro Tennis Sneaker (flat rubber sole bottom z = 0.000 m,
        # midsole contour, ankle collar rim, integrated tongue & crisp accent side trim!)
        shoe_slices = [
            # (y, z_bot, z_top, hw, sole_thick)
            (-0.064, 0.003, 0.086, 0.042, 0.022),
            (-0.042, 0.000, 0.104, 0.049, 0.024),  # Heel counter
            (0.005,  0.000, 0.102, 0.052, 0.022),  # Ankle collar dip
            (0.055,  0.000, 0.096, 0.053, 0.021),  # Raised padded tongue / laces arch
            (0.115,  0.000, 0.068, 0.055, 0.020),  # Forefoot flex
            (0.168,  0.001, 0.052, 0.049, 0.019),  # Toe cap
            (0.205,  0.010, 0.032, 0.027, 0.016),  # Rounded toe bumper
        ]
        shoe_rings: List[List[bmesh.types.BMVert]] = []
        for sy, zb, zt, hw, sh in shoe_slices:
            z_sole = zb + sh
            pts_2d = [
                (0.0, zb),
                (hw * 0.75, zb),
                (hw * 0.98, zb + 0.005),
                (hw * 1.02, z_sole),                     # Outsole lip
                (hw * 0.93, z_sole + (zt - z_sole) * 0.36),
                (hw * 0.62, z_sole + (zt - z_sole) * 0.80),
                (0.0, zt),
                (-hw * 0.62, z_sole + (zt - z_sole) * 0.80),
                (-hw * 0.93, z_sole + (zt - z_sole) * 0.36),
                (-hw * 1.02, z_sole),
                (-hw * 0.98, zb + 0.005),
                (-hw * 0.75, zb),
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
                elif i == 1 and j in (4, 5, 6, 7):
                    # Crisp colored ankle collar rim at heel/collar
                    f.material_index = mat_idx["Mat_JerseyAccent"]
                elif i == 3 and j in (5, 6):
                    # Crisp colored lace/tongue strip on vamp
                    f.material_index = mat_idx["Mat_JerseyAccent"]
                elif i in (2, 3, 4) and ((side_sign > 0 and j == 3) or (side_sign < 0 and j == 8)):
                    # Integrated flush side swoosh stripe along outer upper panel (zero floating pill!)
                    f.material_index = mat_idx["Mat_JerseyAccent"]
                else:
                    f.material_index = mat_idx["Mat_ShoeUpper"]
                f.smooth = True

        bm.faces.new(list(reversed(shoe_rings[0]))).material_index = mat_idx["Mat_ShoeUpper"]
        bm.faces.new(shoe_rings[-1]).material_index = mat_idx["Mat_ShoeSole"]

    # -----------------------------------------------------------------------
    # 4. Sculpted Head, Flush Curved Stylized Eyes, Brows, Nose & Smile
    # -----------------------------------------------------------------------
    head_center = Vector((0.0, 0.008, 1.552))
    ret_head = bmesh.ops.create_icosphere(bm, subdivisions=3, radius=1.0)
    head_verts = ret_head["verts"]
    for v in head_verts:
        p = v.co.copy()
        rx, ry, rz = 0.104, 0.111, 0.120
        if p.z < 0.0:
            t = min(1.0, abs(p.z))
            rx *= (1.0 - 0.28 * (t ** 1.35))
            ry *= (1.0 - 0.16 * (t ** 1.5))
            if p.y > 0.25 and p.z < -0.25:
                p.y += 0.05 * (1.0 - abs(p.x))
        if p.y > 0.35:
            ry *= 0.94
        v.co = head_center + Vector((p.x * rx, p.y * ry, p.z * rz))
        v[part_layer] = PART_HEAD

    head_set = set(head_verts)
    for f in bm.faces:
        if all(v in head_set for v in f.verts):
            f.material_index = mat_idx["Mat_Skin"]
            f.smooth = True

    # Subtle Cute Stylized Nose (gentle rounded profile)
    add_sculpted_ellipsoid(
        bm,
        Vector((0.0, 0.112, 1.533)),
        (0.010, 0.011, 0.011),
        mat_idx["Mat_Skin"],
        part_layer=part_layer,
        part_id=PART_HEAD,
        subdiv=1,
        rot_euler=(-0.15, 0.0, 0.0),
    )

    # Sculpted Rounded Ears
    for side_sign in (-1.0, 1.0):
        add_sculpted_ellipsoid(
            bm,
            Vector((side_sign * 0.102, -0.003, 1.542)),
            (0.013, 0.019, 0.025),
            mat_idx["Mat_Skin"],
            part_layer=part_layer,
            part_id=PART_HEAD,
            subdiv=2,
            rot_euler=(0.0, 0.0, side_sign * -0.18),
        )

    # Flush Curved Stylized Eyes (NO protruding spheres in 3/4 view!)
    for side_sign in (-1.0, 1.0):
        u_eye = side_sign * 0.34
        # Sclera flush curved almond
        add_curved_head_patch(
            bm, head_center, 0.104, 0.111, 0.120,
            u_eye, 0.11, 0.165, 0.155, 4, 4, 0.0014,
            mat_idx["Mat_EyeWhite"], part_layer, PART_HEAD, tilt_deg=side_sign * -4.0,
        )
        # Vivid Iris slightly inward
        add_curved_head_patch(
            bm, head_center, 0.104, 0.111, 0.120,
            u_eye * 0.94, 0.105, 0.102, 0.112, 4, 4, 0.0024,
            mat_idx["Mat_EyeIris"], part_layer, PART_HEAD,
        )
        # Crisp Dark Pupil
        add_curved_head_patch(
            bm, head_center, 0.104, 0.111, 0.120,
            u_eye * 0.93, 0.105, 0.056, 0.066, 3, 3, 0.0030,
            mat_idx["Mat_FaceDetail"], part_layer, PART_HEAD,
        )
        # Crisp Eye Specular Catchlight
        add_curved_head_patch(
            bm, head_center, 0.104, 0.111, 0.120,
            u_eye * 0.93 - 0.042, 0.158, 0.026, 0.028, 2, 2, 0.0036,
            mat_idx["Mat_EyeWhite"], part_layer, PART_HEAD,
        )
        # Crisp Upper Eyelash / Lid Liner
        add_curved_head_patch(
            bm, head_center, 0.104, 0.111, 0.120,
            u_eye, 0.255, 0.172, 0.028, 4, 2, 0.0028,
            mat_idx["Mat_FaceDetail"], part_layer, PART_HEAD, tilt_deg=side_sign * 4.0,
        )
        # Confident Cheerful Arched Eyebrow (slightly arched upward, warm expression!)
        add_curved_head_patch(
            bm, head_center, 0.104, 0.111, 0.120,
            u_eye * 1.02, 0.395, 0.165, 0.032, 4, 2, 0.0034,
            mat_idx["Mat_Hair"], part_layer, PART_HEAD, tilt_deg=side_sign * -6.0,
        )

    # Confident Friendly Smile
    add_smile_arc(bm, head_center, 0.104, 0.111, 0.120, mat_idx["Mat_FaceDetail"], part_layer, PART_HEAD)

    # -----------------------------------------------------------------------
    # 5. Cohesive Sculpted Stylized Hair (Natural athletic volume, NO top bun,
    #    ZERO banana tubes, ZERO temple bald patches, and strictly inside Cap!)
    # -----------------------------------------------------------------------
    ret_hair = bmesh.ops.create_uvsphere(bm, u_segments=20, v_segments=12, radius=1.0)
    hair_verts = ret_hair["verts"]
    hair_center = Vector((0.0, 0.001, 1.565))
    for v in hair_verts:
        p = v.co.copy()
        az = math.atan2(p.x, p.y)
        in_face_window = abs(az) < 1.15 and p.z < 0.44
        if in_face_window:
            side_t = max(0.0, (abs(az) - 0.65) / 0.50)
            target_z = 0.44 * (1.0 - 0.55 * side_t)
            if p.z < target_z:
                p.z = target_z
                p.y = min(p.y, 0.90)
        if abs(az) >= 1.15 and p.z < -0.30:
            p.z = -0.30 + (p.z + 0.30) * 0.25

        # Smooth rounded athletic dome (ZERO cone step discontinuity)
        crown_round = 1.0 + 0.028 * math.sin(max(0.0, p.z) * math.pi)
        rx = 0.111 * crown_round
        ry = 0.117 * crown_round
        rz = 0.128
        v.co = hair_center + Vector((p.x * rx, p.y * ry, p.z * rz))
        v[part_layer] = PART_HEAD

    hair_set = set(hair_verts)
    for f in bm.faces:
        if all(v in hair_set for v in f.verts):
            f.material_index = mat_idx["Mat_Hair"]
            f.smooth = True

    # Smooth Flush Layered Swept Bangs
    bang_specs = [
        (-0.52, 0.42, 0.18, 0.12, 18.0),
        (-0.22, 0.46, 0.19, 0.13, 12.0),
        (0.08,  0.47, 0.20, 0.14, -8.0),
        (0.38,  0.45, 0.18, 0.12, -16.0),
        (0.66,  0.38, 0.14, 0.10, -24.0),
        (-0.74, 0.34, 0.13, 0.10, 24.0),
    ]
    for uc, vc, uh, vh, td in bang_specs:
        add_curved_head_patch(
            bm, hair_center, 0.111, 0.117, 0.124,
            uc, vc, uh, vh, 4, 3, 0.0042,
            mat_idx["Mat_Hair"], part_layer, PART_HEAD, tilt_deg=td,
        )

    # Smooth Sideburns integrated seamlessly from temple into cheek
    for side_sign in (-1.0, 1.0):
        add_curved_head_patch(
            bm, head_center, 0.104, 0.111, 0.120,
            side_sign * 1.24, 0.09, 0.15, 0.16, 3, 3, 0.0022,
            mat_idx["Mat_Hair"], part_layer, PART_HEAD, tilt_deg=side_sign * 5.0,
        )

    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    bm.verts.ensure_lookup_table()
    bm.verts.index_update()
    part_ids = [v[part_layer] for v in bm.verts]

    bm.to_mesh(mesh)
    bm.free()

    assign_body_weights(obj, arm_obj, part_ids)

    for v in obj.data.vertices:
        v.co *= MODEL_SCALE

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
    """Assign smooth, spike-free analytical vertex weights across the 21 bones."""
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
            if p.z >= 1.470:
                weights["Head"] = 1.0
            else:
                w_head = smoothstep(1.430, 1.470, p.z)
                weights["Head"] = w_head
                weights["Neck"] = 1.0 - w_head

        elif pid in (PART_ARM_L, PART_ARM_R):
            side = "L" if pid == PART_ARM_L else "R"
            t_ua, d_ua = closest_segment_t(p, *bone_pts[f"UpperArm_{side}"])
            t_fa, d_fa = closest_segment_t(p, *bone_pts[f"Forearm_{side}"])
            _, d_ha = closest_segment_t(p, *bone_pts[f"Hand_{side}"])

            ax = abs(p.x)
            # Broad, smooth deltoid blend: inner shoulder stays anchored to Chest/Shoulder
            # so raising arm 120° in celebrate/serve_toss NEVER pulls armpit spikes!
            if ax < 0.215:
                w_ua = smoothstep(0.155, 0.215, ax)
                w_sh = smoothstep(0.138, 0.175, ax) * (1.0 - w_ua) * 0.75
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
            if p.z > 0.780:
                w_hips = smoothstep(0.780, 0.885, p.z)
                weights["Hips"] = w_hips
                weights[f"Thigh_{side}"] = 1.0 - w_hips
            elif p.z > 0.455:
                w_shin = smoothstep(0.525, 0.455, p.z)
                weights[f"Shin_{side}"] = w_shin
                weights[f"Thigh_{side}"] = 1.0 - w_shin
            elif p.z > 0.110:
                weights[f"Shin_{side}"] = 1.0
            else:
                if p.y > 0.04 or p.z < 0.075:
                    weights[f"Foot_{side}"] = 1.0
                else:
                    w_shin = smoothstep(0.075, 0.115, p.z)
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
                if abs(p.x) > 0.125 and z > 1.260:
                    w_sh = smoothstep(0.125, 0.175, abs(p.x)) * 0.65
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
                w_hd = smoothstep(1.430, 1.465, z)
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
# Independent Named Attachment Nodes (ZERO hair clipping!)
# ---------------------------------------------------------------------------

def attach_to_bone(
    obj: bpy.types.Object,
    arm_obj: bpy.types.Object,
    bone_name: str,
) -> None:
    for v in obj.data.vertices:
        v.co *= MODEL_SCALE
    bpy.ops.object.select_all(action="DESELECT")
    obj.select_set(True)
    arm_obj.select_set(True)
    bpy.context.view_layer.objects.active = arm_obj
    arm_obj.data.bones.active = arm_obj.data.bones[bone_name]
    bpy.ops.object.parent_set(type="BONE", keep_transform=True)


def build_headgear_headband(arm_obj: bpy.types.Object, mats: Dict[str, bpy.types.Material]) -> bpy.types.Object:
    """Athletic forehead sweatband sitting cleanly outside hair surface with zero intersection."""
    mesh = bpy.data.meshes.new("Headgear_Headband")
    obj = bpy.data.objects.new("Headgear_Headband", mesh)
    bpy.context.scene.collection.objects.link(obj)
    obj.data.materials.append(mats["Mat_JerseyAccent"])

    bm = bmesh.new()
    # Flat-profile athletic terry headband hugging hair contour snugly
    add_torus_band(
        bm,
        Vector((0.0, 0.001, 1.616)),
        0.1112,
        0.1195,
        0.006,
        0.014,
        22,
        6,
        0,
        rot_euler=(-0.15, 0.0, 0.0),
    )
    # Two soft ribbon tails fluttering at back (-Y -> glTF +Z)
    for sx, len_z in ((-0.014, 0.080), (0.016, 0.068)):
        p0 = Vector((sx, -0.122, 1.596))
        p1 = Vector((sx * 1.4, -0.146, 1.596 - len_z * 0.5))
        p2 = Vector((sx * 1.7, -0.162, 1.596 - len_z))
        u, v = frame_from_dir(p2 - p0, Vector((0.0, 1.0, 0.0)))
        add_loft_tube(
            bm,
            [
                (p0, u, v, 0.010, 0.004, 6),
                (p1, u, v, 0.012, 0.004, 6),
                (p2, u, v, 0.007, 0.003, 6),
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
    """Pro tennis sun visor: snug headband + realistically curved & proportioned forward brim (-Z)."""
    mesh = bpy.data.meshes.new("Headgear_Visor")
    obj = bpy.data.objects.new("Headgear_Visor", mesh)
    bpy.context.scene.collection.objects.link(obj)
    obj.data.materials.append(mats["Mat_JerseyPrimary"])  # 0: band
    obj.data.materials.append(mats["Mat_JerseyAccent"])   # 1: forward brim

    bm = bmesh.new()
    # Snug visor band hugging hair contour cleanly
    add_torus_band(
        bm,
        Vector((0.0, 0.001, 1.616)),
        0.1120,
        0.1198,
        0.007,
        0.016,
        22,
        6,
        0,
        rot_euler=(-0.12, 0.0, 0.0),
    )

    # Realistic forehead-only curved brim (+Y in Blender -> -Z in glTF!)
    # Narrower span (0.28*pi to 0.72*pi), shorter reach (outer_r=0.192), nice athletic curve & thickness!
    brim_segs = 10
    inner_r = 0.114
    outer_r = 0.192
    rings: List[List[bmesh.types.BMVert]] = []
    for i in range(brim_segs + 1):
        t = i / brim_segs
        ang = math.pi * (0.28 + 0.44 * t)  # Clean front arc only, does NOT poke out past ears!
        ca, sa = math.cos(ang), math.sin(ang)
        arch_z = 1.612 + 0.010 * math.sin(t * math.pi)
        tip_drop = -0.022 * math.sin(t * math.pi) - 0.006
        v_in_top = bm.verts.new(Vector((inner_r * ca, inner_r * sa + 0.004, arch_z + 0.005)))
        v_in_bot = bm.verts.new(Vector((inner_r * ca, inner_r * sa + 0.004, arch_z - 0.004)))
        v_out_top = bm.verts.new(Vector((outer_r * ca, outer_r * sa + 0.006, arch_z + tip_drop + 0.004)))
        v_out_bot = bm.verts.new(Vector((outer_r * ca, outer_r * sa + 0.006, arch_z + tip_drop - 0.003)))
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
    """Backwards tennis cap: full dome cleanly encloses hair (0 hair clipping!) + curved rear brim (+Z)."""
    mesh = bpy.data.meshes.new("Headgear_CapBackwards")
    obj = bpy.data.objects.new("Headgear_CapBackwards", mesh)
    bpy.context.scene.collection.objects.link(obj)
    obj.data.materials.append(mats["Mat_JerseyAccent"])   # 0: crown
    obj.data.materials.append(mats["Mat_JerseyPrimary"])  # 1: backwards brim

    bm = bmesh.new()
    # Cap dome covers z = 1.612 -> 1.740 (strictly enclosing hair dome z<=1.696!)
    ret = bmesh.ops.create_icosphere(bm, subdivisions=2, radius=1.0)
    crown_verts = ret["verts"]
    cap_center = Vector((0.0, 0.001, 1.615))
    for v in crown_verts:
        p = v.co.copy()
        if p.z < 0.0:
            p.z = max(p.z, -0.02)
        v.co = cap_center + Vector((p.x * 0.122, p.y * 0.128, p.z * 0.124))
    crown_set = set(crown_verts)
    for f in bm.faces:
        if all(v in crown_set for v in f.verts):
            f.material_index = 0
            f.smooth = True

    # Cap top button
    add_sculpted_ellipsoid(bm, Vector((0.0, 0.001, 1.741)), (0.011, 0.011, 0.006), 1, subdiv=1)

    # Curved backwards-facing brim (-Y in Blender -> +Z in glTF!)
    brim_segs = 10
    inner_r = 0.118
    outer_r = 0.214
    rings: List[List[bmesh.types.BMVert]] = []
    for i in range(brim_segs + 1):
        t = i / brim_segs
        ang = -math.pi * (0.30 + 0.40 * t)  # Realistic cap brim width
        ca, sa = math.cos(ang), math.sin(ang)
        arch_z = 1.615 + 0.012 * math.sin(t * math.pi)
        tip_drop = -0.016 * math.sin(t * math.pi) - 0.004
        v_in_top = bm.verts.new(Vector((inner_r * ca, inner_r * sa - 0.002, arch_z + 0.005)))
        v_in_bot = bm.verts.new(Vector((inner_r * ca, inner_r * sa - 0.002, arch_z - 0.004)))
        v_out_top = bm.verts.new(Vector((outer_r * ca, outer_r * sa - 0.004, arch_z + tip_drop + 0.004)))
        v_out_bot = bm.verts.new(Vector((outer_r * ca, outer_r * sa - 0.004, arch_z + tip_drop - 0.003)))
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
    p_wr = Vector((side_sign * 0.480, 0.060, 0.960))
    p_el = Vector((side_sign * 0.340, 0.020, 1.140))
    axis = (p_wr - p_el).normalized()
    u, v = frame_from_dir(axis, Vector((0.0, 1.0, 0.0)))
    c_mid = p_wr - axis * 0.036
    add_loft_tube(
        bm,
        [
            (c_mid - axis * 0.027, u, v, 0.038, 0.036, 12),
            (c_mid - axis * 0.019, u, v, 0.043, 0.041, 12),
            (c_mid + axis * 0.019, u, v, 0.041, 0.039, 12),
            (c_mid + axis * 0.027, u, v, 0.036, 0.034, 12),
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
    origin = Vector((0.520, 0.075, 0.905))
    # Natural continental grip pointing forward & slightly outward (+X)
    rot = Euler((-math.radians(50.0), math.radians(24.0), math.radians(-14.0)), "XYZ").to_matrix()

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
# 8 Athletic Tennis NLA Animations (ZERO bone scale tracks, ZERO clipping!)
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
            pb.location = (Vector(hips_offset) * MODEL_SCALE) if hips_offset else Vector((0.0, 0.0, 0.0))


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
    """Author all 8 tennis clips with natural athletic biomechanics & zero head/arm clipping."""
    arm_obj.animation_data_create()

    # Classic athletic split-step tennis ready stance: wider feet, gentle knee flex,
    # left arm tucked gracefully forward toward racquet throat, racquet held diagonally forward-right
    ready_a = {
        "Hips": (-4, 0, 0),
        "Spine": (-7, 0, 0),
        "Chest": (-7, 0, 4),
        "Head": (12, 0, -4),
        "UpperArm_L": (30, -2, -26),
        "Forearm_L": (42, 16, -42),
        "UpperArm_R": (20, 4, 22),
        "Forearm_R": (46, -16, 22),
        "Hand_R": (8, -12, -16),
        "Thigh_L": (-18, 9, 6),
        "Shin_L": (32, 0, 0),
        "Foot_L": (-14, -9, 0),
        "Thigh_R": (-18, -9, -6),
        "Shin_R": (32, 0, 0),
        "Foot_R": (-14, 9, 0),
    }
    ready_b = {
        "Hips": (-5, 0, 0),
        "Spine": (-8, 0, 0),
        "Chest": (-8, 0, 2),
        "Head": (14, 0, -2),
        "UpperArm_L": (32, -1, -28),
        "Forearm_L": (45, 16, -44),
        "UpperArm_R": (22, 4, 20),
        "Forearm_R": (49, -16, 20),
        "Hand_R": (9, -12, -16),
        "Thigh_L": (-22, 9, 6),
        "Shin_L": (38, 0, 0),
        "Foot_L": (-16, -9, 0),
        "Thigh_R": (-22, -9, -6),
        "Shin_R": (38, 0, 0),
        "Foot_R": (-16, 9, 0),
    }

    # 1. idle (1.20 s)
    build_nla_clip(
        arm_obj,
        "idle",
        120,
        [
            (0, ready_a, (0.0, 0.0, -0.036)),
            (30, ready_b, (0.0, 0.0, -0.056)),
            (60, ready_a, (0.0, 0.0, -0.036)),
            (90, ready_b, (0.0, 0.0, -0.056)),
            (120, ready_a, (0.0, 0.0, -0.036)),
        ],
    )

    # 2. run (0.56 s) - athletic stride with racquet held safely out to right-front
    run_r_fwd = {
        "Hips": (-6, 0, -6),
        "Spine": (-8, 0, 4),
        "Chest": (-8, 0, 10),
        "Head": (14, 0, -8),
        "UpperArm_L": (-26, -6, -8),
        "Forearm_L": (48, 16, -14),
        "UpperArm_R": (26, 6, 12),
        "Forearm_R": (44, -12, 12),
        "Hand_R": (6, -10, -12),
        "Thigh_L": (32, 3, 2),
        "Shin_L": (46, 0, 0),
        "Foot_L": (-14, 0, 0),
        "Thigh_R": (-42, -3, -2),
        "Shin_R": (26, 0, 0),
        "Foot_R": (10, 0, 0),
    }
    run_l_fwd = {
        "Hips": (-6, 0, 6),
        "Spine": (-8, 0, -4),
        "Chest": (-8, 0, -10),
        "Head": (14, 0, 8),
        "UpperArm_L": (38, -6, -12),
        "Forearm_L": (52, 16, -16),
        "UpperArm_R": (-6, 6, 14),
        "Forearm_R": (40, -12, 14),
        "Hand_R": (6, -10, -12),
        "Thigh_L": (-42, 3, 2),
        "Shin_L": (26, 0, 0),
        "Foot_L": (10, 0, 0),
        "Thigh_R": (32, -3, -2),
        "Shin_R": (46, 0, 0),
        "Foot_R": (-14, 0, 0),
    }
    run_mid = {
        "Hips": (-5, 0, 0),
        "Spine": (-7, 0, 0),
        "Chest": (-7, 0, 0),
        "Head": (12, 0, 0),
        "UpperArm_L": (10, -6, -12),
        "Forearm_L": (50, 16, -14),
        "UpperArm_R": (16, 6, 12),
        "Forearm_R": (42, -12, 12),
        "Hand_R": (6, -10, -12),
        "Thigh_L": (-14, 3, 2),
        "Shin_L": (40, 0, 0),
        "Foot_L": (-8, 0, 0),
        "Thigh_R": (-14, -3, -2),
        "Shin_R": (40, 0, 0),
        "Foot_R": (-8, 0, 0),
    }
    build_nla_clip(
        arm_obj,
        "run",
        56,
        [
            (0, run_r_fwd, (0.0, 0.0, -0.025)),
            (14, run_mid, (0.0, 0.0, -0.062)),
            (28, run_l_fwd, (0.0, 0.0, -0.025)),
            (42, run_mid, (0.0, 0.0, -0.062)),
            (56, run_r_fwd, (0.0, 0.0, -0.025)),
        ],
    )

    # 3. slide (0.50 s) - wide court lunge slide, balanced & smooth
    slide_pose = {
        "Hips": (-10, -8, -16),
        "Spine": (-8, 4, 8),
        "Chest": (-10, 6, 14),
        "Head": (18, 0, -10),
        "UpperArm_L": (24, 24, -18),
        "Forearm_L": (28, 12, -16),
        "UpperArm_R": (24, -16, 14),
        "Forearm_R": (42, -14, 14),
        "Hand_R": (4, -8, -10),
        "Thigh_L": (14, 20, 10),
        "Shin_L": (48, 0, 0),
        "Foot_L": (-16, 0, 0),
        "Thigh_R": (-48, -18, -14),
        "Shin_R": (36, 0, 0),
        "Foot_R": (-10, 0, 0),
    }
    build_nla_clip(
        arm_obj,
        "slide",
        50,
        [
            (0, ready_a, (0.0, 0.0, -0.04)),
            (14, slide_pose, (0.0, 0.0, -0.15)),
            (38, slide_pose, (0.0, 0.0, -0.15)),
            (50, ready_a, (0.0, 0.0, -0.04)),
        ],
    )

    # 4. serve_toss (0.35 s = 35 frames EXACT):
    # Knees athletic flex on toss load -> high left-arm ball toss + trophy pose cocked safely OUTSIDE head/visor!
    toss_load = {
        "Hips": (-10, 0, -14),
        "Spine": (-6, 0, -10),
        "Chest": (2, 0, -14),
        "Head": (8, 0, 14),
        "UpperArm_L": (42, 8, -10),
        "Forearm_L": (24, 0, -12),
        "UpperArm_R": (16, -16, 20),
        "Forearm_R": (56, 0, 10),
        "Thigh_L": (-28, 8, 4),
        "Shin_L": (48, 0, 0),
        "Foot_L": (-18, -8, 0),
        "Thigh_R": (-26, -8, -4),
        "Shin_R": (46, 0, 0),
        "Foot_R": (-18, 8, 0),
    }
    toss_trophy = {
        "Hips": (2, 0, -18),
        "Spine": (6, 0, -12),
        "Chest": (10, -6, -16),
        "Head": (24, 0, 18),
        "Shoulder_L": (0, 18, 0),
        "UpperArm_L": (-20, 118, -10),  # Left arm reaches high skyward for toss
        "Forearm_L": (-10, 0, -6),
        "Shoulder_R": (0, -14, -14),
        "UpperArm_R": (10, -56, -34),   # Cocked out-and-back OUTSIDE right shoulder (0 head/visor clipping!)
        "Forearm_R": (-42, -26, 8),
        "Hand_R": (-12, 18, 12),
        "Thigh_L": (-12, 8, 4),
        "Shin_L": (22, 0, 0),
        "Foot_L": (-10, -8, 0),
        "Thigh_R": (-12, -8, -4),
        "Shin_R": (22, 0, 0),
        "Foot_R": (-10, 8, 0),
    }
    build_nla_clip(
        arm_obj,
        "serve_toss",
        35,
        [
            (0, ready_a, (0.0, 0.0, -0.04)),
            (12, toss_load, (0.0, 0.0, -0.10)),
            (35, toss_trophy, (0.0, 0.0, -0.02)),
        ],
    )

    # 5. forehand (0.36 s = 36 frames EXACT):
    # Wide open-stance unit turn -> sweeping side-front waist-height topspin strike (0 face clipping!) -> shoulder follow-through
    fh_prep = {
        "Hips": (-8, 0, -32),
        "Spine": (-6, 0, -24),
        "Chest": (-8, 0, -30),
        "Head": (12, 0, 44),
        "UpperArm_L": (36, 12, -24),
        "Forearm_L": (44, 16, -22),
        "Shoulder_R": (0, 0, -18),
        "UpperArm_R": (-24, -18, -38),
        "Forearm_R": (36, -12, -16),
        "Hand_R": (6, -12, -16),
        "Thigh_L": (-24, 10, 6),
        "Shin_L": (42, 0, 0),
        "Foot_L": (-16, -10, 0),
        "Thigh_R": (-26, -10, -8),
        "Shin_R": (44, 0, 0),
        "Foot_R": (-16, 10, 0),
    }
    fh_contact = {
        "Hips": (-6, 0, 18),
        "Spine": (-7, 0, 14),
        "Chest": (-8, 0, 22),
        "Head": (12, 0, -24),
        "UpperArm_L": (26, 12, -14),
        "Forearm_L": (54, 16, -24),
        "Shoulder_R": (0, 0, 10),
        "UpperArm_R": (46, 18, 6),     # Outward-forward at waist/lower-chest height (strictly clears head/face!)
        "Forearm_R": (26, -8, 12),
        "Hand_R": (10, -20, -18),
        "Thigh_L": (-20, 10, 6),
        "Shin_L": (32, 0, 0),
        "Foot_L": (-12, -10, 0),
        "Thigh_R": (-18, -10, -6),
        "Shin_R": (30, 0, 0),
        "Foot_R": (-12, 10, 0),
    }
    fh_follow = {
        "Hips": (-5, 0, 32),
        "Spine": (-5, 0, 24),
        "Chest": (-6, 0, 30),
        "Head": (10, 0, -36),
        "UpperArm_L": (18, 18, -8),
        "Forearm_L": (48, 16, -18),
        "Shoulder_R": (0, 0, 16),
        "UpperArm_R": (72, 18, 34),
        "Forearm_R": (58, -16, 24),
        "Hand_R": (10, -14, -12),
        "Thigh_L": (-18, 9, 4),
        "Shin_L": (28, 0, 0),
        "Foot_L": (-10, -9, 0),
        "Thigh_R": (-16, -9, -4),
        "Shin_R": (28, 0, 0),
        "Foot_R": (-10, 9, 0),
    }
    build_nla_clip(
        arm_obj,
        "forehand",
        36,
        [
            (0, ready_a, (0.0, 0.0, -0.04)),
            (10, fh_prep, (0.0, 0.0, -0.08)),
            (20, fh_contact, (0.0, 0.0, -0.04)),
            (30, fh_follow, (0.0, 0.0, -0.03)),
            (36, ready_a, (0.0, 0.0, -0.04)),
        ],
    )

    # 6. backhand (0.36 s = 36 frames EXACT):
    # Athletic closed-stance shoulder turn, low-to-high sweep across strike zone & proud finish!
    bh_prep = {
        "Hips": (-8, 0, 28),
        "Spine": (-8, 0, 22),
        "Chest": (-10, 0, 32),
        "Head": (14, 0, -40),
        "UpperArm_L": (40, 10, -18),
        "Forearm_L": (54, 16, -24),
        "Shoulder_R": (0, 0, 14),
        "UpperArm_R": (40, 14, 38),
        "Forearm_R": (52, -14, 24),
        "Hand_R": (6, -10, 10),
        "Thigh_L": (-28, 10, 8),
        "Shin_L": (46, 0, 0),
        "Foot_L": (-16, -10, 0),
        "Thigh_R": (-26, -10, -6),
        "Shin_R": (44, 0, 0),
        "Foot_R": (-16, 10, 0),
    }
    bh_contact = {
        "Hips": (-6, 0, -10),
        "Spine": (-8, 0, -10),
        "Chest": (-8, 0, -16),
        "Head": (14, 0, 20),
        "UpperArm_L": (12, 16, -22),
        "Forearm_L": (40, 14, -16),
        "Shoulder_R": (0, 0, -8),
        "UpperArm_R": (48, -12, -10),
        "Forearm_R": (26, -6, -14),
        "Hand_R": (8, -12, -12),
        "Thigh_L": (-24, 10, 4),
        "Shin_L": (36, 0, 0),
        "Foot_L": (-12, -10, 0),
        "Thigh_R": (-22, -10, -4),
        "Shin_R": (36, 0, 0),
        "Foot_R": (-12, 10, 0),
    }
    bh_follow = {
        "Hips": (-6, 0, -24),
        "Spine": (-6, 0, -16),
        "Chest": (-6, 0, -24),
        "Head": (12, 0, 32),
        "UpperArm_L": (-12, 20, -24),
        "Forearm_L": (30, 12, -12),
        "Shoulder_R": (0, 0, -14),
        "UpperArm_R": (62, -26, -38),
        "Forearm_R": (24, -8, -16),
        "Hand_R": (8, -10, -10),
        "Thigh_L": (-18, 8, 4),
        "Shin_L": (28, 0, 0),
        "Foot_L": (-10, -8, 0),
        "Thigh_R": (-18, -8, -4),
        "Shin_R": (28, 0, 0),
        "Foot_R": (-10, 8, 0),
    }
    build_nla_clip(
        arm_obj,
        "backhand",
        36,
        [
            (0, ready_a, (0.0, 0.0, -0.04)),
            (10, bh_prep, (0.0, 0.0, -0.08)),
            (20, bh_contact, (0.0, 0.0, -0.04)),
            (30, bh_follow, (0.0, 0.0, -0.03)),
            (36, ready_a, (0.0, 0.0, -0.04)),
        ],
    )

    # 7. lob (0.40 s = 40 frames EXACT)
    lob_low = {
        "Hips": (-12, 0, -14),
        "Spine": (-10, 0, -10),
        "Chest": (-10, 0, -14),
        "Head": (18, 0, 18),
        "UpperArm_L": (34, 16, -22),
        "Forearm_L": (42, 12, -22),
        "UpperArm_R": (18, 12, -18),
        "Forearm_R": (20, 0, -12),
        "Hand_R": (-12, 0, -12),
        "Thigh_L": (-34, 8, 6),
        "Shin_L": (56, 0, 0),
        "Foot_L": (-20, -8, 0),
        "Thigh_R": (-34, -8, -6),
        "Shin_R": (56, 0, 0),
        "Foot_R": (-20, 8, 0),
    }
    lob_lift = {
        "Hips": (4, 0, 12),
        "Spine": (6, 0, 10),
        "Chest": (10, 0, 14),
        "Head": (-10, 0, -16),
        "UpperArm_L": (28, 16, -16),
        "Forearm_L": (48, 12, -20),
        "Shoulder_R": (0, 0, 12),
        "UpperArm_R": (88, -14, 14),
        "Forearm_R": (34, -12, 14),
        "Hand_R": (10, -10, -10),
        "Thigh_L": (-12, 8, 4),
        "Shin_L": (20, 0, 0),
        "Foot_L": (-8, -8, 0),
        "Thigh_R": (-12, -8, -4),
        "Shin_R": (20, 0, 0),
        "Foot_R": (-8, 8, 0),
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

    # 8. celebrate (1.00 s = 100 frames loop): Joyful wide V-victory jump!
    # Arms open OUTWARD & UPWARD (never crossing overhead, zero racquet-head clipping, zero armpit spikes!)
    cel_dip = {
        "Hips": (-8, 0, 0),
        "Spine": (-8, 0, 0),
        "Chest": (-6, 0, 0),
        "Head": (10, 0, 0),
        "UpperArm_L": (34, 10, -14),
        "Forearm_L": (52, 16, -18),
        "UpperArm_R": (34, -10, 14),
        "Forearm_R": (52, -16, 18),
        "Thigh_L": (-32, 8, 6),
        "Shin_L": (54, 0, 0),
        "Foot_L": (-20, -8, 0),
        "Thigh_R": (-32, -8, -6),
        "Shin_R": (54, 0, 0),
        "Foot_R": (-20, 8, 0),
    }
    cel_peak = {
        "Hips": (4, 0, -4),
        "Spine": (8, 0, 0),
        "Chest": (10, 0, 4),
        "Head": (14, 0, -4),
        "Shoulder_L": (0, 22, 0),
        "UpperArm_L": (22, 74, -14),   # Open outward-up ~40° away from head!
        "Forearm_L": (38, 12, -14),
        "Shoulder_R": (0, -22, 0),
        "UpperArm_R": (18, -50, 8),    # Open outward-up ~40° away from head, racquet points skyward on +X!
        "Forearm_R": (12, -38, -4),
        "Hand_R": (-8, -32, -16),
        "Thigh_L": (-12, 10, 8),
        "Shin_L": (28, 0, 0),
        "Foot_L": (14, -10, 0),
        "Thigh_R": (-12, -10, -8),
        "Shin_R": (28, 0, 0),
        "Foot_R": (14, 10, 0),
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
