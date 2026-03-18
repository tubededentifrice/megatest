#!/usr/bin/env node

// Parse CLI flags
const args = process.argv.slice(2);
let configPath = 'serve.config.yml';
let port;
let host;

for (let i = 0; i < args.length; i++) {
    if (args[i] === '--config' && args[i + 1]) {
        configPath = args[++i];
    } else if (args[i] === '--port' && args[i + 1]) {
        port = Number(args[++i]);
    } else if (args[i] === '--host' && args[i + 1]) {
        host = args[++i];
    }
}

import('../dist/index.js').then(({ runServe }) => {
    runServe({ config: configPath, port, host });
});
