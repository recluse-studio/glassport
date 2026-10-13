import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {resolve} from 'node:path';
const require=createRequire(import.meta.url);
for(const location of ['root','appium-ios-device']){
 test(`Installed ${location} rejects the advisory input and preserves ordinary quoted arguments`,()=>{
  const dependencyRequire=location==='root'?require:createRequire(resolve(import.meta.dirname,'../node_modules/appium-ios-device/package.json'));
  const {quote,parse}=dependencyRequire('shell-quote');
  assert.throws(()=>quote(['echo','ok',{comment:'example'},'a\nid;#']),TypeError);
  assert.deepEqual(parse(quote(['a b','Unicode 😀',"single'quote"])),['a b','Unicode 😀',"single'quote"]);
 });
}
