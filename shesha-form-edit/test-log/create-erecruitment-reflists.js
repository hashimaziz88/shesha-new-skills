const http = require('http');

const BASE = 'localhost';
const PORT = 21021;
const MODULE_ID = 'aabe5e0e-faaf-4167-bf25-af87fc7f0f0e';

const REFLISTS = [
  {
    name: 'JobPostingStatus',
    label: 'Job Posting Status',
    items: [
      { itemValue: 1, item: 'Draft', orderIndex: 1 },
      { itemValue: 2, item: 'Active', orderIndex: 2 },
      { itemValue: 3, item: 'Closed', orderIndex: 3 }
    ]
  },
  {
    name: 'ApplicationStatus',
    label: 'Application Status',
    items: [
      { itemValue: 1, item: 'Applied', orderIndex: 1 },
      { itemValue: 2, item: 'Invited to Interview', orderIndex: 2 },
      { itemValue: 3, item: 'Scheduled for Interview', orderIndex: 3 },
      { itemValue: 4, item: 'Accepted', orderIndex: 4 },
      { itemValue: 5, item: 'Declined', orderIndex: 5 }
    ]
  },
  {
    name: 'InterviewType',
    label: 'Interview Type',
    items: [
      { itemValue: 1, item: 'Phone', orderIndex: 1 },
      { itemValue: 2, item: 'Video Call', orderIndex: 2 },
      { itemValue: 3, item: 'In-Person', orderIndex: 3 },
      { itemValue: 4, item: 'Panel', orderIndex: 4 }
    ]
  },
  {
    name: 'InterviewOutcome',
    label: 'Interview Outcome',
    items: [
      { itemValue: 1, item: 'Pending', orderIndex: 1 },
      { itemValue: 2, item: 'Passed', orderIndex: 2 },
      { itemValue: 3, item: 'Failed', orderIndex: 3 },
      { itemValue: 4, item: 'Deferred', orderIndex: 4 }
    ]
  },
  {
    name: 'JobLevel',
    label: 'Job Level',
    items: [
      { itemValue: 1, item: 'Junior', orderIndex: 1 },
      { itemValue: 2, item: 'Mid-Level', orderIndex: 2 },
      { itemValue: 3, item: 'Senior', orderIndex: 3 },
      { itemValue: 4, item: 'Management', orderIndex: 4 },
      { itemValue: 5, item: 'Executive', orderIndex: 5 }
    ]
  },
  {
    name: 'EmploymentType',
    label: 'Employment Type',
    items: [
      { itemValue: 1, item: 'Full-Time', orderIndex: 1 },
      { itemValue: 2, item: 'Part-Time', orderIndex: 2 },
      { itemValue: 3, item: 'Contract', orderIndex: 3 },
      { itemValue: 4, item: 'Internship', orderIndex: 4 },
      { itemValue: 5, item: 'Temporary', orderIndex: 5 }
    ]
  },
  {
    name: 'Race',
    label: 'Race',
    items: [
      { itemValue: 1, item: 'African', orderIndex: 1 },
      { itemValue: 2, item: 'Coloured', orderIndex: 2 },
      { itemValue: 3, item: 'Indian/Asian', orderIndex: 3 },
      { itemValue: 4, item: 'White', orderIndex: 4 },
      { itemValue: 5, item: 'Other', orderIndex: 5 }
    ]
  },
  {
    name: 'Gender',
    label: 'Gender',
    items: [
      { itemValue: 1, item: 'Male', orderIndex: 1 },
      { itemValue: 2, item: 'Female', orderIndex: 2 },
      { itemValue: 3, item: 'Non-Binary', orderIndex: 3 },
      { itemValue: 4, item: 'Prefer not to say', orderIndex: 4 }
    ]
  },
  {
    name: 'DisabilityStatus',
    label: 'Disability Status',
    items: [
      { itemValue: 1, item: 'Not Disabled', orderIndex: 1 },
      { itemValue: 2, item: 'Disabled', orderIndex: 2 },
      { itemValue: 3, item: 'Prefer not to say', orderIndex: 3 }
    ]
  }
];

function req(method, path, body, token) {
  return new Promise((resolve, reject) => {
    const bodyStr = body ? JSON.stringify(body) : '';
    const options = {
      hostname: BASE,
      port: PORT,
      path,
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
  const authRes = await req('POST', '/api/TokenAuth/Authenticate', { userNameOrEmailAddress: 'admin', password: '123qwe' });
  const token = authRes.body.result?.accessToken;
  if (!token) { console.error('Auth failed'); process.exit(1); }
  console.log('Token OK\n');

  // Check which ref lists already exist
  const existCheck = await req('GET', '/api/services/app/ReferenceList/GetAll?maxResultCount=200', {}, token);
  const existing = new Set();
  if (existCheck.status === 200 && existCheck.body.result?.items) {
    for (const rl of existCheck.body.result.items) {
      if (rl.module?.name === 'A.Test' || rl.moduleId === MODULE_ID) {
        existing.add(rl.name);
      }
    }
    console.log('Existing A.Test reflists:', [...existing].join(', ') || '(none)');
  } else {
    console.log('GetAll returned:', existCheck.status, '- will proceed to create');
  }

  for (const rl of REFLISTS) {
    if (existing.has(rl.name)) {
      console.log(`SKIP ${rl.name} (already exists)`);
      continue;
    }

    console.log(`Creating: ${rl.name}`);
    const createRes = await req('POST', '/api/services/app/ReferenceList/Create', {
      moduleId: MODULE_ID,
      name: rl.name,
      label: rl.label,
      description: `E-Recruitment: ${rl.label}`
    }, token);

    if (createRes.status !== 200 || !createRes.body.result?.id) {
      console.error(`  FAILED (${createRes.status}):`, JSON.stringify(createRes.body).substring(0, 200));
      continue;
    }

    const rlId = createRes.body.result.id;
    console.log(`  Created id: ${rlId}`);

    // Create items
    let itemOk = 0;
    for (const item of rl.items) {
      const itemRes = await req('POST', '/api/services/app/ReferenceListItem/Create', {
        referenceListId: rlId,
        item: item.item,
        itemValue: item.itemValue,
        orderIndex: item.orderIndex
      }, token);
      if (itemRes.status === 200 && itemRes.body.result?.id) {
        itemOk++;
      } else {
        console.error(`  Item "${item.item}" FAILED:`, JSON.stringify(itemRes.body).substring(0, 150));
      }
    }
    console.log(`  Items created: ${itemOk}/${rl.items.length}`);

    // Mark as Live
    if (createRes.body.result?.id) {
      const liveRes = await req('POST', `/api/services/app/ReferenceList/SetStatus?id=${rlId}&status=Live`, {}, token);
      if (liveRes.status === 200) {
        console.log(`  Status: Live`);
      }
    }
  }

  console.log('\nDone!');
}

main().catch(e => { console.error(e); process.exit(1); });
