/* ================================================================
   سياق — عارض المحتوى المتسلسل
   ================================================================ */

const S = window.syaq;
const $ = (id) => document.getElementById(id);

/* ---------------- الحالة ---------------- */
const state = {
  items: [],            // العناصر بالترتيب الحالي
  selected: new Set(),  // معرّفات العناصر المحددة
  lastClicked: null,
  currentSet: null,     // { name, file }
  dirty: false,
  viewer: {
    open: false,
    index: 0,
    zoom: 1,
    panX: 0,
    panY: 0,
    slideTimer: null,
    hideTimer: null
  }
};

const DEFAULTS = {
  navDir: 'rtl',
  clickMode: 'zones',
  wheel: 'nav',
  fit: 'contain',
  videoStart: 'auto',   // auto | manual
  advanceOnEnd: true,
  loop: false,
  muted: false,
  slideSec: 0
};
let settings = { ...DEFAULTS };

/* ---------------- أدوات مساعدة ---------------- */

function fileURL(p) {
  let s = String(p).replace(/\\/g, '/');
  if (!s.startsWith('/')) s = '/' + s;
  s = encodeURI('file://' + s);
  return s.replace(/#/g, '%23').replace(/\?/g, '%3F');
}

const KIND_ICON = {
  image: '🖼️', video: '🎬', audio: '🎵', pdf: '📕',
  text: '📄', office: '📘', other: '📦'
};
const KIND_LABEL = {
  image: 'صورة', video: 'فيديو', audio: 'صوت', pdf: 'PDF',
  text: 'نص', office: 'مستند', other: 'ملف'
};

function fmtSize(n) {
  if (!n) return '';
  const u = ['بايت', 'ك.ب', 'م.ب', 'ج.ب'];
  let i = 0;
  while (n >= 1024 && i < u.length - 1) { n /= 1024; i++; }
  return n.toFixed(i === 0 ? 0 : 1) + ' ' + u[i];
}

function fmtDate(ts) {
  if (!ts) return '';
  try {
    return new Date(ts).toLocaleDateString('ar', {
      year: 'numeric', month: 'short', day: 'numeric'
    });
  } catch { return ''; }
}

let toastTimer = null;
function toast(msg, ms = 2000) {
  const el = state.viewer.open ? $('toast') : $('mainToast');
  el.textContent = msg;
  el.classList.remove('hidden');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.add('hidden'), ms);
}

function confirmBox(title, text) {
  return new Promise((resolve) => {
    $('confirmTitle').textContent = title;
    $('confirmText').textContent = text;
    $('modalConfirm').classList.remove('hidden');
    const done = (v) => {
      $('modalConfirm').classList.add('hidden');
      $('confirmYes').onclick = null;
      $('confirmNo').onclick = null;
      resolve(v);
    };
    $('confirmYes').onclick = () => done(true);
    $('confirmNo').onclick = () => done(false);
  });
}

function askText(title, initial = '') {
  return new Promise((resolve) => {
    const wrap = document.createElement('div');
    wrap.className = 'modal';
    wrap.innerHTML =
      '<div class="modal-box">' +
      '<h3></h3>' +
      '<input type="text" class="input" />' +
      '<div class="modal-actions">' +
      '<button class="btn" data-x="no">إلغاء</button>' +
      '<button class="btn btn-primary" data-x="yes">حسناً</button>' +
      '</div></div>';
    wrap.querySelector('h3').textContent = title;
    const input = wrap.querySelector('input');
    input.value = initial;
    document.body.appendChild(wrap);
    input.focus();
    input.select();
    const done = (v) => { wrap.remove(); resolve(v); };
    wrap.querySelector('[data-x=no]').onclick = () => done(null);
    wrap.querySelector('[data-x=yes]').onclick = () => done(input.value.trim() || null);
    input.onkeydown = (e) => {
      if (e.key === 'Enter') done(input.value.trim() || null);
      if (e.key === 'Escape') done(null);
    };
  });
}

/* ================================================================
   قائمة المحتوى
   ================================================================ */

function addItems(newItems, { announce = true } = {}) {
  const have = new Set(state.items.map(i => i.path.toLowerCase()));
  const fresh = newItems.filter(i => !have.has(i.path.toLowerCase()));
  state.items.push(...fresh);
  state.dirty = true;
  renderItems();
  if (announce) {
    const skipped = newItems.length - fresh.length;
    toast(fresh.length
      ? `أُضيف ${fresh.length} عنصر${skipped ? ` (تجاهُل ${skipped} مكرر)` : ''}`
      : 'كل الملفات موجودة مسبقاً');
  }
}

function removeItem(id) {
  state.items = state.items.filter(i => i.id !== id);
  state.selected.delete(id);
  state.dirty = true;
  renderItems();
}

function moveItem(fromIdx, toIdx) {
  if (fromIdx === toIdx || fromIdx < 0 || toIdx < 0) return;
  const [it] = state.items.splice(fromIdx, 1);
  state.items.splice(toIdx, 0, it);
  state.dirty = true;
  renderItems();
}

