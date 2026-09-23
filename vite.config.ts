import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import { GoogleGenAI } from '@google/genai';

function geminiApiPlugin(): Plugin {
  return {
    name: 'gemini-api-plugin',
    configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
        if (req.url === '/api/gemini/health' && req.method === 'GET') {
          res.setHeader('Content-Type', 'application/json');
          res.end(JSON.stringify({
            ok: true,
            available: !!process.env.GEMINI_API_KEY,
            model: 'gemini-3.8-flash',
          }));
          return;
        }

        if (req.url === '/api/gemini' && req.method === 'POST') {
          let body = '';
          req.on('data', (chunk) => {
            body += chunk;
          });
          req.on('end', async () => {
            let data: Record<string, unknown> = {};
            try {
              data = JSON.parse(body || '{}');
            } catch {
              data = {};
            }

            const model = (data.model as string) || 'gemini-3.8-flash';
            const apiKey = (data.apiKey as string) || req.headers['x-gemini-api-key'] || process.env.GEMINI_API_KEY;
            let contents: unknown = data.prompt || data.content;

            if (Array.isArray(data.messages)) {
              contents = (data.messages as Array<{ role: string; content: string }>).map((m) => ({
                role: m.role === 'assistant' ? 'model' : 'user',
                parts: [{ text: String(m.content || '') }],
              }));
            }

            try {
              if (!apiKey) {
                throw new Error('No GEMINI_API_KEY configured');
              }

              const ai = new GoogleGenAI({ apiKey: String(apiKey) });
              const config: Record<string, unknown> = {};
              if (data.systemInstruction) {
                config.systemInstruction = data.systemInstruction;
              }

              const response = await ai.models.generateContent({
                model,
                contents: contents || 'Hello Logos',
                config,
              });

              res.setHeader('Content-Type', 'application/json');
              res.end(JSON.stringify({
                ok: true,
                text: response.text,
                model,
                source: 'gemini-live',
              }));
            } catch (err: unknown) {
              const error = err as Error;
              console.warn('[Gemini API Proxy]', error.message);

              // Provide intelligent local subkernel fallback if external API key is invalid or offline
              const userPrompt = typeof data.prompt === 'string'
                ? data.prompt
                : (Array.isArray(data.messages) ? data.messages[data.messages.length - 1]?.content : '');
              
              let fallbackReply = `Logos 🦀 online (Subkernel local runtime).\n\nProcessed query: "${userPrompt || 'system status'}".`;
              if (/node|floret|graph/i.test(userPrompt)) {
                fallbackReply += `\n\nCanonical graph insight: In CloudOS, everything is a typed property graph. All files, processes, windows and services connect via semantic edges (owns, launches, opens, communicates). You can drag, inspect, or connect nodes directly in Floret!`;
              } else if (/taskbar|tab|persist/i.test(userPrompt)) {
                fallbackReply += `\n\nTaskbar state: Open tabs and active window states are automatically persisted into localStorage (\`cloudos.taskbar.tabs.v1\`) across page refreshes.`;
              }

              res.setHeader('Content-Type', 'application/json');
              res.end(JSON.stringify({
                ok: true,
                text: fallbackReply,
                model: 'subkernel-local:logos',
                fallback: true,
                warning: error.message,
              }));
            }
          });
          return;
        }

        next();
      });
    },
  };
}

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), geminiApiPlugin()],
  server: {
    host: '0.0.0.0',
    port: 3000,
    allowedHosts: true,
  },
});
