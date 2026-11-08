"""cmake/lift_check.cmake must hash the same files the same way as lifter_stamp().

If they drift apart, every build fails right after a fresh lift.
"""
import os
import pathlib
import shutil
import subprocess
import sys
import tempfile
import unittest

ROOT = pathlib.Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
import run_lift  # noqa: E402

CMAKE = shutil.which('cmake')
SCRIPT = ROOT / 'cmake' / 'lift_check.cmake'
PCRECOMP = os.path.dirname(run_lift._TOOLS)


def run_check(*defs):
    args = [CMAKE, '-DPCRECOMP=' + PCRECOMP, '-DRUN_LIFT=' + str(ROOT / 'run_lift.py')]
    args += ['-D' + d for d in defs] + ['-P', str(SCRIPT)]
    return subprocess.run(args, capture_output=True, text=True)


@unittest.skipUnless(CMAKE, 'cmake is not on PATH')
class LiftCheckTests(unittest.TestCase):
    def test_hash_matches_lifter_stamp(self):
        out = run_check('PRINT=ON')
        self.assertEqual(out.returncode, 0, out.stderr)
        self.assertEqual(out.stderr.strip(), run_lift.lifter_stamp())

    def test_current_stamp_passes_and_old_one_fails(self):
        with tempfile.TemporaryDirectory() as gen:
            stamp = pathlib.Path(gen, 'lift_stamp.txt')
            stamp.write_text(run_lift.lifter_stamp() + '\n')
            self.assertEqual(run_check('GEN_DIR=' + gen, 'EDITION=game').returncode, 0)

            stamp.write_text('0000000000000000\n')
            out = run_check('GEN_DIR=' + gen, 'EDITION=game')
            self.assertNotEqual(out.returncode, 0)
            self.assertIn('run_lift.py --target game --all', out.stderr)

            out = run_check('GEN_DIR=' + gen, 'EDITION=game', 'ALLOW_STALE=ON')
            self.assertEqual(out.returncode, 0, out.stderr)
            self.assertIn('RA2_ALLOW_STALE_LIFT', out.stderr)

    def test_missing_stamp_fails(self):
        with tempfile.TemporaryDirectory() as gen:
            self.assertNotEqual(run_check('GEN_DIR=' + gen, 'EDITION=gamemd').returncode, 0)


if __name__ == '__main__':
    unittest.main()
