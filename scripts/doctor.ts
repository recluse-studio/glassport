import {discoverTailnet} from '../packages/device/tailscale.ts';
import {discover,publicDevice} from '../packages/device/discovery.ts';
import {fileURLToPath} from 'node:url';
import {resolve} from 'node:path';
const root=resolve(fileURLToPath(new URL('..',import.meta.url)));
let localService:unknown={state:'Unavailable',listener:'http://127.0.0.1:43180'};try{const response=await fetch('http://127.0.0.1:43180/health',{signal:AbortSignal.timeout(3000)});if(response.ok){const value=await response.json();if(value.application==='Glassport')localService={state:'Available',...value};}}catch{}
let appium='Unavailable';try{const response=await fetch('http://127.0.0.1:4723/status',{signal:AbortSignal.timeout(3000)});if(response.ok)appium='Available';}catch{}
console.log(JSON.stringify({application:'Glassport',version:'0.1.0',root,node:process.version,localService,historical_appium:appium,devices:(await discover(root)).map(publicDevice),tailnet:await discoverTailnet(),mock_adapter:false},null,2));
