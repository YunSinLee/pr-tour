const {test, before, after} = require('node:test');
const assert = require('node:assert/strict');
const {resolve} = require('node:path');
const {pathToFileURL} = require('node:url');
const {readFileSync} = require('node:fs');
const {chromium, webkit} = require('playwright');
const browserName = process.env.PR_TOUR_BROWSER || 'chromium';
let browser;
before(async () => { browser = await ({chromium, webkit})[browserName].launch(); });
after(async () => { await browser?.close(); });

async function withGuide(language, options, run) {
  const context = await browser.newContext({viewport: options.mobile ? {width:390,height:844} : {width:1280,height:900}, hasTouch: true});
  const page = await context.newPage();
  page.setDefaultTimeout(6000);
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  let html = readFileSync(resolve(`docs/demo.${language}.html`), 'utf8');
  const changeData = change => {
    html = html.replace(/(<script type="application\/json" id="guide-data">)([\s\S]*?)(<\/script>)/, (_, a, json, b) => {
      const data = JSON.parse(json); change(data);
      return a + JSON.stringify(data).replace(/</g, '\\u003c') + b;
    });
  };
  if (options.fixture) changeData(options.fixture);
  try {
    await context.route(/^https?:/, route => route.abort());
    const url = options.file ? pathToFileURL(resolve(`docs/demo.${language}.html`)).href : `http://${options.secure ? 'localhost' : 'tour.test'}/guide.html`;
    if (!options.file) await context.route(url, route => route.fulfill({contentType:'text/html',body:html}));
    if (options.init) await context.addInitScript(options.init);
    await page.goto(url + '#entry');
    if (options.mobile) await page.locator('#code-tab').tap();
    await run(page, changeData);
    assert.deepEqual(errors, []);
  } finally { await context.close(); }
}

async function chooseRange(page, start, end = start, side = 'right') {
  const mobile = await page.locator('#code-menu-toggle').isVisible();
  if (mobile) await page.locator('#code-menu-toggle').click();
  await page.locator('#review-add').click();
  const attr = side === 'left' ? 'data-old-line' : 'data-line';
  const line = n => page.locator(`#diff-body tr[${attr}="${n}"] .review-line[data-side="${side}"]`);
  await line(start).click();
  if (end !== start) await line(end).click();
  await page.locator('#review-write').click();
}
async function save(page, text) {
  await page.locator('#review-text').fill(text);
  await page.locator('#review-save').click();
  await idle(page);
  await page.locator('#review-list').waitFor({state:'visible'});
}
async function exported(page) {
  const downloadEvent = page.waitForEvent('download');
  await page.locator('#review-download').click();
  const download = await downloadEvent;
  return JSON.parse(readFileSync(await download.path(), 'utf8'));
}
async function previewImport(page, value, file = false) {
  await page.locator('#review-import-open').click();
  const text = typeof value === 'string' ? value : JSON.stringify(value);
  if (file) {
    const chooserEvent = page.waitForEvent('filechooser');
    await page.locator('#review-import-file-button').click();
    await (await chooserEvent).setFiles({name:'review.json',mimeType:'application/json',buffer:Buffer.from(text)});
  } else {
    await page.locator('#review-import-text').fill(text);
    await page.locator('#review-import-check').click();
  }
}

