const { app, BrowserWindow, ipcMain, dialog } = require('electron');
const path = require('path');
const Store = require('electron-store');
const pkg = require('node-machine-id');
const fs = require('fs');
const { machineIdSync } = pkg;

const store = new Store({ name: "settings" });

let mainWindow;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1220,
    height: 900,
    backgroundColor: "#f1f5f9",
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });
  mainWindow.removeMenu?.();
  mainWindow.loadFile("index.html");
}

app.whenReady().then(() => {
  createWindow();
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});
app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

// main.js
ipcMain.handle("print-to-pdf", async (event, payloadJson) => {
  try {
    // 1) Create an offscreen window
    const win = new BrowserWindow({
      show: false,
      webPreferences: { preload: path.join(__dirname, "preload.js") },
    });

    // 2) Pass state via query or IPC
    const url = `file://${path.join(
      __dirname,
      "print.html"
    )}?state=${encodeURIComponent(payloadJson)}`;
    await win.loadURL(url);

    // 3) Wait for the template to finish rendering
    await win.webContents.executeJavaScript("window.__readyForPDF === true");

    // 4) Print to PDF
    const pdf = await win.webContents.printToPDF({
      pageSize: "A4",
      printBackground: true,
      marginsType: 1,
    });

    win.destroy();

    // 5) Prompt user to save the PDF
    const parsed = JSON.parse(payloadJson);
    const result = await dialog.showSaveDialog(mainWindow, {
      title: 'Save Invoice PDF',
      defaultPath: `Invoice_${parsed.invoiceNumber || 'invoice'}.pdf`,
      filters: [{ name: 'PDF Files', extensions: ['pdf'] }]
    });

    if (!result.canceled) {
      fs.writeFileSync(result.filePath, pdf);
    }

    return 'saved';
  } catch (error) {
    console.error('PDF generation error:', error);
    throw error;
  }
});

ipcMain.handle("get-machine-id", async () => {
  try {
    return machineIdSync({ original: true });
  } catch {
    return "unknown-device";
  }
});
ipcMain.handle("get-license", async () => store.get("license", null));
ipcMain.handle("set-license", async (_e, lic) => {
  store.set("license", lic);
  return true;
});
ipcMain.handle("show-license-prompt", async () => {
  const { dialog } = require('electron');
  const result = await dialog.showMessageBox(mainWindow, {
    type: 'question',
    buttons: ['OK', 'Cancel'],
    title: 'Enter License Key',
    message: 'Please enter your license key to enable PDF downloads:',
    noLink: true
  });
  return result.response === 0 ? 'entered' : null; // Since dialog.showMessageBox doesn't have input, use a different method
});
