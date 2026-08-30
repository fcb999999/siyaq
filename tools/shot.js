/* أداة فحص: تفتح واجهة البرنامج بلا عرض، تلتقط صورة، وتطبع أي أخطاء */
const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');
const fs = require('fs');

const OUT = process.env.SHOT_OUT || path.join(__dirname, 'shot.png');
let INJECT = process.env.SHOT_JS || '';
if (INJECT && fs.existsSync(INJECT)) INJECT = fs.readFileSync(INJECT, 'utf8');

app.disableHardwareAcceleration();

app.whenReady().then(async () => {
  // نعيد استخدام معالجات IPC الحقيقية بتحميل main كوحدة؟ لا — نضع بدائل بسيطة
  const stub = {
    'pick-files': () => [],
    'pick-folder': () => [],
    'resolve-dropped': () => [],
    'refresh-items': () => [],
    'read-text': () => ({ ok: true, text: 'نص تجريبي', truncated: false }),
    'open-external': () => {},
    'show-in-folder': () => {},
    'sets-list': () => ([
      { file: 'a.json', name: 'عرض الاجتماع', count: 12, updated: Date.now() },
      { file: 'b.json', name: 'صور الرحلة', count: 40, updated: Date.now() - 86400000 }
    ]),
    'sets-save': () => ({ ok: true, file: 'x.json' }),
    'sets-load': () => ({ name: '', file: '', items: [] }),
    'sets-delete': () => true,
    'sets-rename': () => ({ ok: true, file: 'x.json' }),
    'sets-export': () => ({ ok: true }),
    'sets-import': () => null,
    'settings-get': () => null,
    'settings-set': () => true,
    'win-fullscreen': () => false,
    'win-is-fullscreen': () => false,
    'win-minimize': () => {},
    'win-maximize': () => {},
    'win-close': () => {},
    'update-check': () => ({
      ok: true, repo: 'madaarej/syaq', branch: 'main', method: 'git',
      current: 'a1b2c3d4e5f6', currentShort: 'a1b2c3d',
      latest: { sha: 'f6e5d4c3b2a1', short: 'f6e5d4c',
                date: new Date().toISOString(),
                message: 'إضافة خيار تشغيل الفيديو يدوياً' },
      behind: 3, available: true, unknownLocal: false
    }),
    'update-apply': () => ({ ok: true, changed: true, message: 'اكتمل التحديث.' }),
    'update-relaunch': () => {},
    'app-info': () => ({ version: '1.0.0', electron: '33', method: 'git', repo: 'madaarej/syaq', branch: 'main' })
  };
  for (const [ch, fn] of Object.entries(stub)) ipcMain.handle(ch, (_e, ...a) => fn(...a));

  const win = new BrowserWindow({
    width: 1280,
    height: 820,
    show: false,
    useContentSize: true,
    backgroundColor: '#0b1220',
    webPreferences: {
      preload: path.join(__dirname, '..', 'src', 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      plugins: true,
      offscreen: true
    }
  });

  const problems = [];
  win.webContents.on('console-message', (_e, level, message, line, src) => {
    if (level >= 2) problems.push(`[console] ${message} (${src}:${line})`);
  });
  win.webContents.on('did-fail-load', (_e, code, desc, url) =>
    problems.push(`[load] ${code} ${desc} ${url}`));

  await win.loadFile(path.join(__dirname, '..', 'src', 'renderer', 'index.html'));
  await new Promise(r => setTimeout(r, 1200));

  if (INJECT) {
    try {
      const out = await win.webContents.executeJavaScript(INJECT, true);
      if (out !== undefined) console.log('نتيجة الحقن:', JSON.stringify(out));
    } catch (e) {
      problems.push('[inject] ' + e.message);
    }
    await new Promise(r => setTimeout(r, 900));
  }

  const img = await win.webContents.capturePage();
  fs.writeFileSync(OUT, img.toPNG());
  console.log('اللقطة:', OUT, img.getSize());
  console.log(problems.length ? 'مشاكل:\n' + problems.join('\n') : 'لا توجد أخطاء في الواجهة');

  win.destroy();
  app.quit();
});
