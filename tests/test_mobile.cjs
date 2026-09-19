const {test, before, after} = require('node:test');
const assert = require('node:assert/strict');
const {resolve} = require('node:path');
const {pathToFileURL} = require('node:url');
const {chromium, webkit} = require('playwright');

const browserName = process.env.PR_TOUR_BROWSER || 'chromium';
let browser;
before(async () => { browser = await ({chromium, webkit})[browserName].launch(); });
after(async () => { await browser?.close(); });

async function withGuide(language, run) {
  const context = await browser.newContext({viewport: {width: 390, height: 844}, hasTouch: true});
  const page = await context.newPage();
  page.setDefaultTimeout(8000);
  page.setDefaultNavigationTimeout(8000);
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  try {
    await context.route(/^https?:/, route => route.abort());
    await page.goto(pathToFileURL(resolve(`docs/demo.${language}.html`)).href + '#entry');
    await run(page);
    assert.deepEqual(errors, []);
  } finally {
    await context.close();
  }
}

async function assertFocusedLinesVisible(page) {
  await page.waitForFunction(() => {
    const row = document.querySelector('#diff-body tr.focus');
    const pane = document.getElementById('diff-scroll');
    if (!row || !pane.clientHeight) return false;
    const r = row.getBoundingClientRect(), p = pane.getBoundingClientRect();
    return r.top >= p.top - 1 && r.top < p.bottom;
  });
}

async function assertFits(page, selector, minHeight = 0) {
  const box = await page.locator(selector).boundingBox();
  const viewport = page.viewportSize();
  assert.ok(box, `${selector} is visible`);
  assert.ok(box.x >= -1 && box.x + box.width <= viewport.width + 1, `${selector} fits horizontally`);
  assert.ok(box.y >= -1 && box.y + box.height <= viewport.height + 1, `${selector} fits vertically`);
  assert.ok(box.height >= minHeight, `${selector} is tall enough (${box.height})`);
}

