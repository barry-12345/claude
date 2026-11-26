"""Offline contract verifier for Court 2K V2 tennis_player.glb (CONTRACT.md §4.2).

Run with standard Python 3 or Blender Python:
  python tennis-2k/assets/source/verify_glb.py [path/to/tennis_player.glb]
"""

from __future__ import annotations

import json
import struct
import sys
from pathlib import Path
from typing import Any, Dict, List, Optional, Set, Tuple

DEFAULT_GLB = Path(__file__).resolve().parent.parent.parent / "client" / "public" / "assets" / "models" / "tennis_player.glb"

EXPECTED_BONE_PARENTS: Dict[str, Optional[str]] = {
    "Hips": None,
    "Spine": "Hips",
    "Chest": "Spine",
    "Neck": "Chest",
    "Head": "Neck",
    "HeadgearSocket": "Head",
    "Shoulder_L": "Chest",
    "UpperArm_L": "Shoulder_L",
    "Forearm_L": "UpperArm_L",
    "Hand_L": "Forearm_L",
    "Shoulder_R": "Chest",
    "UpperArm_R": "Shoulder_R",
    "Forearm_R": "UpperArm_R",
    "Hand_R": "Forearm_R",
    "RacquetSocket": "Hand_R",
    "Thigh_L": "Hips",
    "Shin_L": "Thigh_L",
    "Foot_L": "Shin_L",
    "Thigh_R": "Hips",
    "Shin_R": "Thigh_R",
    "Foot_R": "Shin_R",
}

EXPECTED_ATTACHMENTS: Dict[str, str] = {
    "Headgear_Headband": "HeadgearSocket",
    "Headgear_Visor": "HeadgearSocket",
    "Headgear_CapBackwards": "HeadgearSocket",
    "Wristband_L": "Forearm_L",
    "Wristband_R": "Forearm_R",
    "Racquet": "RacquetSocket",
}

REQUIRED_MATERIALS: Set[str] = {
    "Mat_JerseyPrimary",
    "Mat_JerseyAccent",
    "Mat_Shorts",
    "Mat_Skin",
    "Mat_Hair",
    "Mat_Socks",
    "Mat_ShoeUpper",
    "Mat_ShoeSole",
    "Mat_RacquetFrame",
    "Mat_RacquetStrings",
}

REQUIRED_CLIPS: Set[str] = {
    "idle",
    "run",
    "slide",
    "serve_toss",
    "forehand",
    "backhand",
    "lob",
    "celebrate",
}


def load_glb(path: Path) -> Tuple[Dict[str, Any], bytes]:
    data = path.read_bytes()
    magic, version, total_len = struct.unpack_from("<III", data, 0)
    if magic != 0x46546C67 or version != 2:
        raise AssertionError(f"Invalid GLB header: magic={hex(magic)} version={version}")
    offset = 12
    json_chunk = b""
    bin_chunk = b""
    while offset < len(data):
        chunk_len, chunk_type = struct.unpack_from("<II", data, offset)
        offset += 8
        payload = data[offset : offset + chunk_len]
        offset += chunk_len
        if chunk_type == 0x4E4F534A:
            json_chunk = payload
        elif chunk_type == 0x004E4942:
            bin_chunk = payload
    return json.loads(json_chunk.decode("utf-8")), bin_chunk