function renderItems() {
  const list = $('itemsList');
  const empty = $('emptyState');
  list.innerHTML = '';

  const n = state.items.length;
  empty.classList.toggle('hidden', n > 0);
  const missing = state.items.filter(i => !i.exists).length;
  $('countLabel').textContent = n
    ? `${n} عنصر في العرض${missing ? ` — ${missing} غير موجود` : ''}`
    : 'لا يوجد محتوى';
  $('btnPlay').disabled = n === 0;
  $('btnSave').disabled = n === 0;

  state.items.forEach((it, idx) => {
    const card = document.createElement('div');
    card.className = 'card' + (state.selected.has(it.id) ? ' selected' : '') + (it.exists ? '' : ' missing');
    card.draggable = true;
    card.dataset.id = it.id;
    card.dataset.idx = String(idx);

    // المصغّرة
    const thumb = document.createElement('div');
    thumb.className = 'card-thumb';
    if (it.exists && it.kind === 'image') {
      const img = document.createElement('img');
      img.loading = 'lazy';
      img.src = fileURL(it.path);
      img.onerror = () => { thumb.innerHTML = '<div class="card-icon">🖼️</div>'; };
      thumb.appendChild(img);
    } else if (it.exists && it.kind === 'video') {
      const v = document.createElement('video');
      v.preload = 'metadata';
      v.muted = true;
      v.src = fileURL(it.path) + '#t=0.4';
      v.onerror = () => { thumb.innerHTML = '<div class="card-icon">🎬</div>'; };
      thumb.appendChild(v);
    } else {
      thumb.innerHTML = `<div class="card-icon">${KIND_ICON[it.kind] || '📦'}</div>`;
    }

    // رقم الترتيب (قابل للتعديل بالنقر)
    const order = document.createElement('div');
    order.className = 'card-order';
    order.title = 'اضغط لتغيير رقم الترتيب';
    order.textContent = String(idx + 1);
    order.onclick = (e) => { e.stopPropagation(); editOrder(idx, order); };
    thumb.appendChild(order);

    const kind = document.createElement('div');
    kind.className = 'card-kind';
    kind.textContent = KIND_LABEL[it.kind] || 'ملف';
    thumb.appendChild(kind);

    if (!it.exists) {
      const miss = document.createElement('div');
      miss.className = 'missing-badge';
      miss.textContent = 'الملف غير موجود في مكانه';
      thumb.appendChild(miss);
    }

    // الجسم
    const body = document.createElement('div');
    body.className = 'card-body';
    const name = document.createElement('div');
    name.className = 'card-name';
    name.textContent = it.name;
    name.title = it.path;
    const sub = document.createElement('div');
    sub.className = 'card-sub';
    sub.textContent = [fmtSize(it.size), fmtDate(it.mtime)].filter(Boolean).join(' · ');
    body.append(name, sub);

    // الأدوات
    const tools = document.createElement('div');
    tools.className = 'card-tools';
    const mk = (label, title, cls, fn) => {
      const b = document.createElement('button');
      b.textContent = label;
      b.title = title;
      if (cls) b.className = cls;
      b.onclick = (e) => { e.stopPropagation(); fn(); };
      return b;
    };
    if (!it.exists) {
      tools.appendChild(mk('🔎', 'تحديد مكان الملف الجديد', '', () => relocate(it.id)));
    } else {
      tools.appendChild(mk('↗', 'فتح بالبرنامج الافتراضي', '', () => S.openExternal(it.path)));
      tools.appendChild(mk('📂', 'إظهار في المجلد', '', () => S.showInFolder(it.path)));
    }
    tools.appendChild(mk('✕', 'إزالة من العرض', 'rm', () => removeItem(it.id)));

    card.append(thumb, body, tools);

    card.onclick = (e) => selectCard(it.id, idx, e);
    card.ondblclick = () => openViewer(idx);

    list.appendChild(card);
  });

  wireDragReorder();
}

function editOrder(idx, badgeEl) {
  const input = document.createElement('input');
  input.type = 'number';
  input.value = String(idx + 1);
  input.min = '1';
  input.max = String(state.items.length);
  input.style.cssText =
    'width:46px;height:26px;border-radius:8px;border:1px solid #22d3c5;' +
    'background:#0b1220;color:#fff;text-align:center;font-size:12px;font-family:inherit;';
  badgeEl.replaceWith(input);
  input.focus();
  input.select();
  const apply = () => {
    const v = parseInt(input.value, 10);
    if (!isNaN(v)) {
      const target = Math.min(Math.max(v, 1), state.items.length) - 1;
      moveItem(idx, target);
    } else {
      renderItems();
    }
  };
  input.onblur = apply;
  input.onkeydown = (e) => {
    if (e.key === 'Enter') { e.preventDefault(); input.blur(); }
    if (e.key === 'Escape') { input.onblur = null; renderItems(); }
    e.stopPropagation();
  };
  input.onclick = (e) => e.stopPropagation();
}

async function relocate(id) {
  const picked = await S.pickFiles();
  if (!picked.length) return;
  const i = state.items.findIndex(x => x.id === id);
  if (i >= 0) {
    state.items[i] = picked[0];
    state.dirty = true;
    renderItems();
    toast('تم تحديث مسار الملف');
  }
}

function selectCard(id, idx, e) {
  if (e.ctrlKey || e.metaKey) {
    state.selected.has(id) ? state.selected.delete(id) : state.selected.add(id);
  } else if (e.shiftKey && state.lastClicked !== null) {
    const a = Math.min(state.lastClicked, idx);
    const b = Math.max(state.lastClicked, idx);
    state.selected.clear();
    for (let i = a; i <= b; i++) state.selected.add(state.items[i].id);
  } else {
    state.selected.clear();
    state.selected.add(id);
  }
  state.lastClicked = idx;
  renderItems();
}

/* ---------------- السحب لإعادة الترتيب ---------------- */
let dragSrcIdx = null;

function wireDragReorder() {
  document.querySelectorAll('.card').forEach(card => {
    card.addEventListener('dragstart', (e) => {
      dragSrcIdx = Number(card.dataset.idx);
      card.classList.add('dragging');
      e.dataTransfer.effectAllowed = 'move';
      e.dataTransfer.setData('text/plain', String(dragSrcIdx));
    });
    card.addEventListener('dragend', () => {
      card.classList.remove('dragging');
      document.querySelectorAll('.card').forEach(c =>
        c.classList.remove('drop-before', 'drop-after'));
      dragSrcIdx = null;
    });
    card.addEventListener('dragover', (e) => {
      if (dragSrcIdx === null) return;   // إفلات ملفات من النظام
      e.preventDefault();
      const r = card.getBoundingClientRect();
      const before = e.clientX > r.left + r.width / 2;   // الاتجاه من اليمين لليسار
      card.classList.toggle('drop-before', before);
      card.classList.toggle('drop-after', !before);
    });
    card.addEventListener('dragleave', () => {
      card.classList.remove('drop-before', 'drop-after');
    });
    card.addEventListener('drop', (e) => {
      if (dragSrcIdx === null) return;
      e.preventDefault();
      e.stopPropagation();
      const r = card.getBoundingClientRect();
      const before = e.clientX > r.left + r.width / 2;
      let target = Number(card.dataset.idx);
      if (!before) target += 1;
      if (dragSrcIdx < target) target -= 1;
      moveItem(dragSrcIdx, target);
      dragSrcIdx = null;
    });
  });
}

