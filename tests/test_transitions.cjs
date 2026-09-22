const {test, before, after} = require('node:test');
const assert = require('node:assert/strict');
const {resolve} = require('node:path');
const {readFileSync} = require('node:fs');
const {pathToFileURL} = require('node:url');
const {chromium, webkit} = require('playwright');

let browser;
before(async () => { browser = await ({chromium, webkit})[process.env.PR_TOUR_BROWSER || 'chromium'].launch(); });
after(async () => { await browser?.close(); });

async function withGuide(language, run, {fixture, width = 1440, step = 'entry'} = {}) {
  const context = await browser.newContext({viewport: {width, height: 900}});
  const page = await context.newPage();
  page.setDefaultTimeout(8000);
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  try {
    await context.route(/^https?:/, route => route.abort());
    const file = resolve(`docs/demo.${language}.html`);
    let url = pathToFileURL(file).href;
    if (fixture) {
      const html = readFileSync(file, 'utf8').replace(/(<script type="application\/json" id="guide-data">)([\s\S]*?)(<\/script>)/, (_, start, json, end) => {
        const data = JSON.parse(json);
        fixture(data);
        return start + JSON.stringify(data).replace(/</g, '\\u003c') + end;
      });
      url = 'http://pr-tour.test/transitions.html';
      await context.route(url, route => route.fulfill({contentType: 'text/html', body: html}));
    }
    await page.goto(url + '#' + step);
    await run(page, url);
    assert.deepEqual(errors, []);
  } finally { await context.close(); }
}

for (const language of ['en', 'ko']) {
  test(`${language}: offline citations expose exact source, lines and pinned links`, async () => {
    await withGuide(language, async (page, url) => {
      const data = await page.locator('#guide-data').evaluate(el => JSON.parse(el.textContent));
      await page.locator('.transition-evidence > summary').focus();
      await page.keyboard.press('Enter');
      await page.locator('.transition-excerpt').first().waitFor();
      const refs = data.steps.find(step => step.id === 'entry').transition.evidence;
      assert.equal(await page.locator('.transition-excerpt').count(), refs.length);
      for (const [i, ref] of refs.entries()) {
        const excerpt = page.locator('.transition-excerpt').nth(i);
        assert.deepEqual(await excerpt.locator('.transition-line-source').allTextContents(), ref.rows.map(row => row.text));
        assert.deepEqual(await excerpt.locator('.transition-line-number').allTextContents(), ref.rows.map(row => String(row.line)));
        const href = await excerpt.locator('.transition-source').getAttribute('href');
        assert.ok(href.includes(`/blob/${data.head}/${ref.path}`));
        assert.ok(href.endsWith(`#L${ref.start}-L${ref.end}`));
        assert.ok(await excerpt.locator('.hljs-keyword').count());
        const token = excerpt.locator('.hljs-keyword').first();
        assert.notEqual(await token.evaluate(el => getComputedStyle(el).color), await excerpt.locator('.transition-code').evaluate(el => getComputedStyle(el).color));
      }
      await page.locator('.transition-evidence > summary').click();
      await page.locator('.transition-evidence > summary').click();
      assert.equal(await page.locator('.transition-excerpt').count(), refs.length);
      await page.goto(url + '#finish-body');
      assert.equal(await page.locator('.transition-badge.inferred').count(), 1);
      assert.ok((await page.locator('.transition-uncertainty').textContent()).length > 50);
      await page.locator('.transition-evidence > summary').click();
      await page.locator('.transition-excerpt').first().waitFor();
      assert.ok((await page.locator('.transition-line-source').allTextContents()).some(text => text.includes('self._send_queue.put(message)')));
      await page.locator('.transition-overview > summary').click();
      const counts = await page.locator('.transition-overview li').allTextContents();
      assert.deepEqual(counts.map(text => Number(text.split(': ').pop())), [3, 1, 3, 0]);
      if (language === 'en') assert.doesNotMatch(await page.locator('.next-flow').textContent(), /[가-힣]/);
      await page.goto(url + '#contract');
      assert.equal(await page.locator('.transition-badge.reading').count(), 1);
      assert.equal(await page.locator('.transition-evidence').count(), 0);
      await page.goto(url + '#reject-invalid');
      assert.equal(await page.locator('.transition-badge').count(), 0);
      assert.equal(await page.locator('.transition-evidence').count(), 0);
      assert.equal(await page.locator('#next').isDisabled(), true);
    });
  });

  test(`${language}: citation controls and long source fit a narrow screen without changing code navigation`, async () => {
    await withGuide(language, async page => {
      await page.locator('.transition-evidence > summary').click();
      await page.locator('.transition-excerpt').first().waitFor();
      const viewport = page.viewportSize();
      for (const selector of ['.next-flow', '.transition-evidence > summary', '.transition-code']) {
        for (const box of await page.locator(selector).evaluateAll(nodes => nodes.map(el => {
          const b = el.getBoundingClientRect(); return {x:b.x, right:b.right, height:b.height};
        }))) {
          assert.ok(box.x >= -1 && box.right <= viewport.width + 1, `${selector} stays within the screen`);
          if (selector.endsWith('summary')) assert.ok(box.height >= 44);
        }
      }
      assert.ok(await page.locator('.transition-code').first().evaluate(el => el.scrollWidth <= el.clientWidth + 1));
      await page.locator('#code-tab').click();
      await page.locator('#expand-code').click();
      await page.locator('#next').click();
      await page.waitForURL('**#serialize');
      assert.equal(await page.locator('#guide').isHidden(), true);
      assert.equal(await page.locator('#diff-body tr.focus').first().getAttribute('data-line'), '150');
      await page.locator('#show-guide').click();
      assert.equal(await page.locator('.transition-badge.source').count(), 1);
      await page.locator('.transition-evidence > summary').click();
      await page.locator('.transition-excerpt').first().waitFor();
      assert.equal(await page.locator('#definition-dialog').isVisible(), false);
    }, {width:320});
  });
}