def compute_node_world_matrices(nodes: List[Dict[str, Any]]) -> List[List[float]]:
    """Compute 4x4 column-major world matrices? We store row-major 4x4 for readability."""
    parent_of: Dict[int, int] = {}
    for idx, n in enumerate(nodes):
        for c in n.get("children", []):
            parent_of[c] = idx

    def mat_mul(a: List[List[float]], b: List[List[float]]) -> List[List[float]]:
        out = [[0.0] * 4 for _ in range(4)]
        for i in range(4):
            for j in range(4):
                out[i][j] = sum(a[i][k] * b[k][j] for k in range(4))
        return out

    def local_mat(n: Dict[str, Any]) -> List[List[float]]:
        if "matrix" in n:
            m = n["matrix"]
            return [[m[r + c * 4] for c in range(4)] for r in range(4)]
        tx, ty, tz = n.get("translation", [0.0, 0.0, 0.0])
        qx, qy, qz, qw = n.get("rotation", [0.0, 0.0, 0.0, 1.0])
        sx, sy, sz = n.get("scale", [1.0, 1.0, 1.0])
        xx, yy, zz = qx * qx, qy * qy, qz * qz
        xy, xz, yz = qx * qy, qx * qz, qy * qz
        wx, wy, wz = qw * qx, qw * qy, qw * qz
        return [
            [(1 - 2 * (yy + zz)) * sx, 2 * (xy - wz) * sy, 2 * (xz + wy) * sz, tx],
            [2 * (xy + wz) * sx, (1 - 2 * (xx + zz)) * sy, 2 * (yz - wx) * sz, ty],
            [2 * (xz - wy) * sx, 2 * (yz + wx) * sy, (1 - 2 * (xx + yy)) * sz, tz],
            [0.0, 0.0, 0.0, 1.0],
        ]

    cache: Dict[int, List[List[float]]] = {}

    def get_world(idx: int) -> List[List[float]]:
        if idx in cache:
            return cache[idx]
        lm = local_mat(nodes[idx])
        if idx in parent_of:
            wm = mat_mul(get_world(parent_of[idx]), lm)
        else:
            wm = lm
        cache[idx] = wm
        return wm

    return [get_world(i) for i in range(len(nodes))]


def transform_pt(m: List[List[float]], pt: Tuple[float, float, float]) -> Tuple[float, float, float]:
    x, y, z = pt
    return (
        m[0][0] * x + m[0][1] * y + m[0][2] * z + m[0][3],
        m[1][0] * x + m[1][1] * y + m[1][2] * z + m[1][3],
        m[2][0] * x + m[2][1] * y + m[2][2] * z + m[2][3],
    )


def accessor_bounds(
    gltf: Dict[str, Any], bin_chunk: bytes, acc_idx: int, world_mat: List[List[float]]
) -> Tuple[Tuple[float, float, float], Tuple[float, float, float]]:
    acc = gltf["accessors"][acc_idx]
    bv = gltf["bufferViews"][acc["bufferView"]]
    offset = bv.get("byteOffset", 0) + acc.get("byteOffset", 0)
    stride = bv.get("byteStride", 12)
    count = acc["count"]
    mn = [1e9, 1e9, 1e9]
    mx = [-1e9, -1e9, -1e9]
    for i in range(count):
        pt = struct.unpack_from("<fff", bin_chunk, offset + i * stride)
        wp = transform_pt(world_mat, pt)
        for k in range(3):
            mn[k] = min(mn[k], wp[k])
            mx[k] = max(mx[k], wp[k])
    return (mn[0], mn[1], mn[2]), (mx[0], mx[1], mx[2])


def mesh_triangles(gltf: Dict[str, Any], mesh_idx: int) -> int:
    total = 0
    for prim in gltf["meshes"][mesh_idx]["primitives"]:
        if "indices" in prim:
            total += gltf["accessors"][prim["indices"]]["count"] // 3
        else:
            pos_acc = prim["attributes"]["POSITION"]
            total += gltf["accessors"][pos_acc]["count"] // 3
    return total