/* ---------------- إفلات ملفات من النظام ---------------- */
function wireOsDrop() {
  const dz = $('dropzone');
  const stop = (e) => { e.preventDefault(); e.stopPropagation(); };

  ['dragenter', 'dragover'].forEach(ev =>
    dz.addEventListener(ev, (e) => {
      if (dragSrcIdx !== null) return;
      stop(e);
      dz.classList.add('drag');
    }));

  ['dragleave', 'dragend'].forEach(ev =>
    dz.addEventListener(ev, (e) => {
      if (e.target === dz) dz.classList.remove('drag');
    }));

  dz.addEventListener('drop', async (e) => {
    dz.classList.remove('drag');
    if (dragSrcIdx !== null) return;
    stop(e);
    const paths = [];
    for (const f of e.dataTransfer.files) {
      const p = S.pathForFile(f);
      if (p) paths.push(p);
    }
    if (!paths.length) return;
    const resolved = await S.resolveDropped(paths);
    if (resolved.length) addItems(resolved);
    else toast('لا توجد ملفات مدعومة في ما أفلتّه');
  });

  // منع فتح الملف في النافذة عند الإفلات خارج المنطقة
  window.addEventListener('dragover', (e) => e.preventDefault());
  window.addEventListener('drop', (e) => e.preventDefault());
}

/* ---------------- الترتيب التلقائي ---------------- */
function applySort(mode) {
  const arr = state.items;
  switch (mode) {
    case 'name':
      arr.sort((a, b) => a.name.localeCompare(b.name, 'ar', { numeric: true }));
      break;
    case 'date':
      arr.sort((a, b) => a.mtime - b.mtime);
      break;
    case 'kind':
      arr.sort((a, b) =>
        a.kind.localeCompare(b.kind) || a.name.localeCompare(b.name, 'ar', { numeric: true }));
      break;
    case 'size':
      arr.sort((a, b) => b.size - a.size);
      break;
    case 'reverse':
      arr.reverse();
      break;
    case 'shuffle':
      for (let i = arr.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [arr[i], arr[j]] = [arr[j], arr[i]];
      }
      break;
    default: return;
  }
  state.dirty = true;
  renderItems();
}

/* ================================================================
   العروض المحفوظة
   ================================================================ */

async function refreshSets() {
  const sets = await S.setsList();
  const box = $('setsList');
  box.innerHTML = '';
  $('setsHint').textContent = sets.length
    ? `${sets.length} عرض محفوظ — تُحفظ داخل جهازك`
    : 'لم تحفظ أي عرض بعد.';

  sets.forEach(st => {
    const card = document.createElement('div');
    card.className = 'set-card' +
      (state.currentSet && state.currentSet.file === st.file ? ' active' : '');

    const name = document.createElement('div');
    name.className = 'set-name';
    name.textContent = st.name;

    const meta = document.createElement('div');
    meta.className = 'set-meta';
    meta.innerHTML = `<span>${st.count} عنصر</span><span>${fmtDate(st.updated)}</span>`;

    const acts = document.createElement('div');
    acts.className = 'set-actions';

    const bOpen = document.createElement('button');
    bOpen.textContent = 'فتح';
    bOpen.onclick = (e) => { e.stopPropagation(); loadSet(st.file); };

    const bRen = document.createElement('button');
    bRen.textContent = 'تسمية';
    bRen.onclick = async (e) => {
      e.stopPropagation();
      const nn = await askText('اسم جديد للعرض', st.name);
      if (!nn) return;
      const r = await S.setsRename({ file: st.file, newName: nn });
      if (state.currentSet && state.currentSet.file === st.file) {
        state.currentSet = { name: nn, file: r.file };
        updateCurrentSetLabel();
      }
      refreshSets();
    };

    const bDel = document.createElement('button');
    bDel.className = 'del';
    bDel.textContent = 'حذف';
    bDel.onclick = async (e) => {
      e.stopPropagation();
      if (!await confirmBox('حذف العرض', `سيُحذف العرض «${st.name}» من القائمة. الملفات نفسها لن تُحذف.`)) return;
      await S.setsDelete(st.file);
      if (state.currentSet && state.currentSet.file === st.file) {
        state.currentSet = null;
        updateCurrentSetLabel();
      }
      refreshSets();
      toast('حُذف العرض');
    };

    acts.append(bOpen, bRen, bDel);
    card.append(name, meta, acts);
    card.ondblclick = () => loadSet(st.file);
    box.appendChild(card);
  });
}

async function loadSet(file) {
  if (state.items.length && state.dirty) {
    const ok = await confirmBox('فتح عرض محفوظ',
      'ستُستبدل القائمة الحالية بمحتوى العرض المحفوظ. تريد المتابعة؟');
    if (!ok) return;
  }
  const data = await S.setsLoad(file);
  state.items = data.items;
  state.selected.clear();
  state.currentSet = { name: data.name, file: data.file };
  state.dirty = false;
  renderItems();
  updateCurrentSetLabel();
  refreshSets();

  const missing = data.items.filter(i => !i.exists).length;
  toast(missing
    ? `فُتح «${data.name}» — ${missing} ملف غير موجود في مكانه`
    : `فُتح «${data.name}» بترتيبه المحفوظ`, 3200);
}

