import { auth, loadSeed, transformTable, transformCreate, stampTree, getOrCreate, push } from './seed-build.mjs';

const ENTITY = 'A.Test.Domain.Domain.Payroll.PayGrade';
const token = await auth();
console.log('Authenticated');

// ── Table (copy example-employee-table) ──
const tableSeed = loadSeed('employee-table.json');
let table = transformTable(tableSeed, {
  entityFull: ENTITY,
  createFormName: 'paygrade-create',
  columns: [
    { prop: 'name',          caption: 'Name' },
    { prop: 'description',   caption: 'Description' },
    { prop: 'minSalary',     caption: 'Min Salary' },
    { prop: 'maxSalary',     caption: 'Max Salary' },
    { prop: 'stepIncrement', caption: 'Step Increment' }
  ]
});
table.components = stampTree(table.components, 'root');
const tableId = await getOrCreate(token, 'paygrade-table', 'Pay Grades', ENTITY);
await push(token, tableId, table);
console.log('paygrade-table pushed', tableId);

// ── Create (copy example-employee-create) ──
const createSeed = loadSeed('employee-create.json');
let create = transformCreate(createSeed, {
  entityFull: ENTITY,
  fields: [
    { prop: 'name',          label: 'Name',           type: 'textField' },
    { prop: 'description',   label: 'Description',     type: 'textField' },
    { prop: 'minSalary',     label: 'Min Salary',      type: 'numberField' },
    { prop: 'maxSalary',     label: 'Max Salary',      type: 'numberField' },
    { prop: 'stepIncrement', label: 'Step Increment',  type: 'numberField' }
  ]
});
create.components = stampTree(create.components, 'root');
const createId = await getOrCreate(token, 'paygrade-create', 'Pay Grade - Create', ENTITY);
await push(token, createId, create);
console.log('paygrade-create pushed', createId);

console.log('\nDone.');
console.log('  http://localhost:3000/dynamic/a.test/paygrade-table');
