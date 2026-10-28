#!/usr/bin/env python3
"""
Bake a moving body into VOID: a 4D clip, and a time sculpture made from it.

A 4D clip is a sequence of point sets over time. This script writes it as one
binary little-endian PLY (a "4D PLY"), and from the same clip a static time
sculpture that the VOID of today can load as an ordinary point cloud.

The 4D PLY:

    comment v4d clip fps=30 frames=90 duration=3.0
    element vertex N
    property float x / y / z
    property uchar red / green / blue
    property float t        seconds; frame f sits at t = f / fps
    property int id         a stable identity for a body point across frames

A reader that knows nothing of t and id sees every moment at once: the whole
clip as one point cloud.

Inputs (one of):
    --synthetic walker|firebrand|dancer   procedural clips with true ids; no ML
    --frames "<dir>/*.ply"                per-frame point clouds (e.g. Record3D);
                                          ids from nearest-neighbour chaining
    --video clip.mp4                      optional ML path (requirements-ml.txt):
                                          subject mask + monocular depth
    --clip name.clip.ply                  re-bake a clip this script wrote

Sculpture modes (--mode):
    sculpt     every frame at once, sheared through time: x += k * t
    echo       every Nth frame, the older ones sparser and darker
    strobe     a comb of frames, all alike
    slit       a thin slab of space per frame, stacked along the motion axis
    firebrand  one point's path through an exposure window, as a line of light

Core needs Python 3.11 and numpy; --frames also needs scipy.
Run with --help for every option.
"""

from __future__ import annotations

import argparse
import glob as globlib
import math
import os
import re
import sys
from dataclasses import dataclass, field
from typing import Callable

import numpy as np

# VOID keeps a dropped source across reloads up to 64 MB (IndexedDB). A clip
# past this is still readable, but heavy to drop, store and restore.
SIZE_WARN_BYTES = 25 * 1024 * 1024


# --------------------------------------------------------------------------
# The clip
# --------------------------------------------------------------------------


@dataclass
class Clip:
    """F frames; frame f holds n_f points (equal n when ids are tracked)."""

    fps: float
    positions: list[np.ndarray]  # each (n_f, 3) float32
    colors: list[np.ndarray]  # each (n_f, 3) uint8
    ids: list[np.ndarray]  # each (n_f,) int32
    name: str = "clip"
    notes: list[str] = field(default_factory=list)

    @property
    def frames(self) -> int:
        return len(self.positions)

    @property
    def duration(self) -> float:
        return self.frames / self.fps

    def time(self, f: int) -> float:
        return f / self.fps

    @property
    def tracked(self) -> bool:
        """Every frame holds the same ids in the same order."""
        first = self.ids[0]
        return all(len(i) == len(first) and np.array_equal(i, first) for i in self.ids)


# --------------------------------------------------------------------------
# PLY in and out
# --------------------------------------------------------------------------

_PLY_TYPES = {
    "char": "i1", "int8": "i1", "uchar": "u1", "uint8": "u1",
    "short": "i2", "int16": "i2", "ushort": "u2", "uint16": "u2",
    "int": "i4", "int32": "i4", "uint": "u4", "uint32": "u4",
    "float": "f4", "float32": "f4", "double": "f8", "float64": "f8",
}


def write_ply(path: str, xyz: np.ndarray, rgb: np.ndarray, t: np.ndarray | None = None,
              ids: np.ndarray | None = None, comments: list[str] | None = None) -> int:
    """Binary little-endian PLY; t and id are written only when given. Returns bytes."""
    n = len(xyz)
    fields = [("x", "<f4"), ("y", "<f4"), ("z", "<f4"),
              ("red", "u1"), ("green", "u1"), ("blue", "u1")]
    if t is not None:
        fields.append(("t", "<f4"))
    if ids is not None:
        fields.append(("id", "<i4"))
    rec = np.empty(n, dtype=fields)
    rec["x"], rec["y"], rec["z"] = xyz[:, 0], xyz[:, 1], xyz[:, 2]
    rec["red"], rec["green"], rec["blue"] = rgb[:, 0], rgb[:, 1], rgb[:, 2]
    if t is not None:
        rec["t"] = t
    if ids is not None:
        rec["id"] = ids
    names = {"<f4": "float", "u1": "uchar", "<i4": "int"}
    header = ["ply", "format binary_little_endian 1.0"]
    header += [f"comment {c}" for c in (comments or [])]
    header.append(f"element vertex {n}")
    header += [f"property {names[dt]} {name}" for name, dt in fields]
    header.append("end_header")
    os.makedirs(os.path.dirname(os.path.abspath(path)), exist_ok=True)
    with open(path, "wb") as fh:
        fh.write(("\n".join(header) + "\n").encode("ascii"))
        fh.write(rec.tobytes())
    return os.path.getsize(path)


