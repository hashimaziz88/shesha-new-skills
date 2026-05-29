import { auth, loadSeed, transformDetailWithChild, stampTree, getOrCreate, push } from './seed-build.mjs';
const PAYGRADE = 'A.Test.Domain.Domain.Payroll.PayGrade';
const EMPLOYEE = 'A.Test.Domain.Domain.Payroll.Employee';
const token = await auth();
const seed = loadSeed('employee-detail-with-child-tables.json');
let form = transformDetailWithChild(seed, {
  entityFull: PAYGRADE,
  title: 'Pay Grade Details',
  fields: [
    { prop: 'name', label: 'Name', type: 'textField' },
    { prop: 'description', label: 'Description', type: 'textField' },
    { prop: 'minSalary', label: 'Min Salary', type: 'numberField' },
    { prop: 'maxSalary', label: 'Max Salary', type: 'numberField' },
    { prop: 'stepIncrement', label: 'Step Increment', type: 'numberField' }
  ],
  child: {
    entityFull: EMPLOYEE,
    fkProperty: 'payGrade',
    tabTitle: 'Employees',
    columns: [
      { prop: 'employeeNumber', caption: 'Employee Number' },
      { prop: 'firstName', caption: 'First Name' },
      { prop: 'lastName', caption: 'Last Name' }
    ]
  }
});
form.components = stampTree(form.components, 'root');
const id = await getOrCreate(token, 'paygrade-detail-with-employees', 'Pay Grade - Detail (with Employees)', PAYGRADE);
await push(token, id, form);
console.log('pushed', id);
