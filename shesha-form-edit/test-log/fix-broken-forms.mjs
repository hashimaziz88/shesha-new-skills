import { randomUUID } from 'crypto';

const BASE_URL = 'http://localhost:21021';
const MODULE_ID = '4817b124-8749-4d04-a96d-8cc6a5f19097';

async function auth() {
  const r = await fetch(`${BASE_URL}/api/TokenAuth/Authenticate`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ userNameOrEmailAddress: 'admin', password: '123qwe' })
  });
  return (await r.json()).result.accessToken;
}

function stampTree(nodes, parentId) {
  return nodes.map(node => {
    if (!node?.type) return { ...node, components: stampTree(node.components || [], parentId) };
    const n = { ...node, parentId };
    if (n.components) n.components = stampTree(n.components, node.id);
    if (n.columns)    n.columns    = stampTree(n.columns, node.id);
    return n;
  });
}

async function getFormId(token, module, name) {
  const r = await fetch(`${BASE_URL}/api/services/Shesha/FormConfiguration/GetByName?module=${module}&name=${name}`,
    { headers: { Authorization: `Bearer ${token}` } });
  return (await r.json()).result?.id;
}

async function pushMarkup(token, id, markup) {
  const r = await fetch(`${BASE_URL}/api/services/Shesha/FormConfiguration/UpdateMarkup`, {
    method: 'PUT', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ id, markup: JSON.stringify(markup) })
  });
  const d = await r.json();
  if (!d.success) throw new Error(JSON.stringify(d.error));
  console.log(`  pushed ${id}`);
}

function navBtn(label, target, type = 'default') {
  return {
    id: randomUUID(), type: 'button', name: label.toLowerCase().replace(/\s+/g, '-'),
    label, buttonType: type, editMode: 'inherited',
    actionConfiguration: {
      actionOwner: 'shesha.common', actionName: 'Navigate',
      actionArguments: { target }
    }
  };
}

// ── Fix payroll-dashboard ─────────────────────────────────────────────────────
function buildPayrollDashboard() {
  const rootId = randomUUID();
  const colsId = randomUUID();
  const leftId = randomUUID();
  const rightId = randomUUID();
  const titleId = randomUUID();
  const subtitleId = randomUUID();

  return {
    formSettings: { modelType: null, access: 3, version: 1 },
    components: stampTree([{
      id: rootId, type: 'container', name: 'root',
      display: 'flex', flexDirection: 'column', gap: 24, noDefaultStyling: false,
      components: [
        {
          id: titleId, type: 'text', name: 'title',
          content: 'Payroll Dashboard', fontSize: 24, fontWeight: 'bold'
        },
        {
          id: subtitleId, type: 'text', name: 'subtitle',
          content: 'Manage employees, pay grades, allowances, deductions, and payroll runs.'
        },
        {
          id: colsId, type: 'container', name: 'nav',
          display: 'flex', flexDirection: 'row', gap: 12, flexWrap: 'wrap',
          components: [
            navBtn('Employees',    '/dynamic/a.test/employees',         'primary'),
            navBtn('Pay Grades',   '/dynamic/a.test/pay-grades',        'default'),
            navBtn('Allowances',   '/dynamic/a.test/allowance-types',   'default'),
            navBtn('Deductions',   '/dynamic/a.test/deduction-types',   'default'),
            navBtn('Payroll Runs', '/dynamic/a.test/payroll-runs',      'default')
          ]
        }
      ]
    }], 'root')
  };
}

// ── Fix employee-create ───────────────────────────────────────────────────────
function buildEmployeeCreate() {
  const rootId   = randomUUID();
  const headerId = randomUUID();
  const backId   = randomUUID();
  const titleId  = randomUUID();
  const bodyId   = randomUUID();
  const footerId = randomUUID();
  const saveId   = randomUUID();

  const MODEL = 'A.Test.Domain.Employees.Employee';

  const tf = (prop, label) => ({
    id: randomUUID(), type: 'textField',
    name: prop, label, propertyName: prop, editMode: 'inherited'
  });

  return {
    formSettings: {
      modelType: MODEL,
      dataLoaderType: 'gql',
      dataSubmitterType: 'gql',
      layout: 'horizontal',
      labelCol: { span: 6 }, wrapperCol: { span: 18 },
      access: 3, version: 1,
      dataLoadersSettings: { gql: { endpointType: 'default' } },
      dataSubmittersSettings: {
        gql: {
          excludeFormFields: true,
          endpointType: 'dynamic',
          dynamicEndpoint: 'return data && data.id ? form.defaultApiEndpoints.update : form.defaultApiEndpoints.create;'
        }
      }
    },
    components: stampTree([{
      id: rootId, type: 'container', name: 'root',
      display: 'flex', flexDirection: 'column', gap: 16,
      components: [
        {
          id: headerId, type: 'container', name: 'header',
          display: 'flex', flexDirection: 'row', alignItems: 'center', gap: 12,
          components: [
            {
              id: backId, type: 'button', name: 'back', label: 'Back',
              buttonType: 'default', editMode: 'inherited',
              actionConfiguration: {
                actionOwner: 'shesha.common', actionName: 'Navigate',
                actionArguments: { target: '/dynamic/a.test/employees' }
              }
            },
            { id: titleId, type: 'text', name: 'title', content: 'Employee', fontSize: 20, fontWeight: 'bold' }
          ]
        },
        {
          id: bodyId, type: 'container', name: 'body',
          display: 'flex', flexDirection: 'column', gap: 0,
          components: [
            tf('firstName', 'First Name'),
            tf('lastName',  'Last Name'),
            tf('emailAddress1', 'Email'),
            tf('mobileNumber1', 'Mobile')
          ]
        },
        {
          id: footerId, type: 'container', name: 'footer',
          display: 'flex', flexDirection: 'row', justifyContent: 'flex-end',
          components: [{
            id: saveId, type: 'button', name: 'save', label: 'Save',
            buttonType: 'primary', editMode: 'inherited',
            actionConfiguration: { actionOwner: 'shesha.form', actionName: 'Submit', actionArguments: {} }
          }]
        }
      ]
    }], 'root')
  };
}

const token = await auth();
console.log('Authenticated');

const dashId = await getFormId(token, 'A.Test', 'payroll-dashboard');
if (dashId) {
  console.log('\nFixing payroll-dashboard...');
  await pushMarkup(token, dashId, buildPayrollDashboard());
} else {
  console.log('payroll-dashboard not found');
}

const empCreateId = await getFormId(token, 'A.Test', 'employee-create');
if (empCreateId) {
  console.log('\nFixing employee-create...');
  await pushMarkup(token, empCreateId, buildEmployeeCreate());
} else {
  console.log('employee-create not found');
}

console.log('\nDone. Fixed broken forms.');
