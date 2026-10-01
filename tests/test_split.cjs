const {test, before, after} = require('node:test');
const assert = require('node:assert/strict');
const {readFileSync} = require('node:fs');
const {resolve} = require('node:path');
const {pathToFileURL} = require('node:url');
const {chromium, webkit} = require('playwright');
let browser;
before(async () => { browser = await ({chromium, webkit})[process.env.PR_TOUR_BROWSER || 'chromium'].launch(); });
after(async () => { await browser?.close(); });

async function withGuide(language, options, run) {
  const context = await browser.newContext({viewport:options.mobile ? {width:390,height:844} : {width:1600,height:1000}});
  const page = await context.newPage();
  page.setDefaultTimeout(8000);
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  try {
    await context.route(/^https?:/, route => route.abort());
    if (options.init) await page.addInitScript(options.init);
    let url = pathToFileURL(resolve(`docs/demo.${language}.html`)).href;
    if (options.fixture) {
      let html = readFileSync(`docs/demo.${language}.html`, 'utf8').replace(/(<script type="application\/json" id="guide-data">)([\s\S]*?)(<\/script>)/, (_, a, json, b) => {
        const data = JSON.parse(json); options.fixture(data);
        return a + JSON.stringify(data).replace(/</g, '\\u003c') + b;
      });
      url = 'http://tour.test/split.html';
      await context.route(url, route => route.fulfill({body:html,contentType:'text/html'}));
    }
    await page.goto(url + '#entry');
    await page.waitForFunction(() => !document.querySelector('#review-open').disabled);
    if (options.mobile) await page.locator('#code-tab').click();
    await run(page);
    assert.deepEqual(errors, []);
  } finally { await context.close(); }
}
async function mode(page, value) {
  if (await page.locator('#code-menu-toggle').isVisible()) await page.locator('#code-menu-toggle').click();
  await page.locator('#diff-view').selectOption(value);
  if (await page.locator('#code-menu-toggle').isVisible()) await page.keyboard.press('Escape');
}
async function fullFile(page) {
  if (await page.locator('#code-menu-toggle').isVisible()) await page.locator('#code-menu-toggle').click();
  await page.locator('#show-context').click();
}
async function sourceEquals(page, file) {
  const result = await page.evaluate(file => {
    const data = JSON.parse(document.querySelector('#guide-data').textContent);
    const flat = data.files[file].rows.flatMap(r => r.kind === 'gap' ? r.lines : r.kind === 'hunk' ? [] : [r]);
    return ['left','right'].map(side => {
      const col = side === 'left' ? 'old' : 'new', attr = side === 'left' ? 'data-old-line' : 'data-line';
      return {
        expected:flat.filter(r => Number.isInteger(r[col])).map(r => [r[col],r.text]),
        actual:[...document.querySelectorAll(`#diff-body tr[${attr}]`)].map(r => [Number(r.getAttribute(attr)),r.querySelector(`.code-cell[data-side="${side}"]`).textContent]),
      };
    });
  }, file);
  for (const side of result) assert.deepEqual(side.actual, side.expected);
}

for (const language of ['ko','en']) {
  test(`${language}: both split snapshots match every complete source file, with persisted view and definitions`, async () => {
    await withGuide(language, {}, async page => {
      assert.equal(await page.locator('#diff-view').inputValue(), 'unified');
      await mode(page, 'split');
      const files = await page.evaluate(() => {
        const d = JSON.parse(document.querySelector('#guide-data').textContent);
        return Object.keys(d.files).map(file => ({file,index:d.steps.findIndex(s => s.file === file)}));
      });
      for (const {file,index} of files) {
        await page.locator(`.nav-step[data-step="${index}"]`).click();
        if (await page.locator('#show-context').isEnabled()) await fullFile(page);
        await sourceEquals(page, file);
        const count = await page.locator('#diff-body tr[data-line]').count();
        await mode(page, 'unified'); await mode(page, 'split');
        assert.equal(await page.locator('#diff-body tr[data-line]').count(), count, 'expanded context survives both switches');
        await sourceEquals(page, file);
      }
      await page.locator('.nav-step[data-step="1"]').click();
      await page.locator('#diff-body [data-side="right"] .symbol-link[data-symbol="Response"]').first().click();
      assert.equal(await page.locator('#definition-dialog').getAttribute('open'), '');
      await page.keyboard.press('Escape');
      assert.equal(await page.locator('#diff-body .context[data-side="left"] .symbol-link').count(), 0, 'head-only definition links are not attributed to base context');
      await page.reload();
      assert.equal(await page.locator('#diff-view').inputValue(), 'split');
      assert.equal(await page.locator('.diff-table').getAttribute('data-view'), 'split');
      assert.deepEqual(await page.locator('.split-heading th').allTextContents(), language === 'ko' ? ['변경 전','변경 후'] : ['Base','Head']);
      assert.ok(await page.locator('#diff-body [data-side="right"] .hljs-keyword').count());
      await page.setViewportSize({width:851,height:900});
      assert.ok(await page.locator('#diff-view').evaluate(el => el.getBoundingClientRect().right <= innerWidth), 'diff control stays reachable on narrow desktop');
      assert.ok(await page.locator('#focus-back').evaluate(el => el.getBoundingClientRect().right <= innerWidth), 'toolbar wraps within the code pane');
    });
  });
}

