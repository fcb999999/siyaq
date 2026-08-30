const { app, BrowserWindow, ipcMain, dialog, shell, Menu } = require('electron');
const path = require('path');
const fs = require('fs');
const fsp = fs.promises;
const updater = require('./updater');

// ---------- مسارات التخزين ----------
const DATA_DIR = path.join(app.getPath('userData'), 'syaq-data');
const SETS_DIR = path.join(DATA_DIR, 'sets');
const SETTINGS_FILE = path.join(DATA_DIR, 'settings.json');

function ensureDirs() {
  fs.mkdirSync(SETS_DIR, { recursive: true });
}

// ---------- أنواع الملفات المدعومة ----------
const EXT = {
  image: ['.jpg', '.jpeg', '.png', '.gif', '.webp', '.bmp', '.avif', '.svg', '.ico', '.jfif'],
  video: ['.mp4', '.webm', '.ogv', '.m4v', '.mov', '.mkv', '.avi', '.wmv', '.flv', '.ts', '.3gp'],
  audio: ['.mp3', '.wav', '.ogg', '.m4a', '.aac', '.flac', '.opus', '.wma'],
  pdf: ['.pdf'],
  text: ['.txt', '.md', '.json', '.js', '.ts', '.css', '.html', '.xml', '.csv', '.log',
         '.py', '.java', '.c', '.cpp', '.cs', '.php', '.sql', '.yml', '.yaml', '.ini', '.bat', '.sh']
};
const ALL_EXT = Object.values(EXT).flat();
const OFFICE_EXT = ['.docx', '.doc', '.xlsx', '.xls', '.pptx', '.ppt'];

function kindOf(filePath) {
  const e = path.extname(filePath).toLowerCase();
  for (const [k, list] of Object.entries(EXT)) if (list.includes(e)) return k;
  if (OFFICE_EXT.includes(e)) return 'office';
  return 'other';
}

function makeItem(filePath) {
  let size = 0, mtime = 0, exists = true;
  try {
    const st = fs.statSync(filePath);
    size = st.size;
    mtime = st.mtimeMs;
  } catch {
    exists = false;
  }
  return {
    id: Buffer.from(filePath).toString('base64').replace(/=/g, ''),
    path: filePath,
    name: path.basename(filePath),
    ext: path.extname(filePath).toLowerCase(),
    kind: kindOf(filePath),
    size, mtime, exists
  };
}

// ---------- النافذة ----------
let win = null;

function createWindow() {
  win = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 900,
    minHeight: 600,
    show: false,
    backgroundColor: '#0e1526',
    title: 'سياق',
    icon: path.join(__dirname, '..', 'assets', 'icon.png'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      plugins: true,
      webSecurity: true
    }
  });

  Menu.setApplicationMenu(null);
  win.loadFile(path.join(__dirname, 'renderer', 'index.html'));
  win.once('ready-to-show', () => {
    win.show();
    setTimeout(autoCheckUpdate, 4000);
  });

  win.on('enter-full-screen', () => win.webContents.send('fs-changed', true));
  win.on('leave-full-screen', () => win.webContents.send('fs-changed', false));

  win.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });
}

/* فحص تلقائي هادئ للتحديثات (مرة كل 6 ساعات على الأكثر) */
async function autoCheckUpdate() {
  try {
    const res = await updater.check();
    if (res.ok && res.available && win && !win.isDestroyed()) {
      win.webContents.send('update-available', res);
    }
  } catch { /* الفحص التلقائي لا يزعج المستخدم عند الفشل */ }
}