test('untrusted citation strings remain text and old-side links use merge base', async () => {
  const hostile = '</script><img id="injected" src=x onerror="window.injected=true">😀 &lt;\r';
  await withGuide('en', async page => {
    await page.locator('.transition-evidence > summary').click();
    await page.locator('.transition-excerpt').first().waitFor();
    assert.equal(await page.locator('#injected').count(), 0);
    assert.equal(await page.locator('.transition-reason').textContent(), hostile);
    assert.equal(await page.locator('.transition-line-source').textContent(), hostile);
    assert.ok((await page.locator('.transition-uncertainty').textContent()).includes(hostile));
    const data = await page.locator('#guide-data').evaluate(el => JSON.parse(el.textContent));
    const href = await page.locator('.transition-source').getAttribute('href');
    assert.ok(href.endsWith(`/blob/${data.mergeBase}/old%20name.py#L1`));
  }, {fixture(data) {
    const step = data.steps.find(step => step.id === 'entry');
    step.next = hostile;
    step.transition = {to:'serialize',basis:'inferred',uncertainty:hostile,evidence:[{
      path:'old name.py',side:'left',start:1,end:1,text:hostile,rows:[{line:1,text:hostile}]
    }]};
  }});
});

test('missing, legacy, and single-step guides do not imply verified connections', async () => {
  await withGuide('en', async page => {
    assert.equal(await page.locator('.transition-badge.missing').count(), 1);
    assert.equal(await page.locator('.transition-evidence').count(), 0);
    await page.locator('.transition-overview > summary').click();
    assert.match(await page.locator('.transition-overview').textContent(), /not authored: 1/);
  }, {fixture(data) {
    delete data.steps[1].transition;
    data.transitionSummary.source -= 1;
    data.transitionSummary.missing += 1;
  }});
  for (const single of [false,true]) {
    await withGuide('en', async page => {
      assert.equal(await page.locator('.transition-badge').count(), 0);
      assert.equal(await page.locator('.transition-overview').count(), 0);
      assert.equal(await page.locator('.transition-evidence').count(), 0);
      assert.ok((await page.locator('.transition-reason').textContent()).length);
      assert.equal(await page.locator('#next').isDisabled(), single);
    }, {fixture(data) {
      data.steps.forEach(step => delete step.transition);
      data.transitionSummary.enabled = false;
      if (single) data.steps = [data.steps[1]];
    }});
  }
});