for (const language of ['en', 'ko']) {
  test(`${language}: downloaded comments import from a file, persist and return to code on mobile`, async () => {
    await withGuide(language, {mobile:true}, async page => {
      const text = language === 'ko' ? '다른 브라우저에서도 이어서 읽어요.' : 'Portable comment';
      await chooseRange(page, 207, 213); await save(page, text);
      const backup = await exported(page);
      await page.locator('.review-card-actions button').last().click();
      await page.reload(); await page.locator('#review-open').click();
      assert.equal(await page.locator('.review-card').count(), 0);
      await previewImport(page, backup, true);
      await page.locator('#review-import-preview').waitFor({state:'visible'});
      const sheet = await page.locator('#review-dialog').boundingBox();
      assert.ok(sheet.x >= 0 && sheet.x + sheet.width <= 391 && sheet.y >= 0 && sheet.y + sheet.height <= 845);
      await page.locator('#review-import-apply').click();
      assert.deepEqual(await exported(page), backup, 'round trip preserves all exported fields');
      await page.reload(); await page.locator('#review-open').click();
      assert.equal(await page.locator('.review-body').textContent(), text);
      await page.locator('.review-location').click();
      await page.waitForFunction(() => document.querySelector('#diff-body tr[data-line="207"]')?.classList.contains('review-selected'));
    });
  });

  test(`${language}: offline range, literal text, edit, delete/undo, exact JSON and navigation`, async () => {
    await withGuide(language, {file:true}, async page => {
      const body = '<img src=x onerror=alert(1)>\n이 경우 예외 처리도 필요할까요?';
      await chooseRange(page, 207, 213);
      assert.equal(await page.locator('#review-save').isEnabled(), false);
      await save(page, body);
      assert.equal(await page.locator('.review-body').textContent(), body);
      assert.equal(await page.locator('.review-body img').count(), 0);
      let out = await exported(page);
      assert.equal(out.kind, 'pr-tour-review');
      assert.equal(out.comments.length, 1);
      assert.equal(out.comments[0].path, 'starlette/websockets.py');
      assert.equal(out.comments[0].commit, out.head);
      assert.equal(out.comments[0].startLine, 207);
      assert.equal(out.comments[0].endLine, 213);
      assert.equal(out.comments[0].code.split('\n').length, 7);
      assert.equal(out.comments[0].code, [
        '    async def send_denial_response(self, response: Response) -> None:',
        '        if "websocket.http.response" in self.scope.get("extensions", {}):',
        '            await response(self.scope, self.receive, self.send)',
        '        else:',
        '            raise RuntimeError(',
        '                "The server doesn\'t support the Websocket Denial Response extension."',
        '            )',
      ].join('\n'));
      assert.equal(out.comments[0].body, body);
      await page.locator('.review-card-actions button').first().click();
      await save(page, 'Updated');
      const updated = await exported(page);
      assert.equal(updated.comments[0].id, out.comments[0].id);
      assert.equal(updated.comments[0].body, 'Updated');
      await page.locator('.review-card-actions button').last().click();
      await idle(page);
      assert.equal(await page.locator('#review-copy').isEnabled(), false);
      await page.locator('#review-feedback button').click();
      await idle(page);
      assert.equal(await page.locator('.review-card').count(), 1);
      await page.locator('#review-close').click();
      await page.locator('#next').click();
      await page.locator('#review-open').click();
      await page.locator('.review-location').click();
      await page.waitForFunction(() => document.querySelector('#diff-body tr[data-line="207"]')?.classList.contains('review-selected'));
      const top = await page.locator('#diff-body tr[data-line="207"]').boundingBox();
      const pane = await page.locator('#diff-scroll').boundingBox();
      assert.ok(Math.abs(top.y - pane.y - 28) < 2);
    });
  });

  test(`${language}: mobile range controls, draft dismissal, storage reload and copy fallback`, async () => {
    await withGuide(language, {mobile:true, init: () => {
      Object.defineProperty(navigator, 'clipboard', {value:{writeText: async () => { throw new Error('denied'); }}});
    }}, async page => {
      await chooseRange(page, 213, 207);
      await page.locator('#review-text').fill('Draft remains');
      await page.keyboard.press('Escape');
      await page.locator('#review-open').click();
      assert.equal(await page.locator('#review-text').inputValue(), 'Draft remains');
      await page.locator('#review-save').click();
      assert.equal((await exported(page)).comments[0].startLine, 207);
      await page.reload();
      await page.locator('#review-open').click();
      assert.equal(await page.locator('.review-body').textContent(), 'Draft remains');
      await page.locator('#review-copy').click();
      assert.equal(JSON.parse(await page.locator('#review-export-text').inputValue()).comments[0].body, 'Draft remains');
      for (const viewport of [{width:390,height:844},{width:320,height:568},{width:844,height:390}]) {
        await page.setViewportSize(viewport);
        const box = await page.locator('#review-dialog').boundingBox();
        assert.ok(box.x >= -1 && box.y >= -1 && box.x + box.width <= viewport.width + 1 && box.y + box.height <= viewport.height + 1);
        assert.ok(await page.locator('#review-dialog').evaluate(el => el.scrollWidth <= el.clientWidth + 1));
        await page.locator('#review-close').click();
        await page.locator('#review-open').click();
      }
    });
  });
}