function fixture(data) {
  const path = 'starlette/websockets.py';
  const row = (kind,old,next,text) => ({kind,old,new:next,text});
  data.steps = [{id:'entry',title:'Changes',heading:'Changes',why:'Compare both versions',group:'Test',file:path,notes:[
    {title:'Before',start:2,end:3,side:'left',text:'Old code'},
    {title:'After',start:2,end:4,side:'right',text:'New code'},
  ],check:'Check',next:''}];
  data.files = {[path]:{path,oldPath:'starlette/old.py',status:'R',added:4,removed:3,lineCount:37,oldLineCount:36,rows:[
    row('context',1,1,'# unchanged'), row('del',2,null,'old = 1'),row('del',3,null,'old = 2'),
    row('add',null,2,'new = 1'),row('add',null,3,'new = 2'),row('add',null,4,'new = 3'),
    {kind:'gap',id:'g',lines:Array.from({length:30},(_,i)=>row('context',i+4,i+5,`context_${i} = "<literal> 😀"`))},
    row('del',34,null,'removed = True'),row('context',35,35,'# unchanged end'),
    row('add',null,36,'added = True'),row('context',36,37,'# end'),
  ]}};
}
for (const mobile of [false,true]) {
  test(`split ${mobile ? 'mobile' : 'desktop'}: unequal edits, gaps, side-specific focus, comments and source links survive toggling`, async () => {
    await withGuide('en', {mobile,fixture}, async page => {
      await mode(page, 'split');
      const pairs = await page.locator('#diff-body tr.split-row').evaluateAll(rows => rows.map(r => [Number(r.dataset.oldLine)||null,Number(r.dataset.line)||null]));
      assert.deepEqual(pairs, [[1,1],[2,2],[3,3],[null,4],[34,null],[35,35],[null,36],[36,37]]);
      assert.equal(await page.locator('tr[data-line="4"] [data-side="left"].empty .review-line').count(), 0);
      let colors = await page.locator('tr[data-old-line="2"] .code-cell').evaluateAll(cells => cells.map(c => getComputedStyle(c).boxShadow));
      assert.notEqual(colors[0], 'none'); assert.equal(colors[1], 'none');
      await fullFile(page); await sourceEquals(page, 'starlette/websockets.py');
      for (const side of ['left','right']) {
        const attr = side === 'left' ? 'data-old-line' : 'data-line';
        await page.locator(`tr[${attr}="2"] .review-line[data-side="${side}"]`).click();
        await page.locator(`tr[${attr}="3"] .review-line[data-side="${side}"]`).click();
        await mode(page,'unified'); await mode(page,'split');
        assert.equal(await page.locator(`.review-line[data-side="${side}"][aria-pressed=true]`).count(),2);
        await page.locator('#review-write').click();
        assert.equal(await page.locator('#review-code').textContent(), side === 'left' ? 'old = 1\nold = 2' : 'new = 1\nnew = 2');
        await page.locator('#review-text').fill(`Feedback on ${side}`);
        await page.locator('#review-save').click();
        await page.waitForFunction(() => !document.querySelector('#review-open').disabled);
        await page.locator('#review-list .review-location').last().click();
        await page.waitForFunction(side => document.querySelector('.diff-table').dataset.focusSide === side,side);
        assert.match(await page.locator('#source-link').getAttribute('href'), side === 'left' ? /starlette\/old.py#L2-L3$/ : /starlette\/websockets.py#L2-L3$/);
        await mode(page,'unified'); await mode(page,'split');
        assert.equal(await page.locator('.diff-table').getAttribute('data-focus-side'),side);
        assert.equal(await page.locator(`.review-line.has-comment[data-side="${side}"]`).count(),2);
      }
      if (mobile) {
        await page.locator('#code-menu-toggle').click(); await page.locator('#wrap-code').click();
        assert.ok(await page.locator('.diff-table').evaluate(el => el.getBoundingClientRect().width <= innerWidth + 1));
        await page.locator('#next').click();
        assert.equal(await page.locator('#focus-lines').textContent(),'L2–4');
      }
    });
  });
}

test('invalid or unavailable preference storage keeps the view usable', async () => {
  for (const init of [() => localStorage.setItem('pr-tour.diff-view','unknown'), () => {
    Storage.prototype.getItem = () => { throw Error('blocked'); };
    Storage.prototype.setItem = () => { throw Error('blocked'); };
  }]) await withGuide('en',{init},async page => {
    assert.equal(await page.locator('#diff-view').inputValue(),'unified');
    await mode(page,'split');
    assert.ok(await page.locator('.split-row').count());
  });
});

test('partial gaps and the visible source line keep their position when switching views', async () => {
  await withGuide('en',{},async page => {
    await mode(page,'split');
    const id = await page.evaluate(() => JSON.parse(document.querySelector('#guide-data').textContent)
      .files['starlette/websockets.py'].rows.find(r => r.kind === 'gap' && r.lines.length > 40).id);
    const gap = page.locator(`#diff-body tr[data-gap="${id}"]`);
    const before = await page.locator('#diff-body tr[data-line]').count();
    await gap.locator('button').first().click();
    await page.locator(`#diff-body tr[data-gap="${id}"] button`).nth(1).click();
    assert.equal(await page.locator('#diff-body tr[data-line]').count(),before+40);
    const anchor = await page.locator('#diff-body tr[data-line]').evaluateAll(rows => {
      const scroll = document.querySelector('#diff-scroll');
      const row = rows.find(r => r.getBoundingClientRect().top > scroll.getBoundingClientRect().top+40);
      scroll.scrollTop += row.getBoundingClientRect().top-scroll.getBoundingClientRect().top-48;
      return {line:row.dataset.line,offset:row.getBoundingClientRect().top-scroll.getBoundingClientRect().top};
    });
    await mode(page,'unified'); await mode(page,'split');
    assert.equal(await page.locator('#diff-body tr[data-line]').count(),before+40);
    const offset = await page.locator(`#diff-body tr[data-line="${anchor.line}"]`).evaluate(row => row.getBoundingClientRect().top-document.querySelector('#diff-scroll').getBoundingClientRect().top);
    assert.ok(Math.abs(offset-anchor.offset)<2,`${offset} vs ${anchor.offset}`);
  });
});

test('added, deleted, renamed and unavailable files render without inventing source lines', async () => {
  for (const status of ['A','D','R','binary']) await withGuide('en',{fixture:data => {
    fixture(data);
    const file = data.files['starlette/websockets.py'];
    data.steps[0].notes=[];
    file.status=status === 'binary' ? 'M' : status;
    file.rows = status === 'A' ? [{kind:'add',new:1,old:null,text:'new = True'}] : status === 'D' ? [{kind:'del',old:1,new:null,text:'old = True'}] : [];
    if (status === 'binary') file.notice='Binary file: no text preview';
    if (status === 'R') file.changeNote='Renamed without content changes';
  }},async page => {
    await mode(page,'split');
    assert.equal(await page.locator('#diff-body tr[data-line]').count(),status === 'A' ? 1 : 0);
    assert.equal(await page.locator('#diff-body tr[data-old-line]').count(),status === 'D' ? 1 : 0);
    if (['R','binary'].includes(status)) assert.ok(await page.locator('#diff-body tr.hunk').count());
    assert.equal(await page.locator('#show-context').isDisabled(),true);
    await mode(page,'unified'); await mode(page,'split');
  });
});