def read_ply(path: str) -> tuple[dict[str, np.ndarray], list[str]]:
    """The vertex element of an ASCII or binary PLY, as named columns, plus its comments."""
    with open(path, "rb") as fh:
        data = fh.read()
    end = data.find(b"end_header")
    if not data.startswith(b"ply") or end < 0:
        raise ValueError(f"{path}: not a PLY file")
    nl = data.find(b"\n", end)
    body = data[nl + 1:]
    fmt = None
    comments: list[str] = []
    elements: list[tuple[str, int, list[tuple[str, str, str | None]]]] = []
    for line in data[:end].decode("latin1").splitlines()[1:]:
        tok = line.split()
        if not tok:
            continue
        if tok[0] == "format":
            fmt = tok[1]
        elif tok[0] == "comment":
            comments.append(line[len("comment"):].strip())
        elif tok[0] == "element":
            elements.append((tok[1], int(tok[2]), []))
        elif tok[0] == "property":
            if tok[1] == "list":
                elements[-1][2].append((tok[4], tok[3], tok[2]))
            else:
                elements[-1][2].append((tok[2], tok[1], None))
    if not elements or elements[0][0] != "vertex":
        raise ValueError(f"{path}: the first element must be 'vertex'")
    _, count, props = elements[0]
    if any(p[2] is not None for p in props):
        raise ValueError(f"{path}: list properties on vertices are not supported")
    if fmt == "ascii":
        rows = body.decode("latin1").split("\n")[:count]
        table = np.array([r.split()[:len(props)] for r in rows], dtype=np.float64)
        cols = {name: table[:, k] for k, (name, _, _) in enumerate(props)}
    elif fmt in ("binary_little_endian", "binary_big_endian"):
        order = "<" if fmt == "binary_little_endian" else ">"
        dtype = np.dtype([(name, order + _PLY_TYPES[ty]) for name, ty, _ in props])
        rec = np.frombuffer(body, dtype=dtype, count=count)
        cols = {name: rec[name].astype(np.float64) for name, _, _ in props}
    else:
        raise ValueError(f"{path}: unknown PLY format {fmt}")
    return cols, comments


def ply_points(cols: dict[str, np.ndarray]) -> tuple[np.ndarray, np.ndarray]:
    """xyz float32 and rgb uint8 (a neutral grey when the cloud has no colour)."""
    xyz = np.stack([cols["x"], cols["y"], cols["z"]], axis=1).astype(np.float32)
    if all(c in cols for c in ("red", "green", "blue")):
        rgb = np.stack([cols["red"], cols["green"], cols["blue"]], axis=1)
        if rgb.max(initial=0) <= 1.0:
            rgb = rgb * 255.0
        rgb = np.clip(rgb, 0, 255).astype(np.uint8)
    else:
        rgb = np.full((len(xyz), 3), 180, dtype=np.uint8)
    return xyz, rgb


def clip_comment(clip: Clip) -> str:
    return f"v4d clip fps={clip.fps:g} frames={clip.frames} duration={clip.duration:.3f}"


def write_clip(path: str, clip: Clip) -> int:
    t = np.concatenate([np.full(len(p), clip.time(f), np.float32) for f, p in enumerate(clip.positions)])
    return write_ply(
        path,
        np.concatenate(clip.positions),
        np.concatenate(clip.colors),
        t=t,
        ids=np.concatenate(clip.ids),
        comments=[clip_comment(clip), "made by VOID scripts/bake/bake_time_sculpture.py"] + clip.notes,
    )


def read_clip(path: str) -> Clip:
    cols, comments = read_ply(path)
    if "t" not in cols:
        raise ValueError(f"{path}: no 't' property - not a 4D clip")
    fps = None
    for c in comments:
        m = re.search(r"\bfps=([0-9.]+)", c)
        if c.startswith("v4d clip") and m:
            fps = float(m.group(1))
    xyz, rgb = ply_points(cols)
    t = cols["t"]
    times = np.unique(t)
    if fps is None:
        fps = 1.0 / float(np.median(np.diff(times))) if len(times) > 1 else 30.0
    ids = cols["id"].astype(np.int32) if "id" in cols else np.arange(len(t), dtype=np.int32)
    clip = Clip(fps=fps, positions=[], colors=[], ids=[],
                name=os.path.basename(path).split(".")[0])
    for tv in times:
        sel = np.nonzero(t == tv)[0]
        sel = sel[np.argsort(ids[sel], kind="stable")]
        clip.positions.append(xyz[sel])
        clip.colors.append(rgb[sel])
        clip.ids.append(ids[sel])
    return clip


# --------------------------------------------------------------------------
# Synthetic bodies: true ids, no ML
# --------------------------------------------------------------------------


def _unit(v: np.ndarray) -> np.ndarray:
    return v / np.maximum(np.linalg.norm(v, axis=-1, keepdims=True), 1e-9)


def _shade(normals: np.ndarray, base: float = 1.0) -> np.ndarray:
    """VOID's monochrome model fallback: light from above and the front."""
    n = _unit(normals)
    s = 0.38 + 0.42 * (n[:, 1] * 0.5 + 0.5) + 0.1 * (n[:, 2] * 0.5 + 0.5)
    s = np.clip(s * base, 0.12, 1.0)
    return np.clip(np.stack([s, s, s * 1.03], axis=1) * 255, 0, 255).astype(np.uint8)


@dataclass
class _Segment:
    """A capsule from joint a to joint b, sampled at fixed (u, angle) per point."""

    a: str
    b: str
    radius: float
    ref: tuple[float, float, float]  # a direction never parallel to the bone
    area_weight: float = 1.0
    squash: tuple[float, float] = (1.0, 1.0)  # radii along the two frame axes


def _body_points(segments: list[_Segment], sphere_r: float, n: int, rng: np.random.Generator):
    """Assign n ids to segments (by area) plus one head sphere, with fixed local coordinates."""
    areas = [2 * math.pi * s.radius * s.area_weight for s in segments]
    areas.append(4 * math.pi * sphere_r ** 2 * 2.2)
    p = np.array(areas) / sum(areas)
    owner = rng.choice(len(areas), size=n, p=p)
    owner.sort(kind="stable")
    u = rng.random(n)
    ang = rng.random(n) * 2 * math.pi
    dirs = _unit(rng.normal(size=(n, 3)))
    return owner, u, ang, dirs


