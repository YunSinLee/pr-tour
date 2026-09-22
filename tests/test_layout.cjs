const {test, before, after} = require('node:test');
const assert = require('node:assert/strict');
const {resolve} = require('node:path');
const {pathToFileURL} = require('node:url');
const {chromium, webkit} = require('playwright');

let browser;
const storageKey = 'pr-tour.pane-widths.v1';
before(async () => { browser = await ({chromium, webkit})[process.env.PR_TOUR_BROWSER || 'chromium'].launch(); });
after(async () => { await browser?.close(); });

async function withGuide(language, run, setup) {
  const context = await browser.newContext({viewport:{width:1440, height:900}});
  const page = await context.newPage();
  page.setDefaultTimeout(8000);
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  try {
    await context.route(/^https?:/, route => route.abort());
    if (setup) await page.addInitScript(setup);
    await page.goto(pathToFileURL(resolve(`docs/demo.${language}.html`)).href + '#finish-body');
    await run(page);
    assert.deepEqual(errors, []);
  } finally { await context.close(); }
}

async function widths(page) {
  return page.evaluate(() => Object.fromEntries(['sidebar','guide','code-pane'].map(id => [
    id === 'code-pane' ? 'code' : id, document.getElementById(id).getBoundingClientRect().width
  ])));
}

function close(actual, expected, label) {
  assert.ok(Math.abs(actual - expected) < 2, `${label}: ${actual} ≈ ${expected}`);
}

async function drag(page, selector, dx, release = true) {
  const box = await page.locator(selector).boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2 + dx, box.y + box.height / 2, {steps:8});
  if (release) await page.mouse.up();
}

async function fits(page) {
  // ResizeObserver applies viewport clamping on the next rendering cycle.
  await page.waitForFunction(() => [...document.querySelectorAll('#workspace > *')]
    .filter(el => el.getClientRects().length).every(el => {
      const box = el.getBoundingClientRect();
      return box.left >= -1 && box.right <= window.innerWidth + 1;
    }));
  const rects = await page.locator('#workspace > *').evaluateAll(nodes => nodes.filter(el => el.getClientRects().length).map(el => {
    const b = el.getBoundingClientRect(); return {left:b.left, right:b.right};
  }));
  for (const r of rects) assert.ok(r.left >= -1 && r.right <= page.viewportSize().width + 1);
  const w = await widths(page);
  assert.ok(w.sidebar >= 160 && w.guide >= 260 && w.code >= 320);
}

