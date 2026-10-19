// Deploys every AWS stack in order (PLANNING §2): `npm run deploy:aws` from the root, with
// BUDGET_EMAIL set (and optional STAGE, default dev). Serverless Compose is not used: it keeps
// its state through us-east-1, which the account organization denies, and the services read
// the shared outputs straight from CloudFormation (${cf:...}), so they need no state.
import { execSync } from 'node:child_process';

const stage = process.env.STAGE ?? 'dev';

const run = (command, cwd = '.') => {
  console.log(`\n> ${command} (${cwd})`);
  execSync(command, { stdio: 'inherit', cwd });
};
const deploy = (path) => {
  run(`serverless deploy --stage ${stage}`, path);
};

// The Lambdas bundle the shared packages from their dist folders.
run('npm run build -w @alegra-lunch/contracts -w @alegra-lunch/shared');

// First the shared topics and HTTP API, which every service reads.
deploy('infra/aws');
// Orders goes after the warehouse: its first request starts the workday the warehouse must hear.
for (const path of [
  'services/kitchen',
  'services/warehouse',
  'services/market',
  'services/orders',
  'services/realtime',
  'apps/web',
]) {
  deploy(path);
}
// Again, now that the dashboard exists: its CloudFront URL becomes the only CORS origin.
deploy('infra/aws');

run('npm run deploy:aws -w @alegra-lunch/web');
