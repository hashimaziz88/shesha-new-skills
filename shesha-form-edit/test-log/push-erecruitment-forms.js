const fs = require('fs');
const path = require('path');
const http = require('http');

const BASE_URL = 'http://localhost:21021';
const MODULE_ID = 'aabe5e0e-faaf-4167-bf25-af87fc7f0f0e';
const DIR = __dirname;

const FORMS = [
  { name: 'erecruitment-job-postings-table', label: 'E-Recruitment: Job Postings', file: 'erecruitment-job-postings-table.json', access: 1 },
  { name: 'erecruitment-job-posting-details', label: 'E-Recruitment: Job Posting Details', file: 'erecruitment-job-posting-details.json', access: 1 },
  { name: 'erecruitment-applications-table', label: 'E-Recruitment: Applications', file: 'erecruitment-applications-table.json', access: 1 },
  { name: 'erecruitment-application-details', label: 'E-Recruitment: Application Details', file: 'erecruitment-application-details.json', access: 1 },
  { name: 'erecruitment-interviews-table', label: 'E-Recruitment: Interviews', file: 'erecruitment-interviews-table.json', access: 1 },
  { name: 'erecruitment-interview-details', label: 'E-Recruitment: Interview Details', file: 'erecruitment-interview-details.json', access: 1 },
  { name: 'erecruitment-public-jobs', label: 'E-Recruitment: Public Job Board', file: 'erecruitment-public-jobs.json', access: 5 },
  { name: 'erecruitment-apply', label: 'E-Recruitment: Apply for Job', file: 'erecruitment-apply.json', access: 5 },
];

function req(method, urlPath, body, token) {
  return new Promise((resolve, reject) => {
    const bodyStr = body ? JSON.stringify(body) : '';
    const options = {
      hostname: 'localhost',
      port: 21021,
      path: urlPath,
      method,
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(bodyStr),
        ...(token ? { 'Authorization': 'Bearer ' + token } : {})
      }
    };
    const r = http.request(options, res => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => {
        try { resolve({ status: res.statusCode, body: JSON.parse(data) }); }
        catch(e) { resolve({ status: res.statusCode, body: data }); }
      });
    });
    r.on('error', reject);
    if (bodyStr) r.write(bodyStr);
    r.end();
  });
}

async function main() {
  // Auth
  console.log('Authenticating...');
  const authRes = await req('POST', '/api/TokenAuth/Authenticate', {
    userNameOrEmailAddress: 'admin',
    password: '123qwe'
  });
  const token = authRes.body.result?.accessToken;
  if (!token) { console.error('Auth failed:', JSON.stringify(authRes.body)); process.exit(1); }
  console.log('Token acquired.\n');

  // Get existing forms to avoid duplicates
  const listRes = await req('GET', '/api/services/Shesha/FormConfiguration/GetAll?maxResultCount=200', {}, token);
  const existing = {};
  if (listRes.body.result?.items) {
    for (const f of listRes.body.result.items) {
      existing[f.name] = f.id;
    }
  }

  const results = [];

  for (const form of FORMS) {
    console.log(`\nProcessing: ${form.name}`);
    const formJson = JSON.parse(fs.readFileSync(path.join(DIR, form.file), 'utf8'));

    let formId = existing[form.name];

    if (!formId) {
      // Create the form
      console.log(`  Creating form...`);
      const createBody = {
        moduleId: MODULE_ID,
        name: form.name,
        label: form.label,
        description: `E-Recruitment module - ${form.label}`
      };
      const createRes = await req('POST', '/api/services/Shesha/FormConfiguration/Create', createBody, token);
      if (createRes.status !== 200 || !createRes.body.result?.id) {
        console.error(`  Create FAILED (${createRes.status}):`, JSON.stringify(createRes.body).substring(0, 200));
        results.push({ name: form.name, status: 'CREATE_FAILED' });
        continue;
      }
      formId = createRes.body.result.id;
      console.log(`  Created with id: ${formId}`);
    } else {
      console.log(`  Exists with id: ${formId}`);
    }

    // Push markup
    const updateBody = {
      id: formId,
      markup: JSON.stringify(formJson),
      access: form.access
    };
    const updateRes = await req('PUT', '/api/services/Shesha/FormConfiguration/UpdateMarkup', updateBody, token);
    if (updateRes.status === 200 && updateRes.body.success !== false) {
      console.log(`  Markup pushed OK`);
      results.push({ name: form.name, id: formId, status: 'OK', access: form.access });
    } else {
      console.error(`  UpdateMarkup FAILED (${updateRes.status}):`, JSON.stringify(updateRes.body).substring(0, 300));
      results.push({ name: form.name, id: formId, status: 'MARKUP_FAILED' });
    }
  }

  console.log('\n=== SUMMARY ===');
  for (const r of results) {
    const icon = r.status === 'OK' ? '✓' : '✗';
    const accessLabel = r.access === 5 ? '(public)' : '(admin)';
    console.log(`${icon} ${r.name} ${accessLabel} - ${r.status} ${r.id ? '['+ r.id + ']' : ''}`);
  }
  console.log('\nAdmin forms: /dynamic/A.Test/<form-name>');
  console.log('Public forms: /no-auth/A.Test/<form-name>');
}

main().catch(e => { console.error(e); process.exit(1); });