test('renamed/deleted base lines and hidden context retain source, paths and side', async () => {
  await withGuide('en', {fixture: data => { data.files['starlette/websockets.py'].oldPath = 'starlette/previous.py'; }}, async page => {
    await chooseRange(page, 68, 68, 'left');
    await save(page, 'Old source');
    let out = await exported(page);
    assert.equal(out.comments[0].path, 'starlette/previous.py');
    assert.equal(out.comments[0].side, 'left');
    assert.equal(out.comments[0].commit, out.mergeBase);
    assert.equal(out.comments[0].code, '            if message_type not in {"websocket.accept", "websocket.close"}:');
    await page.locator('#review-close').click();
    await page.locator('#show-context').click();
    await chooseRange(page, 150, 152);
    await save(page, 'Hidden context');
    out = await exported(page);
    assert.equal(out.comments[1].code.split('\n').length, 3);
    await page.locator('#review-close').click();
    await page.locator('#show-context').click();
    await page.locator('#review-open').click();
    await page.locator('.review-location').last().click();
    await page.waitForFunction(() => document.querySelector('#diff-body tr[data-line="150"]')?.classList.contains('review-selected'));
  });
});

test('mobile direct selection, definition clicks, expanded access and range reset remain usable', async () => {
  await withGuide('en', {mobile:true}, async page => {
    await page.locator('#diff-body tr[data-old-line="68"] .review-line').click();
    await page.waitForFunction(() => {
      const row = document.querySelector('#diff-body tr[data-old-line="68"]');
      return Math.abs(row.getBoundingClientRect().top - document.getElementById('diff-scroll').getBoundingClientRect().top - 28) < 2;
    });
    assert.ok((await page.locator('#diff-body tr[data-old-line="68"] .review-line').boundingBox()).height >= 44);
    await page.locator('#diff-body tr[data-line="70"] .review-line').click();
    assert.match(await page.locator('#review-selection-label').textContent(), /Head L70$/);
    await page.locator('#review-write').click(); await save(page, 'Head range');
    assert.equal((await exported(page)).comments[0].side, 'right');
    await page.locator('#review-close').click();
    await page.locator('#expand-code').click();
    await page.locator('#code-menu-toggle').click();
    await page.locator('#review-menu-open').click();
    assert.equal(await page.locator('.review-card').count(), 1);
    await page.keyboard.press('Escape');
    assert.equal(await page.locator('body').getAttribute('data-code-expanded'), 'true');
    await page.locator('#diff-body [data-symbol="Response"]').last().click();
    assert.equal(await page.locator('#definition-dialog').isVisible(), true);
    await page.keyboard.press('Escape');
    await page.locator('#code-menu-toggle').click(); await page.locator('#review-add').click();
    await page.locator('#next').click();
    assert.equal(await page.locator('#review-selection').isHidden(), true);
  });
});

test('deleted files export base source; binary changes offer no line comments', async () => {
  await withGuide('en', {fixture: data => {
    data.files = {
      'deleted.py': {path:'deleted.py',oldPath:'deleted.py',status:'D',lineCount:0,oldLineCount:1,added:0,removed:1,rows:[{kind:'del',old:1,new:null,text:'removed = True'}]},
      'image.png': {path:'image.png',oldPath:'image.png',status:'M',lineCount:0,oldLineCount:0,rows:[],notice:'Binary',added:null,removed:null},
    };
    data.steps = [
      {...data.steps[0], id:'entry',file:'deleted.py',notes:[]},
      {...data.steps[0], id:'binary',file:'image.png',notes:[]},
    ];
  }}, async page => {
    await chooseRange(page, 1, 1, 'left'); await save(page, 'Deletion');
    const out = await exported(page);
    assert.equal(out.comments[0].code, 'removed = True');
    assert.equal(out.comments[0].commit, out.mergeBase);
    await page.locator('#review-close').click(); await page.locator('#next').click();
    assert.equal(await page.locator('#review-add').isEnabled(), false);
    await page.locator('#review-open').click();
    assert.equal(await page.locator('#review-add-from-list').isEnabled(), false);
  });
});

