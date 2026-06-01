import { auth, loadSeed, transformDetail, stampTree, getOrCreate, push } from './seed-build.mjs';
const ENTITY = 'A.Test.Domain.Domain.Payroll.PayGrade';
const token = await auth();
const seed = loadSeed('employee-detail-without-child-tables.json');
let detail = transformDetail(seed, {
  entityFull: ENTITY, title: "Pay Grade Details",
  fields: [
    { prop: 'name',          label: 'Name',           type: 'textField' },
    { prop: 'description',   label: 'Description',     type: 'textField' },
    { prop: 'minSalary',     label: 'Min Salary',      type: 'numberField' },
    { prop: 'maxSalary',     label: 'Max Salary',      type: 'numberField' },
    { prop: 'stepIncrement', label: 'Step Increment',  type: 'numberField' }
  ]
});
detail.components = stampTree(detail.components, 'root');
const id = await getOrCreate(token, 'paygrade-detail', 'Pay Grade - Detail', ENTITY);
await push(token, id, detail);
console.log('paygrade-detail pushed', id);
