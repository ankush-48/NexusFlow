import http from 'k6/http';
import ws from 'k6/ws';
import { check } from 'k6';
const base=__ENV.NEXUS_URL||'http://localhost:3000';
export const options={vus:Number(__ENV.VUS||10),duration:__ENV.DURATION||'20s'};

export function setup() {
  const login=http.post(base+'/api/auth/login',JSON.stringify({email:__ENV.NEXUS_EMAIL,password:__ENV.NEXUS_PASSWORD}),{headers:{'Content-Type':'application/json'}});
  if (login.status!==200) throw new Error('Login failed with HTTP '+login.status);
  const access=login.cookies.nf_access[0].value;
  const result=http.get(base+'/api/orgs',{headers:{Cookie:'nf_access='+access}});
  const org=result.json()[0].id;
  return {access,org};
}

export default function ({access,org}) {
  const url=base.replace(/^http/,'ws')+'/socket.io/?EIO=4&transport=websocket';
  const result=ws.connect(url,{headers:{Cookie:'nf_access='+access,Origin:base}},socket=>{
    socket.on('message',data=>{
      if (data.startsWith('0')) socket.send('40');
      if (data.startsWith('40')) socket.send('420'+JSON.stringify(['workspace.join',org]));
      if (data.startsWith('430')) check(data,{'workspace join acknowledged':packet=>packet.includes('"ok":true')});
      if (data==='2') socket.send('3');
    });
    socket.setTimeout(()=>socket.close(),3500);
  });
  check(result,{'WebSocket upgrade succeeded':item=>item&&item.status===101});
}