test('snapshot isolation, clipboard success and storage failure keep comments exportable', async () => {
  await withGuide('en', {init: () => {
    Object.defineProperty(navigator, 'clipboard', {value:{writeText: async text => { window.copiedReview = text; }}});
  }}, async (page, changeData) => {
    await chooseRange(page, 207); await save(page, 'First snapshot');
    await page.locator('#review-copy').click();
    assert.equal(await page.evaluate(() => JSON.parse(window.copiedReview).comments[0].body), 'First snapshot');
    changeData(data => { data.head = 'f'.repeat(40); });
    await page.reload(); await page.locator('#review-open').click();
    assert.equal(await page.locator('.review-card').count(), 0);
    await page.locator('#review-close').click();
    await page.evaluate(() => { Storage.prototype.setItem = () => { throw new Error('quota'); }; });
    await chooseRange(page, 207); await save(page, 'Memory only');
    assert.match(await page.locator('#review-storage').textContent(), /unavailable/);
    assert.equal((await exported(page)).comments[0].body, 'Memory only');
  });
});

test('invalid stored data cannot execute or prevent the reader from loading', async () => {
  await withGuide('en', {init: () => {
    Storage.prototype.getItem = key => key.startsWith('pr-tour.review') ? '[{"body":"<script>bad</script>"}]' : null;
  }}, async page => {
    await page.locator('#review-open').click();
    assert.equal(await page.locator('.review-card').count(), 0);
    assert.match(await page.locator('#review-storage').textContent(), /unavailable/);
    await page.locator('#review-close').click();
    await page.locator('#next').click();
    assert.match(await page.locator('#progress-text').textContent(), /03/);
  });
});

test('import previews preserve local edits by default, replace explicitly and skip repeated imports', async () => {
  await withGuide('en', {}, async page => {
    await chooseRange(page, 207); await save(page, 'Local version');
    await page.locator('#review-close').click();
    await chooseRange(page, 208); await save(page, 'Unchanged');
    const incoming = await exported(page);
    incoming.comments[0].body = '<img src=x onerror=alert(1)> Incoming version';
    incoming.comments.push({...incoming.comments[1],id:'new-comment',body:'Added from backup'});
    await previewImport(page, incoming);
    assert.equal(await page.locator('#review-import-summary').textContent(), '1 new · 1 duplicates · 1 conflicts');
    assert.equal(await page.locator('#review-import-policy').inputValue(), 'keep');
    assert.equal(await page.locator('#review-import-conflicts img').count(), 0);
    await page.locator('#review-import-apply').click();
    let out = await exported(page);
    assert.deepEqual(out.comments.map(c => c.body), ['Local version','Unchanged','Added from backup']);
    await previewImport(page, incoming);
    assert.equal(await page.locator('#review-import-apply').isEnabled(), false);
    await page.locator('#review-import-policy').selectOption('replace');
    await page.locator('#review-import-apply').click();
    out = await exported(page);
    assert.deepEqual(out, incoming);
    assert.equal(await page.locator('.review-body img').count(), 0);
    await previewImport(page, incoming);
    assert.equal(await page.locator('#review-import-summary').textContent(), '0 new · 3 duplicates · 0 conflicts');
    assert.equal(await page.locator('#review-import-apply').isEnabled(), false);
    await page.locator('#review-import-text').fill('{}');
    assert.equal(await page.locator('#review-import-preview').isHidden(), true, 'editing invalidates the checked data');
    await page.locator('#review-import-cancel').click();
    assert.deepEqual(await exported(page), incoming);
  });
});

