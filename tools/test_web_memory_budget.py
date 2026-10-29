import pathlib
import re
import unittest

ROOT = pathlib.Path(__file__).resolve().parents[1]


def memory_bytes(text, setting):
    match = re.search(rf"-s{setting}=(\d+)(MB|GB)", text)
    if not match:
        raise AssertionError(f"missing -s{setting} in web link options")
    value, unit = int(match.group(1)), match.group(2)
    return value * (1024**2 if unit == "MB" else 1024**3)


class WebMemoryBudgetTests(unittest.TestCase):
    def test_wasm_linear_memory_stays_below_the_one_gib_runtime_budget(self):
        cmake = (ROOT / "CMakeLists.txt").read_text(encoding="utf-8")
        initial = memory_bytes(cmake, "INITIAL_MEMORY")
        maximum = memory_bytes(cmake, "MAXIMUM_MEMORY")
        self.assertEqual(initial, 640 * 1024**2)
        self.assertEqual(maximum, 768 * 1024**2)
        self.assertLessEqual(initial, maximum)


if __name__ == "__main__":
    unittest.main()
