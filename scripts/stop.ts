import {readFile} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {resolve} from 'node:path';
const root=resolve(fileURLToPath(new URL('..',import.meta.url)));
for(const name of ['server','appium','launcher']){
  try{const pid=Number((await readFile(`${root}/runtime/${name}.pid`,'utf8')).trim());if(!Number.isInteger(pid)||pid<=1)continue;const command=execFileSync('ps',['-p',String(pid),'-o','command='],{encoding:'utf8'}).trim();if(!command){console.log(`${name}: no running owned process.`);continue;}if(!command.includes(root)||!(name==='server'?command.includes('apps/server/server.ts'):name==='appium'?command.includes('appium/index.js'):command.includes('scripts/start.ts'))){console.error(`${name}: process identity does not match Glassport; left running.`);continue;}process.kill(pid,'SIGTERM');console.log(`${name}: stopped owned process ${pid}.`);}catch(error){console.log(`${name}: no running owned process.`);}
}
