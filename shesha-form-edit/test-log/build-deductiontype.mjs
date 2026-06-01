import { auth, loadSeed, transformTable, transformCreate, transformDetail, stampTree, getOrCreate, push } from './seed-build.mjs';
const ENTITY = 'A.Test.Domain.Domain.Payroll.DeductionType';
const token = await auth();

const fields = [
  { prop: 'name',            label: 'Name',             type: 'textField' },
  { prop: 'description',     label: 'Description',      type: 'textField' },
  { prop: 'calculationType', label: 'Calculation Type', type: 'dropdown', reflist: { module: 'A.Test', name: 'A.Test.DeductionCalculationType' } },
  { prop: 'rate',            label: 'Rate',             type: 'numberField' },
  { prop: 'isMandatory',     label: 'Is Mandatory',     type: 'checkbox' }
];
const columns = [
  { prop: 'name', caption: 'Name' },
  { prop: 'description', caption: 'Description' },
  { prop: 'rate', caption: 'Rate' }
];

const table = transformTable(loadSeed('employee-table.json'), { entityFull: ENTITY, createFormName: 'deductiontype-create', columns });
table.components = stampTree(table.components, 'root');
await push(token, await getOrCreate(token, 'deductiontype-table', 'Deduction Types', ENTITY), table);
console.log('deductiontype-table OK');

const create = transformCreate(loadSeed('employee-create.json'), { entityFull: ENTITY, fields });
create.components = stampTree(create.components, 'root');
await push(token, await getOrCreate(token, 'deductiontype-create', 'Deduction Type - Create', ENTITY), create);
console.log('deductiontype-create OK');

const detail = transformDetail(loadSeed('employee-detail-without-child-tables.json'), { entityFull: ENTITY, title: 'Deduction Type Details', fields });
detail.components = stampTree(detail.components, 'root');
await push(token, await getOrCreate(token, 'deductiontype-detail', 'Deduction Type - Detail', ENTITY), detail);
console.log('deductiontype-detail OK');
