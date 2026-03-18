import type { CheckpointStatus, ReportMeta, ReviewCheckpoint } from '@megatest/core';

// Re-export core types used by other serve modules
export type { CheckpointStatus, ReportMeta, ReviewCheckpoint };

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

export interface DiscoveredProject {
    name: string;
    repoPath: string;
    megatestDir: string;
    reportsDir: string;
}

export interface ReportEntry {
    commitHash: string;
    meta: ReportMeta | null;
    mtime: Date;
    reportUrl: string;
}

export interface ReviewData {
    extension: string;
    checkpoints: ReviewCheckpoint[];
}
