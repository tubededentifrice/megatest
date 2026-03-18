import { loadConfig } from '../config/loader.js';
import { validate } from '../config/validator.js';

export async function runValidate(repoPath: string): Promise<number> {
    try {
        const config = loadConfig(repoPath);
        const errors = validate(config);

        const errs = errors.filter((e) => e.severity === 'error');
        const warns = errors.filter((e) => e.severity === 'warning');

        // Print results per file
        if (errs.length === 0) {
            console.log('\u2713 config.yml valid');
            for (const [name] of config.workflows) {
                console.log(`\u2713 workflows/${name}.yml valid`);
            }
            for (const [name] of config.includes) {
                console.log(`\u2713 includes/${name}.yml valid`);
            }
            for (const [name] of config.plans) {
                console.log(`\u2713 plans/${name}.yml valid`);
            }
        }

        // Print warnings
        for (const w of warns) {
            console.log(`\u26A0 ${w.file}: ${w.message}`);
        }

        // Print errors
        for (const e of errs) {
            console.error(`\u2717 ${e.file}: ${e.message}`);
        }

        const totalFiles = 1 + config.workflows.size + config.includes.size + config.plans.size;

        if (errs.length === 0) {
            console.log(`\nConfiguration valid (${totalFiles} files, ${errs.length} errors, ${warns.length} warnings)`);
            return 0;
        }
        console.error(`\nConfiguration invalid (${totalFiles} files, ${errs.length} errors, ${warns.length} warnings)`);
        return 1;
    } catch (err: any) {
        console.error(`Error: ${err.message}`);
        return 1;
    }
}