test('invalid files reject atomically without touching saved comments', async () => {
  await withGuide('en', {}, async page => {
    await chooseRange(page, 207); await save(page, 'Keep this');
    const backup = await exported(page);
    const stored = await page.evaluate(() => JSON.stringify(Object.entries(localStorage).filter(([key]) => key.startsWith('pr-tour.review'))));
    const mutations = [
      data => { data.schemaVersion = 2; },
      data => { data.prUrl += '9'; },
      data => { data.head = 'f'.repeat(40); },
      data => { data.base = 'f'.repeat(40); },
      data => { data.mergeBase = 'f'.repeat(40); },
      data => { data.comments[1].path = '../missing.py'; },
      data => { data.comments[1].endLine = 999999999; },
      data => { data.comments[1].side = 'other'; },
      data => { data.comments[1].commit = data.mergeBase; },
      data => { data.comments[1].code = 'different source'; },
      data => { data.comments[1].body = ' '; },
      data => { data.comments[1].updatedAt = 'invalid date'; },
      data => { data.comments[1].id = data.comments[0].id; },
    ];
    for (const mutate of mutations) {
      const incoming = structuredClone(backup);
      incoming.comments = [{...incoming.comments[0],id:'new-one',body:'Valid addition'}, {...incoming.comments[0],id:'bad-one'}];
      mutate(incoming);
      await previewImport(page, incoming);
      assert.ok((await page.locator('#review-import-error').textContent()).length > 0);
      assert.equal(await page.locator('#review-import-preview').isHidden(), true);
      await page.locator('#review-import-cancel').click();
      assert.equal(await page.locator('#review-items .review-body').textContent(), 'Keep this');
      assert.equal(await page.evaluate(() => JSON.stringify(Object.entries(localStorage).filter(([key]) => key.startsWith('pr-tour.review')))), stored);
    }
    await previewImport(page, '{broken json', true);
    await page.waitForFunction(() => document.getElementById('review-import-error').textContent.length > 0);
    await page.locator('#review-import-cancel').click();
    await page.reload(); await page.locator('#review-open').click();
    assert.deepEqual(await exported(page), backup);
  });
});

test('base-side rename imports map back to the current file and work offline without storage', async () => {
  await withGuide('en', {fixture: data => {
    data.files['starlette/websockets.py'].oldPath = 'starlette/previous.py';
    // A newly added file can reuse the old name after a rename. It has no base-side source.
    data.files['starlette/previous.py'] = {path:'starlette/previous.py',oldPath:'starlette/previous.py',status:'A',
      lineCount:1,oldLineCount:0,added:1,removed:0,rows:[{kind:'add',old:null,new:1,text:'replacement = True'}]};
    data.steps.push({...data.steps[0],id:'replacement',file:'starlette/previous.py',notes:[]});
  }}, async page => {
    await chooseRange(page, 68, 68, 'left'); await save(page, 'Old path');
    const backup = await exported(page);
    await page.locator('.review-card-actions button').last().click();
    await page.evaluate(() => { Storage.prototype.setItem = () => { throw new Error('quota'); }; });
    await previewImport(page, backup);
    await page.locator('#review-import-apply').click();
    assert.match(await page.locator('#review-storage').textContent(), /unavailable/);
    assert.deepEqual(await exported(page), backup);
    await page.locator('.review-location').click();
    await page.waitForFunction(() => document.querySelector('#diff-body tr[data-old-line="68"]')?.classList.contains('review-selected'));
  });
});

test('file URLs can restore a backup; large inputs and cancelled previews leave data unchanged', async () => {
  await withGuide('en', {file:true}, async page => {
    await chooseRange(page, 207); await save(page, 'Offline');
    const backup = await exported(page);
    await page.locator('.review-card-actions button').last().click();
    await previewImport(page, backup, true);
    await page.locator('#review-import-preview').waitFor({state:'visible'});
    await page.locator('#review-import-cancel').click();
    assert.equal(await page.locator('.review-card').count(), 0);
    await previewImport(page, backup, true);
    await page.locator('#review-import-preview').waitFor({state:'visible'});
    await page.locator('#review-import-apply').click();
    assert.deepEqual(await exported(page), backup);
    await previewImport(page, ' '.repeat(10 * 1024 * 1024 + 1), true);
    await page.waitForFunction(() => document.getElementById('review-import-error').textContent.includes('10 MiB'));
    assert.equal(await page.locator('#review-import-preview').isHidden(), true);
    await page.locator('#review-import-cancel').click();
    assert.deepEqual(await exported(page), backup);
  });
});

