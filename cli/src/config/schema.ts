export interface Viewport {
  width: number;
  height: number;
}

export interface MegatestConfig {
  version: string;
  defaults: {
    viewport: Viewport;
    threshold: number; // % pixels allowed to differ (0.0-100.0)
    waitAfterNavigation: string; // "load", "networkidle", or ms string
    screenshotMode: 'viewport' | 'full';
    timeout: number; // per-step timeout in ms
  };
  viewports: Record<string, Viewport>;
  variables: Record<string, string>;
}

export interface Locator {
  testid?: string;
  role?: string;
  name?: string;
  label?: string;
  text?: string;
  placeholder?: string;
  css?: string;
}

// Step types - each step is an object with exactly one key
export interface OpenStep {
  open: string;
}
export interface WaitStep {
  wait: number;
}
export interface ScreenshotStep {
  screenshot: string;
}
export interface ClickStep {
  click: Locator & { name?: string };
}
export interface FillStep {
  fill: Locator & { value: string };
}
export interface HoverStep {
  hover: Locator;
}
export interface SelectStep {
  select: Locator & { value: string };
}
export interface PressStep {
  press: string;
}
export interface ScrollStep {
  scroll: { up?: number; down?: number; left?: number; right?: number };
}
export interface EvalStep {
  eval: string;
}
export interface IncludeStep {
  include: string;
}
export interface SetViewportStep {
  'set-viewport': string;
}

export type Step =
  | OpenStep
  | WaitStep
  | ScreenshotStep
  | ClickStep
  | FillStep
  | HoverStep
  | SelectStep
  | PressStep
  | ScrollStep
  | EvalStep
  | IncludeStep
  | SetViewportStep;

export interface Workflow {
  name: string;
  description?: string;
  steps: Step[];
}

export interface Include {
  name: string;
  description?: string;
  steps: Step[];
}

export interface Plan {
  name: string;
  description?: string;
  workflows: string[];
}

export interface LoadedConfig {
  config: MegatestConfig;
  workflows: Map<string, Workflow>;
  includes: Map<string, Include>;
  plans: Map<string, Plan>;
  basePath: string; // absolute path to .megatest/ directory
}
