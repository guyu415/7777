// Four soft, rising air sweeps, timed to the existing 2.8 s wish collection.
// Deterministic PCM, bundled locally; no account or external service required.
import {writeFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
const rate=44100,duration=2.8,count=Math.round(rate*duration);
const left=new Float64Array(count),right=new Float64Array(count);let seed=921783;
function noise(){seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed/2147483648-1;}
for(const [start,length,pan,level] of [[.03,.65,-.45,.8],[.48,.72,.38,.65],[1.12,.73,-.22,.75],[1.79,.77,.22,1]]){
  let low=0,band=0,phase=0;
  for(let i=0;i<length*rate;i++){
    const t=i/rate,u=t/length,index=Math.round(start*rate)+i;if(index>=count)break;
    const frequency=470+Math.pow(u,.72)*2900,f=2*Math.sin(Math.PI*frequency/rate);
    low+=f*band;const high=noise()-low-.72*band;band+=f*high;
    phase+=2*Math.PI*(590+Math.pow(u,1.5)*1350)/rate;
    const envelope=Math.pow(Math.sin(Math.PI*u),1.65),value=(band*.65+Math.sin(phase)*.075)*envelope*level;
    const moving=pan*(1-u),l=Math.sqrt((1-moving)/2),r=Math.sqrt((1+moving)/2);
    left[index]+=value*l;right[index]+=value*r;
  }
}
// A restrained crystalline settling, not a loud impact or a constant bell.
for(let i=Math.round(2.26*rate);i<count;i++){
  const t=i/rate-2.26,envelope=(1-Math.exp(-t/.006))*Math.exp(-t/.13);
  const value=(Math.sin(2*Math.PI*1568*t)*.055+Math.sin(2*Math.PI*2349*t)*.025)*envelope;
  left[i]+=value;right[i]+=value;
}
let peak=0;for(let i=0;i<count;i++)peak=Math.max(peak,Math.abs(left[i]),Math.abs(right[i]));
const buffer=Buffer.alloc(44+count*4);buffer.write('RIFF',0);buffer.writeUInt32LE(buffer.length-8,4);buffer.write('WAVEfmt ',8);buffer.writeUInt32LE(16,16);buffer.writeUInt16LE(1,20);buffer.writeUInt16LE(2,22);buffer.writeUInt32LE(rate,24);buffer.writeUInt32LE(rate*4,28);buffer.writeUInt16LE(4,32);buffer.writeUInt16LE(16,34);buffer.write('data',36);buffer.writeUInt32LE(count*4,40);
for(let i=0;i<count;i++){
  const fade=Math.min(1,i/(rate*.008),(count-1-i)/(rate*.035));
  buffer.writeInt16LE(Math.round(left[i]/peak*.57*fade*32767),44+i*4);
  buffer.writeInt16LE(Math.round(right[i]/peak*.57*fade*32767),46+i*4);
}
writeFileSync(fileURLToPath(new URL('../dist/audio/wish-collect.wav',import.meta.url)),buffer);