function updateCurrentSetLabel() {
  const el = $('currentSet');
  if (state.currentSet) {
    el.textContent = '● ' + state.currentSet.name;
    el.classList.add('on');
  } else {
    el.classList.remove('on');
  }
}

function openSaveModal() {
  if (!state.items.length) return;
  $('saveName').value = state.currentSet ? state.currentSet.name : '';
  $('saveWarn').classList.add('hidden');
  $('saveOk').textContent = 'حفظ';
  $('modalSave').classList.remove('hidden');
  $('saveName').focus();
  $('saveName').select();
}

async function doSave(overwrite = false) {
  const name = $('saveName').value.trim();
  if (!name) {
    $('saveWarn').textContent = 'اكتب اسماً للعرض أولاً.';
    $('saveWarn').classList.remove('hidden');
    return;
  }
  const res = await S.setsSave({ name, items: state.items, overwrite });
  if (!res.ok && res.reason === 'exists') {
    $('saveWarn').textContent = 'يوجد عرض محفوظ بهذا الاسم. اضغط «استبدال» للكتابة فوقه.';
    $('saveWarn').classList.remove('hidden');
    $('saveOk').textContent = 'استبدال';
    $('saveOk').onclick = () => doSave(true);
    return;
  }
  $('modalSave').classList.add('hidden');
  $('saveOk').onclick = () => doSave(false);
  state.currentSet = { name, file: res.file };
  state.dirty = false;
  updateCurrentSetLabel();
  refreshSets();
  toast(`حُفظ العرض «${name}» بـ ${state.items.length} عنصر`);
}

/* ================================================================
   العارض
   ================================================================ */

const stage = () => $('stage');

function openViewer(index = 0) {
  if (!state.items.length) return;
  state.viewer.open = true;
  state.viewer.index = Math.min(Math.max(index, 0), state.items.length - 1);
  $('viewer').classList.remove('hidden');
  $('viewer').focus();
  $('vTotal').textContent = String(state.items.length);
  $('vSeek').max = String(state.items.length);
  S.setFullscreen(true);
  showAt(state.viewer.index);
  armControlsHide();
}

function closeViewer() {
  stopSlideTimer();
  stage().innerHTML = '';
  state.viewer.open = false;
  $('viewer').classList.add('hidden');
  $('vGridPanel').classList.add('hidden');
  S.setFullscreen(false);
}

function clampIndex(i) {
  const n = state.items.length;
  if (settings.loop) return ((i % n) + n) % n;
  return Math.min(Math.max(i, 0), n - 1);
}

function go(delta) {
  const n = state.items.length;
  const next = state.viewer.index + delta;
  if (!settings.loop && (next < 0 || next >= n)) {
    toast(next < 0 ? 'هذا أول عنصر' : 'هذا آخر عنصر', 1200);
    return;
  }
  showAt(clampIndex(next));
}

function showAt(i) {
  stopSlideTimer();
  state.viewer.index = i;
  state.viewer.zoom = 1;
  state.viewer.panX = 0;
  state.viewer.panY = 0;

  const it = state.items[i];
  $('vIndex').textContent = String(i + 1);
  $('vSeek').value = String(i + 1);
  $('vTitle').textContent = `${i + 1}. ${it.name}`;

  const st = stage();
  st.innerHTML = '';
  st.className = 'stage' + (it.kind === 'pdf' ? ' pdf-mode' : '');
  state.viewer.kind = it.exists ? it.kind : 'other';
  $('viewer').classList.toggle('no-zones', it.kind === 'pdf' || it.kind === 'text');

  if (!it.exists) {
    st.appendChild(fileCard(it, 'الملف غير موجود في مساره المحفوظ', true));
    return;
  }

  switch (it.kind) {
    case 'image':   renderImage(st, it); break;
    case 'video':   renderVideo(st, it); break;
    case 'audio':   renderAudio(st, it); break;
    case 'pdf':     renderPdf(st, it); break;
    case 'text':    renderText(st, it); break;
    default:        st.appendChild(fileCard(it, 'هذا النوع لا يُعرض داخل البرنامج')); break;
  }

  preloadNeighbors(i);
  if (document.querySelector('.grid-panel:not(.hidden)')) renderGrid();
}

function renderImage(st, it) {
  const img = document.createElement('img');
  img.className = 'media' + (settings.fit === 'cover' ? ' fit-cover' : settings.fit === 'none' ? ' fit-none' : '');
  img.src = fileURL(it.path);
  img.draggable = false;
  img.onerror = () => {
    st.innerHTML = '';
    st.appendChild(fileCard(it, 'تعذّر عرض هذه الصورة'));
  };
  st.appendChild(img);
  enablePan(img);
  if (settings.slideSec > 0) startSlideTimer();
}

function renderVideo(st, it) {
  const auto = settings.videoStart !== 'manual';
  const v = document.createElement('video');
  v.className = 'media';
  v.src = fileURL(it.path);
  v.controls = true;
  v.muted = settings.muted;
  v.autoplay = auto;
  v.onended = () => { if (settings.advanceOnEnd) go(navStep()); };
  v.onerror = () => {
    st.innerHTML = '';
    st.appendChild(fileCard(it,
      'صيغة الفيديو غير مدعومة داخل البرنامج (جرّب mp4 أو webm)، يمكنك فتحه خارجياً'));
  };
  st.appendChild(v);

  if (auto) {
    v.play().catch(() => addPlayOverlay(st, v));   // لو منع النظام التشغيل التلقائي
  } else {
    addPlayOverlay(st, v);
  }
}

