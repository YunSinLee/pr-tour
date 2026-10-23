const test = require('node:test');
const assert = require('node:assert/strict');
const {readFileSync} = require('node:fs');
const vm = require('node:vm');

const template = readFileSync(`${__dirname}/../skills/pr-tour/assets/guide.html`, 'utf8');
const functions = template.slice(template.indexOf('  function cancelFocusScroll()'), template.indexOf('  function scrollToFocus('));

function setup(reduced = false) {
  let time = 0;
  let nextId = 0;
  const frames = new Map();
  const scroll = {scrollTop: 100, scrollHeight: 2400, clientHeight: 400};
  const context = vm.createContext({
    el: () => scroll,
    performance: {now: () => time},
    window: {matchMedia: () => ({matches: reduced})},
    requestAnimationFrame: callback => { frames.set(++nextId, callback); return nextId; },
    cancelAnimationFrame: id => frames.delete(id),
  });
  vm.runInContext(`let focusScrollFrame = 0; ${functions}`, context);
  return {scroll, context, frames, advance(to) {
    time = to;
    const callbacks = [...frames.values()];
    frames.clear();
    callbacks.forEach(callback => callback(time));
  }};
}

test('note navigation moves through intermediate positions and arrives within 180ms', () => {
  const {scroll, context, frames, advance} = setup();
  context.scrollCodeTo(1500, true);
  assert.equal(scroll.scrollTop, 100);
  advance(90);
  assert.ok(scroll.scrollTop > 100 && scroll.scrollTop < 1500);
  advance(180);
  assert.equal(scroll.scrollTop, 1500);
  assert.equal(frames.size, 0);
});

test('a new destination replaces the running animation from its current position', () => {
  const {scroll, context, frames, advance} = setup();
  context.scrollCodeTo(1500, true);
  advance(60);
  const current = scroll.scrollTop;
  context.scrollCodeTo(200, true);
  assert.equal(frames.size, 1);
  advance(150);
  assert.ok(scroll.scrollTop > 200 && scroll.scrollTop < current);
  advance(240);
  assert.equal(scroll.scrollTop, 200);
});

test('manual interruption leaves the reader at their chosen position', () => {
  const {scroll, context, frames, advance} = setup();
  context.scrollCodeTo(1500, true);
  advance(60);
  context.cancelFocusScroll();
  scroll.scrollTop = 450;
  advance(180);
  assert.equal(scroll.scrollTop, 450);
  assert.equal(frames.size, 0);
});

test('reduced motion, initial positioning and bounds are handled without animation', () => {
  const reduced = setup(true);
  reduced.context.scrollCodeTo(1500, true);
  assert.equal(reduced.scroll.scrollTop, 1500);
  assert.equal(reduced.frames.size, 0);
  const normal = setup();
  normal.context.scrollCodeTo(-100, false);
  assert.equal(normal.scroll.scrollTop, 0);
  normal.context.scrollCodeTo(5000, false);
  assert.equal(normal.scroll.scrollTop, 2000);
  assert.equal(normal.frames.size, 0);
});
