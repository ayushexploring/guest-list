/* ============================================================
   GUEST LIST - BEHAVIOUR
   You should not need to edit this file. Settings live in
   js/config.js.

   Storage: one guests.json file in a private GitHub repo, read
   and written through the GitHub contents API. Every save is a
   commit, so the repo history is a full undo log.
   ============================================================ */

(function () {
  'use strict';

  const $ = function (id) { return document.getElementById(id); };

  /* ---------- localStorage can throw (private mode, blocked) ---------- */
  const store = {
    get: function (k) { try { return localStorage.getItem(k); } catch (e) { return null; } },
    set: function (k, v) { try { localStorage.setItem(k, v); } catch (e) { /* not remembered */ } },
    del: function (k) { try { localStorage.removeItem(k); } catch (e) { /* ignore */ } }
  };
  const KEY_TOKEN = 'guestlist.token';
  const KEY_NAME  = 'guestlist.name';

  const state = {
    token: null,
    me: '',
    data: null,       // { version, categories: [{id,name}], guests: [...] }
    sha: null,        // sha of guests.json we last read; null = file not created yet
    loadedAt: 0,
    editingId: null,
    busy: false
  };

  const SIDES = CONFIG.sides;
  function sideLabel(id) {
    const s = SIDES.find(function (x) { return x.id === id; });
    return s ? s.label : '';
  }

  /* A problem the person can fix - shown as-is, never retried. */
  class UserError extends Error {}

  class HttpError extends Error {
    constructor(status, message) { super(message); this.status = status; }
  }


  /* ============================================================
     GITHUB CONTENTS API
     ============================================================ */

  const REPO = CONFIG.dataRepo;
  const API  = 'https://api.github.com/repos/' + REPO.owner + '/' + REPO.repo;
  const FILE = '/contents/' + REPO.path.split('/').map(encodeURIComponent).join('/');

  async function gh(path, opts) {
    opts = opts || {};
    const headers = {
      'Accept': 'application/vnd.github+json',
      'Authorization': 'Bearer ' + state.token
    };
    if (opts.body) headers['Content-Type'] = 'application/json';

    // no-store: the API sends max-age=60, which would show a stale list
    const res = await fetch(API + path, { method: opts.method || 'GET', body: opts.body, headers: headers, cache: 'no-store' });
    if (!res.ok) {
      let msg = res.statusText;
      try { msg = (await res.json()).message || msg; } catch (e) { /* not JSON */ }
      throw new HttpError(res.status, msg);
    }
    return res.json();
  }

  const utf8 = { enc: new TextEncoder(), dec: new TextDecoder() };

  async function readData() {
    try {
      const f = await gh(FILE);
      state.sha  = f.sha;
      state.data = normalise(JSON.parse(utf8.dec.decode(Vault.fromB64(f.content))));
    } catch (e) {
      if (e.status !== 404) throw e;
      // 404 is either "file not created yet" or "no access to the repo" - tell them apart
      await gh('');
      state.sha  = null;
      state.data = emptyData();
    }
    state.loadedAt = Date.now();
  }

  async function writeData(next, message) {
    const body = {
      message: message,
      content: Vault.toB64(utf8.enc.encode(JSON.stringify(next, null, 2) + '\n'))
    };
    if (state.sha) body.sha = state.sha;
    const res = await gh(FILE, { method: 'PUT', body: JSON.stringify(body) });
    return res.content.sha;
  }

  /* ---------- apply a change and save it ----------
     `mutate` edits a copy of the data. If someone else saved in the
     meantime GitHub rejects our stale sha (409/422); we then reload
     their version and apply the same change on top of it. */
  async function commit(message, mutate) {
    for (let attempt = 0; ; attempt++) {
      const next = JSON.parse(JSON.stringify(state.data));
      mutate(next);
      try {
        state.sha  = await writeData(next, message + ' (by ' + state.me + ')');
        state.data = next;
        return;
      } catch (e) {
        if ((e.status === 409 || e.status === 422) && attempt < 4) {
          await new Promise(function (r) { setTimeout(r, 300 * (attempt + 1)); });
          await readData();
          continue;
        }
        throw e;
      }
    }
  }


  /* ============================================================
     DATA SHAPE
     ============================================================ */

  function slug(s) {
    return s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'x';
  }

  function newId(prefix) {
    return prefix + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
  }

  function emptyData() {
    // Deterministic ids, so two people creating the file at once agree on them
    return {
      version: 1,
      categories: CONFIG.starterCategories.map(function (name) { return { id: 'c_' + slug(name), name: name }; }),
      guests: []
    };
  }

  function normalise(d) {
    d = d || {};
    return {
      version: 1,
      categories: Array.isArray(d.categories) ? d.categories : [],
      guests: Array.isArray(d.guests) ? d.guests : []
    };
  }

  function sameName(a, b) {
    return a.trim().toLowerCase().replace(/\s+/g, ' ') === b.trim().toLowerCase().replace(/\s+/g, ' ');
  }

  function categoryName(data, id) {
    const c = data.categories.find(function (x) { return x.id === id; });
    return c ? c.name : 'Uncategorised';
  }

  function requireCategory(data, id) {
    if (!data.categories.some(function (c) { return c.id === id; })) {
      throw new UserError('That category was just removed by someone else. Please pick another.');
    }
  }


  /* ============================================================
     SMALL UI HELPERS
     ============================================================ */

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  let toastTimer = null;
  function toast(msg, kind) {
    const t = $('toast');
    // a modal dialog sits in the top layer and would hide a toast outside it
    const dlg = $('catDialog');
    (dlg.open ? dlg : document.body).appendChild(t);
    t.textContent = msg;
    t.className = 'toast' + (kind ? ' ' + kind : '');
    t.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { t.hidden = true; }, kind === 'error' ? 6000 : 2600);
  }

  function explain(e) {
    if (e instanceof UserError) return e.message;
    if (e.status === 401) return 'The access key has expired or been revoked. Ask whoever set up this app to renew it.';
    if (e.status === 403 && /rate limit/i.test(e.message)) return 'GitHub is busy right now. Please try again in a few minutes.';
    if (e.status === 403 || e.status === 404) return 'The app cannot reach the guest list storage. Check the token\'s repository access.';
    if (e instanceof TypeError) return 'No internet connection. Nothing was saved - please try again.';
    return 'Something went wrong: ' + e.message;
  }

  function setBusy(on, label) {
    state.busy = on;
    document.querySelectorAll('#app button, #catDialog button').forEach(function (b) { b.disabled = on; });
    const save = $('saveBtn');
    if (on && label) { save.dataset.label = save.textContent; save.textContent = label; }
    else if (!on && save.dataset.label) { save.textContent = save.dataset.label; delete save.dataset.label; }
  }

  /* Run a save with busy state + error toast. Returns true on success. */
  async function run(label, fn) {
    if (state.busy) return false;
    setBusy(true, label);
    try {
      await fn();
      return true;
    } catch (e) {
      if (e.status === 401) { lock(explain(e)); return false; }
      toast(explain(e), 'error');
      // our copy may be behind whatever made it fail
      if (!(e instanceof UserError) && !(e instanceof TypeError)) {
        try { await readData(); } catch (e2) { /* keep what we have */ }
      }
      return false;
    } finally {
      setBusy(false);
      render();
    }
  }


  /* ============================================================
     RENDER
     ============================================================ */

  function render() {
    if (!state.data) return;
    renderStats();
    renderCategorySelects();
    renderList();
    if ($('catDialog').open) renderCatDialog();
    $('meName').textContent = state.me;
  }

  function people(list) {
    return list.reduce(function (n, g) { return n + (Number(g.count) || 1); }, 0);
  }

  function renderStats() {
    const g = state.data.guests;
    const tiles = [
      { n: g.length, l: 'Invites' },
      { n: people(g), l: 'People' }
    ];
    SIDES.forEach(function (s) {
      tiles.push({ n: people(g.filter(function (x) { return x.side === s.id; })), l: s.label });
    });
    $('stats').innerHTML = tiles.map(function (t) {
      return '<div class="stat"><span class="stat-n">' + t.n + '</span><span class="stat-l">' + esc(t.l) + '</span></div>';
    }).join('');
  }

  function renderCategorySelects() {
    const cats = state.data.categories;

    // form select keeps the current choice if it still exists
    const sel = $('gCategory');
    const cur = sel.value;
    sel.innerHTML = '<option value="" disabled>Choose a category</option>' +
      cats.map(function (c) { return '<option value="' + esc(c.id) + '">' + esc(c.name) + '</option>'; }).join('') +
      '<option value="__new">+ New category&hellip;</option>';
    sel.value = cats.some(function (c) { return c.id === cur; }) ? cur : '';

    const fc = $('filterCat');
    const fcur = fc.value;
    fc.innerHTML = '<option value="">All categories</option>' +
      cats.map(function (c) { return '<option value="' + esc(c.id) + '">' + esc(c.name) + '</option>'; }).join('');
    fc.value = cats.some(function (c) { return c.id === fcur; }) ? fcur : '';
  }

  function filtered() {
    const q    = $('search').value.trim().toLowerCase();
    const cat  = $('filterCat').value;
    const side = $('filterSide').value;
    return state.data.guests.filter(function (g) {
      if (cat && g.categoryId !== cat) return false;
      if (side === '_none' ? g.side : (side && g.side !== side)) return false;
      if (q && (g.name + ' ' + (g.notes || '') + ' ' + (g.addedBy || '')).toLowerCase().indexOf(q) === -1) return false;
      return true;
    });
  }

  function renderList() {
    const list = filtered();
    const all  = state.data.guests;
    const byName = function (a, b) { return a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }); };

    // category order as defined, then anything whose category vanished
    const groups = state.data.categories.map(function (c) { return { id: c.id, name: c.name, items: [] }; });
    const orphan = { id: '', name: 'Uncategorised', items: [] };
    list.forEach(function (g) {
      const grp = groups.find(function (x) { return x.id === g.categoryId; }) || orphan;
      grp.items.push(g);
    });
    groups.push(orphan);

    $('list').innerHTML = groups.filter(function (grp) { return grp.items.length; }).map(function (grp) {
      grp.items.sort(byName);
      return '<details class="group" open>' +
        '<summary><span class="group-name">' + esc(grp.name) + '</span>' +
        '<span class="group-count">' + grp.items.length + ' ' + (grp.items.length === 1 ? 'invite' : 'invites') +
        ' &middot; ' + people(grp.items) + ' ppl</span></summary>' +
        '<ul class="guests">' + grp.items.map(guestRow).join('') + '</ul>' +
        '</details>';
    }).join('');

    const empty = $('emptyMsg');
    empty.hidden = list.length > 0;
    empty.textContent = all.length ? 'No guests match your search.' : 'No guests yet - add the first one above.';

    $('showing').textContent = list.length !== all.length
      ? 'Showing ' + list.length + ' of ' + all.length + ' invites (' + people(list) + ' people)'
      : '';
  }

  function guestRow(g) {
    const n = Number(g.count) || 1;
    const meta = [];
    if (g.side) meta.push('<span class="badge side-' + esc(g.side) + '">' + esc(sideLabel(g.side)) + '</span>');
    if (g.addedBy) meta.push('<span>added by ' + esc(g.addedBy) + '</span>');
    return '<li><button type="button" class="guest' + (g.id === state.editingId ? ' editing' : '') + '" data-id="' + esc(g.id) + '">' +
      '<span class="g-top"><span class="g-name">' + esc(g.name) + '</span>' +
      (n > 1 ? '<span class="g-count">&times;' + n + '</span>' : '') + '</span>' +
      (meta.length ? '<span class="g-meta">' + meta.join(' ') + '</span>' : '') +
      (g.notes ? '<span class="g-notes">' + esc(g.notes) + '</span>' : '') +
      '</button></li>';
  }


  /* ============================================================
     GUEST FORM
     ============================================================ */

  function renderSideChips() {
    $('gSide').innerHTML = SIDES.map(function (s) {
      return '<button type="button" class="chip" data-side="' + esc(s.id) + '" aria-pressed="false">' + esc(s.label) + '</button>';
    }).join('');
    $('filterSide').innerHTML = '<option value="">Any side</option>' +
      SIDES.map(function (s) { return '<option value="' + esc(s.id) + '">' + esc(s.label) + '</option>'; }).join('') +
      '<option value="_none">Side not set</option>';
  }

  function getSide() {
    const on = $('gSide').querySelector('[aria-pressed="true"]');
    return on ? on.dataset.side : '';
  }

  function setSide(id) {
    $('gSide').querySelectorAll('.chip').forEach(function (c) {
      c.setAttribute('aria-pressed', String(c.dataset.side === id));
    });
  }

  function clampCount(v) {
    const n = parseInt(v, 10);
    return isNaN(n) ? 1 : Math.min(99, Math.max(1, n));
  }

  function resetForm() {
    const keepCat = $('gCategory').value;   // adding several guests to one category in a row is common
    state.editingId = null;
    $('guestForm').reset();
    $('gCategory').value = keepCat === '__new' ? '' : keepCat;
    $('gCount').value = 1;
    setSide('');
    $('newCatRow').hidden = true;
    $('formTitle').textContent = 'Add a guest';
    $('saveBtn').textContent = 'Add guest';
    $('cancelEdit').hidden = true;
    $('deleteBtn').hidden = true;
    $('formCard').classList.remove('is-editing');
  }

  function startEdit(id) {
    const g = state.data.guests.find(function (x) { return x.id === id; });
    if (!g) return;
    state.editingId = id;
    $('gName').value = g.name;
    $('gCategory').value = g.categoryId;
    setSide(g.side || '');
    $('gCount').value = Number(g.count) || 1;
    $('gNotes').value = g.notes || '';
    $('newCatRow').hidden = true;
    $('formTitle').textContent = 'Edit guest';
    $('saveBtn').textContent = 'Save';
    $('cancelEdit').hidden = false;
    $('deleteBtn').hidden = false;
    $('formCard').classList.add('is-editing');
    $('formCard').scrollIntoView({ behavior: 'smooth', block: 'start' });
    renderList();
  }

  async function onSubmit(ev) {
    ev.preventDefault();
    const name  = $('gName').value.trim().replace(/\s+/g, ' ');
    const catId = $('gCategory').value;
    if (!name) { toast('Please enter a name.', 'error'); $('gName').focus(); return; }
    if (!catId || catId === '__new') { toast('Please choose a category.', 'error'); $('gCategory').focus(); return; }

    const fields = {
      name: name,
      categoryId: catId,
      side: getSide(),
      count: clampCount($('gCount').value),
      notes: $('gNotes').value.trim()
    };
    const now = new Date().toISOString();

    if (state.editingId) {
      const id = state.editingId;
      const ok = await run('Saving…', function () {
        return commit('Edit guest: ' + name, function (d) {
          requireCategory(d, catId);
          const g = d.guests.find(function (x) { return x.id === id; });
          if (!g) throw new UserError('Someone else has just deleted this guest.');
          Object.assign(g, fields, { updatedBy: state.me, updatedAt: now });
        });
      });
      if (ok) { toast('Saved ' + name + '.'); resetForm(); }
      return;
    }

    const dup = state.data.guests.find(function (g) { return sameName(g.name, name); });
    if (dup && !confirm('"' + dup.name + '" is already on the list (in ' + categoryName(state.data, dup.categoryId) +
        ', added by ' + (dup.addedBy || 'someone') + ').\n\nAdd again anyway?')) return;

    const guest = Object.assign({ id: newId('g_') }, fields, { addedBy: state.me, addedAt: now });
    const ok = await run('Adding…', function () {
      return commit('Add guest: ' + name, function (d) {
        requireCategory(d, catId);
        if (!d.guests.some(function (x) { return x.id === guest.id; })) d.guests.push(guest);
      });
    });
    if (ok) { toast('Added ' + name + '.'); resetForm(); $('gName').focus(); }
  }

  async function onDelete() {
    const id = state.editingId;
    const g = state.data.guests.find(function (x) { return x.id === id; });
    if (!g || !confirm('Remove "' + g.name + '" from the guest list?')) return;
    const ok = await run('Deleting…', function () {
      return commit('Remove guest: ' + g.name, function (d) {
        d.guests = d.guests.filter(function (x) { return x.id !== id; });
      });
    });
    if (ok) { toast('Removed ' + g.name + '.'); resetForm(); }
  }


  /* ============================================================
     CATEGORIES
     ============================================================ */

  /* Returns the id of the category (an existing one if the name is taken). */
  async function addCategory(name) {
    name = name.trim().replace(/\s+/g, ' ');
    if (!name) return null;
    let id = newId('c_');
    const ok = await run(null, function () {
      return commit('Add category: ' + name, function (d) {
        const existing = d.categories.find(function (c) { return sameName(c.name, name); });
        if (existing) { id = existing.id; return; }
        d.categories.push({ id: id, name: name });
      });
    });
    return ok ? id : null;
  }

  function renderCatDialog() {
    const d = state.data;
    $('catList').innerHTML = d.categories.map(function (c) {
      const n = d.guests.filter(function (g) { return g.categoryId === c.id; }).length;
      return '<li data-id="' + esc(c.id) + '">' +
        '<input type="text" value="' + esc(c.name) + '" maxlength="40" aria-label="Category name">' +
        '<span class="muted small">' + n + '</span>' +
        '<button class="btn small ghost" type="button" data-act="rename">Rename</button>' +
        '<button class="btn small danger" type="button" data-act="delete"' + (n ? ' disabled title="Move or delete its guests first"' : '') + '>Delete</button>' +
        '</li>';
    }).join('') || '<li class="muted">No categories yet.</li>';
  }

  async function onCatListClick(ev) {
    const btn = ev.target.closest('button[data-act]');
    if (!btn) return;
    const li = btn.closest('li');
    const id = li.dataset.id;
    const current = state.data.categories.find(function (c) { return c.id === id; });
    if (!current) return;

    if (btn.dataset.act === 'rename') {
      const name = li.querySelector('input').value.trim().replace(/\s+/g, ' ');
      if (!name || name === current.name) return;
      const ok = await run(null, function () {
        return commit('Rename category: ' + current.name + ' -> ' + name, function (d) {
          if (d.categories.some(function (c) { return c.id !== id && sameName(c.name, name); })) {
            throw new UserError('There is already a category called "' + name + '".');
          }
          const c = d.categories.find(function (x) { return x.id === id; });
          if (!c) throw new UserError('Someone else has just deleted this category.');
          c.name = name;
        });
      });
      if (ok) toast('Renamed to ' + name + '.');
    } else {
      if (!confirm('Delete the category "' + current.name + '"?')) return;
      const ok = await run(null, function () {
        return commit('Delete category: ' + current.name, function (d) {
          const n = d.guests.filter(function (g) { return g.categoryId === id; }).length;
          if (n) throw new UserError('"' + current.name + '" still has ' + n + ' guest' + (n === 1 ? '' : 's') + '. Move or delete them first.');
          d.categories = d.categories.filter(function (c) { return c.id !== id; });
        });
      });
      if (ok) toast('Deleted ' + current.name + '.');
    }
  }


  /* ============================================================
     CSV EXPORT
     ============================================================ */

  function exportCsv() {
    const d = state.data;
    const order = {};
    d.categories.forEach(function (c, i) { order[c.id] = i; });
    const rows = d.guests.slice().sort(function (a, b) {
      return ((order[a.categoryId] ?? 1e9) - (order[b.categoryId] ?? 1e9)) ||
        a.name.localeCompare(b.name, undefined, { sensitivity: 'base' });
    });

    // Leading = + - @ would be run as a formula by Excel
    const cell = function (v) {
      let s = String(v == null ? '' : v);
      if (/^[=+\-@]/.test(s)) s = "'" + s;
      return '"' + s.replace(/"/g, '""') + '"';
    };
    const lines = [['Name', 'Category', 'Side', 'People', 'Notes', 'Added by', 'Added on']].concat(rows.map(function (g) {
      return [g.name, categoryName(d, g.categoryId), sideLabel(g.side), Number(g.count) || 1, g.notes, g.addedBy,
        g.addedAt ? g.addedAt.slice(0, 10) : ''];
    }));
    const csv = '﻿' + lines.map(function (r) { return r.map(cell).join(','); }).join('\r\n');

    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
    a.download = 'guest-list-' + new Date().toISOString().slice(0, 10) + '.csv';
    document.body.appendChild(a);
    a.click();
    setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
  }


  /* ============================================================
     LOCK / UNLOCK / LOAD
     ============================================================ */

  function show(which) {
    $('lockScreen').hidden    = which !== 'lock';
    $('notConfigured').hidden = which !== 'setup';
    $('app').hidden           = which !== 'app';
  }

  function lock(message) {
    state.token = null;
    state.data = null;
    store.del(KEY_TOKEN);
    $('myName').value = state.me || store.get(KEY_NAME) || '';
    $('passcode').value = '';
    const err = $('unlockError');
    err.textContent = message || '';
    err.hidden = !message;
    show('lock');
  }

  async function onUnlock(ev) {
    ev.preventDefault();
    const pass = $('passcode').value;
    const name = $('myName').value.trim().replace(/\s+/g, ' ');
    const err  = $('unlockError');
    if (!pass || !name) return;
    const btn = $('unlockBtn');
    btn.disabled = true;
    btn.textContent = 'Opening…';
    err.hidden = true;
    try {
      state.token = await Vault.decrypt(CONFIG.vault, pass);
    } catch (e) {
      err.textContent = 'That passcode is not right. Please try again.';
      err.hidden = false;
      btn.disabled = false;
      btn.textContent = 'Open guest list';
      return;
    }
    state.me = name;
    store.set(KEY_TOKEN, state.token);
    store.set(KEY_NAME, name);
    btn.disabled = false;
    btn.textContent = 'Open guest list';
    await start();
  }

  async function start() {
    show('app');
    $('list').innerHTML = '<p class="empty">Loading the guest list&hellip;</p>';
    try {
      await readData();
      render();
    } catch (e) {
      if (e.status === 401 || e.status === 403 || e.status === 404) { lock(explain(e)); return; }
      $('list').innerHTML = '<p class="empty">' + esc(explain(e)) + '</p>';
    }
  }

  async function refresh(quiet) {
    if (state.busy || !state.token) return;
    try {
      await readData();
      if (state.editingId && !state.data.guests.some(function (g) { return g.id === state.editingId; })) {
        resetForm();
        toast('The guest you were editing was deleted by someone else.', 'error');
      }
      render();
      if (!quiet) toast('Up to date.');
    } catch (e) {
      if (e.status === 401) { lock(explain(e)); return; }
      if (!quiet) toast(explain(e), 'error');
    }
  }


  /* ============================================================
     WIRING
     ============================================================ */

  function init() {
    document.title = CONFIG.title;
    $('title').textContent = CONFIG.title;
    $('subtitle').textContent = CONFIG.subtitle || '';
    renderSideChips();

    $('unlockForm').addEventListener('submit', onUnlock);
    $('guestForm').addEventListener('submit', onSubmit);
    $('deleteBtn').addEventListener('click', onDelete);
    $('cancelEdit').addEventListener('click', function () { resetForm(); renderList(); });

    $('gSide').addEventListener('click', function (ev) {
      const chip = ev.target.closest('.chip');
      if (!chip) return;
      setSide(chip.getAttribute('aria-pressed') === 'true' ? '' : chip.dataset.side);   // tap again to clear
    });

    document.querySelectorAll('[data-step]').forEach(function (b) {
      b.addEventListener('click', function () {
        $('gCount').value = clampCount(clampCount($('gCount').value) + Number(b.dataset.step));
      });
    });
    $('gCount').addEventListener('change', function () { this.value = clampCount(this.value); });

    /* "+ New category…" inside the form */
    let prevCat = '';
    $('gCategory').addEventListener('focus', function () { prevCat = this.value; });
    $('gCategory').addEventListener('change', function () {
      if (this.value === '__new') {
        $('newCatRow').hidden = false;
        $('newCatName').focus();
      } else {
        prevCat = this.value;
        $('newCatRow').hidden = true;
      }
    });
    const closeNewCat = function (selectId) {
      $('newCatRow').hidden = true;
      $('newCatName').value = '';
      $('gCategory').value = selectId || prevCat || '';
    };
    $('newCatCancel').addEventListener('click', function () { closeNewCat(); });
    const addFromForm = async function () {
      const id = await addCategory($('newCatName').value);
      if (id) closeNewCat(id);
    };
    $('newCatAdd').addEventListener('click', addFromForm);
    $('newCatName').addEventListener('keydown', function (ev) {
      if (ev.key === 'Enter') { ev.preventDefault(); addFromForm(); }
    });

    /* list */
    $('list').addEventListener('click', function (ev) {
      const row = ev.target.closest('.guest');
      if (row) startEdit(row.dataset.id);
    });
    ['search', 'filterCat', 'filterSide'].forEach(function (id) {
      $(id).addEventListener('input', renderList);
    });

    /* footer */
    $('exportCsv').addEventListener('click', exportCsv);
    $('refreshBtn').addEventListener('click', function () { refresh(false); });
    $('lockBtn').addEventListener('click', function () {
      if (confirm('Lock this device? You will need the passcode again.')) lock();
    });
    $('changeName').addEventListener('click', function () {
      const n = (prompt('Your name', state.me) || '').trim().replace(/\s+/g, ' ');
      if (!n) return;
      state.me = n;
      store.set(KEY_NAME, n);
      render();
    });

    /* categories dialog */
    const dlg = $('catDialog');
    $('manageCats').addEventListener('click', function () { renderCatDialog(); dlg.showModal(); });
    $('catClose').addEventListener('click', function () { dlg.close(); });
    dlg.addEventListener('click', function (ev) { if (ev.target === dlg) dlg.close(); });   // tap backdrop
    $('catList').addEventListener('click', onCatListClick);
    $('catList').addEventListener('keydown', function (ev) {
      if (ev.key !== 'Enter' || ev.target.tagName !== 'INPUT') return;
      ev.preventDefault();
      ev.target.closest('li').querySelector('[data-act="rename"]').click();
    });
    $('catAddForm').addEventListener('submit', async function (ev) {
      ev.preventDefault();
      if (await addCategory($('catAddName').value)) {
        $('catAddName').value = '';
        toast('Category added.');
      }
    });

    /* pick up other people's changes when coming back to the tab */
    document.addEventListener('visibilitychange', function () {
      if (document.visibilityState === 'visible' && Date.now() - state.loadedAt > 20000) refresh(true);
    });

    /* ---------- first screen ---------- */
    if (!CONFIG.vault) { show('setup'); return; }
    state.me = store.get(KEY_NAME) || '';
    state.token = store.get(KEY_TOKEN);
    if (state.token && state.me) start();
    else lock();
  }

  init();
})();