app.whenReady().then(() => {
  ensureDirs();
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

// ================= إضافة المحتوى =================

ipcMain.handle('pick-files', async () => {
  const res = await dialog.showOpenDialog(win, {
    title: 'اختر الملفات',
    properties: ['openFile', 'multiSelections'],
    filters: [
      { name: 'كل المحتوى المدعوم', extensions: ALL_EXT.concat(OFFICE_EXT).map(e => e.slice(1)) },
      { name: 'صور', extensions: EXT.image.map(e => e.slice(1)) },
      { name: 'فيديو', extensions: EXT.video.map(e => e.slice(1)) },
      { name: 'صوت', extensions: EXT.audio.map(e => e.slice(1)) },
      { name: 'مستندات', extensions: ['pdf', 'txt', 'md', 'docx', 'xlsx', 'pptx'] },
      { name: 'كل الملفات', extensions: ['*'] }
    ]
  });
  if (res.canceled) return [];
  return res.filePaths.map(makeItem);
});

ipcMain.handle('pick-folder', async () => {
  const res = await dialog.showOpenDialog(win, {
    title: 'اختر مجلداً',
    properties: ['openDirectory']
  });
  if (res.canceled) return [];
  return await scanFolder(res.filePaths[0], true);
});

async function scanFolder(dir, recursive) {
  const out = [];
  const wanted = ALL_EXT.concat(OFFICE_EXT);
  async function walk(d, depth) {
    let entries;
    try {
      entries = await fsp.readdir(d, { withFileTypes: true });
    } catch {
      return;
    }
    entries.sort((a, b) => a.name.localeCompare(b.name, 'ar', { numeric: true }));
    for (const en of entries) {
      const full = path.join(d, en.name);
      if (en.isDirectory()) {
        if (recursive && depth < 6) await walk(full, depth + 1);
      } else if (wanted.includes(path.extname(en.name).toLowerCase())) {
        out.push(makeItem(full));
      }
    }
  }
  await walk(dir, 0);
  return out;
}

ipcMain.handle('resolve-dropped', async (_e, paths) => {
  const out = [];
  for (const p of paths) {
    try {
      const st = await fsp.stat(p);
      if (st.isDirectory()) out.push(...await scanFolder(p, true));
      else out.push(makeItem(p));
    } catch { /* تجاهل الملف المتعذر */ }
  }
  return out;
});

ipcMain.handle('refresh-items', async (_e, paths) => paths.map(makeItem));

ipcMain.handle('read-text', async (_e, p) => {
  try {
    const buf = await fsp.readFile(p);
    const MAX = 400 * 1024;
    return {
      ok: true,
      text: buf.subarray(0, MAX).toString('utf8'),
      truncated: buf.length > MAX
    };
  } catch (err) {
    return { ok: false, error: err.message };
  }
});

ipcMain.handle('open-external', async (_e, p) => { await shell.openPath(p); });
ipcMain.handle('show-in-folder', async (_e, p) => { shell.showItemInFolder(p); });

// ================= العروض المحفوظة =================

function safeName(name) {
  const bad = String.fromCharCode(60,62,58,34,47,92,124,63,42);
  let out = '';
  for (const ch of String(name || '')) {
    if (ch.charCodeAt(0) < 32) continue;
    out += bad.includes(ch) ? '_' : ch;
  }
  return out.trim().slice(0, 120) || 'عرض';
}

ipcMain.handle('sets-list', async () => {
  ensureDirs();
  let files = [];
  try {
    files = await fsp.readdir(SETS_DIR);
  } catch {
    return [];
  }
  const out = [];
  for (const f of files.filter(x => x.endsWith('.json'))) {
    try {
      const data = JSON.parse(await fsp.readFile(path.join(SETS_DIR, f), 'utf8'));
      out.push({
        file: f,
        name: data.name,
        count: (data.items || []).length,
        created: data.created,
        updated: data.updated
      });
    } catch { /* ملف تالف */ }
  }
  out.sort((a, b) => (b.updated || 0) - (a.updated || 0));
  return out;
});

ipcMain.handle('sets-save', async (_e, { name, items, overwrite }) => {
  ensureDirs();
  const file = safeName(name) + '.json';
  const full = path.join(SETS_DIR, file);
  const already = fs.existsSync(full);
  if (already && !overwrite) return { ok: false, reason: 'exists' };
  let prev = {};
  if (already) {
    try { prev = JSON.parse(await fsp.readFile(full, 'utf8')); } catch { prev = {}; }
  }
  const payload = {
    app: 'syaq',
    version: 1,
    name,
    created: prev.created || Date.now(),
    updated: Date.now(),
    items: items.map((it, i) => ({ order: i + 1, path: it.path, name: it.name }))
  };
  await fsp.writeFile(full, JSON.stringify(payload, null, 2), 'utf8');
  return { ok: true, file };
});

ipcMain.handle('sets-load', async (_e, file) => {
  const full = path.join(SETS_DIR, path.basename(file));
  const data = JSON.parse(await fsp.readFile(full, 'utf8'));
  const items = (data.items || [])
    .slice()
    .sort((a, b) => (a.order || 0) - (b.order || 0))
    .map(r => makeItem(r.path));
  return { name: data.name, file: path.basename(file), items };
});

ipcMain.handle('sets-delete', async (_e, file) => {
  await fsp.unlink(path.join(SETS_DIR, path.basename(file)));
  return true;
});

ipcMain.handle('sets-rename', async (_e, { file, newName }) => {
  const full = path.join(SETS_DIR, path.basename(file));
  const data = JSON.parse(await fsp.readFile(full, 'utf8'));
  data.name = newName;
  data.updated = Date.now();
  const newFile = safeName(newName) + '.json';
  await fsp.writeFile(path.join(SETS_DIR, newFile), JSON.stringify(data, null, 2), 'utf8');
  if (newFile !== path.basename(file)) await fsp.unlink(full).catch(() => {});
  return { ok: true, file: newFile };
});

ipcMain.handle('sets-export', async (_e, { name, items }) => {
  const res = await dialog.showSaveDialog(win, {
    title: 'تصدير العرض',
    defaultPath: safeName(name || 'عرض') + '.syaq',
    filters: [{ name: 'عرض سياق', extensions: ['syaq'] }]
  });
  if (res.canceled) return { ok: false };
  const payload = {
    app: 'syaq', version: 1, name, created: Date.now(), updated: Date.now(),
    items: items.map((it, i) => ({ order: i + 1, path: it.path, name: it.name }))
  };
  await fsp.writeFile(res.filePath, JSON.stringify(payload, null, 2), 'utf8');
  return { ok: true, path: res.filePath };
});

ipcMain.handle('sets-import', async () => {
  const res = await dialog.showOpenDialog(win, {
    title: 'استيراد عرض',
    properties: ['openFile'],
    filters: [{ name: 'عرض سياق', extensions: ['syaq', 'json'] }]
  });
  if (res.canceled) return null;
  const data = JSON.parse(await fsp.readFile(res.filePaths[0], 'utf8'));
  const items = (data.items || [])
    .slice()
    .sort((a, b) => (a.order || 0) - (b.order || 0))
    .map(r => makeItem(r.path));
  return { name: data.name || path.basename(res.filePaths[0], '.syaq'), items };
});

// ================= الإعدادات =================

ipcMain.handle('settings-get', async () => {
  try {
    return JSON.parse(await fsp.readFile(SETTINGS_FILE, 'utf8'));
  } catch {
    return null;
  }
});

ipcMain.handle('settings-set', async (_e, obj) => {
  ensureDirs();
  await fsp.writeFile(SETTINGS_FILE, JSON.stringify(obj, null, 2), 'utf8');
  return true;
});

// ================= التحكم بالنافذة =================

ipcMain.handle('win-fullscreen', (_e, on) => {
  if (!win) return false;
  win.setFullScreen(on === undefined ? !win.isFullScreen() : !!on);
  return win.isFullScreen();
});
ipcMain.handle('win-is-fullscreen', () => (win ? win.isFullScreen() : false));
ipcMain.handle('win-minimize', () => win && win.minimize());
ipcMain.handle('win-maximize', () => {
  if (!win) return;
  if (win.isMaximized()) win.unmaximize();
  else win.maximize();
});
ipcMain.handle('win-close', () => win && win.close());

// ================= التحديث =================

ipcMain.handle('update-check', async () => {
  try { return await updater.check(); }
  catch (e) { return { ok: false, reason: 'error', message: e.message }; }
});

ipcMain.handle('update-apply', async () => {
  try { return await updater.apply(); }
  catch (e) { return { ok: false, reason: 'error', message: e.message }; }
});

ipcMain.handle('update-relaunch', () => { updater.relaunch(); });

ipcMain.handle('app-info', async () => {
  const repo = await updater.resolveRepo();
  return {
    version: app.getVersion(),
    electron: process.versions.electron,
    method: updater.isGitClone() ? 'git' : 'zip',
    repo: repo ? `${repo.owner}/${repo.repo}` : null,
    branch: repo ? repo.branch : null
  };
});
