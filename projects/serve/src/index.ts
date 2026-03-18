import * as path from 'node:path';
import { serve } from '@hono/node-server';
import { createApp } from './app.js';
import { loadConfig } from './config.js';
import { discoverProjects, listReports } from './discovery.js';

export type {
    ServeConfig,
    ServeProjectConfig,
    DiscoveredProject,
    ReportEntry,
    ReviewData,
} from './types.js';

export interface ServeOptions {
    config: string;
    port?: number | string;
    host?: string;
}

export async function runServe(opts: ServeOptions): Promise<void> {
    const configPath = path.resolve(opts.config);
    const config = loadConfig(configPath);

    // CLI flags override config
    if (opts.port) {
        const parsed = typeof opts.port === 'number' ? opts.port : Number.parseInt(opts.port, 10);
        if (Number.isNaN(parsed) || parsed < 1 || parsed > 65535) {
            console.error(`Invalid port: ${opts.port}`);
            process.exit(1);
        }
        config.server.port = parsed;
    }
    if (opts.host) config.server.host = opts.host;

    const projects = discoverProjects(config.projects);

    if (projects.length === 0) {
        console.warn('No projects with reports found. Dashboard will be empty.');
    } else {
        console.log(`Found ${projects.length} project(s):`);
        for (const p of projects) {
            const reports = listReports(p);
            console.log(`  ${p.name}: ${reports.length} report(s) — ${p.repoPath}`);
        }
    }

    const app = createApp(config);
    const { port, host } = config.server;

    const server = serve({ fetch: app.fetch, port, hostname: host }, (info) => {
        console.log(`\nMegatest report server running at http://${host}:${info.port}/`);
    });

    server.on('error', (err: NodeJS.ErrnoException) => {
        if (err.code === 'EADDRINUSE') {
            console.error(`Port ${port} is already in use. Try --port <number>`);
        } else {
            console.error(`Server error: ${err.message}`);
        }
        process.exit(1);
    });
}