/* طبقة زر التشغيل في الوضع اليدوي */
function addPlayOverlay(st, media) {
  const ov = document.createElement('div');
  ov.className = 'play-overlay';
  ov.innerHTML = '<div class="pbtn">▶</div>' +
                 '<div class="phint">اضغط للتشغيل — أو مفتاح المسافة</div>';
  const start = (e) => {
    if (e) { e.preventDefault(); e.stopPropagation(); }
    media.play().catch(() => {});
  };
  ov.addEventListener('click', start);
  media.addEventListener('play', () => ov.remove(), { once: true });
  st.appendChild(ov);
}

function renderAudio(st, it) {
  const box = document.createElement('div');
  box.className = 'audio-view';
  const ico = document.createElement('div');
  ico.className = 'big-icon';
  ico.textContent = '🎵';
  const nm = document.createElement('h2');
  nm.textContent = it.name;
  const a = document.createElement('audio');
  a.src = fileURL(it.path);
  a.controls = true;
  a.autoplay = settings.videoStart !== 'manual';
  a.onended = () => { if (settings.advanceOnEnd) go(navStep()); };
  box.append(ico, nm, a);
  st.appendChild(box);
}

function renderPdf(st, it) {
  const f = document.createElement('iframe');
  f.className = 'media';
  f.src = fileURL(it.path);
  st.appendChild(f);
}

async function renderText(st, it) {
  const res = await S.readText(it.path);
  if (!res.ok) {
    st.appendChild(fileCard(it, 'تعذّرت قراءة الملف: ' + res.error));
    return;
  }
  const pre = document.createElement('div');
  pre.className = 'doc-view';
  pre.textContent = res.text + (res.truncated ? '\n\n… (عُرض جزء من الملف فقط)' : '');
  st.appendChild(pre);
  if (settings.slideSec > 0) startSlideTimer();
}

function fileCard(it, msg, missing = false) {
  const box = document.createElement('div');
  box.className = 'file-card';

  const ico = document.createElement('div');
  ico.className = 'big-icon';
  ico.textContent = missing ? '⚠️' : (KIND_ICON[it.kind] || '📦');

  const h = document.createElement('h2');
  h.textContent = it.name;

  const p = document.createElement('p');
  p.textContent = msg;

  const p2 = document.createElement('p');
  p2.textContent = it.path;
  p2.style.opacity = '.6';
  p2.style.fontSize = '11px';
  p2.style.direction = 'ltr';

  box.append(ico, h, p, p2);

  if (!missing) {
    const row = document.createElement('div');
    row.style.cssText = 'display:flex;gap:10px;margin-top:8px;';
    const b1 = document.createElement('button');
    b1.className = 'btn btn-primary';
    b1.textContent = '↗ فتح بالبرنامج الافتراضي';
    b1.onclick = () => S.openExternal(it.path);
    const b2 = document.createElement('button');
    b2.className = 'btn';
    b2.textContent = '📂 إظهار في المجلد';
    b2.onclick = () => S.showInFolder(it.path);
    row.append(b1, b2);
    box.appendChild(row);
  }
  return box;
}

const preloadCache = [];
function preloadNeighbors(i) {
  preloadCache.length = 0;
  [i + 1, i - 1, i + 2].forEach(k => {
    const it = state.items[clampIndex(k)];
    if (it && it.exists && it.kind === 'image') {
      const img = new Image();
      img.src = fileURL(it.path);
      preloadCache.push(img);
    }
  });
}

/* ---------------- التكبير والتحريك ---------------- */
function applyTransform() {
  const img = stage().querySelector('img.media');
  if (!img) return;
  const v = state.viewer;
  img.style.transform = `translate(${v.panX}px, ${v.panY}px) scale(${v.zoom})`;
  img.style.cursor = v.zoom > 1 ? 'grab' : 'default';
}

function zoomBy(f) {
  const v = state.viewer;
  const img = stage().querySelector('img.media');
  if (!img) return;
  v.zoom = Math.min(Math.max(v.zoom * f, 0.2), 8);
  if (v.zoom <= 1) { v.panX = 0; v.panY = 0; }
  applyTransform();
  toast('التكبير ' + Math.round(v.zoom * 100) + '%', 900);
}

function resetZoom() {
  const v = state.viewer;
  v.zoom = 1; v.panX = 0; v.panY = 0;
  applyTransform();
}

function enablePan(img) {
  let dragging = false, sx = 0, sy = 0, ox = 0, oy = 0;
  img.addEventListener('mousedown', (e) => {
    if (state.viewer.zoom <= 1) return;
    e.preventDefault();
    e.stopPropagation();
    dragging = true;
    sx = e.clientX; sy = e.clientY;
    ox = state.viewer.panX; oy = state.viewer.panY;
    img.style.cursor = 'grabbing';
  });
  window.addEventListener('mousemove', (e) => {
    if (!dragging) return;
    state.viewer.panX = ox + (e.clientX - sx);
    state.viewer.panY = oy + (e.clientY - sy);
    applyTransform();
  });
  window.addEventListener('mouseup', () => {
    if (dragging) { dragging = false; applyTransform(); }
  });
}

/* ---------------- العرض التلقائي ---------------- */
function startSlideTimer() {
  stopSlideTimer();
  if (!(settings.slideSec > 0)) return;
  state.viewer.slideTimer = setTimeout(() => go(navStep()), settings.slideSec * 1000);
}
function stopSlideTimer() {
  clearTimeout(state.viewer.slideTimer);
  state.viewer.slideTimer = null;
}

/* اتجاه "التالي" كقيمة +1 دائماً في المصفوفة */
function navStep() { return 1; }

