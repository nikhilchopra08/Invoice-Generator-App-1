const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('electronAPI', {
  printToPDF: (data) => ipcRenderer.invoke('print-to-pdf', data),
  getMachineId: () => ipcRenderer.invoke('get-machine-id'),
  getLicense: () => ipcRenderer.invoke('get-license'),
  setLicense: (lic) => ipcRenderer.invoke('set-license', lic)
});
