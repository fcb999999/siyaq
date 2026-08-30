/* يُنفَّذ بعد npm install: يبني الأيقونة وينشئ اختصار سطح المكتب.
   لا يُفشل التثبيت أبداً مهما حدث — الاختصار كماليّ لا شرط للتشغيل. */

const path = require('path');
const fs = require('fs');
const { spawnSync } = require('child_process');

const ROOT = path.join(__dirname, '..');

function skip(why) {
  console.log('[سياق] تُخطّي إنشاء الاختصار: ' + why);
  process.exit(0);
}

if (process.platform !== 'win32') skip('النظام ليس ويندوز');
if (process.env.SYAQ_NO_SHORTCUT === '1') skip('SYAQ_NO_SHORTCUT=1');
if (process.env.CI) skip('بيئة CI');

const EXE = path.join(ROOT, 'node_modules', 'electron', 'dist', 'electron.exe');
if (!fs.existsSync(EXE)) skip('لم يُثبَّت electron بعد');

for (const script of ['make-ico.js', 'make-shortcut.js']) {
  const r = spawnSync(EXE, [path.join(__dirname, script)], {
    cwd: ROOT,
    stdio: 'inherit',
    windowsHide: true,
    timeout: 90000
  });
  if (r.status !== 0) {
    console.log('[سياق] تعذّر تنفيذ ' + script + ' — أنشئ الاختصار لاحقاً بـ: npm run shortcut');
    break;
  }
}

process.exit(0);
