"""
Tests for bake_time_sculpture.py. numpy (and scipy for chaining) only; the
video path runs on a mocked 3-frame input, so no model is ever downloaded.

    python -m unittest discover -s scripts/bake
"""

import os
import sys
import tempfile
import unittest

import numpy as np

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import bake_time_sculpture as bake  # noqa: E402


def small(name="walker", frames=12, n=600):
    return bake.SYNTHETIC[name](frames, 12.0, n, 3)


class ClipFormat(unittest.TestCase):
    def test_round_trip_keeps_t_id_and_header(self):
        clip = small()
        with tempfile.TemporaryDirectory() as d:
            path = os.path.join(d, "w.clip.ply")
            bake.write_clip(path, clip)
            with open(path, "rb") as fh:
                head = fh.read(600).decode("latin1")
            self.assertIn("comment v4d clip fps=12 frames=12 duration=1.000", head)
            self.assertIn("property float t\nproperty int id\nend_header", head)
            back = bake.read_clip(path)
        self.assertEqual(back.frames, clip.frames)
        self.assertAlmostEqual(back.fps, 12.0)
        self.assertTrue(back.tracked)
        for f in (0, 5, 11):
            np.testing.assert_allclose(back.positions[f], clip.positions[f], atol=1e-6)
            np.testing.assert_array_equal(back.colors[f], clip.colors[f])

    def test_every_synthetic_body_is_tracked_and_moves(self):
        for name in bake.SYNTHETIC:
            clip = small(name)
            self.assertTrue(clip.tracked, name)
            moved = np.linalg.norm(clip.positions[-1] - clip.positions[0], axis=1).mean()
            self.assertGreater(moved, 0.05, name)

    def test_synthetic_is_deterministic_by_seed(self):
        a, b = small(), small()
        np.testing.assert_array_equal(a.positions[7], b.positions[7])


class Sculptures(unittest.TestCase):
    def run_mode(self, mode, *extra, name="walker"):
        clip = small(name, frames=30)
        args = bake.build_parser().parse_args(["--synthetic", name, "--mode", mode, *extra])
        args.axis_given = args.axis is not None
        args.axis = "xyz".index(args.axis or "x")
        return clip, *bake.sculpt(clip, args, np.random.default_rng(1))

    def test_every_mode_makes_points(self):
        for mode in ("sculpt", "echo", "strobe", "slit", "firebrand"):
            for name in bake.SYNTHETIC:
                _, xyz, rgb = self.run_mode(mode, name=name)
                self.assertGreater(len(xyz), 50, f"{mode} {name}")
                self.assertEqual(len(xyz), len(rgb))
                self.assertTrue(np.isfinite(xyz).all())

    def test_sculpt_shears_with_time(self):
        clip, xyz, _ = self.run_mode("sculpt", "--shear", "5")
        spread = np.ptp(xyz[:, 0])
        self.assertGreater(spread, np.ptp(np.concatenate(clip.positions)[:, 0]) + 5 * 2.0)

    def test_echo_past_is_sparser_and_darker(self):
        clip, xyz, rgb = self.run_mode("echo", "--every", "10")
        # Frames 9, 19, 29: the oldest is the leftmost of a walker heading +x.
        left = xyz[:, 0] < np.percentile(xyz[:, 0], 20)
        right = xyz[:, 0] > np.percentile(xyz[:, 0], 80)
        self.assertLess(rgb[left].mean(), rgb[right].mean())

    def test_firebrand_window_zero_is_a_point(self):
        _, xyz, _ = self.run_mode("firebrand", "--window", "0")
        self.assertEqual(len(xyz), 1)

    def test_time_colour_ramps(self):
        _, xyz, rgb = self.run_mode("strobe", "--color", "time", "--every", "5")
        early = rgb[xyz[:, 0] < np.percentile(xyz[:, 0], 15)].mean()
        late = rgb[xyz[:, 0] > np.percentile(xyz[:, 0], 85)].mean()
        self.assertLess(early, late)

    def test_sculpture_carries_no_time(self):
        with tempfile.TemporaryDirectory() as d:
            rc = bake.main(["--synthetic", "walker", "--frames-count", "6", "--points", "300",
                            "--out-dir", d, "--mode", "echo", "--every", "2"])
            self.assertEqual(rc, 0)
            cols, comments = bake.read_ply(os.path.join(d, "walker.sculpture.ply"))
            self.assertNotIn("t", cols)
            self.assertFalse(any(c.startswith("v4d clip") for c in comments))
            self.assertTrue(os.path.exists(os.path.join(d, "walker.clip.ply")))


class Chaining(unittest.TestCase):
    def test_frames_without_ids_are_followed(self):
        # The truth: a tracked walker. The input: each frame shuffled, ids dropped.
        truth = small(frames=10, n=1500)
        rng = np.random.default_rng(5)
        with tempfile.TemporaryDirectory() as d:
            for f, (p, c) in enumerate(zip(truth.positions, truth.colors)):
                order = rng.permutation(len(p))
                bake.write_ply(os.path.join(d, f"frame_{f:03d}.ply"), p[order], c[order])
            clip = bake.load_frames(os.path.join(d, "*.ply"), 400, 12.0, 9, 90)
        self.assertEqual(clip.frames, 10)
        self.assertTrue(clip.tracked)
        # Each track should stay on (or right beside) one body point.
        tree_err = []
        for f in range(1, clip.frames):
            step = np.linalg.norm(clip.positions[f] - clip.positions[f - 1], axis=1)
            tree_err.append(np.median(step))
        true_step = np.median(np.linalg.norm(truth.positions[5] - truth.positions[4], axis=1))
        self.assertLess(np.median(tree_err), true_step * 1.6 + 0.02)
        # Claims are mostly one to one.
        uniq = len(np.unique(clip.positions[-1], axis=0)) / len(clip.positions[-1])
        self.assertGreater(uniq, 0.9)


class VideoPathMocked(unittest.TestCase):
    """The ML path end to end, with the decoder, mask and depth mocked out."""

    def test_three_frames_become_a_tracked_clip(self):
        h, w = 48, 64
        frames = []
        for k in range(3):
            img = np.zeros((h, w, 3), np.uint8)
            img[10:40, 20 + 2 * k:34 + 2 * k] = (200, 180, 160)
            frames.append(img)
        saved = bake._video_frames, bake._mask_fn, bake._depth_fn
        try:
            bake._video_frames = lambda path, fps, max_frames, width: frames
            bake._mask_fn = lambda kind: (lambda rgb: rgb[:, :, 0] > 0)
            bake._depth_fn = lambda device: (lambda rgb: np.tile(np.linspace(0, 1, w, dtype=np.float32), (h, 1)))
            clip = bake.load_video("mock.mp4", 200, 30.0, 1, 3, w, "rembg", 55.0, 2.0, 0.6)
        finally:
            bake._video_frames, bake._mask_fn, bake._depth_fn = saved
        self.assertEqual(clip.frames, 3)
        self.assertTrue(clip.tracked)
        self.assertEqual(len(clip.positions[0]), 200)
        # The subject moves right in the picture, so it moves +x in space.
        self.assertGreater(clip.positions[2][:, 0].mean(), clip.positions[0][:, 0].mean())
        # Depth from the mock: nearer (bigger disparity) is less negative z.
        p = clip.positions[0]
        self.assertTrue((p[:, 2] < 0).all())
        self.assertEqual(clip.colors[0][0].tolist(), [200, 180, 160])


if __name__ == "__main__":
    unittest.main()
