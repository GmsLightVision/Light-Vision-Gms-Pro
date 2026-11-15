// Light Vision Gms Pro 2.3.0 - Processo principal do Electron
const { app, BrowserWindow, shell, ipcMain, webContents } = require('electron');
const path = require('path');

// ===== INTEGRAÇÃO IA — análise inteligente =====
// Provedores suportados (em ordem de preferência, conforme ia-config.txt):
//   1. codegpt    (Plano CodeGPT Plus) — agentes em codegpt.co
//   2. Groq       (grátis, sem cartão) — console.groq.com/keys
//   3. OpenRouter (grátis, modelos :free) — openrouter.ai/keys
//   4. Zhipu GLM  (pago) — open.bigmodel.cn
// Configuração em ia-config.txt: "codegpt" | "groq" | "openrouter" | "glm"
const fs = require('fs');

const CODEGPT_AGENT_ID = 'fdfae8d6-97e8-4654-941a-2a736f376879';
const CODEGPT_ORG_ID = 'a57ef37d-2de9-47d1-ad9a-17e73fa5416b';

const PROVEDORES = {
    codegpt: {
        url: 'https://api.codegpt.co/api/v1/chat/completions',
        chaveEnv: 'CODEGPT_API_KEY',
        arquivoChave: 'codegpt-key.txt'
    },
    groq: {
        url: 'https://api.groq.com/openai/v1/chat/completions',
        modelo: 'openai/gpt-oss-20b',
        chaveEnv: 'GROQ_API_KEY',
        arquivoChave: 'groq-key.txt'
    },
    openrouter: {
        url: 'https://openrouter.ai/api/v1/chat/completions',
        modelo: 'meta-llama/llama-3.3-70b-instruct:free',
        chaveEnv: 'OPENROUTER_API_KEY',
        arquivoChave: 'openrouter-key.txt'
    },
    glm: {
        url: 'https://open.bigmodel.cn/api/paas/v4/chat/completions',
        modelo: 'glm-4-flash',
        chaveEnv: 'GLM_API_KEY',
        arquivoChave: 'glm-key.txt'
    }
};

function obterConfigIA() {
    let provedor = 'codegpt';
    try { provedor = fs.readFileSync(path.join(__dirname, 'ia-config.txt'), 'utf8').trim().toLowerCase(); } catch (e) { }
    const conf = PROVEDORES[provedor] || PROVEDORES.codegpt;
    let chave = process.env[conf.chaveEnv] || null;
    if (!chave) {
        try { chave = fs.readFileSync(path.join(__dirname, conf.arquivoChave), 'utf8').trim(); } catch (e) { }
    }
    return { provedor, ...conf, chave };
}

ipcMain.handle('glm-analisar', async (_evento, dados) => {
    const conf = obterConfigIA();
    if (!conf.chave) {
        return { ok: false, erro: 'Sem chave ' + conf.provedor + '. Crie ' + conf.arquivoChave + ' com sua API key.' };
    }
    try {
        let headers = { 'Content-Type': 'application/json' };
        let corpo;

        if (conf.provedor === 'codegpt') {
            headers['Authorization'] = 'Bearer ' + conf.chave;
            headers['source'] = 'api';
            headers['channel'] = 'sdk-js';
            headers['CodeGPT-Org-Id'] = CODEGPT_ORG_ID;
            corpo = {
                agentId: CODEGPT_AGENT_ID,
                stream: false,
                format: 'json',
                messages: [
                    {
                        role: 'user',
                        content: 'Analise estes horários de entrada do Aviator e responda APENAS um JSON ' +
                            '{"minuto": <0-59>, "segundo1": <0-9>, "segundo2": <0-9>, "confianca": <0-100>, ' +
                            '"justificativa": "<1 frase>"} sugerindo a próxima entrada: ' + JSON.stringify(dados)
                    }
                ]
            };
        } else {
            headers['Authorization'] = 'Bearer ' + conf.chave;
            corpo = {
                model: conf.modelo,
                messages: [
                    {
                        role: 'system',
                        content: 'Você é um analista de padrões de horários para o jogo Aviator. ' +
                            'Recebe os últimos horários de entrada das velas e devolve APENAS um JSON ' +
                            'no formato {"minuto": <0-59>, "segundo1": <0-9>, "segundo2": <0-9>, ' +
                            '"confianca": <0-100>, "justificativa": "<1 frase>"} sugerindo a próxima entrada.'
                    },
                    { role: 'user', content: JSON.stringify(dados) }
                ],
                temperature: 0.3,
                max_completion_tokens: 1024,
                reasoning_effort: 'low'
            };
        }

        const res = await fetch(conf.url, {
            method: 'POST',
            headers: headers,
            body: JSON.stringify(corpo)
        });
        const json = await res.json();
        if (!res.ok) {
            return { ok: false, erro: (json && json.error && json.error.message) || (json && json.message) || ('HTTP ' + res.status) };
        }
        const texto = json.choices[0].message.content;
        const m = texto.match(/\{[\s\S]*\}/);
        return { ok: true, provedor: conf.provedor, analise: m ? JSON.parse(m[0]) : null, bruto: texto };
    } catch (e) {
        return { ok: false, erro: String(e.message || e) };
    }
});

