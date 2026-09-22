import copy
import importlib.util
import json
import os
from pathlib import Path
import re
import subprocess
import tempfile
import unittest
from unittest.mock import patch


ROOT = Path(__file__).resolve().parents[1]
SKILL = ROOT / 'skills/pr-tour'
spec = importlib.util.spec_from_file_location('build_guide', SKILL / 'scripts/build_guide.py')
builder = importlib.util.module_from_spec(spec)
spec.loader.exec_module(builder)


class BuilderTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.environment = patch.dict(os.environ, {'GIT_CONFIG_NOSYSTEM': '1', 'GIT_CONFIG_GLOBAL': os.devnull})
        cls.environment.start()
        cls.directory = tempfile.TemporaryDirectory(prefix='pr-guide-tests-')
        cls.repo = Path(cls.directory.name)
        cls.git('init', '-q')
        cls.git('config', 'user.name', 'Guide tests')
        cls.git('config', 'user.email', 'tests@example.invalid')
        cls.git('config', 'core.hooksPath', os.devnull)
        (cls.repo / 'nested').mkdir()
        (cls.repo / 'nested/bridge.py').write_text('callback = send\n')
        cls.before = ''.join(f'value_{i} = {i}\n' for i in range(1, 101))
        for path, content in {
            'main.py': cls.before.encode(), 'deleted.txt': b'deleted\n',
            'rename.txt': b'same contents\n', 'mode.sh': b'exit 0\n',
            'binary.bin': b'\x00before', 'crlf.txt': b'a\r\nb\r\n',
            'no-newline.txt': b'before',
            'unchanged.py': '# unchanged 😀\r\nvalue = "<tag>&lt;"\r\n'.encode(),
        }.items():
            (cls.repo / path).write_bytes(content)
        cls.git('add', '.')
        cls.git('commit', '-qm', 'base files')
        first = cls.git('rev-parse', 'HEAD')
        cls.git('update-index', '--add', '--cacheinfo', f'160000,{first},module')
        cls.git('commit', '-qm', 'base module')
        cls.base = cls.git('rev-parse', 'HEAD')
        cls.after = cls.before.replace('value_10 = 10', 'value_10 = 42').replace('value_90 = 90', 'value_90 = 99')
        (cls.repo / 'main.py').write_text(cls.after)
        (cls.repo / 'deleted.txt').unlink()
        (cls.repo / 'rename.txt').rename(cls.repo / 'renamed.txt')
        (cls.repo / 'mode.sh').chmod(0o755)
        for path, content in {
            'added.txt': b'new\n', 'empty-added.txt': b'', 'binary.bin': b'\x00after',
            'crlf.txt': b'a\r\nc\r\n', 'no-newline.txt': b'after',
        }.items():
            (cls.repo / path).write_bytes(content)
        cls.git('add', '.')
        cls.git('update-index', '--add', '--cacheinfo', f'160000,{cls.base},module')
        cls.git('commit', '-qm', 'head')
        cls.head = cls.git('rev-parse', 'HEAD')
        cls.files = builder.changed_files(cls.repo, cls.base, cls.head)
        cls.manifest = {
            'url': 'https://github.example/team/repo/pull/1', 'title': 'Example',
            'head': cls.head, 'base': cls.base, 'date': '2026-09-12',
            'steps': [dict(id=f'step-{i}', group='Flow', title=path, file=path,
                           heading='Change', why='Read the change', check='What changed?',
                           next='Continue', notes=[])
                      for i, path in enumerate(cls.files)],
        }

    @classmethod
    def tearDownClass(cls):
        cls.directory.cleanup()
        cls.environment.stop()

    @classmethod
    def git(cls, *args):
        return subprocess.check_output(['git', *args], cwd=cls.repo, stderr=subprocess.PIPE).decode().strip()

    def test_reconstructs_both_snapshots_with_gaps(self):
        rows = builder.flatten(self.files['main.py']['rows'])
        for key, source in [('old', self.before), ('new', self.after)]:
            actual = [r for r in rows if r.get(key) is not None]
            self.assertEqual([r[key] for r in actual], list(range(1, 101)))
            self.assertEqual([r['text'] for r in actual], source.splitlines())

    def test_special_git_changes_are_kept(self):
        self.assertEqual(self.files['renamed.txt']['oldPath'], 'rename.txt')
        self.assertEqual(self.files['deleted.txt']['status'], 'D')
        self.assertIn('notice', self.files['binary.bin'])
        self.assertIn('notice', self.files['module'])
        self.assertIn('추가', self.files['empty-added.txt']['changeNote'])
        self.assertEqual(self.files['mode.sh']['added'], 0)
        self.assertTrue(any(r.get('text') == 'c\r' for r in self.files['crlf.txt']['rows']))
        self.assertTrue(any(r.get('text') == 'after' for r in self.files['no-newline.txt']['rows']))

    def test_submodule_ignore_setting_cannot_hide_a_change(self):
        self.git('config', 'diff.ignoreSubmodules', 'all')
        try:
            files = builder.changed_files(self.repo, self.base, self.head)
            self.assertIn('module', files)
        finally:
            self.git('config', '--unset', 'diff.ignoreSubmodules')

    def test_reads_committed_source_and_does_not_mutate_manifest(self):
        original = copy.deepcopy(self.manifest)
        (self.repo / 'main.py').write_text('uncommitted content')
        try:
            data = builder.build(self.repo, self.manifest)
            rows = builder.flatten(data['files']['main.py']['rows'])
            self.assertEqual([r['text'] for r in rows if r.get('new') is not None], self.after.splitlines())
            self.assertEqual(self.manifest, original)
        finally:
            (self.repo / 'main.py').write_text(self.after)

    def test_all_changed_files_must_be_covered(self):
        manifest = copy.deepcopy(self.manifest)
        manifest['steps'].pop()
        with self.assertRaisesRegex(ValueError, 'Every changed file'):
            builder.build(self.repo, manifest)

    def test_notes_cannot_cross_hidden_lines(self):
        manifest = copy.deepcopy(self.manifest)
        step = next(s for s in manifest['steps'] if s['file'] == 'main.py')
        step['notes'] = [dict(title='Too broad', text='Hidden gap', start=10, end=90)]
        with self.assertRaisesRegex(ValueError, 'visible diff lines'):
            builder.build(self.repo, manifest)

    def transition_manifest(self, basis='source'):
        manifest = copy.deepcopy(self.manifest)
        transition = dict(to=manifest['steps'][1]['id'], basis=basis,
                          evidence=[dict(path='main.py', side='right', start=10, end=10, text='Changed value')])
        manifest['steps'][0]['transition'] = transition
        return manifest

    def test_transition_citations_reject_directories_and_submodules(self):
        for path in ('nested', 'module'):
            for side in ('left', 'right'):
                with self.subTest(path=path, side=side):
                    manifest = self.transition_manifest()
                    manifest['steps'][0]['transition']['evidence'][0].update(path=path, side=side, start=1, end=1)
                    with self.assertRaisesRegex(ValueError, 'file blob'):
                        builder.build(self.repo, manifest)

    def test_transition_citations_use_pinned_source_including_unchanged_and_old_paths(self):
        manifest = self.transition_manifest()
        references = manifest['steps'][0]['transition']['evidence']
        references += [dict(path=path, side=side, start=start, end=end, text='Connection evidence')
                       for path, side, start, end in [
                           ('main.py', 'left', 10, 10), ('unchanged.py', 'right', 1, 2),
                           ('rename.txt', 'left', 1, 1), ('renamed.txt', 'right', 1, 1),
                           ('deleted.txt', 'left', 1, 1)]]
        original = copy.deepcopy(manifest)
        (self.repo / 'main.py').write_text('uncommitted content')
        try:
            data = builder.build(self.repo, manifest)
        finally:
            (self.repo / 'main.py').write_text(self.after)
        evidence = data['steps'][0]['transition']['evidence']
        self.assertEqual(evidence[0]['rows'], [dict(line=10, text='value_10 = 42')])
        self.assertEqual(evidence[1]['rows'], [dict(line=10, text='value_10 = 10')])
        self.assertEqual(evidence[2]['rows'], [dict(line=1, text='# unchanged 😀\r'),
                                              dict(line=2, text='value = "<tag>&lt;"\r')])
        self.assertEqual(evidence[-1]['rows'][0]['text'], 'deleted')
        self.assertEqual(manifest, original)
        self.assertEqual(data['transitionSummary']['source'], 1)
        self.assertEqual(data['transitionSummary']['missing'], len(manifest['steps']) - 2)
        self.assertEqual(len(data['warnings']), len(manifest['steps']) - 2)

    def test_transition_rejects_invalid_or_reordered_destinations(self):
        for target in ['unknown', self.manifest['steps'][0]['id'], self.manifest['steps'][2]['id']]:
            manifest = self.transition_manifest()
            manifest['steps'][0]['transition']['to'] = target
            with self.subTest(target=target), self.assertRaisesRegex(ValueError, 'next reading step'):
                builder.build(self.repo, manifest)
        manifest = self.transition_manifest()
        manifest['steps'][-1]['transition'] = manifest['steps'][0].pop('transition')
        with self.assertRaisesRegex(ValueError, 'final step'):
            builder.build(self.repo, manifest)

    def test_transition_rejects_malformed_evidence_before_rendering(self):
        for field, value in [('side', 'head'), ('side', ''), ('start', True), ('start', 0),
                             ('end', 1000), ('end', 1), ('path', '../main.py'),
                             ('path', '/main.py'), ('path', 'missing.py'),
                             ('path', 'binary.bin'), ('text', ''), ('rows', []),
                             ('code', 'invented'), ('url', 'https://example.com')]:
            manifest = self.transition_manifest()
            manifest['steps'][0]['transition']['evidence'][0][field] = value
            with self.subTest(field=field, value=value), self.assertRaises((ValueError, subprocess.CalledProcessError)):
                builder.build(self.repo, manifest)
        manifest = self.transition_manifest()
        del manifest['steps'][0]['transition']['evidence'][0]['side']
        with self.assertRaisesRegex(ValueError, 'side'):
            builder.build(self.repo, manifest)

    def test_transition_basis_requires_evidence_or_explicit_uncertainty(self):
        for transition in [None, {}, {'to': self.manifest['steps'][1]['id'], 'basis': 'call'},
                           {'to': self.manifest['steps'][1]['id'], 'basis': 'source', 'evidence': []},
                           {'to': self.manifest['steps'][1]['id'], 'basis': 'inferred'},
                           {'to': self.manifest['steps'][1]['id'], 'basis': 'source', 'uncertainty': 'Maybe'}]:
            manifest = copy.deepcopy(self.manifest)
            manifest['steps'][0]['transition'] = transition
            with self.subTest(transition=transition), self.assertRaises(ValueError):
                builder.build(self.repo, manifest)
        for basis in ['inferred', 'reading']:
            manifest = self.transition_manifest(basis)
            transition = manifest['steps'][0]['transition']
            transition.pop('evidence')
            if basis == 'inferred':
                transition['uncertainty'] = 'The runtime registration is outside this repository.'
            data = builder.build(self.repo, manifest)
            self.assertEqual(data['transitionSummary'][basis], 1)
            self.assertEqual(data['steps'][0]['transition']['evidence'], [])

    def test_legacy_and_single_step_have_no_invented_connections(self):
        data = builder.build(self.repo, self.manifest)
        self.assertFalse(data['transitionSummary']['enabled'])
        self.assertEqual(data['transitionSummary']['missing'], len(data['steps']) - 1)
        self.assertEqual(data['warnings'], [])
        summary, warnings = builder.build_transitions(self.repo, self.manifest['steps'][:1], self.head, self.base)
        self.assertEqual(summary, dict(enabled=False, total=0, source=0, inferred=0, reading=0, missing=0))
        self.assertEqual(warnings, [])

    def test_deleted_line_note_uses_base(self):
        manifest = copy.deepcopy(self.manifest)
        step = next(s for s in manifest['steps'] if s['file'] == 'deleted.txt')
        step['notes'] = [dict(title='Removed', text='Before', start=1, end=1)]
        data = builder.build(self.repo, manifest)
        self.assertEqual(next(s for s in data['steps'] if s['file'] == 'deleted.txt')['notes'][0]['side'], 'left')

    def test_invalid_optional_fields_fail_before_render(self):
        for field, value in [('recap', 'not an array'), ('recap', [4]),
                             ('finding', None), ('reference', {'path': 'main.py'}), ('notes', {})]:
            with self.subTest(field=field, value=value):
                manifest = copy.deepcopy(self.manifest)
                manifest['steps'][0][field] = value
                with self.assertRaises(ValueError):
                    builder.build(self.repo, manifest)

    def test_unicode_offsets_match_javascript(self):
        links = {}
        builder.append_link(links, {'f': {}}, 'main.py', ['😀 함수()'], 1, '함수', 'f', 2)
        self.assertEqual(links[('main.py', 1)][0], {'start': 3, 'end': 5, 'name': 'f'})

    def test_unknown_symbol_is_rejected_even_when_not_used(self):
        manifest = copy.deepcopy(self.manifest)
        manifest['pythonSymbols'] = {'main.py': {'missing': 'unknown'}}
        with self.assertRaisesRegex(ValueError, 'Unknown definition'):
            builder.build(self.repo, manifest)

    def test_english_ui_preserves_authored_content_and_safe_json(self):
        manifest = copy.deepcopy(self.manifest)
        manifest['language'] = 'en'
        manifest['steps'][0]['why'] = '한국어 설명 </script><script>alert(1)</script>'
        data = builder.build(self.repo, manifest)
        template = (SKILL / 'assets/guide.html').read_text()
        page = builder.render(template, data)
        self.assertIn('<html lang="en">', page)
        self.assertNotIn('</script><script>alert(1)</script>', page)
        payload = re.search(r'<script type="application/json" id="guide-data">(.*?)</script>', page, re.S)[1]
        self.assertEqual(json.loads(payload)['steps'][0]['why'], manifest['steps'][0]['why'])
        self.assertFalse(re.search('[가-힣]', page.replace(payload, '')))
        self.assertIn('Copyright (c) 2006, Ivan Sagalaev.', page)
        self.assertIn('const TourSyntax =', page)
        self.assertNotIn('__SYNTAX_ASSETS__', page)
        self.assertFalse(re.search(r'<script\b[^>]*\bsrc=', page))
        self.assertEqual(len(re.findall(r'</script\s*>', page, re.I)), 3)

    def test_cli_refuses_to_overwrite_an_existing_output(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp)
            manifest = path / 'manifest.json'
            output = path / 'guide.html'
            manifest.write_text(json.dumps(self.manifest))
            output.write_text('existing guide')
            result = subprocess.run(['python3', str(SKILL / 'scripts/build_guide.py'), '--repo', str(self.repo),
                                     '--manifest', str(manifest), '--output', str(output)], capture_output=True, text=True)
            self.assertNotEqual(result.returncode, 0)
            self.assertEqual(output.read_text(), 'existing guide')


if __name__ == '__main__':
    unittest.main()
