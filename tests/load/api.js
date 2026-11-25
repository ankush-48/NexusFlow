import http from 'k6/http';
import { check } from 'k6';
import { SharedArray } from 'k6/data';

const origin=__ENV.NEXUS_URL || 'http://localhost:3000';
const credentials=new SharedArray('credentials',()=>{
  if (!__ENV.NEXUS_EMAIL || !__ENV.NEXUS_PASSWORD) throw new Error('Set demo credentials in the environment.');
  return [{email:__ENV.NEXUS_EMAIL,password:__ENV.NEXUS_PASSWORD}];
});
export const options={scenarios:{snapshots:{executor:'constant-vus',vus:Number(__ENV.VUS||10),duration:__ENV.DURATION||'30s'}},thresholds:{checks:['rate>0.99'],'http_req_failed{operation:snapshot}':['rate<0.01']}};

export function setup() {
  const login=http.post(origin+'/api/auth/login',JSON.stringify(credentials[0]),{headers:{'Content-Type':'application/json'}});
  if (login.status!==200) throw new Error('Login failed with HTTP '+login.status);
  const access=login.cookies.nf_access?.[0]?.value;
  const orgs=http.get(origin+'/api/orgs',{headers:{Cookie:'nf_access='+access}});
  if (orgs.status!==200 || !orgs.json()[0]) throw new Error('No test workspace available.');
  return {access,org:orgs.json()[0].id};
}

export default function ({access,org}) {
  const response=http.get(origin+'/api/orgs/'+org+'/snapshot',{headers:{Cookie:'nf_access='+access},tags:{operation:'snapshot'}});
  check(response,{'snapshot status is 200':result=>result.status===200});
}