def _pose_points(joints: dict[str, np.ndarray], segments: list[_Segment], head: tuple[str, float],
                 owner, u, ang, dirs) -> tuple[np.ndarray, np.ndarray]:
    n = len(owner)
    pos = np.zeros((n, 3), np.float32)
    nrm = np.zeros((n, 3), np.float32)
    for k, s in enumerate(segments):
        sel = owner == k
        if not sel.any():
            continue
        a, b = joints[s.a], joints[s.b]
        d = b - a
        e1 = _unit(np.cross(d, np.array(s.ref)))
        e2 = _unit(np.cross(_unit(d), e1))
        c, si = np.cos(ang[sel])[:, None], np.sin(ang[sel])[:, None]
        # A slight taper: limbs are thicker at the near joint.
        taper = (1.0 - 0.18 * u[sel])[:, None]
        radial = c * e1 * s.squash[0] + si * e2 * s.squash[1]
        pos[sel] = a + u[sel][:, None] * d + s.radius * taper * radial
        nrm[sel] = radial
    sel = owner == len(segments)
    centre, r = joints[head[0]], head[1]
    pos[sel] = centre + r * dirs[sel] * np.array([0.9, 1.08, 0.95])
    nrm[sel] = dirs[sel]
    return pos, nrm


def _rot_y(v: np.ndarray, angle: float) -> np.ndarray:
    c, s = math.cos(angle), math.sin(angle)
    out = v.copy()
    out[..., 0] = c * v[..., 0] + s * v[..., 2]
    out[..., 2] = -s * v[..., 0] + c * v[..., 2]
    return out


def _limb(origin, angle, length) -> np.ndarray:
    """A joint `length` from origin, `angle` from straight down, in the x-y plane."""
    return origin + length * np.array([math.sin(angle), -math.cos(angle), 0.0])


Z = (0.0, 0.0, 1.0)
X = (1.0, 0.0, 0.0)


def _walker_joints(t: float) -> dict[str, np.ndarray]:
    speed, period = 1.25, 1.1
    phi = 2 * math.pi * t / period
    pelvis = np.array([speed * t, 0.95 + 0.028 * math.cos(2 * phi), 0.0])
    j: dict[str, np.ndarray] = {"pelvis": pelvis}
    neck = pelvis + np.array([0.06, 0.55, 0.0])
    j["neck"] = neck
    j["head"] = neck + np.array([0.03, 0.2, 0.0])
    for side, sign, ph in (("l", 1.0, phi), ("r", -1.0, phi + math.pi)):
        hip = pelvis + np.array([0.0, -0.02, 0.1 * sign])
        hip_a = 0.42 * math.sin(ph)
        knee_flex = 0.08 + 0.75 * max(0.0, math.cos(ph - 0.35)) ** 1.6
        knee = _limb(hip, hip_a, 0.46)
        ankle = _limb(knee, hip_a - knee_flex, 0.45)
        toe = ankle + 0.2 * np.array([math.cos(0.4 * (hip_a - knee_flex)), math.sin(0.4 * (hip_a - knee_flex)) - 0.15, 0.0])
        shoulder = neck + np.array([-0.02, -0.06, 0.19 * sign])
        arm_a = -0.38 * math.sin(ph)
        elbow = _limb(shoulder, arm_a, 0.3)
        wrist = _limb(elbow, arm_a + 0.25 + 0.2 * max(0.0, -math.sin(ph)), 0.26)
        hand = _limb(wrist, arm_a + 0.4, 0.09)
        j.update({f"hip_{side}": hip, f"knee_{side}": knee, f"ankle_{side}": ankle, f"toe_{side}": toe,
                  f"shoulder_{side}": shoulder, f"elbow_{side}": elbow, f"wrist_{side}": wrist,
                  f"hand_{side}": hand})
    return j


def _walker_segments() -> list[_Segment]:
    segs = [
        _Segment("pelvis", "neck", 0.16, Z, 2.6, (0.62, 1.0)),
        _Segment("neck", "head", 0.05, Z, 0.4),
    ]
    for s in ("l", "r"):
        segs += [
            _Segment(f"hip_{s}", f"knee_{s}", 0.075, Z, 1.4),
            _Segment(f"knee_{s}", f"ankle_{s}", 0.055, Z, 1.2),
            _Segment(f"ankle_{s}", f"toe_{s}", 0.04, Z, 0.5),
            _Segment(f"shoulder_{s}", f"elbow_{s}", 0.045, Z, 0.8),
            _Segment(f"elbow_{s}", f"wrist_{s}", 0.037, Z, 0.7),
            _Segment(f"wrist_{s}", f"hand_{s}", 0.03, Z, 0.3),
        ]
    return segs


def _dancer_joints(t: float) -> tuple[dict[str, np.ndarray], float]:
    turn = 2 * math.pi * 0.45 * t + 0.4 * math.sin(2 * math.pi * t / 3.0)
    plie = 0.06 * (0.5 - 0.5 * math.cos(2 * math.pi * t / 1.5))
    pelvis = np.array([0.0, 1.0 - plie, 0.0])
    j: dict[str, np.ndarray] = {"pelvis": pelvis}
    neck = pelvis + np.array([0.0, 0.56, 0.0])
    j["neck"] = neck
    j["head"] = neck + np.array([0.0, 0.2, 0.02])
    for side, sign in (("l", 1.0), ("r", -1.0)):
        hip = pelvis + np.array([0.0, -0.02, 0.09 * sign])
        lift = max(0.0, math.sin(2 * math.pi * t / 1.5 + (0 if sign > 0 else math.pi))) ** 2
        knee = hip + np.array([0.35 * lift, -0.46 * (1 - 0.45 * lift), 0.04 * sign])
        ankle = knee + np.array([-0.12 * lift, -0.45 * (1 - 0.3 * lift), 0.02 * sign])
        toe = ankle + np.array([0.18, -0.03, 0.0])
        shoulder = neck + np.array([0.0, -0.06, 0.19 * sign])
        wave = 0.35 * math.sin(2 * math.pi * t / 1.0 + (0 if sign > 0 else 1.3))
        up = 0.25 + wave
        elbow = shoulder + 0.3 * np.array([0.05, math.sin(up), math.cos(up) * sign])
        up2 = up + 0.35 * math.sin(2 * math.pi * t / 1.0 + 0.8)
        wrist = elbow + 0.27 * np.array([0.08, math.sin(up2), math.cos(up2) * sign])
        hand = wrist + 0.09 * np.array([0.1, math.sin(up2 + 0.3), math.cos(up2 + 0.3) * sign])
        j.update({f"hip_{side}": hip, f"knee_{side}": knee, f"ankle_{side}": ankle, f"toe_{side}": toe,
                  f"shoulder_{side}": shoulder, f"elbow_{side}": elbow, f"wrist_{side}": wrist,
                  f"hand_{side}": hand})
    return j, turn