/* ---------------- شبكة التنقل ---------------- */
function renderGrid() {
  const p = $('vGridPanel');
  p.innerHTML = '';
  state.items.forEach((it, i) => {
    const c = document.createElement('div');
    c.className = 'g-cell' + (i === state.viewer.index ? ' cur' : '');
    if (it.exists && it.kind === 'image') {
      const im = document.createElement('img');
      im.loading = 'lazy';
      im.src = fileURL(it.path);
      c.appendChild(im);
    } else if (it.exists && it.kind === 'video') {
      const v = document.createElement('video');
      v.preload = 'metadata';
      v.muted = true;
      v.src = fileURL(it.path) + '#t=0.4';
      v.style.cssText = 'width:100%;height:100%;object-fit:cover;';
      c.appendChild(v);
    } else {
      const d = document.createElement('div');
      d.className = 'g-ico';
      d.textContent = KIND_ICON[it.kind] || '📦';
      c.appendChild(d);
    }
    const num = document.createElement('div');
    num.className = 'g-num';
    num.textContent = String(i + 1);
    const nm = document.createElement('div');
    nm.className = 'g-name';
    nm.textContent = it.name;
    c.append(num, nm);
    c.onclick = () => { p.classList.add('hidden'); showAt(i); };
    p.appendChild(c);
  });
}

function toggleGrid() {
  const p = $('vGridPanel');
  if (p.classList.contains('hidden')) {
    renderGrid();
    p.classList.remove('hidden');
    const cur = p.querySelector('.g-cell.cur');
    if (cur) cur.scrollIntoView({ block: 'center' });
  } else {
    p.classList.add('hidden');
  }
}

/* ---------------- إخفاء أشرطة التحكم ---------------- */
function armControlsHide() {
  clearTimeout(state.viewer.hideTimer);
  $('vTop').classList.remove('faded');
  $('vBottom').classList.remove('faded');
  $('viewer').classList.remove('cursor-hidden');
  state.viewer.hideTimer = setTimeout(() => {
    if (!state.viewer.open) return;
    $('vTop').classList.add('faded');
    $('vBottom').classList.add('faded');
    $('viewer').classList.add('cursor-hidden');
  }, 2600);
}

/* ================================================================
   الأحداث
   ================================================================ */

function wireViewerEvents() {
  const viewer = $('viewer');

  viewer.addEventListener('mousemove', armControlsHide);

  $('vClose').onclick = closeViewer;
  $('vPrev').onclick = () => go(-1);
  $('vNext').onclick = () => go(1);
  $('vGrid').onclick = toggleGrid;
  $('vFsToggle').onclick = () => S.setFullscreen(undefined);
  $('vOpenExt').onclick = () => {
    const it = state.items[state.viewer.index];
    if (it) S.openExternal(it.path);
  };

  $('vSeek').oninput = (e) => {
    const i = parseInt(e.target.value, 10) - 1;
    if (!isNaN(i)) showAt(clampIndex(i));
  };

  // النقر بالفأرة
  const zoneClick = (isNextSide) => () => {
    if (settings.clickMode === 'off') return;
    if (settings.clickMode === 'advance') { go(1); return; }
    go(isNextSide ? 1 : -1);
  };
  // في وضع "عربي": اليسار = التالي — وفي "إنجليزي": اليمين = التالي
  $('zoneLeft').onclick = () => {
    if (settings.clickMode === 'off') return;
    if (settings.clickMode === 'advance') return go(1);
    go(settings.navDir === 'rtl' ? 1 : -1);
  };
  $('zoneRight').onclick = () => {
    if (settings.clickMode === 'off') return;
    if (settings.clickMode === 'advance') return go(1);
    go(settings.navDir === 'rtl' ? -1 : 1);
  };
  void zoneClick;

  // النقر بالزر الأوسط/الأيمن: إنهاء العرض بالزر الأيمن
  viewer.addEventListener('contextmenu', (e) => {
    e.preventDefault();
    go(-1);
  });

  // العجلة
  viewer.addEventListener('wheel', (e) => {
    if (settings.wheel === 'off') return;
    if (!$('vGridPanel').classList.contains('hidden')) return;
    if (state.viewer.kind === 'pdf' || state.viewer.kind === 'text') return; // اترك التمرير للمستند
    e.preventDefault();
    if (settings.wheel === 'zoom' && stage().querySelector('img.media')) {
      zoomBy(e.deltaY < 0 ? 1.15 : 1 / 1.15);
    } else if (settings.wheel === 'nav') {
      go(e.deltaY > 0 ? 1 : -1);
    }
  }, { passive: false });

  S.onFullscreenChange(() => {});
}

