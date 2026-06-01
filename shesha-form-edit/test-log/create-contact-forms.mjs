import { randomUUID } from 'crypto';

const BASE_URL = 'http://localhost:21021';
const MODULE_ID = '4817b124-8749-4d04-a96d-8cc6a5f19097'; // A.Test
// CORRECT modelType — verified from existing Shesha system forms (users form uses Shesha.Core.Person)
const PERSON_MODEL = 'Shesha.Core.Person';

async function auth() {
  const r = await fetch(`${BASE_URL}/api/TokenAuth/Authenticate`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ userNameOrEmailAddress: 'admin', password: '123qwe' })
  });
  const d = await r.json();
  return d.result.accessToken;
}

function stampTree(nodes, parentId) {
  return nodes.map(node => {
    if (!node?.type) return { ...node, components: stampTree(node.components || [], parentId) };
    const n = { ...node, parentId };
    if (n.components) n.components = stampTree(n.components, node.id);
    if (n.columns)    n.columns    = stampTree(n.columns,    node.id);
    if (n.tabs)       n.tabs       = n.tabs.map(t => ({ ...t, components: stampTree(t.components || [], node.id) }));
    return n;
  });
}

async function getOrCreateForm(token, name, label, modelType) {
  const existing = await fetch(
    `${BASE_URL}/api/services/Shesha/FormConfiguration/GetByName?module=A.Test&name=${name}`,
    { headers: { Authorization: `Bearer ${token}` } }
  );
  const ed = await existing.json();
  if (ed.result?.id) {
    console.log(`  ${name} exists — reusing ${ed.result.id}`);
    return ed.result.id;
  }
  const r = await fetch(`${BASE_URL}/api/services/Shesha/FormConfiguration/Create`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ moduleId: MODULE_ID, name, label, modelType })
  });
  const d = await r.json();
  if (!d.result?.id) throw new Error(`Create failed for ${name}: ${JSON.stringify(d.error)}`);
  console.log(`  Created ${name}: ${d.result.id}`);
  return d.result.id;
}

async function updateMarkup(token, id, markup) {
  const body = JSON.stringify({ id, markup: JSON.stringify(markup) });
  const r = await fetch(`${BASE_URL}/api/services/Shesha/FormConfiguration/UpdateMarkup`, {
    method: 'PUT', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body
  });
  const d = await r.json();
  if (!d.success) throw new Error(`UpdateMarkup failed: ${JSON.stringify(d.error)}`);
  console.log(`  Markup OK`);
}

// ── contacts-table ────────────────────────────────────────────────────────────
function buildContactsTable() {
  const rootId  = randomUUID();
  const dcId    = randomUUID();
  const toolId  = randomUUID();
  const searchId= randomUUID();
  const tableId = randomUUID();
  const pagerId = randomUUID();

  return {
    formSettings: {
      modelType: PERSON_MODEL,
      dataLoaderType: 'None',
      access: 3, version: 1
    },
    components: stampTree([{
      id: rootId, type: 'container', name: 'root',
      display: 'flex', flexDirection: 'column', gap: 0,
      components: [{
        id: dcId, type: 'datatableContext', name: 'contactsContext',
        // datatableContext MUST have explicit entityType + sourceType — does NOT inherit from formSettings
        entityType: PERSON_MODEL,
        sourceType: 'Entity',
        dataFetchingMode: 'paging',
        defaultPageSize: 10,
        uniqueStateId: 'contactsContext',
        componentName: 'contactsContext',
        propertyName: 'contactsContext',
        sortMode: 'standard',
        allowReordering: 'no',
        standardSorting: [{ id: randomUUID(), propertyName: 'firstName', sorting: 'asc' }],
        components: [
          {
            id: toolId, type: 'container', name: 'toolbar',
            display: 'flex', flexDirection: 'row', justifyContent: 'space-between', gap: 8,
            components: [
              { id: searchId, type: 'datatable.quickSearch', name: 'quickSearch', block: true }
            ]
          },
          {
            id: tableId, type: 'datatable', name: 'contactsTable',
            striped: true, rowDividers: true, hoverHighlight: true,
            items: [
              { id: randomUUID(), itemType: 'item', sortOrder: 0, caption: 'Full Name',    columnType: 'data', propertyName: 'fullName',     isVisible: true },
              { id: randomUUID(), itemType: 'item', sortOrder: 1, caption: 'Email',        columnType: 'data', propertyName: 'emailAddress1', isVisible: true },
              { id: randomUUID(), itemType: 'item', sortOrder: 2, caption: 'Mobile',       columnType: 'data', propertyName: 'mobileNumber1', isVisible: true },
              {
                id: randomUUID(), itemType: 'item', sortOrder: 3, caption: '',
                columnType: 'action', isVisible: true, minWidth: 30, icon: 'EditOutlined',
                action: 'navigate',
                targetUrl: '/dynamic/a.test/contact-detail?id={{selectedRow.id}}'
              }
            ]
          },
          { id: pagerId, type: 'datatable.pager', name: 'pager', showTotalItems: true, showSizeChanger: true }
        ]
      }]
    }], 'root')
  };
}