function createWindow() {
    const win = new BrowserWindow({
        width: 1400,
        height: 900,
        minWidth: 900,
        minHeight: 600,
        title: 'Light Vision Gms Pro 2.3.0',
        icon: path.join(__dirname, 'Gms.jpeg'),
        webPreferences: {
            preload: path.join(__dirname, 'preload.js'),
            webviewTag: true,          // <- Habilita a tag <webview>
            contextIsolation: true,
            nodeIntegration: false
        }
    });

    // O webview usa uma partição própria — aplica a limpeza de cabeçalhos nela também
    const { session } = require('electron');
    const remover = new Set(['x-frame-options', 'content-security-policy', 'content-security-policy-report-only', 'cross-origin-opener-policy', 'cross-origin-opener-policy-report-only', 'cross-origin-embedder-policy', 'cross-origin-embedder-policy-report-only', 'cross-origin-resource-policy', 'permissions-policy']);
    for (const s of [session.defaultSession, session.fromPartition('persist:webview')]) {
        s.webRequest.onHeadersReceived((details, callback) => {
            const headers = { ...details.responseHeaders };
            for (const key of Object.keys(headers)) {
                if (remover.has(key.toLowerCase())) delete headers[key];
            }
            callback({ responseHeaders: headers });
        });
    }

    // Impede que links externos abram dentro da app (popups abrem no navegador)
    win.webContents.setWindowOpenHandler(({ url }) => {
        shell.openExternal(url);
        return { action: 'deny' };
    });

    win.removeMenu(); // Remove a barra de menu padrão
    win.loadFile('index.html');
}

app.whenReady().then(() => {
    // Remove cabeçalhos que bloqueiam o carregamento dentro do app
    const { session } = require('electron');
    const remover = new Set(['x-frame-options', 'content-security-policy', 'content-security-policy-report-only', 'cross-origin-opener-policy', 'cross-origin-opener-policy-report-only', 'cross-origin-embedder-policy', 'cross-origin-embedder-policy-report-only', 'cross-origin-resource-policy', 'permissions-policy', 'report-to', 'nel']);
    for (const nomeSessao of ['defaultSession']) {
        const s = session[nomeSessao];
        s.webRequest.onHeadersReceived((details, callback) => {
            const headers = { ...details.responseHeaders };
            for (const key of Object.keys(headers)) {
                if (remover.has(key.toLowerCase())) delete headers[key];
            }
            callback({ responseHeaders: headers, statusLine: details.statusLine });
        });
        // Faz as requisições parecerem navegação top-level (não embed)
        s.webRequest.onBeforeSendHeaders((details, callback) => {
            const reqHeaders = { ...details.requestHeaders };
            reqHeaders['Sec-Fetch-Dest'] = 'document';
            reqHeaders['Sec-Fetch-Mode'] = 'navigate';
            reqHeaders['Sec-Fetch-Site'] = 'none';
            reqHeaders['Sec-Fetch-User'] = '?1';
            callback({ requestHeaders: reqHeaders });
        });
    }

    createWindow();

    app.on('activate', () => {
        // No macOS: recria a janela se a dock for clicada
        if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });

    // ===== CAPTURA DE HORÁRIOS via processo principal =====
    // Varre TODOS os frames de TODOS os WebContents procurando HH:MM:SS (ex: 02:27:38)
    // e envia o resultado para a página. Funciona mesmo com iframes do Aviator.
    const buscaFrames = `(function(){
        var out = [];
        var cand = document.querySelectorAll('div,span,p,td,li');
        for (var i = 0; i < cand.length; i++) {
            var t = (cand[i].textContent || '').trim();
            if (/^\\\\d{1,2}:\\\\d{2}:\\\\d{2}$/.test(t)) out.push(t);
        }
        return out.slice(0, 8);
    })()`;

    function coletarFrames(frame, acc) {
        acc.push(frame);
        for (const f of frame.frames) coletarFrames(f, acc);
        return acc;
    }

    setInterval(async () => {
        try {
            for (const wc of webContents.getAllWebContents()) {
                const frames = coletarFrames(wc.mainFrame, []);
                let achados = [];
                for (const f of frames) {
                    try {
                        const r = await f.executeJavaScript(buscaFrames, false);
                        if (Array.isArray(r)) achados = achados.concat(r);
                    } catch (e) { /* frame cross-origin ou em recarga */ }
                }
                if (achados.length) {
                    // Envia para a janela principal (página do app)
                    wc.send('horarios-encontrados', achados);
                }
            }
        } catch (e) { /* sem problema */ }
    }, 1500);
});

app.on('window-all-closed', () => {
    // No macOS é comum manter o app ativo até Cmd+Q
    if (process.platform !== 'darwin') app.quit();
});
