"""vera_lookup finds what a VERA20K checkout says about a gamemd.exe address."""
import contextlib
import io
import json
import pathlib
import sys
import tempfile
import unittest

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))
import vera_lookup


FIRE_RS = '''\
//! Weapon fire.

/// `TechnoClass::Fire 0x006FDD50` draws the first spray offset of a burst.
pub fn fire() {}

/// The scan bound (`0x006F9042..0x006F9148`) is read from ESP+0x38.
pub fn scan_bound() {}

// TechnoClass::Fire @ 0x6FDD50 again, written short.
// A colour, not an address: 0x00FF00FF, and a small constant 0x1000.
'''

LEDGER = {
    'format': 1, 'pass': 'test pass', 'tag': '[test]', 'atomic': False,
    'ops': [
        {'op': 'rename_function', 'address': '0x0053B460',
         'from': 'NukeFlash__StartScreenFlash', 'to': 'ChronoScreenEffect__Start'},
        {'op': 'append_plate', 'address': '0x0053B460',
         'function': ['NukeFlash__StartScreenFlash', 'ChronoScreenEffect__Start'],
         'text': 'This starts the chrono screen effect, not a nuke flash.'},
    ],
}


def make_checkout(root):
    root = pathlib.Path(root)
    (root / 'src' / 'sim').mkdir(parents=True)
    (root / 'src' / 'sim' / 'fire.rs').write_text(FIRE_RS, encoding='utf-8')
    (root / 'docs').mkdir()
    (root / 'docs' / 'ghidra-workflow.md').write_text(
        '`__alloca_probe` (0x7CA650) is MSVC\'s `_chkstk`.\n', encoding='utf-8')
    passes = root / 'tools' / 'ghidra_pass' / 'passes'
    passes.mkdir(parents=True)
    (passes / '2026-11-05-test.json').write_text(json.dumps(LEDGER), encoding='utf-8')
    return root


class IndexTest(unittest.TestCase):
    def setUp(self):
        tmp = tempfile.TemporaryDirectory()
        self.addCleanup(tmp.cleanup)
        self.root = make_checkout(tmp.name)
        self.index = vera_lookup.build_index(self.root)

    def test_long_and_short_spellings_are_one_address(self):
        hits = vera_lookup.lookup(self.index, self.root, 0x006FDD50)
        self.assertEqual([(h.path, h.line) for h in hits.cites],
                         [('src/sim/fire.rs', 3), ('src/sim/fire.rs', 9)])

    def test_a_cite_carries_the_line_it_was_written_on(self):
        hits = vera_lookup.lookup(self.index, self.root, 0x006FDD50)
        self.assertIn('draws the first spray offset', hits.cites[0].text)

    def test_markdown_docs_are_indexed(self):
        hits = vera_lookup.lookup(self.index, self.root, 0x007CA650)
        self.assertEqual([(h.path, h.line) for h in hits.cites], [('docs/ghidra-workflow.md', 1)])

    def test_an_address_inside_a_cited_range_is_found(self):
        hits = vera_lookup.lookup(self.index, self.root, 0x006F9100)
        self.assertEqual(hits.cites, [])
        self.assertEqual([(r.lo, r.hi, r.path, r.line) for r in hits.ranges],
                         [(0x006F9042, 0x006F9148, 'src/sim/fire.rs', 6)])

    def test_values_outside_the_image_are_not_addresses(self):
        self.assertEqual(vera_lookup.lookup(self.index, self.root, 0x00FF00FF).cites, [])
        self.assertNotIn(0x1000, self.index.exact)

    def test_names_written_beside_an_address_are_counted(self):
        hits = vera_lookup.lookup(self.index, self.root, 0x006FDD50)
        self.assertEqual(hits.names, [('TechnoClass::Fire', 2)])

    def test_a_ledger_rename_and_its_evidence_are_reported(self):
        hits = vera_lookup.lookup(self.index, self.root, 0x0053B460)
        self.assertEqual([(op.kind, op.name) for op in hits.ledger],
                         [('rename_function', 'ChronoScreenEffect__Start'), ('append_plate', None)])
        self.assertIn('not a nuke flash', hits.ledger[1].text)

    def test_an_uncited_address_reports_its_nearest_cited_neighbours(self):
        hits = vera_lookup.lookup(self.index, self.root, 0x006FDD60)
        self.assertEqual(hits.cites, [])
        self.assertEqual(hits.nearest, (0x006FDD50, 0x007CA650))


class CacheTest(unittest.TestCase):
    def setUp(self):
        tmp = tempfile.TemporaryDirectory()
        self.addCleanup(tmp.cleanup)
        self.root = make_checkout(pathlib.Path(tmp.name) / 'vera')
        self.cache = pathlib.Path(tmp.name) / 'work' / 'vera_index.json'

    def test_an_index_for_the_same_commit_is_reused(self):
        vera_lookup.load_index(self.root, self.cache, 'commit-a')
        (self.root / 'src' / 'sim' / 'fire.rs').write_text('// 0x00401000\n', encoding='utf-8')
        index = vera_lookup.load_index(self.root, self.cache, 'commit-a')
        self.assertIn(0x006FDD50, index.exact)

    def test_a_new_commit_rebuilds_the_index(self):
        vera_lookup.load_index(self.root, self.cache, 'commit-a')
        (self.root / 'src' / 'sim' / 'fire.rs').write_text('// 0x00401000\n', encoding='utf-8')
        index = vera_lookup.load_index(self.root, self.cache, 'commit-b')
        self.assertNotIn(0x006FDD50, index.exact)
        self.assertIn(0x00401000, index.exact)

    def test_an_unknown_commit_is_never_cached(self):
        vera_lookup.load_index(self.root, self.cache, None)
        self.assertFalse(self.cache.exists())


class CommandTest(unittest.TestCase):
    def run_main(self, *argv):
        out, err = io.StringIO(), io.StringIO()
        with contextlib.redirect_stdout(out), contextlib.redirect_stderr(err):
            code = vera_lookup.main(list(argv))
        return code, out.getvalue(), err.getvalue()

    def test_a_lookup_prints_where_the_address_is_cited(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = make_checkout(pathlib.Path(tmp) / 'vera')
            code, out, _ = self.run_main('0x6FDD50', '--vera', str(root), '--no-cache')
        self.assertEqual(code, 0)
        self.assertIn('src/sim/fire.rs:3', out)
        self.assertIn('TechnoClass::Fire', out)

    def test_a_lift_name_is_accepted_as_an_address(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = make_checkout(pathlib.Path(tmp) / 'vera')
            code, out, _ = self.run_main('sub_006FDD50', '--vera', str(root), '--no-cache')
        self.assertEqual(code, 0)
        self.assertIn('src/sim/fire.rs:3', out)

    def test_an_address_nobody_cites_exits_1(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = make_checkout(pathlib.Path(tmp) / 'vera')
            code, out, _ = self.run_main('0x00500000', '--vera', str(root), '--no-cache')
        self.assertEqual(code, 1)
        self.assertIn('not cited', out)

    def test_a_missing_checkout_exits_2_and_says_where_it_looked(self):
        with tempfile.TemporaryDirectory() as tmp:
            missing = pathlib.Path(tmp) / 'nowhere'
            code, _, err = self.run_main('0x6FDD50', '--vera', str(missing), '--no-cache')
        self.assertEqual(code, 2)
        self.assertIn('nowhere', err)


if __name__ == '__main__':
    unittest.main()
