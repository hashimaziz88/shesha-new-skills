import { randomUUID } from 'crypto';

const BASE_URL   = 'http://localhost:21021';
const MODULE     = 'A.Test';
const MODULE_ID  = '4817b124-8749-4d04-a96d-8cc6a5f19097';

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

async function getFormId(token, name) {
  const r = await fetch(`${BASE_URL}/api/services/Shesha/FormConfiguration/GetByName?module=${MODULE}&name=${name}`,
    { headers: { Authorization: `Bearer ${token}` } });
  return (await r.json()).result?.id;
}

async function createForm(token, name, label, modelType) {
  let id = await getFormId(token, name);
  if (!id) {
    const r = await fetch(`${BASE_URL}/api/services/Shesha/FormConfiguration/Create`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ moduleId: MODULE_ID, name, label, modelType })
    });
    id = (await r.json()).result?.id;
    if (!id) throw new Error(`Create failed for ${name}`);
  }
  return id;
}

async function pushMarkup(token, id, markup) {
  const r = await fetch(`${BASE_URL}/api/services/Shesha/FormConfiguration/UpdateMarkup`, {
    method: 'PUT', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ id, markup: JSON.stringify(markup) })
  });
  const d = await r.json();
  if (!d.success) throw new Error(JSON.stringify(d.error));
}

// ── Generic table form builder ────────────────────────────────────────────────
function buildTableForm(entityType, columns, detailFormName) {
  const rootId  = randomUUID();
  const dcId    = randomUUID();
  const toolId  = randomUUID();
  const searchId= randomUUID();
  const tableId = randomUUID();
  const pagerId = randomUUID();
  const modName = entityType.split('.').pop();

  const actionCol = {
    id: randomUUID(), itemType: 'item', sortOrder: columns.length,
    caption: '', columnType: 'action', isVisible: true, minWidth: 30,
    icon: 'EditOutlined', action: 'navigate',
    targetUrl: `/dynamic/a.test/${detailFormName}?id={{selectedRow.id}}`
  };

  return {
    formSettings: { modelType: entityType, dataLoaderType: 'None', access: 3, version: 1 },
    components: stampTree([{
      id: rootId, type: 'container', name: 'root',
      display: 'flex', flexDirection: 'column', gap: 0,
      components: [{
        id: dcId, type: 'datatableContext', name: `${modName}Context`,
        entityType, sourceType: 'Entity',
        dataFetchingMode: 'paging', defaultPageSize: 10,
        uniqueStateId: `${modName}Table`, componentName: `${modName}Table`,
        propertyName: `${modName}Table`,
        sortMode: 'standard', allowReordering: 'no',
        components: [
          {
            id: toolId, type: 'container', name: 'toolbar',
            display: 'flex', flexDirection: 'row', justifyContent: 'space-between', gap: 8,
            components: [{ id: searchId, type: 'datatable.quickSearch', name: 'quickSearch', block: true }]
          },
          {
            id: tableId, type: 'datatable', name: `${modName}Table`,
            striped: true, rowDividers: true, hoverHighlight: true,
            items: [
              ...columns.map((c, i) => ({
                id: randomUUID(), itemType: 'item', sortOrder: i, caption: c.caption,
                columnType: 'data', propertyName: c.prop, isVisible: true
              })),
              actionCol
            ]
          },
          { id: pagerId, type: 'datatable.pager', name: 'pager', showTotalItems: true, showSizeChanger: true }
        ]
      }]
    }], 'root')
  };
}

const FORMS = [
  {
    name: 'employees',    label: 'Employees',
    entity: 'A.Test.Domain.Domain.Payroll.Employee',
    cols: [{ caption: 'First Name', prop: 'firstName' }, { caption: 'Last Name', prop: 'lastName' }, { caption: 'Email', prop: 'emailAddress1' }],
    detail: 'employee-details'
  },
  {
    name: 'payroll-runs', label: 'Payroll Runs',
    entity: 'A.Test.Domain.Domain.Payroll.PayrollRun',
    cols: [{ caption: 'Name', prop: 'name' }, { caption: 'Status', prop: 'status' }, { caption: 'Period', prop: 'payPeriodStartDate' }],
    detail: 'payroll-run-details'
  },
  {
    name: 'pay-grades',   label: 'Pay Grades',
    entity: 'A.Test.Domain.Domain.Payroll.PayGrade',
    cols: [{ caption: 'Name', prop: 'name' }, { caption: 'Description', prop: 'description' }],
    detail: 'pay-grade-details'
  },
  {
    name: 'deduction-types', label: 'Deduction Types',
    entity: 'A.Test.Domain.Domain.Payroll.DeductionType',
    cols: [{ caption: 'Name', prop: 'name' }, { caption: 'Description', prop: 'description' }],
    detail: 'deduction-type-details'
  },
  {
    name: 'allowance-types', label: 'Allowance Types',
    entity: 'A.Test.Domain.Domain.Payroll.AllowanceType',
    cols: [{ caption: 'Name', prop: 'name' }, { caption: 'Description', prop: 'description' }],
    detail: 'allowance-type-details'
  }
];

const token = await auth();
console.log('Authenticated\n');

for (const f of FORMS) {
  process.stdout.write(`Rebuilding ${f.name}...`);
  try {
    const id = await createForm(token, f.name, f.label, f.entity);
    const markup = buildTableForm(f.entity, f.cols, f.detail);
    await pushMarkup(token, id, markup);
    console.log(' OK');
  } catch (e) {
    console.log(' FAILED:', e.message.slice(0, 80));
  }
}
console.log('\nAll done.');