def _dancer_segments() -> list[_Segment]:
    segs = [
        _Segment("pelvis", "neck", 0.15, Z, 2.4, (0.65, 1.0)),
        _Segment("neck", "head", 0.05, Z, 0.4),
    ]
    for s in ("l", "r"):
        segs += [
            _Segment(f"hip_{s}", f"knee_{s}", 0.07, Z, 1.2),
            _Segment(f"knee_{s}", f"ankle_{s}", 0.05, Z, 1.0),
            _Segment(f"ankle_{s}", f"toe_{s}", 0.035, Z, 0.4),
            _Segment(f"shoulder_{s}", f"elbow_{s}", 0.042, X, 0.8),
            _Segment(f"elbow_{s}", f"wrist_{s}", 0.035, X, 0.7),
            _Segment(f"wrist_{s}", f"hand_{s}", 0.028, X, 0.3),
        ]
    return segs


def synth_walker(frames: int, fps: float, n: int, seed: int) -> Clip:
    rng = np.random.default_rng(seed)
    segs = _walker_segments()
    owner, u, ang, dirs = _body_points(segs, 0.11, n, rng)
    clip = Clip(fps=fps, positions=[], colors=[], ids=[], name="walker",
                notes=["synthetic walker: a figure walking along +x, y up, metres"])
    ids = np.arange(n, dtype=np.int32)
    for f in range(frames):
        pos, nrm = _pose_points(_walker_joints(f / fps), segs, ("head", 0.11), owner, u, ang, dirs)
        clip.positions.append(pos)
        clip.colors.append(_shade(nrm))
        clip.ids.append(ids)
    return clip


def synth_dancer(frames: int, fps: float, n: int, seed: int) -> Clip:
    rng = np.random.default_rng(seed)
    segs = _dancer_segments()
    n_skirt = n // 4
    n_body = n - n_skirt
    owner, u, ang, dirs = _body_points(segs, 0.11, n_body, rng)
    su = rng.random(n_skirt) ** 0.8
    sa = rng.random(n_skirt) * 2 * math.pi
    clip = Clip(fps=fps, positions=[], colors=[], ids=[], name="dancer",
                notes=["synthetic dancer: a figure turning in place with a flared skirt, y up, metres"])
    ids = np.arange(n, dtype=np.int32)
    for f in range(frames):
        t = f / fps
        joints, turn = _dancer_joints(t)
        pos, nrm = _pose_points(joints, segs, ("head", 0.11), owner, u, ang, dirs)
        # The skirt flares with the turn and ripples against it.
        waist = joints["pelvis"] + np.array([0.0, 0.08, 0.0])
        hem = 0.2 + (0.3 + 0.05 * np.sin(5 * sa - 3 * turn)) * su
        drop = 0.55 * su * (1 - 0.35 * su)
        sk = np.stack([np.cos(sa) * hem, -drop, np.sin(sa) * hem], axis=1) + waist
        skn = np.stack([np.cos(sa), 0.6 * np.ones_like(sa), np.sin(sa)], axis=1)
        pos = np.concatenate([pos, sk.astype(np.float32)])
        nrm = np.concatenate([nrm, skn.astype(np.float32)])
        pos = _rot_y(pos, turn)
        nrm = _rot_y(nrm, turn)
        clip.positions.append(pos.astype(np.float32))
        clip.colors.append(_shade(nrm))
        clip.ids.append(ids)
    return clip


def synth_firebrand(frames: int, fps: float, n: int, seed: int) -> Clip:
    """A burning stick swung through the dark: a dim rod, a bright flame trailing its tip."""
    rng = np.random.default_rng(seed)
    n_rod = n // 5
    n_flame = n - n_rod
    rod_u = rng.random(n_rod)
    rod_a = rng.random(n_rod) * 2 * math.pi
    fl_dir = _unit(rng.normal(size=(n_flame, 3)))
    fl_r = rng.random(n_flame) ** 0.6
    fl_phase = rng.random(n_flame) * 2 * math.pi
    fl_trail = rng.random(n_flame) ** 2
    omega = 2 * math.pi / 1.6

    def tip_at(t: float) -> np.ndarray:
        return np.array([0.65 * math.sin(omega * t), 1.45 + 0.42 * math.sin(2 * omega * t),
                         0.3 * math.cos(omega * t)])

    clip = Clip(fps=fps, positions=[], colors=[], ids=[], name="firebrand",
                notes=["synthetic firebrand: a burning stick swung in a figure of eight, y up, metres"])
    ids = np.arange(n, dtype=np.int32)
    for f in range(frames):
        t = f / fps
        tip = tip_at(t)
        vel = (tip_at(t + 1e-3) - tip) / 1e-3
        hand = np.array([0.2 * math.sin(omega * t), 1.05 + 0.08 * math.sin(2 * omega * t), 0.15])
        d = tip - hand
        e1 = _unit(np.cross(d, np.array(Z)))
        e2 = _unit(np.cross(_unit(d), e1))
        rod = hand + rod_u[:, None] * d + 0.018 * (np.cos(rod_a)[:, None] * e1 + np.sin(rod_a)[:, None] * e2)
        flicker = 1 + 0.18 * np.sin(17 * t + fl_phase)
        flame = tip + (0.07 * fl_r * flicker)[:, None] * fl_dir \
            - 0.05 * fl_trail[:, None] * vel + np.array([0.0, 0.04, 0.0]) * fl_r[:, None]
        heat = np.clip(1.0 - 0.55 * fl_r - 0.35 * fl_trail, 0.25, 1.0)
        fc = np.clip(np.stack([heat, heat, heat], axis=1) * 255, 0, 255).astype(np.uint8)
        rc = np.full((n_rod, 3), 70, np.uint8)
        clip.positions.append(np.concatenate([rod, flame]).astype(np.float32))
        clip.colors.append(np.concatenate([rc, fc]))
        clip.ids.append(ids)
    return clip


