/* يبني assets/icon.ico متعدّد المقاسات من assets/icon.png
   صيغة ICO تقبل صور PNG مباشرة منذ ويندوز فيستا، فلا حاجة لمكتبة خارجية. */

const { app, nativeImage } = require('electron');
const path = require('path');
const fs = require('fs');

const SRC = path.join(__dirname, '..', 'assets', 'icon.png');
const OUT = path.join(__dirname, '..', 'assets', 'icon.ico');
const SIZES = [16, 24, 32, 48, 64, 128, 256];

app.disableHardwareAcceleration();

app.whenReady().then(() => {
  const base = nativeImage.createFromPath(SRC);
  if (base.isEmpty()) {
    console.error('تعذّرت قراءة ' + SRC);
    app.exit(1);
    return;
  }

  const images = SIZES.map(s => ({
    size: s,
    png: base.resize({ width: s, height: s, quality: 'best' }).toPNG()
  }));

  const HEADER = 6;
  const ENTRY = 16;
  const dir = Buffer.alloc(HEADER + ENTRY * images.length);

  dir.writeUInt16LE(0, 0);                 // محجوز
  dir.writeUInt16LE(1, 2);                 // النوع: أيقونة
  dir.writeUInt16LE(images.length, 4);     // العدد

  let offset = HEADER + ENTRY * images.length;
  images.forEach((img, i) => {
    const p = HEADER + ENTRY * i;
    dir.writeUInt8(img.size === 256 ? 0 : img.size, p);      // العرض (0 = 256)
    dir.writeUInt8(img.size === 256 ? 0 : img.size, p + 1);  // الارتفاع
    dir.writeUInt8(0, p + 2);              // عدد الألوان (0 = بلا لوحة)
    dir.writeUInt8(0, p + 3);              // محجوز
    dir.writeUInt16LE(1, p + 4);           // المستويات
    dir.writeUInt16LE(32, p + 6);          // بت لكل بكسل
    dir.writeUInt32LE(img.png.length, p + 8);
    dir.writeUInt32LE(offset, p + 12);
    offset += img.png.length;
  });

  fs.writeFileSync(OUT, Buffer.concat([dir, ...images.map(i => i.png)]));
  console.log('كُتب الملف:', OUT,
    '(' + SIZES.join('، ') + ') — ' + fs.statSync(OUT).size + ' بايت');
  app.exit(0);
});
