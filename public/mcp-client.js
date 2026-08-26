// MCP Gateway Bridge for BlissOS Subkernel
class BlissMCPBridge {
    constructor(endpoint = 'http://127.0.0.1:8080/mcp') {
        this.endpoint = endpoint;
        this.connected = false;
        this.activeServers = new Map();
    }

    async pingDaemon() {
        try {
            const res = await fetch(`${this.endpoint}/health`, { method: 'GET' });
            if (res.ok) {
                this.connected = true;
                return await res.json();
            }
        } catch (err) {
            this.connected = false;
            return { status: 'OFFLINE', error: err.message };
        }
    }

    async registerServer(serverName, serverPath) {
        // Points to C:\Dev\ollama-harness\mcp-servers\<serverName>
        return this.sendRequest('mcp/register', {
            name: serverName,
            path: serverPath
        });
    }

    async executeTool(serverName, toolName, args = {}) {
        return this.sendRequest('mcp/execute', {
            server: serverName,
            tool: toolName,
            arguments: args
        });
    }

    async sendRequest(method, params) {
        if (!this.connected) await this.pingDaemon();
        try {
            const response = await fetch(`${this.endpoint}/rpc`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    jsonrpc: '2.0',
                    id: Date.now(),
                    method: method,
                    params: params
                })
            });
            return await response.json();
        } catch (err) {
            console.error(`[MCP Bridge Error]: ${err}`);
            return { error: err.message };
        }
    }
}

window.mcpBridge = new BlissMCPBridge();
