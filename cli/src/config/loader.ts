import * as fs from 'node:fs';
import * as path from 'node:path';
import * as yaml from 'js-yaml';
import type { Include, LoadedConfig, MegatestConfig, Plan, Workflow } from './schema.js';

const DEFAULT_CONFIG: MegatestConfig = {
    version: '1',
    defaults: {
        viewport: { width: 1280, height: 720 },
        threshold: 0.1,
        waitAfterNavigation: '1000',
        screenshotMode: 'viewport',
        timeout: 30000,
        format: 'webp',
        concurrency: 4,
    },
    viewports: {
        desktop: { width: 1280, height: 720 },
        mobile: { width: 375, height: 812 },
    },
    variables: {},
};

function listYmlFiles(dir: string): string[] {
    if (!fs.existsSync(dir)) {
        return [];
    }
    return fs
        .readdirSync(dir)
        .filter((f) => f.endsWith('.yml'))
        .map((f) => path.join(dir, f));
}

function loadYamlFile(filePath: string): unknown {
    const content = fs.readFileSync(filePath, 'utf-8');
    return yaml.load(content);
}

function applyConfigDefaults(raw: Record<string, unknown>): MegatestConfig {
    const rawDefaults = (raw.defaults ?? {}) as Record<string, unknown>;
    const rawViewport = (rawDefaults.viewport ?? DEFAULT_CONFIG.defaults.viewport) as {
        width: number;
        height: number;
    };

    const config: MegatestConfig = {
        version: (raw.version as string) ?? DEFAULT_CONFIG.version,
        defaults: {
            viewport: {
                width: rawViewport.width ?? DEFAULT_CONFIG.defaults.viewport.width,
                height: rawViewport.height ?? DEFAULT_CONFIG.defaults.viewport.height,
            },
            threshold: (rawDefaults.threshold as number) ?? DEFAULT_CONFIG.defaults.threshold,
            waitAfterNavigation: String(
                (rawDefaults.waitAfterNavigation as string | number) ?? DEFAULT_CONFIG.defaults.waitAfterNavigation,
            ),
            screenshotMode:
                (rawDefaults.screenshotMode as 'viewport' | 'full') ?? DEFAULT_CONFIG.defaults.screenshotMode,
            timeout: (rawDefaults.timeout as number) ?? DEFAULT_CONFIG.defaults.timeout,
            format: (rawDefaults.format as 'png' | 'webp') ?? DEFAULT_CONFIG.defaults.format,
            concurrency: (rawDefaults.concurrency as number) ?? DEFAULT_CONFIG.defaults.concurrency,
        },
        viewports: (raw.viewports as Record<string, { width: number; height: number }>) ?? DEFAULT_CONFIG.viewports,
        variables: (raw.variables as Record<string, string>) ?? DEFAULT_CONFIG.variables,
    };

    return config;
}

export function loadConfig(repoPath: string): LoadedConfig {
    const basePath = path.resolve(repoPath, '.megatest');

    if (!fs.existsSync(basePath)) {
        throw new Error(`Directory not found: ${basePath}`);
    }

    // Load config.yml
    const configPath = path.join(basePath, 'config.yml');
    let config: MegatestConfig;
    if (fs.existsSync(configPath)) {
        const rawConfig = loadYamlFile(configPath) as Record<string, unknown> | null;
        config = applyConfigDefaults(rawConfig ?? {});
    } else {
        config = structuredClone(DEFAULT_CONFIG);
    }

    // Load workflows
    const workflows = new Map<string, Workflow>();
    const workflowsDir = path.join(basePath, 'workflows');
    for (const filePath of listYmlFiles(workflowsDir)) {
        const raw = loadYamlFile(filePath) as Workflow;
        if (!raw || !raw.name) {
            const filename = path.basename(filePath);
            console.warn(`Warning: ${filename} has no "name" field, skipping`);
            continue;
        }
        workflows.set(raw.name, {
            name: raw.name,
            description: raw.description,
            steps: raw.steps ?? [],
        });
    }

    // Load includes
    const includes = new Map<string, Include>();
    const includesDir = path.join(basePath, 'includes');
    for (const filePath of listYmlFiles(includesDir)) {
        const raw = loadYamlFile(filePath) as Include;
        if (!raw || !raw.name) {
            const filename = path.basename(filePath);
            console.warn(`Warning: ${filename} has no "name" field, skipping`);
            continue;
        }
        includes.set(raw.name, {
            name: raw.name,
            description: raw.description,
            steps: raw.steps ?? [],
        });
    }

    // Load plans
    const plans = new Map<string, Plan>();
    const plansDir = path.join(basePath, 'plans');
    for (const filePath of listYmlFiles(plansDir)) {
        const raw = loadYamlFile(filePath) as Plan;
        if (!raw || !raw.name) {
            const filename = path.basename(filePath);
            console.warn(`Warning: ${filename} has no "name" field, skipping`);
            continue;
        }
        plans.set(raw.name, {
            name: raw.name,
            description: raw.description,
            workflows: raw.workflows ?? [],
        });
    }

    return {
        config,
        workflows,
        includes,
        plans,
        basePath,
    };
}
