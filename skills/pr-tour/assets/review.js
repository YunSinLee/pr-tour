/* Reader comments are local to a repository snapshot, never part of the source manifest. */
const TourReview = (() => {
  'use strict';
  function init({data, currentFile, showCode, reveal}) {
    const el = id => document.getElementById(id);
    const dialog = el('review-dialog');
    const key = 'pr-tour.review.v1:' + JSON.stringify([data.url, data.mergeBase, data.head]);
    const sources = new Map();
    let comments = [], selection = null, selecting = false, draft = null, downloadUrl = '';
    let storageState = 'ready';
    const node = (tag, text = '', cls = '') => {
      const n = document.createElement(tag);
      n.textContent = text;
      if (cls) n.className = cls;
      return n;
    };
    const button = (text, action, cls = '') => {
      const n = node('button', text, cls);
      n.type = 'button';
      n.addEventListener('click', action);
      return n;
    };
    function source(file, side) {
      const id = JSON.stringify([file, side]);
      if (!sources.has(id)) {
        const column = side === 'left' ? 'old' : 'new';
        const rows = data.files[file].rows.flatMap(row => row.kind === 'gap' ? row.lines : [row]);
        sources.set(id, new Map(rows.filter(row => Number.isInteger(row[column])).map(row => [row[column], row.text])));
      }
      return sources.get(id);
    }
    function valid(c) {
      return c && typeof c.id === 'string' && typeof c.file === 'string' && Object.hasOwn(data.files, c.file) &&
        ['left', 'right'].includes(c.side) && Number.isInteger(c.start) && Number.isInteger(c.end) &&
        c.start > 0 && c.end >= c.start && c.end <= (c.side === 'left' ? data.files[c.file].oldLineCount : data.files[c.file].lineCount) &&
        typeof c.body === 'string' && c.body.trim().length > 0 && c.body.length <= 10000 &&
        typeof c.createdAt === 'string' && typeof c.updatedAt === 'string';
    }
    try {
      const saved = localStorage.getItem(key);
      if (saved) {
        const parsed = JSON.parse(saved);
        if (!Array.isArray(parsed) || !parsed.every(valid) || new Set(parsed.map(c => c.id)).size !== parsed.length) throw new Error('invalid');
        comments = parsed;
      }
    } catch { storageState = 'unavailable'; }

    function storageLabel() {
      el('review-storage').textContent = storageState === 'saved'
        ? '이 브라우저에 저장됨 · HTML 파일에는 포함되지 않습니다.'
        : storageState === 'ready'
          ? '저장한 코멘트는 이 브라우저에 보관됩니다. HTML 파일에는 포함되지 않습니다.'
          : '브라우저 저장을 사용할 수 없습니다. 닫기 전에 JSON을 다운로드하세요.';
    }
    function persist() {
      if (storageState !== 'unavailable') {
        try { localStorage.setItem(key, JSON.stringify(comments)); storageState = 'saved'; }
        catch { storageState = 'unavailable'; }
      }
      refresh();
    }
    const pathOf = c => c.side === 'left' ? data.files[c.file].oldPath : c.file;
    const label = c => `${pathOf(c)} · ${c.side === 'left' ? '변경 전' : '변경 후'} L${c.start}${c.end === c.start ? '' : '–' + c.end}`;
    function codeOf(c) {
      const lines = source(c.file, c.side);
      return Array.from({length: c.end - c.start + 1}, (_, i) => lines.get(c.start + i)).join('\n');
    }
    function payload() {
      return JSON.stringify({schemaVersion: 1, kind: 'pr-tour-review', prUrl: data.url,
        repositoryUrl: data.repositoryUrl, head: data.head, base: data.base, mergeBase: data.mergeBase,
        comments: comments.map(c => ({id: c.id, path: pathOf(c), side: c.side,
          commit: c.side === 'left' ? data.mergeBase : data.head, startLine: c.start, endLine: c.end,
          code: codeOf(c), body: c.body, createdAt: c.createdAt, updatedAt: c.updatedAt}))}, null, 2);
    }
    function refresh() {
      for (const id of ['review-open', 'review-menu-open']) el(id).textContent = `코멘트 (${comments.length})`;
      el('review-copy').disabled = el('review-download').disabled = comments.length === 0;
      el('review-add-from-list').disabled = el('review-add').disabled = !data.files[currentFile()]?.rows.some(r => r.kind === 'gap' || Number.isInteger(r.old) || Number.isInteger(r.new));
      storageLabel();
      decorate();
    }
    function decorate() {
      el('diff-body').querySelectorAll('tr').forEach(row => {
        const inRange = c => c.file === currentFile() && Number(c.side === 'left' ? row.dataset.oldLine : row.dataset.line) >= c.start &&
          Number(c.side === 'left' ? row.dataset.oldLine : row.dataset.line) <= c.end;
        row.classList.toggle('review-selected', Boolean(selection && inRange(selection)));
        for (const b of row.querySelectorAll('.review-line')) {
          const hasComment = comments.some(c => c.side === b.dataset.side && inRange(c));
          b.classList.toggle('has-comment', hasComment);
          b.setAttribute('aria-pressed', String(Boolean(selection && selection.side === b.dataset.side && inRange(selection))));
          b.title = hasComment ? '이 줄에 코멘트가 있습니다.' : '줄 선택 후 코멘트 작성';
        }
      });
    }
    function cancelSelection() {
      selecting = false; selection = null;
      document.body.dataset.reviewSelecting = 'false';
      el('review-selection').hidden = true;
      decorate();
    }
    function scrollToRow(row) {
      if (!row) return;
      const scroll = el('diff-scroll');
      el('diff-body').closest('table').style.setProperty('--focus-tail', `${Math.max(0, scroll.clientHeight - 56)}px`);
      scroll.scrollLeft = 0;
      scroll.scrollTop += row.getBoundingClientRect().top - scroll.getBoundingClientRect().top - 28;
    }
    function begin(focusCurrent = true) {
      dialog.close(); showCode(); selecting = true; selection = null;
      document.body.dataset.reviewSelecting = 'true';
      el('review-selection').hidden = false;
      selectionLabel(); decorate();
      if (focusCurrent) requestAnimationFrame(() => scrollToRow(el('diff-body').querySelector('tr.focus')));
      el('review-cancel-selection').focus({preventScroll: true});
    }
    function selectionLabel() {
      el('review-selection-label').textContent = selection ? label(selection) : '줄 번호를 선택하세요. 다른 줄을 누르면 범위가 됩니다.';
      el('review-write').disabled = !selection;
    }
    function select(file, side, line) {
      const first = !selecting;
      if (first) begin(false);
      if (!selection || selection.file !== file || selection.side !== side) selection = {file, side, start: line, end: line, anchor: line};
      else { selection.start = Math.min(selection.anchor, line); selection.end = Math.max(selection.anchor, line); }
      selectionLabel(); decorate();
      if (first) requestAnimationFrame(() => {
        const attr = side === 'left' ? 'data-old-line' : 'data-line';
        scrollToRow(el('diff-body').querySelector(`tr[${attr}="${line}"]`));
      });
    }
    function lineButton(number, side) {
      if (!Number.isInteger(number)) return document.createTextNode('');
      const b = button(String(number), () => select(currentFile(), side, number), 'review-line');
      b.dataset.side = side;
      b.setAttribute('aria-label', `${side === 'left' ? '변경 전' : '변경 후'} L${number} 코멘트 줄 선택`);
      return b;
    }
    function view(name) {
      for (const id of ['list', 'editor', 'export']) el(`review-${id}`).hidden = id !== name;
      el('review-exports').hidden = name !== 'list';
      el('review-feedback').textContent = '';
      el('review-title').textContent = name === 'editor' ? '코멘트 작성' : name === 'export' ? 'JSON 복사' : '리뷰 코멘트';
      storageLabel();
      if (!dialog.open) dialog.showModal();
    }
    function list() {
      draft = null; view('list');
      const container = el('review-items');
      container.replaceChildren();
      if (!comments.length) container.append(node('p', '읽다가 궁금한 점이나 수정 의견을 코드 줄에 남겨보세요.', 'review-empty'));
      for (const c of comments) {
        const card = node('article', '', 'review-card');
        const jump = button(label(c), () => { dialog.close(); cancelSelection(); reveal(c); }, 'review-location');
        const actions = node('div', '', 'review-card-actions');
        actions.append(button('수정', () => edit(c)), button('삭제', () => {
          comments = comments.filter(item => item.id !== c.id); persist(); list();
          const undo = button('삭제 취소', () => { comments.push(c); persist(); list(); });
          el('review-feedback').replaceChildren(node('span', '코멘트를 삭제했습니다. '), undo);
        }));
        card.append(jump, node('p', c.body, 'review-body'), actions);
        container.append(card);
      }
      refresh();
      el('review-close').focus({preventScroll: true});
    }
    function edit(c) {
      draft = {...c}; view('editor');
      el('review-location').textContent = label(c);
      el('review-code').textContent = codeOf(c);
      el('review-text').value = c.body || '';
      el('review-save').disabled = !el('review-text').value.trim();
      el('review-text').focus();
    }
    function open() {
      if (draft) { const pending = {...draft, body: el('review-text').value}; edit(pending); }
      else list();
    }
    el('review-open').addEventListener('click', open);
    el('review-menu-open').addEventListener('click', open);
    el('review-add').addEventListener('click', () => begin());
    el('review-add-from-list').addEventListener('click', () => begin());
    el('review-cancel-selection').addEventListener('click', cancelSelection);
    el('review-write').addEventListener('click', () => { if (selection) edit(selection); });
    el('review-close').addEventListener('click', () => dialog.close());
    el('review-cancel-edit').addEventListener('click', list);
    el('review-text').addEventListener('input', () => { el('review-save').disabled = !el('review-text').value.trim(); });
    el('review-save').addEventListener('click', () => {
      const body = el('review-text').value.trim();
      if (!draft || !body || body.length > 10000) return;
      const now = new Date().toISOString();
      const c = {id: draft.id || (globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(16).slice(2)}`),
        file: draft.file, side: draft.side, start: draft.start, end: draft.end, body,
        createdAt: draft.createdAt || now, updatedAt: now};
      if (!valid(c)) return;
      const index = comments.findIndex(item => item.id === c.id);
      if (index < 0) comments.push(c); else comments[index] = c;
      persist(); cancelSelection(); list();
    });
    el('review-copy').addEventListener('click', async () => {
      const text = payload();
      try {
        await navigator.clipboard.writeText(text);
        el('review-feedback').textContent = 'JSON을 복사했습니다. AI 대화에 붙여넣으세요.';
      } catch {
        view('export');
        el('review-export-text').value = text;
        el('review-export-text').focus(); el('review-export-text').select();
      }
    });
    el('review-export-back').addEventListener('click', list);
    el('review-download').addEventListener('click', () => {
      if (downloadUrl) URL.revokeObjectURL(downloadUrl);
      downloadUrl = URL.createObjectURL(new Blob([payload()], {type: 'application/json'}));
      const a = node('a'); a.href = downloadUrl;
      a.download = `pr-${data.number}-review-${data.head.slice(0, 8)}.json`;
      document.body.append(a); a.click(); a.remove();
    });
    // Preserve an unfinished editor when Escape or Close dismisses the sheet.
    dialog.addEventListener('keydown', event => event.stopPropagation());
    document.addEventListener('keydown', event => {
      if (event.key === 'Escape' && selecting && !document.querySelector('dialog[open]')) {
        event.preventDefault(); event.stopImmediatePropagation(); cancelSelection();
      }
    }, true);
    refresh();
    return {lineButton, refresh, cancelSelection};
  }
  return {init};
})();
