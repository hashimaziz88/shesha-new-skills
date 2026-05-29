import { auth, push } from './seed-build.mjs';
const BASE='http://localhost:21021';
const token = await auth();
const r = await fetch(`${BASE}/api/services/Shesha/FormConfiguration/GetByName?module=A.Test&name=paygrade-table`,{headers:{Authorization:`Bearer ${token}`}});
const form = (await r.json()).result;
const markup = JSON.parse(form.markup);
// find dataContext id + Add button
let dcId=null;
function walk(nodes){ for(const c of nodes||[]){ if(!c||typeof c!=='object')continue;
  if(c.type==='dataContext') dcId=c.id;
  walk(c.components); if(c.columns)for(const col of c.columns)walk(col.components);
}}
walk(markup.components);
function patchAdd(nodes){ for(const c of nodes||[]){ if(!c||typeof c!=='object')continue;
  if(c.type==='buttonGroup'&&Array.isArray(c.items)) for(const it of c.items){
    if(it.actionConfiguration?.actionName==='Show Dialog'){
      it.actionConfiguration.handleSuccess=true;
      it.actionConfiguration.onSuccess={_type:'action-config',actionName:'Refresh table',actionOwner:dcId,actionArguments:{}};
    }
  }
  patchAdd(c.components); if(c.columns)for(const col of c.columns)patchAdd(col.components);
}}
patchAdd(markup.components);
await push(token, form.id, markup);
console.log('patched Add button: handleSuccess=true, onSuccess=Refresh table owner='+dcId);