function wireKeys() {
  window.addEventListener('keydown', (e) => {
    // داخل حقل إدخال؟ لا تتدخل
    const t = e.target;
    if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) {
      return;
    }

    // ----- خارج العارض -----
    if (!state.viewer.open) {
      if (e.key === 'Enter' && state.items.length) {
        const first = [...state.selected][0];
        const idx = first ? state.items.findIndex(i => i.id === first) : 0;
        openViewer(idx < 0 ? 0 : idx);
      }
      if (e.key === 'Delete' && state.selected.size) {
        state.items = state.items.filter(i => !state.selected.has(i.id));
        state.selected.clear();
        state.dirty = true;
        renderItems();
      }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
        e.preventDefault();
        openSaveModal();
      }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'a') {
        e.preventDefault();
        state.items.forEach(i => state.selected.add(i.id));
        renderItems();
      }
      // نقل العنصر المحدد بـ Ctrl + سهم
      if ((e.ctrlKey || e.metaKey) && (e.key === 'ArrowLeft' || e.key === 'ArrowRight')) {
        const id = [...state.selected][0];
        if (!id) return;
        const i = state.items.findIndex(x => x.id === id);
        const dir = (e.key === 'ArrowLeft') === (settings.navDir === 'rtl') ? 1 : -1;
        const to = i + dir;
        if (to >= 0 && to < state.items.length) moveItem(i, to);
        e.preventDefault();
      }
      return;
    }

    // ----- داخل العارض -----
    const grid = $('vGridPanel');
    const nextKey = settings.navDir === 'rtl' ? 'ArrowLeft' : 'ArrowRight';
    const prevKey = settings.navDir === 'rtl' ? 'ArrowRight' : 'ArrowLeft';
    const vid = stage().querySelector('video, audio');

    switch (e.key) {
      case 'Escape':
        if (!grid.classList.contains('hidden')) grid.classList.add('hidden');
        else closeViewer();
        e.preventDefault();
        break;

      case nextKey:
      case 'PageDown':
        go(1); e.preventDefault(); break;

      case prevKey:
      case 'PageUp':
        go(-1); e.preventDefault(); break;

      case 'Home': showAt(0); e.preventDefault(); break;
      case 'End':  showAt(state.items.length - 1); e.preventDefault(); break;

      case ' ':
        e.preventDefault();
        if (vid) { vid.paused ? vid.play().catch(() => {}) : vid.pause(); }
        else go(1);
        break;

      case 'ArrowUp':
        if (vid) { vid.volume = Math.min(1, vid.volume + 0.1); toast('الصوت ' + Math.round(vid.volume * 100) + '%', 900); }
        e.preventDefault(); break;

      case 'ArrowDown':
        if (vid) { vid.volume = Math.max(0, vid.volume - 0.1); toast('الصوت ' + Math.round(vid.volume * 100) + '%', 900); }
        e.preventDefault(); break;

      case '+': case '=': zoomBy(1.2); e.preventDefault(); break;
      case '-': case '_': zoomBy(1 / 1.2); e.preventDefault(); break;
      case '0': resetZoom(); e.preventDefault(); break;

      default:
        if (e.key.toLowerCase() === 'f' || e.key === 'F11') {
          S.setFullscreen(undefined); e.preventDefault();
        } else if (e.key.toLowerCase() === 'g') {
          toggleGrid(); e.preventDefault();
        } else if (e.key.toLowerCase() === 'm') {
          if (vid) { vid.muted = !vid.muted; toast(vid.muted ? 'كتم الصوت' : 'إلغاء الكتم', 900); }
          e.preventDefault();
        } else if (/^[1-9]$/.test(e.key)) {
          const i = parseInt(e.key, 10) - 1;
          if (i < state.items.length) showAt(i);
          e.preventDefault();
        }
    }
    armControlsHide();
  });
}

/* ---------------- الإعدادات ---------------- */
async function loadSettings() {
  const saved = await S.settingsGet() || {};
  // ترقية الإعداد القديم (autoplay) إلى الخيار الجديد
  if (saved.videoStart === undefined && saved.autoplay !== undefined) {
    saved.videoStart = saved.autoplay ? 'auto' : 'manual';
  }
  delete saved.autoplay;
  settings = { ...DEFAULTS, ...saved };
}

function fillSettingsForm() {
  $('setNavDir').value = settings.navDir;
  $('setClickMode').value = settings.clickMode;
  $('setWheel').value = settings.wheel;
  $('setFit').value = settings.fit;
  $('setVideoStart').value = settings.videoStart;
  $('setAdvanceOnEnd').checked = !!settings.advanceOnEnd;
  $('setLoop').checked = !!settings.loop;
  $('setMuted').checked = !!settings.muted;
  $('setSlideSec').value = String(settings.slideSec || 0);
}

async function saveSettingsForm() {
  settings = {
    navDir: $('setNavDir').value,
    clickMode: $('setClickMode').value,
    wheel: $('setWheel').value,
    fit: $('setFit').value,
    videoStart: $('setVideoStart').value,
    advanceOnEnd: $('setAdvanceOnEnd').checked,
    loop: $('setLoop').checked,
    muted: $('setMuted').checked,
    slideSec: Math.max(0, parseInt($('setSlideSec').value, 10) || 0)
  };
  await S.settingsSet(settings);
  $('modalSettings').classList.add('hidden');
  toast('حُفظت الإعدادات');
  if (state.viewer.open) showAt(state.viewer.index);
}


/* ================================================================
   التحديث من GitHub
   ================================================================ */

function esc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function fmtDateTime(iso) {
  if (!iso) return '—';
  try {
    return new Date(iso).toLocaleString('ar', {
      year: 'numeric', month: 'short', day: 'numeric',
      hour: '2-digit', minute: '2-digit'
    });
  } catch { return iso; }
}

function updRow(label, value, mono) {
  return '<div class="upd-row"><span>' + esc(label) + '</span><span>' +
    (mono ? '<code>' + esc(value) + '</code>' : esc(value)) + '</span></div>';
}

function updNote(cls, text) {
  return '<div class="upd-note ' + cls + '">' + esc(text) + '</div>';
}

function showUpdButtons({ apply = false, restart = false, recheck = true }) {
  $('updApply').classList.toggle('hidden', !apply);
  $('updRestart').classList.toggle('hidden', !restart);
  $('updRecheck').classList.toggle('hidden', !recheck);
}

function renderUpdate(res) {
  const body = $('updBody');

  if (!res || !res.ok) {
    body.innerHTML = updNote('bad', (res && res.message) || 'تعذّر فحص التحديثات.');
    showUpdButtons({ apply: false, restart: false });
    return;
  }

  let html = '';
  html += updRow('المستودع', res.repo);
  html += updRow('الفرع', res.branch, true);
  html += updRow('طريقة التحديث', res.method === 'git' ? 'git pull' : 'تنزيل ملفات الفرع');
  html += updRow('نسختك الحالية', res.currentShort || 'غير معروفة', !!res.currentShort);
  html += updRow('آخر نسخة على GitHub', res.latest.short, true);
  html += updRow('تاريخ آخر تحديث', fmtDateTime(res.latest.date));
  if (res.behind) html += updRow('تحديثات متأخّرة', res.behind + ' تحديث');
  if (res.latest.message) html += updRow('آخر تغيير', res.latest.message);

  if (res.available) {
    html += updNote('ok', 'يتوفّر تحديث جديد. اضغط «تحديث الآن» لجلبه، ثم أعد تشغيل البرنامج.');
    showUpdButtons({ apply: true });
  } else if (res.unknownLocal) {
    html += updNote('warn',
      'لم أتمكّن من تحديد نسختك المحلية (المجلد ليس نسخة git). ' +
      'يمكنك جلب أحدث الملفات على أي حال.');
    showUpdButtons({ apply: true });
  } else {
    html += updNote('ok', 'أنت على أحدث نسخة. لا يوجد جديد.');
    showUpdButtons({ apply: false });
    $('updDot').classList.add('hidden');
  }

  body.innerHTML = html;
}

