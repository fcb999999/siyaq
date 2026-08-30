/* يولّد assets/icon.png من ملف الشعار المتجه mark.svg */
const { app, BrowserWindow } = require('electron');
const path = require('path');
const fs = require('fs');

const OUT = path.join(__dirname, '..', 'assets', 'icon.png');

app.disableHardwareAcceleration();

app.whenReady().then(async () => {
  const win = new BrowserWindow({
    width: 512,
    height: 512,
    show: false,
    frame: false,
    transparent: true,
    backgroundColor: '#00000000',
    useContentSize: true,
    webPreferences: { offscreen: true }
  });

  await win.loadFile(path.join(__dirname, 'icon.html'));
  await new Promise(r => setTimeout(r, 900));

  const img = await win.webContents.capturePage({ x: 0, y: 0, width: 512, height: 512 });
  fs.writeFileSync(OUT, img.toPNG());
  console.log('كُتب الملف:', OUT, img.getSize());

  win.destroy();
  app.quit();
});
