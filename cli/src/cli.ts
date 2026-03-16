import { Command } from 'commander';
import { runValidate } from './commands/validate.js';

const program = new Command();

program.name('megatest').description('Visual regression testing CLI').version('0.1.0');

program
    .command('validate')
    .description('Validate .megatest/ configuration')
    .requiredOption('--repo <path>', 'Path to target repository')
    .action(async (opts) => {
        const code = await runValidate(opts.repo);
        process.exit(code);
    });

program
    .command('run')
    .description('Run visual regression tests')
    .requiredOption('--repo <path>', 'Path to target repository')
    .requiredOption('--url <url>', 'Base URL of the running application')
    .option('--plan <name>', 'Plan to execute')
    .option('--workflow <name>', 'Single workflow to execute')
    .option('--concurrency <n>', 'Max parallel workflows (default: from config or 4)')
    .action(async (opts) => {
        const { runRun } = await import('./commands/run.js');
        const code = await runRun({
            repo: opts.repo,
            url: opts.url,
            plan: opts.plan,
            workflow: opts.workflow,
            concurrency: opts.concurrency ? Number(opts.concurrency) : undefined,
        });
        process.exit(code);
    });

program
    .command('accept')
    .description('Accept screenshots as new baselines')
    .argument('[checkpoint]', 'Specific checkpoint to accept (all viewports)')
    .requiredOption('--repo <path>', 'Path to target repository')
    .action(async (checkpoint, opts) => {
        const { runAccept } = await import('./commands/accept.js');
        const code = await runAccept(opts.repo, checkpoint);
        process.exit(code);
    });

program
    .command('serve')
    .description('Start a report server dashboard')
    .option('--config <path>', 'Path to serve config file', 'serve.config.yml')
    .option('--port <number>', 'Port to listen on (overrides config)')
    .option('--host <address>', 'Host to bind to (overrides config)')
    .action(async (opts) => {
        const { runServe } = await import('./commands/serve.js');
        await runServe(opts);
    });

program.parse();
