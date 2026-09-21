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

async function withGuide(language, run, fixture) {
  const context = await browser.newContext({viewport: {width: 390, height: 844}, hasTouch: true});
  const page = await context.newPage();
  page.setDefaultTimeout(8000);
  page.setDefaultNavigationTimeout(8000);
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  try {
    await context.route(/^https?:/, route => route.abort());
    const path = resolve(`docs/demo.${language}.html`);
    let url = pathToFileURL(path).href;
    if (fixture) {
      const html = readFileSync(path, 'utf8').replace(/(<script type="application\/json" id="guide-data">)([\s\S]*?)(<\/script>)/, (_, start, json, end) => {
        const data = JSON.parse(json);
        fixture(data);
        return start + JSON.stringify(data).replace(/</g, '\\u003c') + end;
      });
      url = 'http://pr-tour.test/guide.html';
      await context.route(url, route => route.fulfill({contentType: 'text/html', body: html}));
    }
    await page.goto(url + '#entry');
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
    return r.top >= p.top - 1 && r.top <= p.top + 29 && r.top < p.bottom;
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

async function useCodeTool(page, selector) {
  await page.locator('#code-menu-toggle').tap();
  await page.locator(selector).tap();
  assert.equal(await page.locator('#code-menu').isHidden(), true);
}

for (const language of ['en', 'ko']) {
  test(`${language}: code navigation includes steps without notes and distinguishes old/new lines`, async () => {
    await withGuide(language, async page => {
      await page.locator('#code-tab').tap();
      assert.equal(await page.locator('#previous').isDisabled(), true);
      assert.equal(await page.locator('#diff-body tr.focus').count(), 0);
      await page.locator('#next').tap();
      await assertFocusedLinesVisible(page);
      const row = page.locator('#diff-body tr.focus').first();
      assert.equal(await row.getAttribute('data-old-line'), '68');
      assert.match(await row.getAttribute('class'), /\bdel\b/);
      await page.locator('#code-menu-toggle').tap();
      const source = await page.locator('#mobile-source-link').getAttribute('href');
      const base = await page.locator('#guide-data').evaluate(el => JSON.parse(el.textContent).mergeBase);
      assert.ok(source.includes(`/blob/${base}/`));
      assert.ok(source.endsWith('#L68'));
      await page.keyboard.press('Escape');
      await page.locator('#next').tap();
      assert.equal(await row.getAttribute('data-line'), '68');
      assert.doesNotMatch(await row.getAttribute('class'), /\bdel\b/);
      await assertFocusedLinesVisible(page);
      await page.locator('#next').tap();
      assert.equal(await page.locator('#diff-body tr.focus').count(), 0);
      assert.equal(await page.locator('#diff-scroll').evaluate(el => el.scrollTop), 0);
      assert.equal(await page.locator('#next').isDisabled(), true);
      await page.locator('#previous').tap();
      assert.equal(await row.getAttribute('data-line'), '68');
      await page.locator('#previous').tap();
      assert.equal(await row.getAttribute('data-old-line'), '68');
      await page.locator('#previous').tap();
      assert.equal(await page.locator('#previous').isDisabled(), true);
      assert.equal(await page.locator('#code-pane').isVisible(), true);
    }, data => {
      const start = {...data.steps[1], notes: []};
      const middle = {...data.steps[3], notes: [{...data.steps[3].notes[0], start: 68, end: 68, side: 'left'}, data.steps[3].notes[1]]};
      const end = {...data.steps[4], notes: []};
      data.steps = [start, middle, end];
    });
  });

  test(`${language}: code navigation visits every note in both directions and keeps the code view`, async () => {
    await withGuide(language, async page => {
      const steps = await page.locator('#guide-data').evaluate(el => JSON.parse(el.textContent).steps);
      const points = steps.flatMap((step, stepIndex) => step.notes.map((note, noteIndex) => ({step, stepIndex, note, noteIndex})));
      await page.locator('#step-select').selectOption('0');
      await page.locator('#code-tab').tap();
      assert.equal(await page.locator('#previous').isDisabled(), true);
      for (const direction of [1, -1]) {
        const ordered = direction === 1 ? points : [...points].reverse();
        for (const [index, point] of ordered.entries()) {
          assert.equal(await page.locator('#guide').isHidden(), true);
          assert.equal(await page.locator('#step-select').inputValue(), String(point.stepIndex));
          assert.equal(await page.locator('#focus-title').textContent(), point.note.title);
          assert.equal(await page.locator('.note-button[aria-pressed=true]').getAttribute('data-note'), String(point.noteIndex));
          assert.equal(await page.locator('#diff-body tr.focus').first().getAttribute('data-line'), String(point.note.start));
          await assertFocusedLinesVisible(page);
          if (index < ordered.length - 1) await page.locator(direction === 1 ? '#next' : '#previous').tap();
        }
        assert.equal(await page.locator(direction === 1 ? '#next' : '#previous').isDisabled(), true);
      }
      await page.locator('#guide-tab').tap();
      await page.locator('#next').tap();
      await page.waitForURL('**#entry');
      assert.equal(await page.locator('#guide').isVisible(), true, 'guide navigation still moves by step');
      await page.locator('#code-tab').tap();
      await page.locator('#step-select').selectOption('3');
      await page.locator('#diff-scroll').evaluate(el => { el.scrollLeft = 80; });
      await page.locator('#next').tap();
      assert.equal(await page.locator('#focus-lines').textContent(), 'L68–86');
      assert.equal(await page.locator('#diff-scroll').evaluate(el => el.scrollLeft), 0, 'a new code point starts at its left edge');
      await page.locator('#next').tap();
      await page.waitForURL('**#finish-body');
      await page.goBack();
      await page.waitForURL('**#response-state');
      await page.waitForFunction(() => document.getElementById('focus-lines').textContent === 'L13–16');
      assert.equal(await page.locator('#code-pane').isVisible(), true);
      await assertFocusedLinesVisible(page);
    });
  });

  test(`${language}: expanded reading preserves navigation, explanations, tools and definition dismissal`, async () => {
    await withGuide(language, async page => {
      await page.locator('#code-tab').tap();
      await page.locator('#expand-code').tap();
      assert.equal(await page.locator('.topbar').isHidden(), true);
      await page.locator('#next').tap();
      await page.waitForURL('**#serialize');
      await page.locator('#next').tap();
      await page.waitForURL('**#response-state');
      await page.locator('#next').tap();
      await page.locator('#show-guide').tap();
      assert.equal(await page.locator('#guide').isVisible(), true);
      const selected = page.locator('.note-button[aria-pressed=true]');
      assert.equal(await selected.getAttribute('data-note'), '1');
      assert.equal(await selected.evaluate(el => el === document.activeElement), true);
      await selected.tap();
      assert.equal(await page.locator('.topbar').isHidden(), true);
      assert.equal(await page.locator('#focus-lines').textContent(), 'L68–86');
      await assertFocusedLinesVisible(page);
      await page.locator('#diff-body [data-symbol="WebSocketState"]').first().tap();
      await page.locator('#definition-dialog').waitFor({state: 'visible'});
      await page.keyboard.press('Escape');
      await page.locator('#definition-dialog').waitFor({state: 'hidden'});
      assert.equal(await page.locator('.topbar').isHidden(), true, 'Escape closes only the definition first');
      await page.locator('#code-menu-toggle').tap();
      await assertFits(page, '#code-menu');
      await page.locator('#wrap-code').focus();
      await page.keyboard.press('Escape');
      assert.equal(await page.locator('#code-menu').isHidden(), true);
      assert.equal(await page.locator('#code-menu-toggle').evaluate(el => el === document.activeElement), true);
      assert.equal(await page.locator('.topbar').isHidden(), true, 'Escape closes only the tools first');
      await useCodeTool(page, '#show-context');
      assert.equal(await page.locator('#show-context').getAttribute('aria-pressed'), 'true');
      await useCodeTool(page, '#show-context');
      await assertFocusedLinesVisible(page);
      await page.keyboard.press('Escape');
      assert.equal(await page.locator('.topbar').isVisible(), true);
      assert.equal(await page.locator('#expand-code').evaluate(el => el === document.activeElement), true);
      await page.locator('#code-menu-toggle').tap();
      await page.locator('#focus-lines').tap();
      assert.equal(await page.locator('#code-menu').isHidden(), true, 'outside tap dismisses tools');
      await page.locator('#expand-code').tap();
      await page.setViewportSize({width:1280,height:900});
      await page.locator('#guide').waitFor({state: 'visible'});
      assert.equal(await page.locator('.topbar').isVisible(), true);
      assert.equal(await page.locator('#show-context').isVisible(), true);
      assert.equal(await page.locator('#mobile-source-link').isVisible(), false);
      await page.locator('#next').click();
      await page.waitForURL('**#finish-body');
      await page.setViewportSize({width:390,height:844});
      assert.equal(await page.locator('.topbar').isVisible(), true, 'desktop transition leaves expanded mode');
      assert.equal(await page.locator('#code-pane').isVisible(), true);
    });
  });

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
      assert.equal(await page.locator('#code-pane').isVisible(), true);
      await assertFocusedLinesVisible(page);
      assert.equal(await page.locator('#diff-scroll').evaluate(el => el.scrollLeft), 0, 'a different file starts at its left edge');
    });
  });

  test(`${language}: wrapping preserves source and definition links without page overflow`, async () => {
    await withGuide(language, async page => {
      await page.locator('#code-tab').tap();
      const source = await page.locator('#diff-body').textContent();
      await useCodeTool(page, '#wrap-code');
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
      await useCodeTool(page, '#wrap-code');
      assert.equal(await page.locator('#diff-body').textContent(), source);
      assert.ok(await page.locator('#diff-scroll').evaluate(el => el.scrollWidth > el.clientWidth));
    });
  });

  test(`${language}: narrow phones, tablets and landscape keep code and controls reachable`, async () => {
    await withGuide(language, async page => {
      for (const viewport of [{width:320,height:480},{width:320,height:568},{width:768,height:1024},{width:844,height:390}]) {
        await page.setViewportSize(viewport);
        await page.locator('#code-tab').tap();
        await useCodeTool(page, '#focus-back');
        await assertFocusedLinesVisible(page);
        await assertFits(page, '#diff-scroll', viewport.width > viewport.height ? 180 : 200);
        for (const selector of ['#next', '#previous', '#guide-tab', '#code-tab', '#step-select', '#expand-code', '#code-menu-toggle']) {
          await assertFits(page, selector, 44);
        }
        assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
        await useCodeTool(page, '#wrap-code');
        assert.ok(await page.locator('#diff-scroll').evaluate(el => el.scrollWidth <= el.clientWidth + 1));
        await page.locator('#diff-body [data-symbol="Response"]').last().tap();
        await assertFits(page, '#definition-close', 44);
        await assertFits(page, '#definition-code', 80);
        await page.locator('#definition-close').tap();
        await useCodeTool(page, '#wrap-code');
        const height = (await page.locator('#diff-scroll').boundingBox()).height;
        await page.locator('#expand-code').tap();
        await assertFits(page, '#diff-scroll', viewport.height - 160);
        assert.ok((await page.locator('#diff-scroll').boundingBox()).height > height + 50);
        for (const selector of ['#next', '#previous', '#expand-code', '#show-guide', '#code-menu-toggle']) {
          await assertFits(page, selector, 44);
        }
        await assertFocusedLinesVisible(page);
        await page.locator('#expand-code').tap();
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
        await page.locator('#guide-tab').tap();
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