def verify_glb(path: Path) -> Dict[str, Any]:
    if not path.exists():
        raise AssertionError(f"Missing GLB file: {path}")

    size_bytes = path.stat().st_size
    size_kb = size_bytes / 1024.0
    assert size_kb <= 350.0, f"GLB too large: {size_kb:.2f} KB > 350 KB"

    gltf, bin_chunk = load_glb(path)
    nodes = gltf.get("nodes", [])
    meshes = gltf.get("meshes", [])
    materials = gltf.get("materials", [])
    animations = gltf.get("animations", [])
    skins = gltf.get("skins", [])

    name_to_idx = {n.get("name"): i for i, n in enumerate(nodes) if n.get("name")}
    parent_name_of: Dict[str, Optional[str]] = {}
    for i, n in enumerate(nodes):
        for c in n.get("children", []):
            cname = nodes[c].get("name")
            if cname:
                parent_name_of[cname] = n.get("name")

    # 1. Verify 21 bones & exact parent-child hierarchy
    for bone, expected_parent in EXPECTED_BONE_PARENTS.items():
        assert bone in name_to_idx, f"Missing bone node: {bone}"
        if expected_parent is not None:
            actual_parent = parent_name_of.get(bone)
            assert actual_parent == expected_parent, (
                f"Bone {bone} parent mismatch: expected {expected_parent}, got {actual_parent}"
            )

    # 2. Verify at least 1 SkinnedMesh
    skinned_nodes = [n for n in nodes if "skin" in n and "mesh" in n]
    assert len(skinned_nodes) >= 1 and len(skins) >= 1, "No SkinnedMesh found"

    # 3. Verify 6 independent named attachment nodes & parent bones
    for node_name, expected_bone in EXPECTED_ATTACHMENTS.items():
        assert node_name in name_to_idx, f"Missing independent attachment node: {node_name}"
        n = nodes[name_to_idx[node_name]]
        assert "mesh" in n, f"Attachment node {node_name} has no mesh"
        assert "skin" not in n, f"Attachment node {node_name} should be independent, not merged into SkinnedMesh"
        actual_parent = parent_name_of.get(node_name)
        assert actual_parent == expected_bone, (
            f"Attachment {node_name} parent mismatch: expected {expected_bone}, got {actual_parent}"
        )

    # 4. Verify 10 required materials
    mat_names = {m.get("name") for m in materials}
    missing_mats = REQUIRED_MATERIALS - mat_names
    assert not missing_mats, f"Missing required materials: {sorted(missing_mats)}"

    # 5. Verify 8 animations & ZERO scale channels
    anim_names = {a.get("name") for a in animations}
    missing_anims = REQUIRED_CLIPS - anim_names
    assert not missing_anims, f"Missing animation clips: {sorted(missing_anims)}"
    scale_channels: List[Tuple[str, str]] = []
    anim_durations: Dict[str, float] = {}
    for a in animations:
        aname = a.get("name", "")
        max_t = 0.0
        for s in a.get("samplers", []):
            acc = gltf["accessors"][s["input"]]
            if acc.get("max"):
                max_t = max(max_t, float(acc["max"][0]))
        anim_durations[aname] = round(max_t, 4)
        for ch in a.get("channels", []):
            if ch["target"]["path"] == "scale":
                tname = nodes[ch["target"]["node"]].get("name", str(ch["target"]["node"]))
                scale_channels.append((aname, tname))
    assert not scale_channels, f"Forbidden scale animation channels found: {scale_channels}"

    # 6. Triangle counts & draw calls estimate
    tris_by_node: Dict[str, int] = {}
    prims_by_node: Dict[str, int] = {}
    total_file_tris = 0
    for n in nodes:
        if "mesh" in n:
            m_idx = n["mesh"]
            t = mesh_triangles(gltf, m_idx)
            p = len(meshes[m_idx]["primitives"])
            nname = n.get("name", f"mesh_{m_idx}")
            tris_by_node[nname] = t
            prims_by_node[nname] = p
            total_file_tris += t

    assert total_file_tris <= 9000, f"Total file triangles {total_file_tris} > 9000"

    # Worst-case visible archetype: power (Body + Headband + Wristband_L + Wristband_R + Racquet)
    # and serve_volley (Body + Visor + Racquet)
    body_name = skinned_nodes[0].get("name", "Avatar_Body")
    vis_power_tris = (
        tris_by_node[body_name]
        + tris_by_node["Headgear_Headband"]
        + tris_by_node["Wristband_L"]
        + tris_by_node["Wristband_R"]
        + tris_by_node["Racquet"]
    )
    vis_visor_tris = tris_by_node[body_name] + tris_by_node["Headgear_Visor"] + tris_by_node["Racquet"]
    vis_cap_tris = tris_by_node[body_name] + tris_by_node["Headgear_CapBackwards"] + tris_by_node["Racquet"]
    for label, vt in [("power", vis_power_tris), ("serve_volley", vis_visor_tris), ("defender", vis_cap_tris)]:
        assert 3500 <= vt <= 7500, f"Visible tris for {label} = {vt}, expected [3500, 7500]"

    vis_power_dc = (
        prims_by_node[body_name]
        + prims_by_node["Headgear_Headband"]
        + prims_by_node["Wristband_L"]
        + prims_by_node["Wristband_R"]
        + prims_by_node["Racquet"]
    )
    vis_visor_dc = prims_by_node[body_name] + prims_by_node["Headgear_Visor"] + prims_by_node["Racquet"]
    max_vis_dc = max(vis_power_dc, vis_visor_dc)
    assert max_vis_dc <= 18, f"Max visible Draw Calls {max_vis_dc} > 18"

    # 7. World bounding box, height, minY, orientation (-Z front, +X right racquet)
    world_mats = compute_node_world_matrices(nodes)
    # Note: for SkinnedMesh at rest, vertex coords are in mesh node's space (bind pose)
    body_idx = name_to_idx[body_name]
    b_min = [1e9, 1e9, 1e9]
    b_max = [-1e9, -1e9, -1e9]
    for prim in meshes[nodes[body_idx]["mesh"]]["primitives"]:
        mn, mx = accessor_bounds(gltf, bin_chunk, prim["attributes"]["POSITION"], world_mats[body_idx])
        for k in range(3):
            b_min[k] = min(b_min[k], mn[k])
            b_max[k] = max(b_max[k], mx[k])

    height_m = b_max[1] - b_min[1]
    min_y = b_min[1]
    assert abs(min_y) <= 0.01, f"|minY| = {abs(min_y):.4f} > 0.01 m"
    assert 1.75 <= height_m <= 1.82, f"Character height {height_m:.4f} m outside [1.75, 1.82]"

    # Orientation checks via attachment bounds in world space
    def node_bounds(nname: str) -> Tuple[Tuple[float, float, float], Tuple[float, float, float]]:
        idx = name_to_idx[nname]
        mn_out = [1e9, 1e9, 1e9]
        mx_out = [-1e9, -1e9, -1e9]
        for prim in meshes[nodes[idx]["mesh"]]["primitives"]:
            mn, mx = accessor_bounds(gltf, bin_chunk, prim["attributes"]["POSITION"], world_mats[idx])
            for k in range(3):
                mn_out[k] = min(mn_out[k], mn[k])
                mx_out[k] = max(mx_out[k], mx[k])
        return tuple(mn_out), tuple(mx_out)  # type: ignore

    visor_mn, visor_mx = node_bounds("Headgear_Visor")
    cap_mn, cap_mx = node_bounds("Headgear_CapBackwards")
    rac_mn, rac_mx = node_bounds("Racquet")
    rac_center_x = 0.5 * (rac_mn[0] + rac_mx[0])

    # Visor brim extends forward (-Z), CapBackwards brim extends backward (+Z), Racquet on +X
    assert visor_mn[2] < -0.15, f"Visor should extend forward (-Z < -0.15), got minZ={visor_mn[2]:.3f}"
    assert cap_mx[2] > 0.15, f"CapBackwards should extend backward (+Z > 0.15), got maxZ={cap_mx[2]:.3f}"
    assert rac_center_x > 0.40, f"Racquet should be on right side (+X > 0.40), got centerX={rac_center_x:.3f}"

    return {
        "file_kb": round(size_kb, 2),
        "bones_count": len(EXPECTED_BONE_PARENTS),
        "attachments_count": len(EXPECTED_ATTACHMENTS),
        "materials_total": len(materials),
        "required_materials_present": len(REQUIRED_MATERIALS),
        "animations": anim_durations,
        "scale_channels_count": len(scale_channels),
        "total_file_tris": total_file_tris,
        "tris_by_node": tris_by_node,
        "visible_tris": {
            "power": vis_power_tris,
            "allcourt": tris_by_node[body_name] + tris_by_node["Wristband_L"] + tris_by_node["Wristband_R"] + tris_by_node["Racquet"],
            "serve_volley": vis_visor_tris,
            "defender": vis_cap_tris,
        },
        "max_visible_draw_calls": max_vis_dc,
        "prims_by_node": prims_by_node,
        "height_m": round(height_m, 4),
        "min_y_m": round(min_y, 5),
        "visor_min_z": round(visor_mn[2], 4),
        "cap_max_z": round(cap_mx[2], 4),
        "racquet_center_x": round(rac_center_x, 4),
    }


if __name__ == "__main__":
    target = Path(sys.argv[1]).resolve() if len(sys.argv) > 1 else DEFAULT_GLB
    report = verify_glb(target)
    print(json.dumps(report, indent=2))
    print("VERIFY_GLB: ALL CONTRACT CHECKS PASSED")