SYNTHETIC: dict[str, Callable[[int, float, int, int], Clip]] = {
    "walker": synth_walker,
    "dancer": synth_dancer,
    "firebrand": synth_firebrand,
}


# --------------------------------------------------------------------------
# Correspondence for clouds that carry no ids: nearest-neighbour chaining
# --------------------------------------------------------------------------


def chain_ids(clouds: list[tuple[np.ndarray, np.ndarray]], n: int, seed: int, k: int = 8) -> Clip:
    """
    Follow n points through per-frame clouds that know nothing of each other.

    Frame 0 is sampled (seeded); each later frame takes, for every track, the
    nearest unclaimed point to where the track is predicted to be (constant
    velocity). Claims are settled closest-first in k rounds, so two tracks
    rarely collapse onto one point; a track with no free neighbour shares.
    """
    from scipy.spatial import cKDTree  # scipy only for this path

    rng = np.random.default_rng(seed)
    xyz0, rgb0 = clouds[0]
    pick = rng.choice(len(xyz0), size=n, replace=len(xyz0) < n)
    cur = xyz0[pick].astype(np.float64)
    prev = cur.copy()
    positions = [cur.astype(np.float32)]
    colors = [rgb0[pick]]
    for xyz, rgb in clouds[1:]:
        m = len(xyz)
        kk = min(k, m)
        tree = cKDTree(xyz)
        dist, idx = tree.query(cur + (cur - prev), k=kk)
        if kk == 1:
            dist, idx = dist[:, None], idx[:, None]
        assigned = np.full(n, -1, np.int64)
        claimed = np.zeros(m, bool)
        for r in range(kk):
            pending = np.nonzero(assigned < 0)[0]
            if len(pending) == 0:
                break
            c = idx[pending, r]
            d = dist[pending, r]
            free = ~claimed[c]
            pending, c, d = pending[free], c[free], d[free]
            order = np.lexsort((d, c))
            cs = c[order]
            first = np.ones(len(cs), bool)
            first[1:] = cs[1:] != cs[:-1]
            winners = pending[order][first]
            assigned[winners] = cs[first]
            claimed[cs[first]] = True
        lost = assigned < 0
        assigned[lost] = idx[lost, 0]
        prev = cur
        cur = xyz[assigned].astype(np.float64)
        positions.append(cur.astype(np.float32))
        colors.append(rgb[assigned])
    ids = np.arange(n, dtype=np.int32)
    return Clip(fps=30.0, positions=positions, colors=colors, ids=[ids] * len(positions))


def load_frames(pattern: str, n: int, fps: float, seed: int, max_frames: int) -> Clip:
    paths = sorted(globlib.glob(pattern))
    if not paths:
        raise SystemExit(f"no files match {pattern}")
    paths = paths[:max_frames]
    clouds = [ply_points(read_ply(p)[0]) for p in paths]
    clip = chain_ids(clouds, n, seed)
    clip.fps = fps
    clip.name = os.path.basename(os.path.dirname(os.path.abspath(paths[0]))) or "frames"
    clip.notes.append(f"from {len(paths)} frame clouds; ids by nearest-neighbour chaining")
    return clip


# --------------------------------------------------------------------------
# The optional ML path: a video becomes a moving point cloud
# --------------------------------------------------------------------------


def _video_frames(path: str, fps: float, max_frames: int, width: int) -> list[np.ndarray]:
    """RGB frames (H, W, 3) uint8, resampled to fps and scaled to `width`."""
    import cv2  # opencv-python, from requirements-ml.txt

    cap = cv2.VideoCapture(path)
    if not cap.isOpened():
        raise SystemExit(f"cannot open {path}")
    src_fps = cap.get(cv2.CAP_PROP_FPS) or fps
    step = src_fps / fps
    frames: list[np.ndarray] = []
    i, nxt = 0, 0.0
    while len(frames) < max_frames:
        ok, bgr = cap.read()
        if not ok:
            break
        if i >= nxt - 1e-6:
            h, w = bgr.shape[:2]
            s = width / w
            bgr = cv2.resize(bgr, (width, max(1, round(h * s))), interpolation=cv2.INTER_AREA)
            frames.append(bgr[:, :, ::-1].copy())
            nxt += step
        i += 1
    cap.release()
    return frames


def _torch_device() -> tuple[int, str]:
    try:
        import torch

        if torch.cuda.is_available():
            return 0, f"CUDA ({torch.cuda.get_device_name(0)})"
    except ImportError:
        pass
    return -1, "CPU"


