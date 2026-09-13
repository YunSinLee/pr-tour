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
        cls.before = ''.join(f'value_{i} = {i}\n' for i in range(1, 101))
        for path, content in {
            'main.py': cls.before.encode(), 'deleted.txt': b'deleted\n',
            'rename.txt': b'same contents\n', 'mode.sh': b'exit 0\n',
            'binary.bin': b'\x00before', 'crlf.txt': b'a\r\nb\r\n',
            'no-newline.txt': b'before',
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
