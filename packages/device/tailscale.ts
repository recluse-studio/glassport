import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {readFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {deviceRef} from './discovery.ts';
const run=promisify(execFile);
const binary='/Applications/Tailscale.app/Contents/MacOS/Tailscale';
export async function discoverTailnet(){
  try{
    const {stdout}=await run(binary,['status','--json'],{timeout:8000,maxBuffer:2*1024*1024});
    const status=JSON.parse(stdout);let confirmed:any[]=[];try{confirmed=JSON.parse(await readFile(new URL('../../runtime/tailnet-devices.json',import.meta.url),'utf8')).devices??[];}catch{}
    const candidates=Object.values(status.Peer??{}).filter((p:any)=>/^(ios|ipados)$/i.test(p.OS??'')).map((p:any)=>{const identity=confirmed.find(d=>p.TailscaleIPs?.includes(d.address));return ({
      peer_ref:deviceRef(String(p.ID??p.PublicKey)),configured_network_address:identity?.address??null,name:identity?.name??String(p.HostName??'Apple mobile device'),dns_name:String(p.DNSName??'').replace(/\.$/,''),
      os:String(p.OS),online:p.Online===true,key_expired:p.Expired===true||(p.KeyExpiry&&Date.parse(p.KeyExpiry)<Date.now()),last_seen:p.LastSeen??null,
      device_identity:identity?.device_class==='iPad'?'USER_CONFIRMED_IPAD':'UNCONFIRMED',control_status:'HELPER_NOT_VERIFIED'
    });});
    return {backend:String(status.BackendState??'Unknown'),self_online:status.Self?.Online===true,candidates,error:null};
  }catch{return {backend:'Unavailable',self_online:false,candidates:[],error:'Tailscale status could not be read. Start the installed Tailscale application and connect the iPad.'};}
}
