// End-to-end validation of the GA4 service-account setup: sign a JWT with the
// key, exchange for an access token, run a real Data API report.
import fs from 'fs';
import crypto from 'crypto';

const key = JSON.parse(fs.readFileSync('C:/Users/kinsm/.gcp/mm-analytics-key.json', 'utf8'));
const PROPERTY = 'properties/543678040';

const b64url = o => Buffer.from(JSON.stringify(o)).toString('base64url');
const now = Math.floor(Date.now() / 1000);
const unsigned = `${b64url({ alg: 'RS256', typ: 'JWT' })}.${b64url({
  iss: key.client_email,
  scope: 'https://www.googleapis.com/auth/analytics.readonly',
  aud: 'https://oauth2.googleapis.com/token',
  iat: now, exp: now + 3600,
})}`;
const sig = crypto.createSign('RSA-SHA256').update(unsigned).sign(key.private_key).toString('base64url');

const tokRes = await fetch('https://oauth2.googleapis.com/token', {
  method: 'POST',
  headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
  body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion: `${unsigned}.${sig}` }),
});
const tok = await tokRes.json();
if (!tok.access_token) { console.error('TOKEN FAILED:', JSON.stringify(tok)); process.exit(1); }
console.log('access token: OK');

const rep = await fetch(`https://analyticsdata.googleapis.com/v1beta/${PROPERTY}:runReport`, {
  method: 'POST',
  headers: { Authorization: `Bearer ${tok.access_token}`, 'Content-Type': 'application/json' },
  body: JSON.stringify({
    dateRanges: [{ startDate: '7daysAgo', endDate: 'today' }],
    dimensions: [{ name: 'pagePath' }],
    metrics: [{ name: 'screenPageViews' }, { name: 'activeUsers' }],
    orderBys: [{ metric: { metricName: 'screenPageViews' }, desc: true }],
    limit: 8,
  }),
});
const data = await rep.json();
if (data.error) { console.error('REPORT FAILED:', data.error.status, data.error.message); process.exit(1); }
console.log(`\nGA4 REPORT OK — top pages, last 7 days (${data.rowCount ?? 0} total rows):`);
for (const r of data.rows || []) console.log(`  ${r.metricValues[0].value.padStart(4)} views | ${r.metricValues[1].value.padStart(3)} users | ${r.dimensionValues[0].value}`);