for (const language of ['en', 'ko']) {
  test(`${language}: notes open focused code; each pane retains its reading position`, async () => {
    await withGuide(language, async page => {
      assert.equal(await page.locator('#guide').isVisible(), true);
      assert.equal(await page.locator('#code-pane').isHidden(), true);
      await page.locator('#guide').evaluate(el => { el.scrollTop = 70; });
      const guideTop = await page.locator('#guide').evaluate(el => el.scrollTop);
      await page.locator('.note-button').first().tap();
      await assertFocusedLinesVisible(page);
      assert.equal(await page.locator('#guide').isHidden(), true);
      assert.equal(await page.locator('#diff-scroll').evaluate(el => el === document.activeElement), true);
      await page.locator('#diff-scroll').evaluate(el => { el.scrollTop += 120; el.scrollLeft = 100; });
      const position = await page.locator('#diff-scroll').evaluate(el => [el.scrollTop, el.scrollLeft]);
      await page.locator('#guide-tab').tap();
      assert.equal(await page.locator('#guide').evaluate(el => el.scrollTop), guideTop);
      await page.locator('#code-tab').tap();
      assert.deepEqual(await page.locator('#diff-scroll').evaluate(el => [el.scrollTop, el.scrollLeft]), position);
      await page.locator('#next').tap();
      await page.waitForURL('**#serialize');
      await page.locator('#guide').waitFor({state: 'visible'});
      assert.equal(await page.locator('#guide').isVisible(), true);
      assert.equal(await page.locator('#guide').evaluate(el => el.scrollTop), 0);
      await page.locator('#code-tab').tap();
      await assertFocusedLinesVisible(page);
      assert.equal(await page.locator('#diff-scroll').evaluate(el => el.scrollLeft), 0, 'a different file starts at its left edge');
    });
  });

  test(`${language}: wrapping preserves source and definition links without page overflow`, async () => {
    await withGuide(language, async page => {
      await page.locator('#code-tab').tap();
      const source = await page.locator('#diff-body').textContent();
      await page.locator('#wrap-code').tap();
      assert.equal(await page.locator('#diff-body').textContent(), source);
      assert.equal(await page.locator('#wrap-code').getAttribute('aria-pressed'), 'true');
      await assertFocusedLinesVisible(page);
      assert.ok(await page.locator('#diff-scroll').evaluate(el => el.scrollWidth <= el.clientWidth + 1));
      await page.locator('#diff-body [data-symbol="Response"]').last().tap();
      await assertFits(page, '#definition-dialog', 700);
      assert.ok(await page.locator('#definition-code').evaluate(el => el.scrollWidth <= el.clientWidth + 1));
      assert.equal(await page.locator('.desktop-hint').isVisible(), false);
      await assertFits(page, '#definition-close', 44);
      await page.locator('#definition-body .symbol-link').first().tap();
      await assertFits(page, '#definition-back', 44);
      await page.locator('#definition-back').tap();
      await page.locator('#definition-close').tap();
      assert.equal(await page.locator('#definition-dialog').isHidden(), true);
      await page.locator('#wrap-code').tap();
      assert.equal(await page.locator('#diff-body').textContent(), source);
      assert.ok(await page.locator('#diff-scroll').evaluate(el => el.scrollWidth > el.clientWidth));
    });
  });

  test(`${language}: narrow phones, tablets and landscape keep code and controls reachable`, async () => {
    await withGuide(language, async page => {
      for (const viewport of [{width:320,height:480},{width:320,height:568},{width:768,height:1024},{width:844,height:390}]) {
        await page.setViewportSize(viewport);
        await page.locator('#code-tab').tap();
        await page.locator('#focus-back').tap();
        await assertFocusedLinesVisible(page);
        await assertFits(page, '#diff-scroll', 100);
        for (const selector of ['#next', '#previous', '#guide-tab', '#code-tab', '#step-select', '#wrap-code']) {
          await assertFits(page, selector, 44);
        }
        assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
        await page.locator('#wrap-code').tap();
        assert.ok(await page.locator('#diff-scroll').evaluate(el => el.scrollWidth <= el.clientWidth + 1));
        await page.locator('#diff-body [data-symbol="Response"]').last().tap();
        await assertFits(page, '#definition-close', 44);
        await assertFits(page, '#definition-code', 80);
        await page.locator('#definition-close').tap();
        await page.locator('#wrap-code').tap();
      }
    });
  });

  test(`${language}: keyboard tabs, every step and desktop pane order remain usable`, async () => {
    await withGuide(language, async page => {
      await page.locator('#guide-tab').focus();
      await page.keyboard.press('ArrowRight');
      assert.equal(await page.locator('#code-tab').getAttribute('aria-selected'), 'true');
      assert.equal(await page.locator('#code-tab').evaluate(el => el === document.activeElement), true);
      await assertFocusedLinesVisible(page);
      await page.keyboard.press('Home');
      assert.equal(await page.locator('#guide').isVisible(), true);
      const ids = await page.locator('#step-select option').evaluateAll(options => options.map(option => option.value));
      for (const id of ids) {
        await page.locator('#step-select').selectOption(id);
        await page.waitForFunction(index => document.getElementById('progress-text').textContent.startsWith(String(Number(index) + 1).padStart(2, '0')), id);
        assert.equal(await page.locator('#guide').isVisible(), true);
        await page.locator('#code-tab').tap();
        await assertFocusedLinesVisible(page);
      }
      await page.setViewportSize({width:1280,height:900});
      await page.locator('#guide').waitFor({state: 'visible'});
      await page.locator('#code-pane').waitFor({state: 'visible'});
      assert.equal(await page.locator('#guide').isVisible(), true);
      assert.equal(await page.locator('#code-pane').isVisible(), true);
      assert.equal(await page.locator('#code-tab').isVisible(), false);
      await page.locator('#layout-select').selectOption('code-first');
      assert.ok((await page.locator('#code-pane').boundingBox()).x < (await page.locator('#guide').boundingBox()).x);
      await page.setViewportSize({width:390,height:844});
      await page.locator('#guide-tab').tap();
      assert.equal(await page.locator('#code-pane').isHidden(), true);
      await page.setViewportSize({width:1280,height:900});
      await page.locator('#code-pane').waitFor({state: 'visible'});
      assert.equal(await page.locator('#workspace').getAttribute('data-layout'), 'code-first');
      assert.equal(await page.locator('#guide').isVisible(), true);
      assert.equal(await page.locator('#code-pane').isVisible(), true);
    });
  });
}
