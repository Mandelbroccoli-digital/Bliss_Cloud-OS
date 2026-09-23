const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  // Multimodal Stream Handlers
  sendAIStream: (channel, data) => ipcRenderer.send(`ai:stream:${channel}`, data),
  onAIStreamChunk: (channel, callback) => {
    const listener = (_event, value) => callback(value);
    ipcRenderer.on(`ai:stream:${channel}:chunk`, listener);
    return () => ipcRenderer.removeListener(`ai:stream:${channel}:chunk`, listener);
  },

  // Deployment / Local Node Operations
  executeCommand: (cmd) => ipcRenderer.invoke('node:exec', cmd),
  
  // Custom Window Controls (Frameless Titlebar)
  minimize: () => ipcRenderer.send('window:minimize'),
  maximize: () => ipcRenderer.send('window:maximize'),
  close: () => ipcRenderer.send('window:close')
});
