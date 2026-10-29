// Local PCM: jade-like cover tap and softer paper/pluck option tap.
import {writeFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
function make(name,duration,kind){
  const rate=44100,count=Math.round(duration*rate),samples=new Float64Array(count);let seed=43171,previous=0;
  for(let i=0;i<count;i++){
    const t=i/rate,attack=1-Math.exp(-t/.0018);seed=(seed*1664525+1013904223)>>>0;const noise=seed/2147483648-1,brush=noise-previous;previous=noise;
    samples[i]=kind==='cover'?attack*(.48*Math.sin(2*Math.PI*1320*t)*Math.exp(-t/.072)+.22*Math.sin(2*Math.PI*2134*t)*Math.exp(-t/.11)+.09*Math.sin(2*Math.PI*3191*t)*Math.exp(-t/.045)+brush*.08*Math.exp(-t/.009)):attack*(.34*Math.sin(2*Math.PI*610*t+2*Math.exp(-t/.01))*Math.exp(-t/.022)+.12*Math.sin(2*Math.PI*1220*t)*Math.exp(-t/.014)+brush*.13*Math.exp(-t/.018));
    samples[i]*=Math.min(1,(duration-t)/.025);
  }
  const peak=Math.max(...samples.map(Math.abs)),buffer=Buffer.alloc(44+count*2);buffer.write('RIFF',0);buffer.writeUInt32LE(buffer.length-8,4);buffer.write('WAVEfmt ',8);buffer.writeUInt32LE(16,16);buffer.writeUInt16LE(1,20);buffer.writeUInt16LE(1,22);buffer.writeUInt32LE(rate,24);buffer.writeUInt32LE(rate*2,28);buffer.writeUInt16LE(2,32);buffer.writeUInt16LE(16,34);buffer.write('data',36);buffer.writeUInt32LE(count*2,40);
  for(let i=0;i<count;i++)buffer.writeInt16LE(Math.round(samples[i]/peak*.56*32767),44+i*2);
  writeFileSync(fileURLToPath(new URL('../dist/audio/'+name,import.meta.url)),buffer);
}
make('ui-cover.wav',.46,'cover');make('ui-option.wav',.19,'option');
