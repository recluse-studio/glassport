import test from 'node:test';import assert from 'node:assert/strict';import {randomUUID} from 'node:crypto';import http from 'node:http';
const origin='http://127.0.0.1:43180';
test('Actual loopback service rejects missing sessions, forged origins/Host and missing CSRF before device dispatch',async()=>{
  const unauth=await fetch(origin+'/api/state');assert.equal(unauth.status,401);
  const host=await new Promise<number|undefined>((resolve,reject)=>{const req=http.get(origin+'/',{headers:{Host:'evil.example'}},res=>{res.resume();resolve(res.statusCode);});req.on('error',reject);});assert.equal(host,403);
  const page=await fetch(origin+'/');assert.equal(page.status,200);assert.match(await page.text(),/<title>Glassport<\/title>/);
  const cookie=page.headers.get('set-cookie')!.split(';')[0];const client=randomUUID();const headers={'Cookie':cookie,'X-Glassport-Client':client};
  const bootstrap=await fetch(origin+'/api/bootstrap',{headers});const auth=await bootstrap.json() as any;assert.ok(auth.csrf);
  const forged=await fetch(origin+'/api/connect',{method:'POST',headers:{...headers,Origin:'https://evil.example','X-Glassport-CSRF':auth.csrf},body:'{}'});assert.equal(forged.status,403);
  const noCsrf=await fetch(origin+'/api/connect',{method:'POST',headers:{...headers,Origin:origin},body:'{}'});assert.equal(noCsrf.status,403);
  const invalid=await fetch(origin+'/api/connect',{method:'POST',headers:{...headers,Origin:origin,'X-Glassport-CSRF':auth.csrf},body:JSON.stringify({device_ref:'not-a-real-device'})});assert.equal(invalid.status,409);assert.equal((await invalid.json() as any).error.code,'DEVICE_UNAVAILABLE');
  const diagnostics=await fetch(origin+'/api/diagnostics',{headers});const receipt=await diagnostics.json() as any;assert.equal(receipt.application,'Glassport');assert.equal(receipt.mock_adapter,false);assert.equal(receipt.adapter,'native_coredevice');assert.equal(receipt.adapter_status,'UNAVAILABLE');
});
