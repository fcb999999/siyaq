const { contextBridge, ipcRenderer, webUtils } = require('electron');

contextBridge.exposeInMainWorld('syaq', {
  // إضافة المحتوى
  pickFiles: () => ipcRenderer.invoke('pick-files'),
  pickFolder: () => ipcRenderer.invoke('pick-folder'),
  resolveDropped: (paths) => ipcRenderer.invoke('resolve-dropped', paths),
  refreshItems: (paths) => ipcRenderer.invoke('refresh-items', paths),

  // استخراج المسار الحقيقي من ملف مسحوب (Electron 32+)
  pathForFile: (file) => {
    try { return webUtils.getPathForFile(file); } catch { return ''; }
  },

  // قراءة وفتح
  readText: (p) => ipcRenderer.invoke('read-text', p),
  openExternal: (p) => ipcRenderer.invoke('open-external', p),
  showInFolder: (p) => ipcRenderer.invoke('show-in-folder', p),

  // العروض المحفوظة
  setsList: () => ipcRenderer.invoke('sets-list'),
  setsSave: (payload) => ipcRenderer.invoke('sets-save', payload),
  setsLoad: (file) => ipcRenderer.invoke('sets-load', file),
  setsDelete: (file) => ipcRenderer.invoke('sets-delete', file),
  setsRename: (payload) => ipcRenderer.invoke('sets-rename', payload),
  setsExport: (payload) => ipcRenderer.invoke('sets-export', payload),
  setsImport: () => ipcRenderer.invoke('sets-import'),

  // الإعدادات
  settingsGet: () => ipcRenderer.invoke('settings-get'),
  settingsSet: (obj) => ipcRenderer.invoke('settings-set', obj),

  // التحديث
  updateCheck: () => ipcRenderer.invoke('update-check'),
  updateApply: () => ipcRenderer.invoke('update-apply'),
  updateRelaunch: () => ipcRenderer.invoke('update-relaunch'),
  appInfo: () => ipcRenderer.invoke('app-info'),
  onUpdateAvailable: (cb) => ipcRenderer.on('update-available', (_e, v) => cb(v)),

  // النافذة
  setFullscreen: (on) => ipcRenderer.invoke('win-fullscreen', on),
  isFullscreen: () => ipcRenderer.invoke('win-is-fullscreen'),
  minimize: () => ipcRenderer.invoke('win-minimize'),
  maximize: () => ipcRenderer.invoke('win-maximize'),
  close: () => ipcRenderer.invoke('win-close'),
  onFullscreenChange: (cb) => ipcRenderer.on('fs-changed', (_e, v) => cb(v))
});