async function storedBodies(page) {
  return page.evaluate(() => JSON.parse(Object.entries(localStorage).find(([key]) => key.startsWith('pr-tour.review'))[1]).map(c => c.body));
}
async function idle(page) {
  await page.waitForFunction(() => document.getElementById('review-dialog').getAttribute('aria-busy') === 'false');
}
async function holdWrites(page) {
  await page.evaluate(() => {
    const data = JSON.parse(document.getElementById('guide-data').textContent);
    const key = 'pr-tour.review.v1:' + JSON.stringify([data.url, data.mergeBase, data.head]);
    navigator.locks.request(key, () => new Promise(resolve => { window.releaseReviewLock = resolve; }));
  });
  await page.waitForFunction(() => typeof window.releaseReviewLock === 'function');
}

test('two tabs serialize simultaneous additions and preserve unrelated edits, deletions, undo and imports', async () => {
  await withGuide('en', {secure:true}, async a => {
    assert.equal(await a.evaluate(() => Boolean(navigator.locks?.request)), true);
    const b = await a.context().newPage();
    await b.goto(a.url());
    await Promise.all([chooseRange(a,207), chooseRange(b,208)]);
    await a.locator('#review-text').fill('A'); await b.locator('#review-text').fill('B');
    await holdWrites(a);
    await Promise.all([a.locator('#review-save').click(), b.locator('#review-save').click()]);
    assert.equal(await a.locator('#review-save').isEnabled(), false);
    assert.equal(await b.locator('#review-save').isEnabled(), false);
    await a.evaluate(() => window.releaseReviewLock());
    await Promise.all([idle(a), idle(b)]);
    assert.deepEqual((await storedBodies(a)).sort(), ['A','B']);

    await Promise.all([a.reload(), b.reload()]);
    await Promise.all([a.locator('#review-open').click(), b.locator('#review-open').click()]);
    const card = (page, body) => page.locator('.review-card').filter({has:page.locator('.review-body', {hasText:new RegExp(`^${body}$`)})});
    await card(a,'A').locator('.review-card-actions button').first().click(); await save(a,'A edited');
    await card(b,'B').locator('.review-card-actions button').first().click(); await save(b,'B edited');
    assert.deepEqual((await storedBodies(a)).sort(), ['A edited','B edited']);

    await card(a,'A edited').locator('.review-card-actions button').last().click(); await idle(a);
    assert.deepEqual(await storedBodies(a), ['B edited']);
    const incoming = await exported(b);
    incoming.comments = [{...incoming.comments[0],id:'import-from-b',body:'Imported in B'}];
    await previewImport(b, incoming); await b.locator('#review-import-apply').click(); await idle(b);
    assert.deepEqual((await storedBodies(a)).sort(), ['B edited','Imported in B']);
    await a.locator('#review-feedback button').click(); await idle(a);
    assert.deepEqual((await storedBodies(a)).sort(), ['A edited','B edited','Imported in B']);
    await b.reload(); await b.locator('#review-open').click();
    assert.deepEqual((await b.locator('.review-body').allTextContents()).sort(), ['A edited','B edited','Imported in B']);
  });
});

test('same-ID conflicts preserve the other tab and keep local edits exportable before reload', async () => {
  await withGuide('en', {secure:true}, async a => {
    await chooseRange(a,207); await save(a,'Original');
    const b = await a.context().newPage(); await b.goto(a.url()); await b.locator('#review-open').click();
    await a.locator('.review-card-actions button').first().click(); await save(a,'Saved in A');
    await b.locator('.review-card-actions button').first().click(); await save(b,'Unsaved in B');
    assert.deepEqual(await storedBodies(b), ['Saved in A']);
    assert.match(await b.locator('#review-storage').textContent(), /another tab.*Download JSON before reloading/);
    assert.equal((await exported(b)).comments[0].body, 'Unsaved in B');
    await b.locator('.review-card-actions button').first().click(); await save(b,'Still exportable in B');
    assert.deepEqual(await storedBodies(b), ['Saved in A']);
    assert.equal((await exported(b)).comments[0].body, 'Still exportable in B');
    await b.reload(); await b.locator('#review-open').click();
    assert.equal(await b.locator('.review-body').textContent(), 'Saved in A');
  });
});

