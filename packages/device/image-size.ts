import {GlassportError} from '../contracts/core.ts';
export function imageSize(frame:Buffer){
  if(frame.length>=24&&frame.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])))return {width:frame.readUInt32BE(16),height:frame.readUInt32BE(20)};
  if(frame[0]===0xff&&frame[1]===0xd8){let position=2;while(position+4<=frame.length){if(frame[position++]!==0xff)continue;while(frame[position]===0xff)position++;const marker=frame[position++];if(marker===0xda||marker===0xd9)break;if(marker===0x01||marker>=0xd0&&marker<=0xd7)continue;const length=frame.readUInt16BE(position);if(length<2||position+length>frame.length)break;if([0xc0,0xc1,0xc2,0xc3,0xc5,0xc6,0xc7,0xc9,0xca,0xcb,0xcd,0xce,0xcf].includes(marker)&&length>=7)return {height:frame.readUInt16BE(position+3),width:frame.readUInt16BE(position+5)};position+=length;}}
  throw new GlassportError('CAPTURE_INVALID','The device frame has no valid image dimensions.',503);
}