async function checkUpdate() {
  $('updBody').innerHTML = updNote('ok', 'جارٍ الفحص…');
  showUpdButtons({ apply: false, restart: false });
  updLast = await S.updateCheck();
  renderUpdate(updLast);
}

let updLast = null;

async function applyUpdate() {
  $('updBody').innerHTML = updNote('ok', 'جارٍ جلب التحديث… لا تغلق البرنامج.');
  showUpdButtons({ apply: false, restart: false, recheck: false });

  const res = await S.updateApply();

  if (!res.ok) {
    $('updBody').innerHTML = updNote('bad', res.message || 'فشل التحديث.');
    showUpdButtons({ apply: false, restart: false });
    return;
  }
  if (!res.changed) {
    $('updBody').innerHTML = updNote('ok', res.message || 'أنت على أحدث نسخة.');
    showUpdButtons({ apply: false, restart: false });
    $('updDot').classList.add('hidden');
    return;
  }

  $('updBody').innerHTML =
    updNote('ok', 'اكتمل التحديث بنجاح.') +
    (res.warn ? updNote('warn', res.warn) : '') +
    updNote('warn', 'أعد تشغيل البرنامج لتفعيل النسخة الجديدة.');
  showUpdButtons({ apply: false, restart: true, recheck: false });
  $('updDot').classList.add('hidden');
}

function wireUpdateUI() {
  $('btnUpdate').onclick = () => {
    $('modalUpdate').classList.remove('hidden');
    checkUpdate();
  };
  $('updClose').onclick = () => $('modalUpdate').classList.add('hidden');
  $('updRecheck').onclick = checkUpdate;
  $('updApply').onclick = applyUpdate;
  $('updRestart').onclick = () => S.updateRelaunch();

  S.onUpdateAvailable((res) => {
    updLast = res;
    $('updDot').classList.remove('hidden');
    toast('يتوفّر تحديث جديد للبرنامج — افتح «التحديث»', 5000);
  });
}

/* ---------------- ربط الواجهة ---------------- */
function wireUI() {
  const addFiles = async () => {
    const f = await S.pickFiles();
    if (f.length) addItems(f);
  };
  const addFolder = async () => {
    const f = await S.pickFolder();
    if (f.length) addItems(f);
    else toast('لا توجد ملفات مدعومة في هذا المجلد');
  };

  $('btnAddFiles').onclick = addFiles;
  $('btnAddFiles2').onclick = addFiles;
  $('btnAddFolder').onclick = addFolder;
  $('btnAddFolder2').onclick = addFolder;

  $('btnPlay').onclick = () => {
    const first = [...state.selected][0];
    const idx = first ? state.items.findIndex(i => i.id === first) : 0;
    openViewer(idx < 0 ? 0 : idx);
  };

  $('btnClear').onclick = async () => {
    if (!state.items.length) return;
    if (!await confirmBox('مسح القائمة', 'ستُفرَّغ القائمة الحالية. الملفات على جهازك لن تتأثر.')) return;
    state.items = [];
    state.selected.clear();
    state.currentSet = null;
    state.dirty = false;
    renderItems();
    updateCurrentSetLabel();
    refreshSets();
  };

  $('sortSelect').onchange = (e) => {
    applySort(e.target.value);
    e.target.value = '';
  };

  $('btnSave').onclick = openSaveModal;
  $('saveCancel').onclick = () => $('modalSave').classList.add('hidden');
  $('saveOk').onclick = () => doSave(false);
  $('saveExport').onclick = async () => {
    const name = $('saveName').value.trim() || 'عرض';
    const r = await S.setsExport({ name, items: state.items });
    if (r.ok) {
      $('modalSave').classList.add('hidden');
      toast('صُدِّر العرض إلى ملف');
    }
  };
  $('saveName').onkeydown = (e) => { if (e.key === 'Enter') doSave(false); };

  $('btnImport').onclick = async () => {
    const data = await S.setsImport();
    if (!data) return;
    state.items = data.items;
    state.currentSet = null;
    state.dirty = true;
    renderItems();
    updateCurrentSetLabel();
    toast(`استُورد «${data.name}» بـ ${data.items.length} عنصر`);
  };

  $('btnSettings').onclick = () => {
    fillSettingsForm();
    $('modalSettings').classList.remove('hidden');
  };
  $('settingsClose').onclick = () => $('modalSettings').classList.add('hidden');
  $('settingsSave').onclick = saveSettingsForm;

  $('btnHelp').onclick = () => $('modalHelp').classList.remove('hidden');
  $('helpClose').onclick = () => $('modalHelp').classList.add('hidden');

  // إغلاق النوافذ بالنقر على الخلفية
  document.querySelectorAll('.modal').forEach(m => {
    m.addEventListener('mousedown', (e) => {
      if (e.target === m) m.classList.add('hidden');
    });
  });
}

/* إن وضع المستخدم صورة الشعار الأصلية في assets/logo.png فاستخدمها */
function tryCustomLogo() {
  const probe = new Image();
  probe.onload = () => {
    $('brandLogo').src = '../../assets/logo.png';
    const el = $('emptyLogo');
    if (el) el.src = '../../assets/logo.png';
  };
  probe.src = '../../assets/logo.png';
}

/* ---------------- الإقلاع ---------------- */
(async function init() {
  tryCustomLogo();
  await loadSettings();
  wireUI();
  wireUpdateUI();
  wireOsDrop();
  wireViewerEvents();
  wireKeys();
  renderItems();
  await refreshSets();
})();
