import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import net from 'node:net';
import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {once} from 'node:events';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const temp=fs.mkdtempSync(path.join(os.tmpdir(),'supercomputer-original-test-'));
const socket=net.createServer();socket.listen(0,'127.0.0.1');await once(socket,'listening');
const port=socket.address().port;await new Promise(resolve=>socket.close(resolve));
const data=path.join(temp,'data'),pipeline=path.join(temp,'pipeline');
const child=spawn(process.execPath,['scripts/start.mjs','--no-open'],{
  cwd:root,windowsHide:true,stdio:['ignore','pipe','pipe'],
  env:{...process.env,SUPACOMPUTA_HOME:data,SUPACOMPUTA_PIPELINE:pipeline,SUPACOMPUTA_PORT:String(port),SUPACOMPUTA_FRIENDLY_PORT:'0',CLAUDE_CONFIG_DIR:path.join(temp,'claude')}
});
let log='';child.stdout.on('data',d=>log+=d);child.stderr.on('data',d=>log+=d);
const base=`http://127.0.0.1:${port}`;
async function api(route,method='GET',body){
  const r=await fetch(base+route,{method,headers:body?{'Content-Type':'application/json'}:{},body:body?JSON.stringify(body):undefined,signal:AbortSignal.timeout(5000)});
  assert.ok(r.ok,`${method} ${route}: ${r.status}`);return r.json();
}
try{
  let ready=false;
  for(let i=0;i<50;i++){
    if(child.exitCode!==null)throw new Error(`Server exited: ${log}`);
    try{await api('/api/chats');ready=true;break}catch{}
    await new Promise(r=>setTimeout(r,100));
  }
  assert.ok(ready,`Server did not start: ${log}`);
  assert.deepEqual(await api('/api/chats'),[]);
  const html=await (await fetch(base+'/')).text();assert.ok(html.includes('Supercomputer'));
  const appJs=await (await fetch(base+'/app.js')).text();assert.ok(appJs.includes('bl_open'));
  assert.ok(fs.existsSync(path.join(pipeline,'MAIN.md')));
  const connections=await api('/api/connections');assert.ok(JSON.stringify(connections).includes('Blender'));
  assert.equal((await api('/api/blender/test')).open,false);
  const c=await api('/api/chats','POST',{});assert.ok(c.id);
  const chat=await api(`/api/chats/${c.id}`);assert.equal(chat.title,'New chat');
  await api(`/api/chats/${c.id}`,'PATCH',{title:'Renamed smoke test',pinned:true});
  assert.equal((await api('/api/chats'))[0].title,'Renamed smoke test');
  assert.ok(fs.existsSync(path.join(data,'chats',`${c.id}.json`)));
  await api(`/api/chats/${c.id}`,'DELETE');assert.deepEqual(await api('/api/chats'),[]);
  assert.ok(!fs.existsSync(path.join(data,'config.json')),'Test must not import private settings');
  console.log('PASS: clean startup, original UI, Blender routes, pipeline workspace, chat persistence and deletion, isolated data.');
}finally{
  if(child.exitCode===null){child.kill();await Promise.race([once(child,'exit'),new Promise(r=>setTimeout(r,5000))]);}
  // Only remove the freshly created, resolved temporary test directory.
  const resolved=fs.realpathSync(temp),parent=fs.realpathSync(os.tmpdir());
  assert.equal(path.dirname(resolved),parent);
  assert.ok(path.basename(resolved).startsWith('supercomputer-original-test-'));
  fs.rmSync(resolved,{recursive:true,force:true});
}
