/* ================================================================
   وحدة التحديث من GitHub
   تعمل بطريقتين:
   1) إن كان المجلد نسخة git (فيه .git) → git pull --ff-only
   2) وإلا → تنزيل ملف zip من الفرع وفك ضغطه فوق ملفات البرنامج
   ================================================================ */

const { app, net } = require('electron');
const path = require('path');
const fs = require('fs');
const fsp = fs.promises;
const os = require('os');
const { execFile } = require('child_process');

const ROOT = path.join(__dirname, '..');

/* net.fetch يمر عبر شبكة Chromium فيحترم إعدادات الوكيل والشهادات،
   بخلاف fetch الخاص بـ Node الذي قد يفشل خلف بعض الشبكات. */
const httpGet = (url, opts = {}) => {
  /* بلا تخزين مؤقت: وإلا أعاد فحصٌ لاحق نتيجة قديمة من الذاكرة،
     فيبدو البرنامج محدَّثاً وهو ليس كذلك. */
  const o = {
    ...opts,
    cache: 'no-store',
    headers: { ...(opts.headers || {}), 'Cache-Control': 'no-cache', 'Pragma': 'no-cache' }
  };
  return (net && net.fetch) ? net.fetch(url, o) : fetch(url, o);
};
const UA = { 'User-Agent': 'syaq-updater', 'Accept': 'application/vnd.github+json' };

/* لا تُنسخ هذه المسارات عند التحديث بطريقة zip */
const SKIP = new Set(['node_modules', '.git', 'dist', 'syaq-data']);

function stateFile() {
  return path.join(app.getPath('userData'), 'syaq-data', 'update.json');
}

function readState() {
  try { return JSON.parse(fs.readFileSync(stateFile(), 'utf8')); } catch { return {}; }
}

function writeState(obj) {
  try {
    fs.mkdirSync(path.dirname(stateFile()), { recursive: true });
    fs.writeFileSync(stateFile(), JSON.stringify(obj, null, 2), 'utf8');
  } catch { /* غير حرج */ }
}

function run(cmd, args, opts = {}) {
  return new Promise((resolve) => {
    execFile(cmd, args, { cwd: ROOT, windowsHide: true, maxBuffer: 8 * 1024 * 1024, ...opts },
      (err, stdout, stderr) => resolve({
        ok: !err,
        out: String(stdout || '').trim(),
        err: String(stderr || err && err.message || '').trim()
      }));
  });
}

const isGitClone = () => fs.existsSync(path.join(ROOT, '.git'));

/* النسخة المبنيّة بمثبِّت: ملفاتها داخل app.asar فلا يمكن الكتابة فوقها،
   ويكون التحديث بتنزيل مثبِّت أحدث من صفحة المستودع. */
const isPackaged = () => !!app.isPackaged;

/* مقارنة أرقام نسخ على هيئة 1.2.3 */
function cmpVersion(a, b) {
  const pa = String(a || '0').split('.').map(n => parseInt(n, 10) || 0);
  const pb = String(b || '0').split('.').map(n => parseInt(n, 10) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] || 0) - (pb[i] || 0);
    if (d) return d < 0 ? -1 : 1;
  }
  return 0;
}

/* ---------- تحديد المستودع ---------- */

function parseGithubUrl(url) {
  const m = String(url || '').match(/github\.com[:/]+([^/\s]+)\/([^/\s.]+)/i);
  return m ? { owner: m[1], repo: m[2] } : null;
}

async function resolveRepo() {
  let branch = 'main';
  let found = null;

  try {
    const pkg = JSON.parse(await fsp.readFile(path.join(ROOT, 'package.json'), 'utf8'));
    if (pkg.updateBranch) branch = pkg.updateBranch;
    const url = pkg.repository && (pkg.repository.url || pkg.repository);
    found = parseGithubUrl(url);
  } catch { /* تجاهل */ }

  if (!found && isGitClone()) {
    const r = await run('git', ['remote', 'get-url', 'origin']);
    if (r.ok) found = parseGithubUrl(r.out);
  }

  if (!found) return null;

  if (isGitClone()) {
    const b = await run('git', ['rev-parse', '--abbrev-ref', 'HEAD']);
    if (b.ok && b.out && b.out !== 'HEAD') branch = b.out;
  }

  return { ...found, branch };
}

async function localSha() {
  if (isGitClone()) {
    const r = await run('git', ['rev-parse', 'HEAD']);
    if (r.ok) return r.out;
  }
  return readState().sha || null;
}

/* ---------- الفحص ---------- */

