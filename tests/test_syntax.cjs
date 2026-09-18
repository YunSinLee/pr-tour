const test = require('node:test');
const assert = require('node:assert/strict');
const syntax = require('../skills/pr-tour/assets/syntax.js');
const hljs = require('../skills/pr-tour/assets/vendor/highlightjs/highlight.min.js');

function colored(source, path, scope) {
  const original = source.split('\n');
  return syntax.lines(source, path, hljs).map((tokens, index) => tokens
    .filter(token => token.classes.split(' ').includes(scope))
    .map(token => original[index].slice(token.start, token.end)).join(''));
}

test('common source languages receive tokens without guessing unknown extensions', () => {
  for (const [path, source] of [
    ['main.py', 'async def f(): return True'], ['app.tsx', 'const count: number = 42;'],
    ['main.js', 'const text = "hello";'], ['main.go', 'func main() { return }'],
    ['main.rs', 'fn main() { let n = 42; }'], ['Main.java', 'public class Main {}'],
    ['main.swift', 'let name = "hello"'], ['main.kt', 'val name = "hello"'],
    ['index.html', '<p class="hello">World</p>'], ['style.css', '.hello { color: red; }'],
    ['config.json', '{"count": 42}'], ['config.yml', 'count: 42'],
  ]) assert.ok(syntax.lines(source, path, hljs)[0].length, path);
  for (const path of ['data.unknown', 'constructor', 'data.__proto__', 'toString']) {
    assert.deepEqual(syntax.lines('const count = 42;', path, hljs), [[]]);
  }
  assert.equal(syntax.language('src/MAIN.PY'), 'python');
});

test('multiline strings keep their scope on each line', () => {
  const code = 'value = """first\nif is text here\nlast"""\nreturn 42';
  assert.equal(colored(code, 'x.py', 'hljs-string')[1], 'if is text here');
  assert.equal(colored(code, 'x.py', 'hljs-keyword')[1], '');
  assert.equal(colored(code, 'x.py', 'hljs-keyword')[3], 'return');
});

test('old and new snapshots are parsed separately, including collapsed gaps', () => {
  const deletion = {kind: 'del', old: 1, new: null, text: '/*'};
  const addition = {kind: 'add', old: null, new: 1, text: '//'};
  const context = {kind: 'context', old: 2, new: 2, text: 'const value = "ok";'};
  const close = {kind: 'del', old: 3, new: null, text: '*/'};
  syntax.file({path: 'x.js', oldPath: 'x.js', rows: [
    {kind: 'hunk', text: '@@ ... @@'}, deletion, addition,
    {kind: 'gap', lines: [context]}, close,
  ]}, hljs);
  assert.ok(deletion.syntax.some(token => token.classes === 'hljs-comment'));
  assert.ok(close.syntax.some(token => token.classes === 'hljs-comment'));
  assert.ok(context.syntax.some(token => token.classes === 'hljs-keyword'));
  assert.ok(context.syntax.some(token => token.classes === 'hljs-string'));
});

test('renamed files use the old extension for deletions and new extension for additions', () => {
  const oldRow = {old: 1, new: null, text: 'return 42'};
  const newRow = {old: null, new: 1, text: 'return 42'};
  syntax.file({path: 'data.txt', oldPath: 'script.py', rows: [oldRow, newRow]}, hljs);
  assert.ok(oldRow.syntax.length);
  assert.deepEqual(newRow.syntax, []);
});

test('CRLF, emoji, entity-looking text and HTML-looking source retain exact offsets', () => {
  const source = '# 😀 comment\r\nvalue = "<script>&lt;&amp;\'"\r\nreturn 42';
  assert.equal(colored(source, 'x.py', 'hljs-comment')[0], '# 😀 comment');
  assert.equal(colored(source, 'x.py', 'hljs-string')[1], '"<script>&lt;&amp;\'"');
  const tokens = syntax.lines(source, 'x.py', hljs);
  const string = tokens[1].find(token => token.classes === 'hljs-string');
  assert.equal(string.start, source.split('\n')[1].indexOf('"'));
});

test('malformed highlighter output, altered source and lexer failures fall back to text', () => {
  for (const value of ['<img src=x onerror=alert(1)>', '<span onclick="x">hello</span>',
    '<span class="hljs-string">wrong</span>', '</span>hello', '<span class="hljs-string">hello']) {
    assert.deepEqual(syntax.lines('hello', 'x.py', {getLanguage: () => true, highlight: () => ({value})}), [[]]);
  }
  assert.deepEqual(syntax.lines('hello', 'x.py', {getLanguage: () => true, highlight() { throw Error(); }}), [[]]);
  assert.deepEqual(syntax.lines('hello', 'x.py', undefined), [[]]);
});

test('rendered source and definition-link boundaries preserve UTF-16 text exactly', () => {
  // Minimal text-only DOM contract: no HTML parser or innerHTML setter is available.
  const doc = {createTextNode: text => ({textContent: text}), createElement: tag => ({
    tag, ownerDocument: doc, children: [], append(child) { this.children.push(child); },
    set textContent(text) { this.children = [doc.createTextNode(text)]; },
    get textContent() { return this.children.map(child => child.textContent).join(''); },
  })};
  const row = {text: 'const x = "😀 Response <img onerror=alert(1)>";\r'};
  syntax.rows([row], 'x.js', hljs);
  const cell = doc.createElement('td'), button = doc.createElement('button');
  const start = row.text.indexOf('Response'), end = start + 'Response'.length;
  syntax.append(cell, row, 0, start);
  syntax.append(button, row, start, end);
  cell.append(button);
  syntax.append(cell, row, end);
  assert.equal(cell.textContent, row.text);
  assert.equal(button.textContent, 'Response');
  assert.equal(button.children[0].className, 'hljs-string');
  assert.ok(cell.children.every(child => !child.tag || ['span', 'button'].includes(child.tag)));
});
