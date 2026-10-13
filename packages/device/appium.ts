import {GlassportError} from '../contracts/core.ts';
import type {Rect,Action} from '../contracts/core.ts';
import type {Device} from './discovery.ts';
export class AppiumDevice {
  base:string; sessionId:string|null=null; device:Device|null=null;
  constructor(base='http://127.0.0.1:4723'){this.base=base.replace(/\/$/,'');}
  async request(path:string,method='GET',body?:unknown,timeout=15000):Promise<any>{
    let response:Response;
    try{response=await fetch(this.base+path,{method,headers:{'Content-Type':'application/json'},body:body===undefined?undefined:JSON.stringify(body),signal:AbortSignal.timeout(timeout)});}catch(error){throw new GlassportError('TRANSPORT_LOST','The device service is unreachable or its response timed out.',503);}
    const json=await response.json() as any;
    if(!response.ok||json.value?.error){const message=String(json.value?.message??'Device operation failed.');let code='DEVICE_OPERATION_FAILED';if(/license|agree.*Xcode/i.test(message))code='DEVELOPER_SETUP_REQUIRED';else if(/locked|passcode/i.test(message))code='DEVICE_LOCKED';else if(/sign|provision/i.test(message))code='SIGNING_INVALID';throw new GlassportError(code,code==='DEVELOPER_SETUP_REQUIRED'?'The selected native helper route is unavailable. Reassess its prerequisites against the current device-control specification.':code==='SIGNING_INVALID'?'The iPad helper signing or provisioning is invalid.':code==='DEVICE_LOCKED'?'Unlock the iPad to continue.':'The iPad rejected the operation. Review device setup and diagnostics.',503);}
    return json.value;
  }
  path(suffix:string){if(!this.sessionId)throw new GlassportError('SESSION_EXPIRED','Connect to an iPad first.',409);return `/session/${this.sessionId}${suffix}`;}
  async execute(name:string,args:Record<string,unknown>={}){return this.request(this.path('/execute/sync'),'POST',{script:`mobile: ${name}`,args:[args]});}
  async connect(device:Device){
    if(!device.privateIngressVerified)throw new GlassportError('DEVICE_INGRESS_REQUIRED','Configure and verify private control and media ingress for the iPad helper before connecting.',409);
    const caps:Record<string,unknown>={platformName:'iOS','appium:automationName':'XCUITest','appium:udid':device.udid,'appium:noReset':true,'appium:fullReset':false,'appium:newCommandTimeout':3600,'appium:mjpegServerPort':9100,'appium:waitForIdleTimeout':0.5,'appium:useNewWDA':false,'appium:showXcodeLog':false};
    if(device.wdaUrl)caps['appium:webDriverAgentUrl']=device.wdaUrl;
    if(device.preinstalledWda)caps['appium:usePreinstalledWDA']=true;
    const value=await this.request('/session','POST',{capabilities:{alwaysMatch:caps,firstMatch:[{}]}},120000);
    if(!value?.sessionId)throw new GlassportError('HELPER_EXITED','The device service returned no active session.',503);
    this.sessionId=value.sessionId;this.device=device;
    await this.request(this.path('/appium/settings'),'POST',{settings:{mjpegServerFramerate:15,mjpegServerScreenshotQuality:65,mjpegScalingFactor:100,mjpegFixOrientation:true,animationCoolOffTimeout:0.2}});
    return this.geometry();
  }
  async disconnect(){const id=this.sessionId;this.sessionId=null;this.device=null;if(id)try{await this.request(`/session/${id}`,'DELETE',undefined,5000);}catch{}}
  async geometry():Promise<{bounds:Rect;orientation:string;app:string|null}>{
    const bounds=await this.request(this.path('/window/rect'));
    const orientation=await this.request(this.path('/orientation'));
    let app:string|null=null;try{const info=await this.execute('activeAppInfo');app=info.bundleId??null;}catch{}
    return {bounds,orientation,app};
  }
  async screenshot():Promise<Buffer>{const data=await this.request(this.path('/screenshot'));return Buffer.from(String(data),'base64');}
  async source(){return this.execute('source',{format:'json'});}
  async apps(){return this.execute('listApps',{applicationType:'User'});}
  async action(a:Action){const p=a.parameters;
    switch(a.kind){
      case 'tap':return this.execute('tap',{x:p.x,y:p.y});
      case 'double_tap':return this.execute('doubleTap',{x:p.x,y:p.y});
      case 'hold':return this.execute('touchAndHold',{x:p.x,y:p.y,duration:p.duration??0.6});
      case 'swipe':return this.execute('dragFromToForDuration',{fromX:p.fromX,fromY:p.fromY,toX:p.toX,toY:p.toY,duration:p.duration??0.35});
      case 'type_keys': case 'type_text': {const active=await this.request(this.path('/element/active'));const id=active?.['element-6066-11e4-a52e-4f735466cecf']??active?.ELEMENT;if(!id)throw new GlassportError('INPUT_UNAVAILABLE','Focus an editable field on the iPad before typing.',409);return this.request(this.path(`/element/${id}/value`),'POST',{text:String(p.text),value:Array.from(String(p.text))});}
      case 'key':{const key=({Backspace:'XCUIKeyboardKeyDelete',Enter:'XCUIKeyboardKeyReturn',Escape:'XCUIKeyboardKeyEscape',Tab:'XCUIKeyboardKeyTab',ArrowLeft:'XCUIKeyboardKeyLeftArrow',ArrowRight:'XCUIKeyboardKeyRightArrow',ArrowUp:'XCUIKeyboardKeyUpArrow',ArrowDown:'XCUIKeyboardKeyDownArrow'} as Record<string,string>)[String(p.key)];if(!key)throw new GlassportError('INPUT_UNAVAILABLE','The selected device adapter does not support that keyboard action.',409);return this.execute('keys',{keys:[key]});}
      case 'home':return this.execute('pressButton',{name:'home'});
      case 'open_app':return this.execute('activateApp',{bundleId:p.bundleId});
    }
  }
}