async function check() {
  const info = await resolveRepo();
  if (!info) {
    return { ok: false, reason: 'no-repo',
      message: 'لم يُضبط مستودع GitHub بعد. اربط المجلد بمستودعك ثم أعد المحاولة.' };
  }

  if (isPackaged()) return checkPackaged(info);

  let res;
  try {
    res = await httpGet(
      `https://api.github.com/repos/${info.owner}/${info.repo}/commits/${encodeURIComponent(info.branch)}`,
      { headers: UA });
  } catch (e) {
    return { ok: false, reason: 'network',
      message: 'تعذّر الاتصال بـ GitHub: ' + e.message +
               (e.cause && e.cause.message ? ' — ' + e.cause.message : '') };
  }

  if (res.status === 404) {
    return { ok: false, reason: 'not-found',
      message: `المستودع أو الفرع غير موجود (${info.owner}/${info.repo} · ${info.branch}).` };
  }
  if (res.status === 403) {
    return { ok: false, reason: 'rate',
      message: 'تجاوزتَ حد طلبات GitHub مؤقتاً. جرّب بعد قليل.' };
  }
  if (!res.ok) {
    return { ok: false, reason: 'http', message: 'استجابة غير متوقعة من GitHub: ' + res.status };
  }

  const j = await res.json();
  const latest = {
    sha: j.sha,
    short: String(j.sha).slice(0, 7),
    date: j.commit && j.commit.committer && j.commit.committer.date,
    message: (j.commit && j.commit.message || '').split('\n')[0],
    author: j.commit && j.commit.author && j.commit.author.name
  };

  const current = await localSha();
  let behind = null;

  if (current && current !== latest.sha) {
    try {
      const cmp = await httpGet(
        `https://api.github.com/repos/${info.owner}/${info.repo}/compare/${current}...${latest.sha}`,
        { headers: UA });
      if (cmp.ok) {
        const cj = await cmp.json();
        behind = cj.ahead_by;
      }
    } catch { /* اختياري */ }
  }

  const result = {
    ok: true,
    repo: `${info.owner}/${info.repo}`,
    branch: info.branch,
    method: isGitClone() ? 'git' : 'zip',
    current,
    currentShort: current ? String(current).slice(0, 7) : null,
    latest,
    behind,
    available: !!current && current !== latest.sha,
    unknownLocal: !current
  };

  writeState({ ...readState(), lastCheck: Date.now(), lastResult: result });
  return result;
}

/* ---------- فحص النسخة المثبَّتة (مقارنة أرقام النسخ) ---------- */

async function checkPackaged(info) {
  const raw = `https://raw.githubusercontent.com/${info.owner}/${info.repo}/${info.branch}/package.json`;

  let res;
  try {
    res = await httpGet(raw, { headers: { 'User-Agent': 'syaq-updater' } });
  } catch (e) {
    return { ok: false, reason: 'network', message: 'تعذّر الاتصال بـ GitHub: ' + e.message };
  }
  if (!res.ok) {
    return { ok: false, reason: 'http', message: 'تعذّرت قراءة نسخة المستودع: ' + res.status };
  }

  let remote;
  try { remote = JSON.parse(await res.text()); }
  catch { return { ok: false, reason: 'http', message: 'ملف package.json في المستودع غير صالح.' }; }

  const current = app.getVersion();
  const latestV = remote.version || '0.0.0';
  const result = {
    ok: true,
    repo: `${info.owner}/${info.repo}`,
    branch: info.branch,
    method: 'installer',
    packaged: true,
    downloadUrl: `https://github.com/${info.owner}/${info.repo}`,
    current,
    currentShort: current,
    latest: { sha: latestV, short: latestV, date: null, message: 'النسخة ' + latestV },
    behind: null,
    available: cmpVersion(current, latestV) < 0,
    unknownLocal: false
  };

  writeState({ ...readState(), lastCheck: Date.now(), lastResult: result });
  return result;
}

/* للفحص التلقائي: متى كان آخر اتصال، وما كانت نتيجته */
const lastCheckAt = () => readState().lastCheck || 0;
const lastResult = () => readState().lastResult || null;

/* ---------- التحديث عبر git ---------- */

async function applyViaGit(info) {
  const before = await localSha();

  /* يُرفض التحديث عند وجود تعديل محلي، ويُرفض كذلك إن تعذّر التحقق أصلاً:
     الأسلم ألّا نكتب فوق ملفات لا نعرف حالتها. */
  const dirty = await run('git', ['status', '--porcelain']);
  if (!dirty.ok) {
    return { ok: false, reason: 'status',
      message: 'تعذّر التحقق من حالة الملفات المحلية، فلم يُطبَّق التحديث احتياطاً:\n' + dirty.err };
  }
  if (dirty.out) {
    return { ok: false, reason: 'dirty',
      message: 'يوجد تعديل محلي غير محفوظ في ملفات البرنامج، فلم يُطبَّق التحديث حتى لا يُفقد.\n' +
               dirty.out.split('\n').slice(0, 8).join('\n') };
  }

  const fetched = await run('git', ['fetch', 'origin', info.branch]);
  if (!fetched.ok) return { ok: false, reason: 'fetch', message: 'فشل جلب التحديث:\n' + fetched.err };

  const pulled = await run('git', ['merge', '--ff-only', `origin/${info.branch}`]);
  if (!pulled.ok) {
    return { ok: false, reason: 'merge',
      message: 'تعذّر الدمج السريع (ربما تفرّع تاريخ النسخة المحلية):\n' + pulled.err };
  }

  const after = await localSha();
  let npm = false;
  if (before && after && before !== after) {
    const diff = await run('git', ['diff', '--name-only', before, after]);
    npm = diff.ok && /(^|\n)package(-lock)?\.json/.test(diff.out);
  }

  return { ok: true, changed: before !== after, from: before, to: after, needsInstall: npm };
}

