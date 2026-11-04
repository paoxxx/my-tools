const { app, BrowserWindow, ipcMain, clipboard, dialog } = require('electron');
const fs = require('fs');
const path = require('path');

let win;
function createWindow() {
  win = new BrowserWindow({
    width: 440,
    height: 620,
    minWidth: 300,
    minHeight: 300,
    title: '快捷粘贴',
    acceptFirstMouse: true, // 从别的软件切过来，第一下点击就能粘贴
    webPreferences: { preload: path.join(__dirname, 'preload.js') }
  });
  win.loadFile('index.html');
}

ipcMain.handle('clip:read', () => ({ text: clipboard.readText(), html: clipboard.readHTML() }));
ipcMain.handle('clip:write', (e, data) => { clipboard.write({ text: data.text, html: data.html }); return true; });
ipcMain.handle('win:top', (e, on) => { win.setAlwaysOnTop(!!on); return !!on; });
ipcMain.handle('file:save', async (e, text) => {
  const r = await dialog.showSaveDialog(win, { defaultPath: '粘贴内容.txt' });
  if (r.canceled || !r.filePath) return false;
  fs.writeFileSync(r.filePath, text, 'utf8');
  return true;
});

app.whenReady().then(createWindow);
app.on('window-all-closed', () => app.quit());
