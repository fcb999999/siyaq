/* ينشئ اختصار «سياق» على سطح المكتب.
   يشير مباشرةً إلى electron.exe لا إلى ملف .bat، فلا تظهر نافذة أوامر سوداء. */

const { app, shell } = require('electron');
const path = require('path');
const fs = require('fs');

const ROOT = path.join(__dirname, '..');
const EXE = path.join(ROOT, 'node_modules', 'electron', 'dist', 'electron.exe');
const ICON = path.join(ROOT, 'assets', 'icon.ico');

app.disableHardwareAcceleration();

app.whenReady().then(() => {
  if (process.platform !== 'win32') {
    console.error('هذه الأداة لويندوز فقط.');
    app.exit(1);
    return;
  }
  if (!fs.existsSync(EXE)) {
    console.error('لم أجد electron.exe — شغّل npm install أولاً.');
    app.exit(1);
    return;
  }
  if (!fs.existsSync(ICON)) {
    console.error('لم أجد أيقونة .ico — شغّل npm run ico أولاً.');
    app.exit(1);
    return;
  }

  const targets = [
    { dir: app.getPath('desktop'), label: 'سطح المكتب' }
  ];

  // قائمة ابدأ أيضاً إن طُلبت
  if (process.env.SYAQ_START_MENU === '1') {
    targets.push({
      dir: path.join(app.getPath('appData'), 'Microsoft', 'Windows', 'Start Menu', 'Programs'),
      label: 'قائمة ابدأ'
    });
  }

  let made = 0;
  for (const t of targets) {
    const linkPath = path.join(t.dir, 'سياق.lnk');
    const ok = shell.writeShortcutLink(linkPath, 'create', {
      target: EXE,
      args: `"${ROOT}"`,
      cwd: ROOT,
      icon: ICON,
      iconIndex: 0,
      description: 'سياق — عارض المحتوى المتسلسل',
      appUserModelId: 'com.syaq.viewer'
    });
    console.log((ok ? '✔ أُنشئ على ' : '✘ فشل على ') + t.label + ': ' + linkPath);
    if (ok) made++;
  }

  app.exit(made ? 0 : 1);
});
