#!/usr/bin/env node

const { spawn } = require('child_process');
const path = require('path');
const os = require('os');
const net = require('net');

const args = process.argv.slice(2);
const command = args[0];

// Data directory: ~/.mcp-deploy (survives npm reinstalls)
const DATA_ROOT = process.env.MCP_DEPLOY_ROOT || path.join(os.homedir(), '.mcp-deploy');

// Commands that need TypeScript/ESM support — delegate to tsx
const CLI_COMMANDS = ['list', 'add', 'remove', 'deploy', 'undeploy', 'status', 'secrets:set', 'secrets:list', 'secrets:delete', 'login'];

if (command === '-v' || command === '--version') {
    const pkg = require(path.join(__dirname, '..', 'package.json'));
    console.log(pkg.version);
} else if (command === '-gui' || command === '--gui' || command === 'gui') {
    // Start Next.js standalone server
    const pkgRoot = path.join(__dirname, '..');
    const standaloneDir = path.join(pkgRoot, '.next', 'standalone');
    const serverJs = path.join(standaloneDir, 'server.js');
    const fs = require('fs');
    if (!fs.existsSync(serverJs)) {
        console.error('Missing standalone build output. Run "npm run build" first.');
        process.exit(1);
    }

    // Parse -p / --port and --host flags
    const guiArgs = args.slice(1);
    let port = '3838';
    // Loopback by default: the dashboard has no authentication and can deploy
    // and delete workers in the user's Cloudflare account, so it must not be
    // reachable from the network unless someone explicitly asks for that.
    let host = '127.0.0.1';
    for (let i = 0; i < guiArgs.length; i++) {
        if ((guiArgs[i] === '-p' || guiArgs[i] === '--port') && guiArgs[i + 1]) {
            port = guiArgs[i + 1];
        } else if ((guiArgs[i] === '-H' || guiArgs[i] === '--host') && guiArgs[i + 1]) {
            host = guiArgs[i + 1];
        }
    }

    const LOOPBACK = ['127.0.0.1', 'localhost', '::1'];
    if (!LOOPBACK.includes(host)) {
        console.warn(
            `\nWARNING: binding to ${host} exposes the dashboard to your network.\n` +
            `It has no login, and anyone who reaches it can deploy or delete\n` +
            `workers in your Cloudflare account and change their secrets.\n` +
            `Only do this on a network you trust.\n`
        );
    }

    const url = `http://localhost:${port}`;
    const portNum = parseInt(port, 10);

    // Cross-platform port check using Node's net module
    checkPort(portNum, host).then((inUse) => {
        if (inUse) {
            // Something is on this port — check if it's a healthy mcp-deploy
            const http = require('http');
            const req = http.get(`${url}/api/cloudflare/status`, { timeout: 2000 }, (res) => {
                res.resume();
                if (res.statusCode === 200) {
                    console.log(`mcp-deploy is already running at ${url}`);
                    process.exit(0);
                } else {
                    console.error(`Port ${port} is in use by another process. Use -p to choose a different port.`);
                    process.exit(1);
                }
            });
            req.on('error', () => {
                console.error(`Port ${port} is in use by another process. Use -p to choose a different port.`);
                process.exit(1);
            });
            req.on('timeout', () => {
                req.destroy();
                console.error(`Port ${port} is in use by another process. Use -p to choose a different port.`);
                process.exit(1);
            });
        } else {
            startServer(port, url, host);
        }
    });

    function startServer(port, url, host) {
        console.log(`Starting mcp-deploy web interface on ${url} ...`);
        const server = spawn(process.execPath, ['server.js'], {
            cwd: standaloneDir,
            stdio: 'inherit',
            env: {
                ...process.env,
                PORT: port,
                HOSTNAME: host,
                MCP_DEPLOY_ROOT: DATA_ROOT,
            },
        });

        server.on('close', (code) => process.exit(code || 0));
        server.on('error', (err) => {
            console.error('Failed to start server:', err);
            process.exit(1);
        });
    }
} else if (CLI_COMMANDS.includes(command)) {
    // Delegate to TypeScript CLI module via tsx
    const tsxBin = path.join(__dirname, '../node_modules/.bin/tsx');
    const cliModule = path.join(__dirname, '../src/cli/index.ts');
    const child = spawn(tsxBin, [cliModule, ...args], {
        cwd: path.join(__dirname, '..'),
        stdio: 'inherit',
        env: {
            ...process.env,
            MCP_DEPLOY_ROOT: DATA_ROOT,
        },
    });

    child.on('close', (code) => process.exit(code || 0));
    child.on('error', (err) => {
        console.error('Failed to run command:', err);
        process.exit(1);
    });
} else if (command === '-h' || command === '--help' || !command) {
    console.log(`
mcp-deploy - Deploy MCP servers to Cloudflare Workers

Usage:
  mcp-deploy gui [-p PORT] [-H HOST]      Start the web interface (default: 127.0.0.1:3838)
  mcp-deploy list                         List all MCPs and their status
  mcp-deploy add <github-repo>            Add an MCP from GitHub
  mcp-deploy remove <slug>                Remove an MCP (deletes worker + data)
  mcp-deploy deploy <slug>                Deploy an MCP to Cloudflare
  mcp-deploy undeploy <slug>              Remove worker but keep MCP in registry
  mcp-deploy status <slug>                Check deployment health
  mcp-deploy secrets:list <slug>          List configured secret keys
  mcp-deploy secrets:set <slug> <key>     Set a secret (prompts for value)
  mcp-deploy secrets:delete <slug> <key>  Delete a secret
  mcp-deploy login                        Login to Cloudflare via wrangler
  mcp-deploy --version                    Show version
  mcp-deploy --help                       Show this help message

Examples:
  mcp-deploy gui                          # Start web UI on http://localhost:3838
  mcp-deploy gui -p 3001                  # Start web UI on a different port
  mcp-deploy gui -H 0.0.0.0               # Expose on the network (no auth — see warning)
  mcp-deploy add upascal/my-mcp-remote    # Add an MCP from GitHub
  mcp-deploy deploy my-mcp                # Deploy to Cloudflare Workers
  mcp-deploy undeploy my-mcp              # Take down worker, keep config for later
  mcp-deploy secrets:set my-mcp API_KEY   # Set a secret interactively

For more information, visit: https://github.com/upascal/mcp-deploy
  `.trim());
} else {
    console.error(`Unknown command: ${command}`);
    console.log('Run "mcp-deploy --help" for usage information.');
    process.exit(1);
}

/**
 * Check if a port is in use (cross-platform, no lsof dependency).
 * Returns a promise that resolves to true if the port is occupied.
 */
function checkPort(port, host) {
    return new Promise((resolve) => {
        const server = net.createServer();
        server.once('error', (err) => {
            if (err.code === 'EADDRINUSE') {
                resolve(true);
            } else {
                resolve(false);
            }
        });
        server.once('listening', () => {
            server.close(() => resolve(false));
        });
        server.listen(port, host);
    });
}
