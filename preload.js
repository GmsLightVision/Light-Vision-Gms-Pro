// Preload: roda isolado antes da página carregar (contextIsolation)
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
    isElectron: true,
    platform: process.platform,
    // Análise inteligente via IA (chamada feita no processo principal)
    analisarComIA: (dados) => ipcRenderer.invoke('glm-analisar', dados),
    // Recebe horários capturados pelo processo principal (varredura de frames)
    onHorariosEncontrados: (callback) => ipcRenderer.on('horarios-encontrados', (_e, lista) => callback(lista))
});
