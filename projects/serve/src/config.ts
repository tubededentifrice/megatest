import * as fs from 'node:fs';
import * as yaml from 'js-yaml';
import type { ServeConfig, ServeProjectConfig } from './types.js';

export function loadConfig(configPath: string): ServeConfig {
    if (!fs.existsSync(configPath)) {
        console.error(`Config file not found: ${configPath}`);
        console.error('Create one from serve.config.sample.yml');
        process.exit(1);
    }

    const raw = fs.readFileSync(configPath, 'utf-8');
    const doc = yaml.load(raw) as Record<string, unknown>;

    if (!doc || typeof doc !== 'object') {
        console.error(`Invalid config file: ${configPath}`);
        process.exit(1);
    }

    const server = (doc.server as Record<string, unknown>) ?? {};
    const projects = (doc.projects as Array<Record<string, unknown>>) ?? [];

    if (!Array.isArray(projects) || projects.length === 0) {
        console.error(`Config must have at least one project in 'projects' list`);
        process.exit(1);
    }

    const parsed: ServeConfig = {
        title: (doc.title as string) ?? 'Megatest Reports',
        server: {
            port: (server.port as number) ?? 3000,
            host: (server.host as string) ?? '0.0.0.0',
        },
        projects: projects.map((p, i) => {
            if (!p.name || !p.path) {
                console.error(`Project at index ${i} must have 'name' and 'path'`);
                process.exit(1);
            }
            return { name: p.name as string, path: p.path as string };
        }),
    };

    return parsed;
}
