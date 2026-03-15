export type CheckpointStatus = 'pass' | 'fail' | 'new' | 'error';

export interface CheckpointResult {
    workflow: string;
    checkpoint: string;
    viewport: string;
    status: CheckpointStatus;
    diffPercent: number | null;
    diffPixels: number | null;
    totalPixels: number | null;
    dimensionMismatch: boolean;
    baselinePath: string | null;
    actualPath: string | null;
    diffPath: string | null;
    error: string | null;
}

export interface RunResult {
    commitHash: string;
    timestamp: string;
    checkpoints: CheckpointResult[];
    passed: number;
    failed: number;
    newCount: number;
    errors: number;
    duration: number;
}

export interface ReportMeta {
    commitHash: string;
    timestamp: string;
    passed: number;
    failed: number;
    newCount: number;
    errors: number;
    duration: number;
    totalCheckpoints: number;
}

export interface ServeProjectConfig {
    name: string;
    path: string;
}

export interface ServeConfig {
    title: string;
    server: {
        port: number;
        host: string;
    };
    projects: ServeProjectConfig[];
}