// ── contact-detail ────────────────────────────────────────────────────────────
function buildContactDetail() {
  const rootId   = randomUUID();
  const headerId = randomUUID();
  const backId   = randomUUID();
  const titleId  = randomUUID();
  const bodyId   = randomUUID();
  const footerId = randomUUID();
  const saveId   = randomUUID();

  const tf = (prop, label) => ({
    id: randomUUID(), type: 'textField',
    name: prop, label, propertyName: prop, editMode: 'inherited'
  });

  return {
    formSettings: {
      modelType: PERSON_MODEL,
      dataLoaderType: 'gql',
      dataSubmitterType: 'gql',
      layout: 'horizontal',
      labelCol: { span: 6 }, wrapperCol: { span: 18 },
      access: 3, version: 1,
      dataLoadersSettings:    { gql: { endpointType: 'default' } },
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
              buttonType: 'default', icon: 'ArrowLeftOutlined',
              actionConfiguration: {
                actionName: 'Navigate', actionOwner: 'shesha.common',
                actionArguments: { target: '/dynamic/a.test/contacts-table' }
              }
            },
            { id: titleId, type: 'text', name: 'pageTitle', content: 'Contact Detail', fontSize: 20, fontWeight: 'bold' }
          ]
        },
        {
          id: bodyId, type: 'container', name: 'body',
          display: 'flex', flexDirection: 'column', gap: 0,
          components: [
            tf('firstName',     'First Name'),
            tf('lastName',      'Last Name'),
            tf('emailAddress1', 'Email'),
            tf('mobileNumber1', 'Mobile'),
            tf('homeNumber',    'Home Phone'),
            tf('identityNumber','ID Number')
          ]
        },
        {
          id: footerId, type: 'container', name: 'footer',
          display: 'flex', flexDirection: 'row', justifyContent: 'flex-end', gap: 8,
          components: [{
            id: saveId, type: 'button', name: 'save', label: 'Save',
            buttonType: 'primary', icon: 'SaveOutlined',
            actionConfiguration: { actionName: 'Submit', actionOwner: 'shesha.form', actionArguments: {} }
          }]
        }
      ]
    }], 'root')
  };
}

// ── main ──────────────────────────────────────────────────────────────────────
const token = await auth();
console.log('Authenticated');

console.log('\nCreating contacts-table...');
const tid = await getOrCreateForm(token, 'contacts-table', 'Contacts - Table', PERSON_MODEL);
await updateMarkup(token, tid, buildContactsTable());

console.log('\nCreating contact-detail...');
const did = await getOrCreateForm(token, 'contact-detail', 'Contact - Detail', PERSON_MODEL);
await updateMarkup(token, did, buildContactDetail());

console.log('\nDone.');
console.log('  http://localhost:3000/dynamic/a.test/contacts-table');
console.log('  http://localhost:3000/dynamic/a.test/contact-detail');