def _mask_fn(kind: str) -> Callable[[np.ndarray], np.ndarray]:
    """The subject's mask for one frame: bool (H, W)."""
    if kind == "sam":
        from ultralytics import SAM

        model = SAM("sam2.1_b.pt")

        def sam_mask(rgb: np.ndarray) -> np.ndarray:
            h, w = rgb.shape[:2]
            res = model(rgb, points=[[w // 2, h // 2]], labels=[1], verbose=False)
            masks = res[0].masks
            if masks is None:
                return np.zeros((h, w), bool)
            return masks.data[0].cpu().numpy().astype(bool)

        return sam_mask

    from PIL import Image
    from rembg import new_session, remove

    session = new_session("u2net_human_seg")

    def rembg_mask(rgb: np.ndarray) -> np.ndarray:
        m = remove(Image.fromarray(rgb), only_mask=True, session=session)
        return np.asarray(m) > 127

    return rembg_mask


def _depth_fn(device: int) -> Callable[[np.ndarray], np.ndarray]:
    """Relative inverse depth (bigger is nearer) for one frame: float (H, W)."""
    from PIL import Image
    from transformers import pipeline

    pipe = pipeline("depth-estimation", model="depth-anything/Depth-Anything-V2-Small-hf", device=device)

    def depth(rgb: np.ndarray) -> np.ndarray:
        h, w = rgb.shape[:2]
        out = pipe(Image.fromarray(rgb))
        pred = out["predicted_depth"]
        pred = pred.squeeze().cpu().numpy() if hasattr(pred, "cpu") else np.asarray(pred)
        return np.asarray(Image.fromarray(pred.astype(np.float32)).resize((w, h), Image.BILINEAR))

    return depth


def backproject(rgb: np.ndarray, mask: np.ndarray, disparity: np.ndarray, lo: float, hi: float,
                fov_deg: float, near: float, relief: float, n: int, rng: np.random.Generator):
    """n samples of the subject as points: pinhole camera, y up, the subject facing +z."""
    h, w = mask.shape
    vs, us = np.nonzero(mask)
    if len(us) == 0:
        return np.zeros((0, 3), np.float32), np.zeros((0, 3), np.uint8)
    pick = rng.integers(0, len(us), size=n)
    u = us[pick] + rng.random(n)
    v = vs[pick] + rng.random(n)
    d = np.clip((disparity[vs[pick], us[pick]] - lo) / max(hi - lo, 1e-6), 0, 1)
    z = near + (1 - d) * relief
    fx = (w / 2) / math.tan(math.radians(fov_deg) / 2)
    x = (u - w / 2) / fx * z
    y = -(v - h / 2) / fx * z
    xyz = np.stack([x, y, -z], axis=1).astype(np.float32)
    return xyz, rgb[vs[pick], us[pick]].astype(np.uint8)


def load_video(path: str, n: int, fps: float, seed: int, max_frames: int, width: int,
               mask_kind: str, fov: float, near: float, relief: float) -> Clip:
    device, label = _torch_device()
    print(f"video: depth on {label}, mask by {mask_kind}")
    frames = _video_frames(path, fps, max_frames, width)
    if not frames:
        raise SystemExit(f"{path}: no frames could be read")
    mask_of = _mask_fn(mask_kind)
    depth_of = _depth_fn(device)
    masks, disps = [], []
    for k, rgb in enumerate(frames):
        masks.append(mask_of(rgb))
        disps.append(depth_of(rgb))
        print(f"  frame {k + 1}/{len(frames)}", end="\r")
    print()
    # One depth scale for the whole clip, so the body does not breathe in depth.
    inside = np.concatenate([d[m] for d, m in zip(disps, masks) if m.any()] or [np.zeros(1)])
    lo, hi = np.percentile(inside, 2), np.percentile(inside, 98)
    rng = np.random.default_rng(seed)
    clouds = []
    for rgb, m, d in zip(frames, masks, disps):
        xyz, col = backproject(rgb, m, d, lo, hi, fov, near, relief, n * 2, rng)
        if len(xyz) == 0:
            raise SystemExit(f"{path}: a frame has no subject - try --mask sam, or trim the clip")
        clouds.append((xyz, col))
    clip = chain_ids(clouds, n, seed)
    clip.fps = fps
    clip.name = os.path.splitext(os.path.basename(path))[0]
    clip.notes.append(f"from video: mask {mask_kind}, Depth Anything V2 Small, fov {fov:g} deg (assumed)")
    return clip


# --------------------------------------------------------------------------
# Time sculptures
# --------------------------------------------------------------------------


def time_ramp(u: np.ndarray) -> np.ndarray:
    """--color time: the past dim, the present bright (monochrome, VOID's default light)."""
    s = 0.22 + 0.78 * np.clip(u, 0, 1)
    return np.clip(np.stack([s, s, s * 1.03], axis=1) * 255, 0, 255).astype(np.uint8)


def _motion(clip: Clip) -> tuple[int, float, float]:
    """
    The dominant axis of the body's travel, its signed speed, and the path's
    middle on it. A body that stays where it is (it turns, it swings) has no
    travel to speak of: speed 0, axis x.
    """
    c = np.array([p.mean(axis=0) for p in clip.positions])
    travel = c[-1] - c[0]
    size = float(np.ptp(clip.positions[0], axis=0).max())
    axis = int(np.argmax(np.abs(travel)))
    path = float(np.linalg.norm(np.diff(c, axis=0), axis=1).sum())
    # Travel is a path that goes somewhere: long, and mostly straight.
    if abs(travel[axis]) < 0.25 * size or abs(travel[axis]) < 0.6 * path:
        return 0, 0.0, float(np.median(c[:, 0]))
    speed = travel[axis] / max(clip.duration - 1 / clip.fps, 1e-6)
    return axis, float(speed), float(np.median(c[:, axis]))


def _take(rng: np.random.Generator, n: int, keep: float) -> np.ndarray:
    k = int(round(n * max(0.0, min(1.0, keep))))
    return np.sort(rng.choice(n, size=k, replace=False)) if k < n else np.arange(n)


def _per_frame_budget(clip: Clip, frames: list[int], max_points: int) -> float:
    total = sum(len(clip.positions[f]) for f in frames)
    return min(1.0, max_points / max(total, 1))


def _catmull(p0, p1, p2, p3, s):
    s2, s3 = s * s, s * s * s
    return 0.5 * ((2 * p1) + (-p0 + p2) * s + (2 * p0 - 5 * p1 + 4 * p2 - p3) * s2 + (-p0 + 3 * p1 - 3 * p2 + p3) * s3)


def sculpt(clip: Clip, args, rng) -> tuple[np.ndarray, np.ndarray]:
    mode = args.mode
    F = clip.frames
    t_last = clip.time(F - 1)
    xyz_out, rgb_out = [], []

    def emit(f: int, sel: np.ndarray, xyz: np.ndarray, dim: float = 1.0):
        age = (t_last - clip.time(f)) / max(t_last, 1e-6)
        col = time_ramp(np.full(len(sel), 1 - age)) if args.color == "time" else clip.colors[f][sel]
        xyz_out.append(xyz)
        rgb_out.append((col.astype(np.float32) * dim).astype(np.uint8))

    if mode == "sculpt":
        frames = list(range(F))
        keep = _per_frame_budget(clip, frames, args.max_points)
        for f in frames:
            sel = _take(rng, len(clip.positions[f]), keep)
            p = clip.positions[f][sel].copy()
            p[:, args.axis] += args.shear * clip.time(f)
            emit(f, sel, p)
    elif mode in ("echo", "strobe"):
        every = max(1, args.every)
        if mode == "echo":
            frames = list(range(F - 1, -1, -every))[::-1]
        else:
            frames = [f for f in range(F) if (f % every) < max(1, args.width)]
        keep = _per_frame_budget(clip, frames, args.max_points)
        for f in frames:
            age = (t_last - clip.time(f)) / max(t_last, 1e-6)
            if mode == "echo":
                sel = _take(rng, len(clip.positions[f]), keep * (1 - 0.85 * age))
                emit(f, sel, clip.positions[f][sel], dim=1 - 0.72 * age)
            else:
                sel = _take(rng, len(clip.positions[f]), keep)
                emit(f, sel, clip.positions[f][sel])
    elif mode == "slit":
        axis, speed, middle = _motion(clip)
        if args.axis_given:
            axis = args.axis
        size = float(np.ptp(clip.positions[0], axis=0).max())
        # A body in place is swept past the slit instead: its own size over the clip.
        stack = args.slit_speed if args.slit_speed is not None else (speed if speed != 0 else size / clip.duration)
        slab = args.slab if args.slab is not None else max(abs(stack) / clip.fps * 1.2, 0.004 * size)
        x0 = middle if args.slit_at is None else args.slit_at
        t_mid = clip.time(F - 1) / 2
        for f in range(F):
            p = clip.positions[f]
            sel = np.nonzero(np.abs(p[:, axis] - x0) < slab / 2)[0]
            q = p[sel].copy()
            # A photo-finish: across the motion axis, place is time.
            q[:, axis] = x0 + (q[:, axis] - x0) - stack * (clip.time(f) - t_mid)
            emit(f, sel, q)
        total = sum(len(x) for x in xyz_out)
        if total > args.max_points:
            keep = args.max_points / total
            for k in range(len(xyz_out)):
                s = _take(rng, len(xyz_out[k]), keep)
                xyz_out[k], rgb_out[k] = xyz_out[k][s], rgb_out[k][s]
        print(f"slit: axis {'xyz'[axis]}, slab {slab:.4f}, stacked at {stack:.3f} per second")
    elif mode == "firebrand":
        if not clip.tracked:
            raise SystemExit("firebrand needs a clip whose points keep their identity (ids)")
        P = np.stack(clip.positions)  # (F, n, 3)
        if args.point_id is not None:
            hit = np.nonzero(clip.ids[0] == args.point_id)[0]
            if len(hit) == 0:
                raise SystemExit(f"no point with id {args.point_id}")
            i = int(hit[0])
        else:
            # The brand is whatever travels furthest: the longest path in the clip.
            i = int(np.argmax(np.linalg.norm(np.diff(P, axis=0), axis=2).sum(axis=0)))
        path = P[:, i, :]
        t_end = clip.time(F - 1) if args.t_end is None else min(args.t_end, clip.time(F - 1))
        window = max(0.0, min(args.window if args.window is not None else t_end, t_end))
        m = args.max_points if window > 0 else 1
        ts = np.linspace(t_end - window, t_end, m)
        ff = ts * clip.fps
        f1 = np.clip(np.floor(ff).astype(int), 0, F - 1)
        s = (ff - f1)[:, None]
        g = lambda k: path[np.clip(f1 + k, 0, F - 1)]
        pts = _catmull(g(-1), g(0), g(1), g(2), s)
        size = float(np.ptp(P[0], axis=0).max())
        pts = pts + rng.normal(size=pts.shape) * args.radius * size
        u = (ts - (t_end - window)) / max(window, 1e-6)
        if args.color == "time":
            col = time_ramp(u)
        else:
            base = clip.colors[-1][i].astype(np.float32)
            base = base / max(float(base.max()), 1.0) * 255.0  # the brand at full light
            col = np.repeat(base[None, :], len(pts), axis=0).astype(np.uint8)
        print(f"firebrand: point id {int(clip.ids[0][i])}, exposure {window:.2f} s ending at {t_end:.2f} s")
        return pts.astype(np.float32), col
    else:
        raise SystemExit(f"unknown mode {mode}")
    return np.concatenate(xyz_out).astype(np.float32), np.concatenate(rgb_out)


# --------------------------------------------------------------------------
# Command line
# --------------------------------------------------------------------------


def human(nbytes: int) -> str:
    return f"{nbytes / 1048576:.1f} MB" if nbytes >= 1048576 else f"{nbytes / 1024:.0f} kB"


def report(path: str, nbytes: int, points: int) -> None:
    print(f"wrote {path}  {points:,} points  {human(nbytes)}")
    if nbytes > SIZE_WARN_BYTES:
        print(f"  warning: {human(nbytes)} is large. VOID keeps a source across reloads up to 64 MB;"
              " try fewer --points or --frames-count.", file=sys.stderr)


def build_parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    src = p.add_mutually_exclusive_group(required=True)
    src.add_argument("--synthetic", choices=sorted(SYNTHETIC), help="a procedural clip with true ids")
    src.add_argument("--frames", help='per-frame point clouds, a glob such as "scan/*.ply"')
    src.add_argument("--video", help="a video file (needs requirements-ml.txt)")
    src.add_argument("--clip", help="a .clip.ply this script wrote, to bake a different sculpture")
    p.add_argument("--name", help="output name (default: from the input)")
    p.add_argument("--out-dir", default="baked", help="where to write (default: ./baked)")
    p.add_argument("--frames-count", type=int, default=90, help="frames to bake (default 90)")
    p.add_argument("--fps", type=float, default=30.0, help="clip frame rate (default 30)")
    p.add_argument("--points", type=int, default=12000, help="points per frame (default 12000)")
    p.add_argument("--seed", type=int, default=7)
    p.add_argument("--no-clip", action="store_true", help="skip the .clip.ply")
    p.add_argument("--no-sculpture", action="store_true", help="skip the .sculpture.ply")

    s = p.add_argument_group("sculpture")
    s.add_argument("--mode", default="sculpt", choices=["sculpt", "echo", "strobe", "slit", "firebrand"])
    s.add_argument("--color", default="source", choices=["source", "time"])
    s.add_argument("--max-points", type=int, default=150000, help="points in the sculpture (default 150000)")
    s.add_argument("--shear", type=float, default=0.5, help="sculpt: k in x += k*t, units per second (default 0.5)")
    s.add_argument("--axis", default=None, choices=["x", "y", "z"], help="sculpt/slit: the axis (default x; slit finds the motion)")
    s.add_argument("--every", type=int, default=9, help="echo/strobe: every Nth frame (default 9)")
    s.add_argument("--width", type=int, default=1, help="strobe: frames per tooth of the comb (default 1)")
    s.add_argument("--slab", type=float, default=None, help="slit: slab thickness (default: one frame of travel)")
    s.add_argument("--slit-at", type=float, default=None, help="slit: where the slit stands on the axis (default: mid-path)")
    s.add_argument("--slit-speed", type=float, default=None, help="slit: how far the stack moves per second (default: the body's speed)")
    s.add_argument("--window", type=float, default=None, help="firebrand: exposure seconds, 0 to the clip (default: all)")
    s.add_argument("--t-end", type=float, default=None, help="firebrand: when the exposure ends (default: the last frame)")
    s.add_argument("--point-id", type=int, default=None, help="firebrand: which point (default: the one that travels furthest)")
    s.add_argument("--radius", type=float, default=0.004, help="firebrand: line thickness, a fraction of body size")

    v = p.add_argument_group("video (optional ML path)")
    v.add_argument("--mask", default="rembg", choices=["rembg", "sam"])
    v.add_argument("--fov", type=float, default=55.0, help="assumed horizontal field of view, degrees")
    v.add_argument("--near", type=float, default=2.0, help="assumed distance to the nearest part of the subject")
    v.add_argument("--relief", type=float, default=0.6, help="assumed depth range of the subject")
    v.add_argument("--width-px", type=int, default=512, help="frames are scaled to this width")
    return p


def main(argv: list[str] | None = None) -> int:
    args = build_parser().parse_args(argv)
    args.axis_given = args.axis is not None
    args.axis = "xyz".index(args.axis or "x")
    if args.synthetic:
        clip = SYNTHETIC[args.synthetic](args.frames_count, args.fps, args.points, args.seed)
    elif args.frames:
        clip = load_frames(args.frames, args.points, args.fps, args.seed, args.frames_count)
    elif args.video:
        clip = load_video(args.video, args.points, args.fps, args.seed, args.frames_count, args.width_px,
                          args.mask, args.fov, args.near, args.relief)
    else:
        clip = read_clip(args.clip)
    name = args.name or clip.name
    print(f"clip: {clip.frames} frames at {clip.fps:g} fps ({clip.duration:.2f} s), "
          f"{len(clip.positions[0]):,} points a frame, ids {'tracked' if clip.tracked else 'renewed'}")
    if not args.no_clip and not args.clip:
        path = os.path.join(args.out_dir, f"{name}.clip.ply")
        report(path, write_clip(path, clip), sum(len(p) for p in clip.positions))
    if not args.no_sculpture:
        rng = np.random.default_rng(args.seed)
        xyz, rgb = sculpt(clip, args, rng)
        path = os.path.join(args.out_dir, f"{name}.sculpture.ply")
        nbytes = write_ply(path, xyz, rgb, comments=[
            f"time sculpture mode={args.mode} color={args.color} from {clip.frames} frames at {clip.fps:g} fps",
            "made by VOID scripts/bake/bake_time_sculpture.py",
        ])
        report(path, nbytes, len(xyz))
    return 0


if __name__ == "__main__":
    sys.exit(main())