test('a stale deletion cannot erase another tab edit and remains undoable in memory', async () => {
  await withGuide('en', {secure:true}, async a => {
    await chooseRange(a,207); await save(a,'Original');
    const b = await a.context().newPage(); await b.goto(a.url()); await b.locator('#review-open').click();
    await a.locator('.review-card-actions button').first().click(); await save(a,'Saved in A');
    await b.locator('.review-card-actions button').last().click(); await idle(b);
    assert.deepEqual(await storedBodies(b), ['Saved in A']);
    assert.match(await b.locator('#review-storage').textContent(), /another tab/);
    await b.locator('#review-feedback button').click(); await idle(b);
    assert.equal((await exported(b)).comments[0].body, 'Original');
    assert.deepEqual(await storedBodies(b), ['Saved in A']);
  });
});

test('without Web Locks a stale tab refuses storage changes and exports its current comments', async () => {
  await withGuide('en', {secure:true,init:() => Object.defineProperty(navigator,'locks',{value:undefined})}, async a => {
    const b = await a.context().newPage(); await b.goto(a.url());
    await chooseRange(a,207); await save(a,'Saved in A');
    await chooseRange(b,208); await save(b,'Local in B');
    assert.deepEqual(await storedBodies(b), ['Saved in A']);
    assert.match(await b.locator('#review-storage').textContent(), /another tab.*Download JSON before reloading/);
    assert.equal((await exported(b)).comments[0].body, 'Local in B');
  });
});

test('queued saves do not reopen a dismissed sheet or discard a newer editor draft', async () => {
  await withGuide('en', {secure:true}, async page => {
    await chooseRange(page,207); await page.locator('#review-text').fill('Pending save');
    await holdWrites(page); await page.locator('#review-save').click();
    await page.locator('#review-close').click();
    await chooseRange(page,208); await page.locator('#review-text').fill('Newer draft');
    await page.evaluate(() => window.releaseReviewLock()); await idle(page);
    assert.equal(await page.locator('#review-editor').isVisible(), true);
    assert.equal(await page.locator('#review-text').inputValue(), 'Newer draft');
    await page.locator('#review-save').click(); await idle(page);
    assert.deepEqual(await storedBodies(page), ['Pending save','Newer draft']);

    await page.locator('.review-card-actions button').first().click();
    await page.locator('#review-text').fill('Closed while saving');
    await page.evaluate(() => { delete window.releaseReviewLock; }); await holdWrites(page);
    await page.locator('#review-save').click(); await page.locator('#review-close').click();
    await page.evaluate(() => window.releaseReviewLock()); await idle(page);
    assert.equal(await page.locator('#review-dialog').isVisible(), false);
    assert.deepEqual(await storedBodies(page), ['Closed while saving','Newer draft']);

    await page.locator('#review-open').click();
    await page.locator('.review-card-actions button').first().click();
    await page.locator('#review-text').fill('Submitted text');
    await page.evaluate(() => { delete window.releaseReviewLock; }); await holdWrites(page);
    await page.locator('#review-save').click();
    await page.locator('#review-text').fill('Typed while waiting');
    await page.evaluate(() => window.releaseReviewLock()); await idle(page);
    assert.equal(await page.locator('#review-editor').isVisible(), true);
    assert.equal(await page.locator('#review-text').inputValue(), 'Typed while waiting');
    assert.deepEqual(await storedBodies(page), ['Submitted text','Newer draft']);
    await page.locator('#review-save').click(); await idle(page);
    assert.deepEqual(await storedBodies(page), ['Typed while waiting','Newer draft']);
  });
});

test('corrupt storage appearing after load is preserved while the current comment can be exported', async () => {
  await withGuide('en', {secure:true}, async page => {
    await chooseRange(page,207); await save(page,'Original');
    const corrupt = '{broken';
    await page.evaluate(value => {
      const key = Object.keys(localStorage).find(key => key.startsWith('pr-tour.review'));
      localStorage.setItem(key,value);
    }, corrupt);
    await page.locator('.review-card-actions button').first().click(); await save(page,'Memory only');
    assert.match(await page.locator('#review-storage').textContent(), /unavailable/);
    assert.equal((await exported(page)).comments[0].body, 'Memory only');
    assert.equal(await page.evaluate(() => Object.entries(localStorage).find(([key]) => key.startsWith('pr-tour.review'))[1]), corrupt);
  });
});