for (const language of ['en','ko']) {
  test(`${language}: drag both boundaries, keep adjacent panes and reading state, reload and reset`, async () => {
    await withGuide(language, async page => {
      const initial = await widths(page);
      await page.locator('.transition-evidence > summary').click();
      await page.locator('.transition-excerpt').first().waitFor();
      await page.locator('#guide').evaluate(el => { el.scrollTop = 180; });
      const scroll = await page.locator('#diff-scroll').evaluate(el => ({top:el.scrollTop,left:el.scrollLeft}));
      await drag(page, '#pane-resizer', 200);
      let w = await widths(page);
      close(w.guide, initial.guide + 200, 'guide expands');
      close(w.code, initial.code - 200, 'code shrinks');
      close(w.sidebar, initial.sidebar, 'sidebar remains');
      assert.ok(await page.locator('#guide').evaluate(el => el.scrollTop > 0), 'guide does not jump to the top as text reflows');
      assert.deepEqual(await page.locator('#diff-scroll').evaluate(el => ({top:el.scrollTop,left:el.scrollLeft})), scroll);
      assert.equal(await page.locator('.transition-evidence').getAttribute('open'), '');
      await drag(page, '#sidebar-resizer', 40);
      w = await widths(page);
      close(w.sidebar, initial.sidebar + 40, 'sidebar expands');
      close(w.guide, initial.guide + 160, 'only adjacent guide shrinks');
      close(w.code, initial.code - 200, 'last pane remains');
      const saved = await page.evaluate(key => JSON.parse(localStorage.getItem(key)), storageKey);
      close(saved.guide, w.guide, 'preference stored');
      await page.reload();
      assert.deepEqual(await widths(page), w);
      await page.locator('#layout-select').selectOption('code-first');
      assert.deepEqual(await widths(page), w, 'widths follow pane identity when reordered');
      assert.deepEqual(await page.locator('#workspace > *').evaluateAll(nodes => nodes.map(el => el.id)),
        ['sidebar','sidebar-resizer','code-pane','pane-resizer','guide']);
      await drag(page, '#pane-resizer', -80);
      let reordered = await widths(page);
      close(reordered.guide, w.guide + 80, 'right guide grows when boundary moves left');
      close(reordered.code, w.code - 80, 'middle code shrinks');
      await drag(page, '#sidebar-resizer', -30);
      close((await widths(page)).guide, reordered.guide, 'last guide stays fixed');
      await page.locator('#pane-resizer').dblclick();
      assert.deepEqual(await widths(page), initial, 'reset default widths without changing pane order');
      assert.equal(await page.locator('#layout-select').inputValue(), 'code-first');
      assert.equal(await page.evaluate(key => localStorage.getItem(key), storageKey), null);
      if (language === 'en') {
        assert.doesNotMatch(await page.locator('#pane-resizer').getAttribute('title'), /[가-힣]/);
        assert.equal(await page.locator('#pane-resizer').getAttribute('aria-label'), 'Code pane width');
      }
      await fits(page);
    });
  });

  test(`${language}: keyboard bounds, narrow desktop clamping, and mobile round trip preserve preferences`, async () => {
    await withGuide(language, async page => {
      const initial = await widths(page);
      const handle = page.locator('#pane-resizer');
      await handle.focus();
      await page.keyboard.press('ArrowRight');
      close((await widths(page)).guide, initial.guide + 10, 'keyboard nudge');
      await page.keyboard.press('Shift+ArrowRight');
      close((await widths(page)).guide, initial.guide + 60, 'large keyboard nudge');
      await page.keyboard.press('End');
      close((await widths(page)).code, 320, 'minimum code width');
      close(Number(await handle.getAttribute('aria-valuenow')), (await widths(page)).guide, 'accessible width');
      const wide = await widths(page);
      await page.setViewportSize({width:851,height:900});
      await fits(page);
      await page.setViewportSize({width:390,height:844});
      assert.equal(await handle.isVisible(), false);
      assert.equal(await page.locator('#sidebar-resizer').isVisible(), false);
      await page.locator('#code-tab').click();
      await page.locator('#next').click();
      assert.equal(await page.locator('#code-pane').isVisible(), true);
      await page.setViewportSize({width:900,height:400});
      assert.equal(await handle.isVisible(), false, 'phone landscape remains tabbed');
      await page.setViewportSize({width:1440,height:900});
      await page.locator('#guide').waitFor({state:'visible'});
      await page.locator('#code-pane').waitFor({state:'visible'});
      assert.deepEqual(await widths(page), wide, 'temporary viewport clamp does not overwrite preference');
      await handle.focus();
      await page.keyboard.press('Home');
      close((await widths(page)).guide, 260, 'minimum guide width');
      await page.locator('#sidebar-resizer').focus();
      await page.keyboard.press('Home');
      close((await widths(page)).sidebar, 160, 'minimum sidebar width');
      await page.keyboard.press('Enter');
      assert.deepEqual(await widths(page), initial);
    });
  });
}

test('cancelled drags restore widths and do not save; releasing outside a separator completes a drag', async () => {
  await withGuide('en', async page => {
    const initial = await widths(page);
    await drag(page, '#pane-resizer', 100, false);
    await page.keyboard.press('Escape');
    await page.mouse.up();
    assert.deepEqual(await widths(page), initial);
    assert.equal(await page.locator('body').getAttribute('data-pane-dragging'), null);
    assert.equal(await page.evaluate(key => localStorage.getItem(key), storageKey), null);
    await drag(page, '#pane-resizer', 100, false);
    await page.locator('#pane-resizer').dispatchEvent('pointercancel');
    await page.mouse.up();
    assert.deepEqual(await widths(page), initial);
    await drag(page, '#pane-resizer', 3000);
    close((await widths(page)).code, 320, 'pointer capture clamps at edge');
    assert.equal(await page.locator('body').getAttribute('data-pane-dragging'), null);
    await page.reload();
    close((await widths(page)).code, 320, 'completed drag was saved');
  });
});

test('invalid or blocked browser storage does not break offline resizing', async () => {
  for (const blocked of [false,true]) {
    await withGuide('en', async page => {
      const initial = await widths(page);
      close(initial.sidebar, 218, 'safe default sidebar');
      close(initial.guide, 326, 'safe default guide');
      await drag(page, '#pane-resizer', 150);
      close((await widths(page)).guide, initial.guide + 150, 'resizing works');
      await page.locator('#pane-resizer').press('Enter');
      assert.deepEqual(await widths(page), initial);
    }, blocked ? () => {
      Object.defineProperty(window, 'localStorage', {get() { throw new Error('Storage blocked'); }});
    } : () => {
      localStorage.setItem('pr-tour.pane-widths.v1', JSON.stringify({version:1,sidebar:-1,guide:'500px'}));
    });
  }
});
