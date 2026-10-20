// Builds the dashboard with the URLs of the deployed stacks and uploads it to S3 behind
// CloudFront (PLANNING §2). Run it after `serverless deploy` of infra/aws, the services and
// apps/web: `npm run deploy:aws -w @alegra-lunch/web` (optional STAGE, default dev).
import { execSync } from 'node:child_process';

const stage = process.env.STAGE ?? 'dev';
const region = 'us-east-2';

const run = (command, env = {}) =>
  execSync(command, { stdio: 'inherit', env: { ...process.env, ...env } });

/** The outputs of a CloudFormation stack as { key: value }. */
function outputsOf(stack) {
  const json = execSync(
    `aws cloudformation describe-stacks --region ${region} --stack-name ${stack} ` +
      '--query "Stacks[0].Outputs" --output json',
    { encoding: 'utf8' },
  );
  return Object.fromEntries(JSON.parse(json).map((o) => [o.OutputKey, o.OutputValue]));
}

const infra = outputsOf(`alegra-lunch-infra-${stage}`);
const realtime = outputsOf(`alegra-lunch-realtime-${stage}`);
const web = outputsOf(`alegra-lunch-web-${stage}`);

// One HTTP API serves orders, warehouse, kitchen, market and the assistant: one URL.
run('npm run build', {
  VITE_ORDERS_URL: infra.HttpApiUrl,
  VITE_WAREHOUSE_URL: infra.HttpApiUrl,
  VITE_KITCHEN_URL: infra.HttpApiUrl,
  VITE_MARKET_URL: infra.HttpApiUrl,
  VITE_ASSISTANT_URL: infra.HttpApiUrl,
  VITE_REALTIME_URL: realtime.ServiceEndpointWebsocket,
});

run(`aws s3 sync dist s3://${web.WebBucketName} --delete --region ${region}`);
// index.html is cached at the edge: invalidate so the new build shows right away.
run(
  `aws cloudfront create-invalidation --distribution-id ${web.WebDistributionId} ` +
    '--paths "/*" --query Invalidation.Id --output text',
);

console.log(`Dashboard deployed: ${web.WebUrl}`);
