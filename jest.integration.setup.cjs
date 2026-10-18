/**
 * Points the AWS SDK to LocalStack unless the environment says otherwise. LocalStack accepts
 * any credentials, so these are not secrets.
 */
const defaults = {
  AWS_ENDPOINT_URL: 'http://localhost:4566',
  AWS_REGION: 'us-east-1',
  AWS_ACCESS_KEY_ID: 'test',
  AWS_SECRET_ACCESS_KEY: 'test',
};

for (const [name, value] of Object.entries(defaults)) {
  process.env[name] ??= value;
}
