const {test, before, after} = require('node:test');
const assert = require('node:assert/strict');
const {resolve} = require('node:path');
const {pathToFileURL} = require('node:url');
const {chromium, webkit} = require('playwright');

const browserName = process.env.PR_TOUR_BROWSER || 'chromium';
let browser;
before(async () => { browser = await ({chromium, webkit})[browserName].launch(); });
after(async () => { await browser?.close(); });

async function withGuide(language, mobile, run) {
  const context = await browser.newContext(mobile
    ? {viewport: {width: 390, height: 844}, isMobile: true, hasTouch: true}
    : {viewport: {width: 1280, height: 900}});
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  try {
    // Exercise the actual standalone examples with network access disabled.
    await context.route(/^https?:/, route => route.abort());
    await page.goto(pathToFileURL(resolve(`docs/demo.${language}.html`)).href + '#entry');
    const trigger = page.locator('#diff-body [data-symbol="Response"]').last();
    await trigger.scrollIntoViewIfNeeded();
    await trigger.focus();
    if (mobile) await trigger.tap();
    else await trigger.press('Enter');
    await page.locator('#definition-dialog').waitFor({state: 'visible'});
    await run(page, trigger);
    assert.deepEqual(errors, []);
  } finally {
    await context.close();
  }
}

async function assertOpen(page) {
  assert.equal(await page.locator('#definition-dialog').evaluate(dialog => dialog.open), true);
}

async function assertClosed(page, trigger) {
  await page.locator('#definition-dialog').waitFor({state: 'hidden'});
  if (trigger) assert.equal(await trigger.evaluate(button => document.activeElement === button), true);
}

async function drag(page, from, to) {
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(to.x, to.y, {steps: 10});
  await page.mouse.up();
}

for (const language of ['en', 'ko']) {
  test(`${language}: backdrop clicks close on every side and restore focus`, async () => {
    await withGuide(language, false, async (page, trigger) => {
      const box = await page.locator('#definition-dialog').boundingBox();
      const points = [
        [box.x - 8, box.y + box.height / 2],
        [box.x + box.width + 8, box.y + box.height / 2],
        [box.x + box.width / 2, box.y - 8],
        [box.x + box.width / 2, box.y + box.height + 8],
      ];
      for (const [index, point] of points.entries()) {
        if (index) await trigger.press('Enter');
        await page.mouse.click(...point);
        await assertClosed(page, trigger);
      }
      assert.equal(new URL(page.url()).hash, '#entry', 'no click through to the underlying guide');
    });
  });

  test(`${language}: dialog border, blank space and text selection stay open`, async () => {
    await withGuide(language, false, async page => {
      const box = await page.locator('#definition-dialog').boundingBox();
      // The dialog itself is the target here, just as it is on the backdrop.
      await page.mouse.click(box.x + 0.5, box.y + box.height / 2);
      await assertOpen(page);
      await page.locator('.definition-header').click({position: {x: 5, y: 5}});
      await page.locator('#definition-code').click({position: {x: 8, y: 8}});
      const text = await page.locator('#definition-description').boundingBox();
      await drag(page, {x: text.x + 2, y: text.y + 10}, {x: text.x + 180, y: text.y + 10});
      assert.ok(await page.evaluate(() => getSelection().toString().length), 'text remains selectable');
      await assertOpen(page);
    });
  });

  test(`${language}: drags crossing the dialog boundary do not dismiss it`, async () => {
    await withGuide(language, false, async (page, trigger) => {
      const text = await page.locator('#definition-description').boundingBox();
      const inside = {x: text.x + 30, y: text.y + 10};
      const outside = {x: 8, y: inside.y};
      await drag(page, inside, outside);
      await assertOpen(page);
      await drag(page, outside, inside);
      await assertOpen(page);
      await page.mouse.click(outside.x, outside.y);
      await assertClosed(page);
      await trigger.press('Enter');
      await page.mouse.click(outside.x, outside.y, {button: 'right'});
      await assertOpen(page);
    });
  });

  test(`${language}: scrolling, related definitions, Back, X and Escape still work`, async () => {
    await withGuide(language, false, async (page, trigger) => {
      const code = page.locator('#definition-code');
      await code.hover();
      await page.mouse.wheel(0, 300);
      await page.waitForFunction(() => document.getElementById('definition-code').scrollTop > 0);
      await assertOpen(page);
      const title = await page.locator('#definition-title').textContent();
      await page.locator('#definition-body .symbol-link').first().click();
      assert.notEqual(await page.locator('#definition-title').textContent(), title);
      await page.locator('#definition-back').click();
      assert.equal(await page.locator('#definition-title').textContent(), title);
      await page.locator('#definition-close').click();
      await assertClosed(page, trigger);
      await trigger.press('Enter');
      assert.equal(await page.locator('#definition-back').isHidden(), true);
      await page.keyboard.press('Escape');
      await assertClosed(page, trigger);
    });
  });

  test(`${language}: mobile taps preserve inside interaction and dismiss on the backdrop`, async () => {
    await withGuide(language, true, async (page, trigger) => {
      await page.locator('.definition-header').tap({position: {x: 5, y: 5}});
      await assertOpen(page);
      await page.locator('#definition-body .symbol-link').first().tap();
      await page.locator('#definition-back').tap();
      await page.touchscreen.tap(5, 400);
      await assertClosed(page);
      await trigger.tap();
      assert.equal(await page.locator('#definition-back').isHidden(), true);
      await page.locator('#definition-close').tap();
      await assertClosed(page);
    });
  });

  test(`${language}: touch scrolling and cancelled gestures do not dismiss the dialog`, {
    skip: browserName !== 'chromium' && 'Touch gesture injection requires Chromium CDP',
  }, async () => {
    await withGuide(language, true, async page => {
      const session = await page.context().newCDPSession(page);
      const code = await page.locator('#definition-code').boundingBox();
      const x = code.x + code.width / 2;
      const y = code.y + code.height * 0.8;
      await session.send('Input.dispatchTouchEvent', {type: 'touchStart', touchPoints: [{x, y}]});
      for (let offset = 20; offset <= 160; offset += 20) {
        await session.send('Input.dispatchTouchEvent', {type: 'touchMove', touchPoints: [{x, y: y - offset}]});
      }
      await session.send('Input.dispatchTouchEvent', {type: 'touchEnd', touchPoints: []});
      await page.waitForFunction(() => document.getElementById('definition-code').scrollTop > 0);
      await assertOpen(page);
      await session.send('Input.dispatchTouchEvent', {type: 'touchStart', touchPoints: [{x: 5, y: 400}]});
      await session.send('Input.dispatchTouchEvent', {type: 'touchCancel', touchPoints: []});
      await assertOpen(page);
      await page.locator('.definition-header').tap({position: {x: 5, y: 5}});
      await assertOpen(page);
      await page.touchscreen.tap(5, 400);
      await assertClosed(page);
    });
  });
}
