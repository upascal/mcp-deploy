#!/usr/bin/env node

const { spawn } = require('child_process');
const path = require('path');

const args = process.argv.slice(2);

if (args.includes('-gui') || args.includes('--gui')) {
    // Start Next.js dev server
    console.log('Starting mcp-deploy web interface...');
    const nextBin = path.join(__dirname, '../node_modules/.bin/next');
    const server = spawn(nextBin, ['dev', '--webpack'], {
        cwd: path.join(__dirname, '..'),
        stdio: 'inherit',
        shell: true
    });

    server.on('close', (code) => process.exit(code || 0));
    server.on('error', (err) => {
        console.error('Failed to start server:', err);
        process.exit(1);
    });
} else if (args.includes('-h') || args.includes('--help') || args.length === 0) {
    // Show help
    console.log(`
mcp-deploy - Deploy MCP servers to Cloudflare Workers

Usage:
  mcp-deploy -gui          Start the web interface
  mcp-deploy --help        Show this help message

Examples:
  mcp-deploy -gui          # Start web UI on http://localhost:3000

For more information, visit: https://github.com/upascal/mcp-deploy
  `.trim());
} else {
    // Future: CLI commands (deploy, list, remove, etc.)
    console.log('CLI commands coming soon. Use -gui flag to start the web interface.');
    console.log('Run "mcp-deploy --help" for usage information.');
}
