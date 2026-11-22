"""The names ledger gives the lift names only when each one is safe to emit and says why."""
import json
import pathlib
import sys
import tempfile
import unittest

ROOT = pathlib.Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
sys.path.insert(0, str(ROOT / 'tools'))
import names_ledger
import run_lift


def entry(address='0x007CA650', name='CRT__chkstk', evidence='push ecx; cmp eax, 0x1000; probes a page at a time'):
    return {'address': address, 'name': name, 'evidence': evidence}


class LoadTest(unittest.TestCase):
    def setUp(self):
        tmp = tempfile.TemporaryDirectory()
        self.addCleanup(tmp.cleanup)
        self.path = pathlib.Path(tmp.name) / 'gamemd.json'

    def write(self, *names, target='gamemd', fmt=1):
        self.path.write_text(json.dumps({'format': fmt, 'target': target, 'names': list(names)}), encoding='utf-8')
        return self.path

    def rejected(self, *names, **kw):
        with self.assertRaises(names_ledger.LedgerError) as caught:
            names_ledger.load(self.write(*names, **kw), 'gamemd')
        return str(caught.exception)

    def test_names_are_keyed_by_address(self):
        path = self.write(entry(), entry('0x007C5F00', 'CRT__ftol'))
        self.assertEqual(names_ledger.load(path, 'gamemd'), {0x007CA650: 'CRT__chkstk', 0x007C5F00: 'CRT__ftol'})

    def test_a_ledger_that_does_not_exist_names_nothing(self):
        self.assertEqual(names_ledger.load(self.path, 'gamemd'), {})

    def test_a_name_without_evidence_is_rejected(self):
        self.assertIn('0x007CA650', self.rejected(entry(evidence='  ')))

    def test_a_name_that_could_be_a_library_symbol_is_rejected(self):
        # The name becomes a C function in the build, so `memcpy` or `_ftol`
        # would collide with the C library's. Module__Function cannot.
        for name in ('memcpy', '_ftol', 'Play_Movie', 'sub_007CA650', 'crt__ftol', 'CRT__', 'CRT__f-tol'):
            with self.subTest(name=name):
                self.assertIn(name, self.rejected(entry(name=name)))

    def test_an_address_must_be_written_in_full(self):
        for address in ('7CA650', '0x7CA650', 0x007CA650, '0x007CA65G'):
            with self.subTest(address=address):
                self.rejected(entry(address=address))

    def test_one_address_cannot_have_two_names(self):
        self.assertIn('0x007CA650', self.rejected(entry(), entry(name='CRT__alloca_probe')))

    def test_one_name_cannot_be_at_two_addresses(self):
        self.assertIn('CRT__chkstk', self.rejected(entry(), entry(address='0x007C5F00')))

    def test_a_misspelt_field_is_rejected(self):
        self.assertIn('evidance', self.rejected({'address': '0x007CA650', 'name': 'CRT__chkstk', 'evidance': 'x'}))

    def test_another_editions_ledger_is_rejected(self):
        self.assertIn('game', self.rejected(entry(), target='game'))

    def test_an_unknown_format_is_rejected(self):
        self.rejected(entry(), fmt=2)


class MergeTest(unittest.TestCase):
    def test_hooks_and_ledger_names_are_both_known(self):
        self.assertEqual(names_ledger.merge({0x004068E0: 'hook_debuglog'}, {0x007CA650: 'CRT__chkstk'}),
                         {0x004068E0: 'hook_debuglog', 0x007CA650: 'CRT__chkstk'})

    def test_a_ledger_name_on_a_hooked_function_is_rejected(self):
        with self.assertRaises(names_ledger.LedgerError) as caught:
            names_ledger.merge({0x004068E0: 'hook_debuglog'}, {0x004068E0: 'Debug__Log'})
        self.assertIn('hook_debuglog', str(caught.exception))


class PlacementTest(unittest.TestCase):
    def test_names_at_addresses_the_lift_has_no_function_at_are_listed(self):
        names = {0x007CA650: 'CRT__chkstk', 0x007CA654: 'CRT__mid_function'}
        self.assertEqual(names_ledger.not_function_starts(names, {0x007CA650, 0x00401000}),
                         [(0x007CA654, 'CRT__mid_function')])


class CommittedLedgersTest(unittest.TestCase):
    def test_each_editions_ledger_loads_and_avoids_its_hooks(self):
        for target, t in run_lift.targets().items():
            with self.subTest(target=target):
                path = pathlib.Path(names_ledger.path_for(target))
                self.assertEqual(path, ROOT / 'names' / (target + '.json'))
                self.assertTrue(path.is_file(), '%s has no names ledger at %s' % (target, path))
                names = names_ledger.load(path, target)
                names_ledger.merge({va: 'hook_%s' % hook for va, hook in t['hooks'].items()}, names)


if __name__ == '__main__':
    unittest.main()