/* ---------- التحديث عبر zip ---------- */

async function applyViaZip(info, latestSha) {
  const tmp = await fsp.mkdtemp(path.join(os.tmpdir(), 'syaq-up-'));
  const zipPath = path.join(tmp, 'src.zip');
  const url = `https://codeload.github.com/${info.owner}/${info.repo}/zip/refs/heads/${info.branch}`;

  let res;
  try {
    res = await httpGet(url, { headers: { 'User-Agent': 'syaq-updater' } });
  } catch (e) {
    return { ok: false, reason: 'network', message: 'تعذّر تنزيل التحديث: ' + e.message };
  }
  if (!res.ok) return { ok: false, reason: 'http', message: 'تعذّر تنزيل التحديث: ' + res.status };

  await fsp.writeFile(zipPath, Buffer.from(await res.arrayBuffer()));

  const outDir = path.join(tmp, 'x');
  const ex = await run('powershell', [
    '-NoProfile', '-NonInteractive', '-Command',
    `Expand-Archive -LiteralPath '${zipPath}' -DestinationPath '${outDir}' -Force`
  ], { cwd: tmp });
  if (!ex.ok) return { ok: false, reason: 'unzip', message: 'تعذّر فك الضغط:\n' + ex.err };

  const entries = await fsp.readdir(outDir, { withFileTypes: true });
  const root = entries.find(e => e.isDirectory());
  if (!root) return { ok: false, reason: 'unzip', message: 'محتوى التحديث غير متوقع.' };
  const srcDir = path.join(outDir, root.name);

  const names = await fsp.readdir(srcDir);
  for (const n of names) {
    if (SKIP.has(n)) continue;
    await fsp.cp(path.join(srcDir, n), path.join(ROOT, n), { recursive: true, force: true });
  }

  await fsp.rm(tmp, { recursive: true, force: true }).catch(() => {});
  writeState({ ...readState(), sha: latestSha, appliedAt: Date.now() });

  return { ok: true, changed: true, to: latestSha, needsInstall: names.includes('package.json') };
}

/* ---------- التطبيق ---------- */

async function apply() {
  const info = await resolveRepo();
  if (!info) return { ok: false, reason: 'no-repo', message: 'لا يوجد مستودع مضبوط.' };

  const st = await check();
  if (!st.ok) return st;
  if (!st.available && !st.unknownLocal) {
    return { ok: true, changed: false, message: 'أنت على أحدث نسخة.' };
  }

  /* النسخة المثبَّتة مضغوطة داخل app.asar ولا يمكن تحديث ملفاتها من داخلها،
     فالتحديث يكون بتنزيل مثبِّت أحدث. */
  if (isPackaged()) {
    return { ok: false, reason: 'packaged',
      downloadUrl: st.downloadUrl,
      message: 'تتوفّر نسخة أحدث (' + st.latest.short + '). هذه نسخة مثبَّتة، ' +
               'فالتحديث يكون بتنزيل المثبِّت الجديد من صفحة المستودع وتشغيله فوق الحالية.' };
  }

  const r = isGitClone()
    ? await applyViaGit(info)
    : await applyViaZip(info, st.latest.sha);

  if (!r.ok) return r;

  if (r.needsInstall) {
    const npmCmd = process.platform === 'win32' ? 'npm.cmd' : 'npm';
    const inst = await run(npmCmd, ['install', '--no-audit', '--no-fund'], { shell: process.platform === 'win32' });
    if (!inst.ok) {
      return { ok: true, changed: true, warn:
        'حُدِّثت الملفات، لكن تعذّر تحديث المكوّنات تلقائياً. شغّل npm install يدوياً.' };
    }
  }

  return { ok: true, changed: r.changed, message: 'اكتمل التحديث.' };
}

function relaunch() {
  app.relaunch({ args: process.argv.slice(1) });
  app.exit(0);
}

module.exports = { check, apply, relaunch, isGitClone, isPackaged, resolveRepo, lastCheckAt, lastResult };
