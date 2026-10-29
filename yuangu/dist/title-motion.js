// Local movement of the existing painted cover, in its original coordinate space.
// Nothing here creates a second bell, moves lettering, or changes a menu target.
export const coverSize=Object.freeze({width:1672,height:941});
export const titleMotionPatches=Object.freeze([
  {id:'title-left-bell',kind:'bell',cx:386,cy:425,rx:40,ry:98,px:389,py:350,amplitude:.13,rate:1.8,phase:.2},
  {id:'title-right-bell',kind:'bell',cx:825,cy:501,rx:38,ry:88,px:819,py:442,amplitude:.15,rate:1.62,phase:1.4},
  {id:'foreground-bell',kind:'bell',cx:211,cy:346,rx:69,ry:151,px:212,py:224,amplitude:.085,rate:1.32,phase:.8},
  {id:'upper-left-bell',kind:'bell',cx:100,cy:202,rx:44,ry:89,px:105,py:136,amplitude:.095,rate:1.5,phase:2},
  {id:'upper-bell-a',kind:'bell',cx:465,cy:179,rx:25,ry:74,px:465,py:130,amplitude:.105,rate:1.78,phase:2.7},
  {id:'upper-bell-b',kind:'bell',cx:558,cy:167,rx:24,ry:74,px:558,py:111,amplitude:.1,rate:1.66,phase:3.4},
  {id:'blossoms-left',kind:'flower',cx:132,cy:113,rx:105,ry:83,px:49,py:61,amplitude:.045,rate:1.2,phase:.3,driftX:3,driftY:3},
  {id:'blossoms-crown',kind:'flower',cx:704,cy:101,rx:139,ry:90,px:588,py:25,amplitude:.05,rate:1.05,phase:.9,driftX:3,driftY:3},
  {id:'blossoms-upper-right',kind:'flower',cx:1165,cy:77,rx:164,ry:76,px:1040,py:32,amplitude:.045,rate:.96,phase:1.8,driftX:4,driftY:3},
  {id:'blossoms-right-branch',kind:'flower',cx:1477,cy:458,rx:160,ry:58,px:1591,py:421,amplitude:.055,rate:1.13,phase:2.3,driftX:2,driftY:5},
  {id:'blossoms-mid-branch',kind:'flower',cx:1070,cy:488,rx:110,ry:44,px:1180,py:486,amplitude:.06,rate:1.18,phase:2.7,driftX:2,driftY:4},
  {id:'blossoms-near-left',kind:'flower',cx:333,cy:787,rx:116,ry:80,px:254,py:824,amplitude:.06,rate:1.07,phase:3.2,driftX:3,driftY:3},
  {id:'blossoms-near-bottom',kind:'flower',cx:596,cy:847,rx:135,ry:55,px:488,py:823,amplitude:.065,rate:1.24,phase:3.8,driftX:3,driftY:4},
  {id:'title-flower-left',kind:'flower',cx:303,cy:375,rx:34,ry:27,px:325,py:385,amplitude:.09,rate:1.3,phase:1.2,driftX:2,driftY:2},
  {id:'title-flower-right',kind:'flower',cx:830,cy:330,rx:29,ry:47,px:799,py:313,amplitude:.08,rate:1.2,phase:2.2,driftX:2,driftY:1}
].map(Object.freeze));

export function motionAt(p,time){
  const wind=Math.sin(time*p.rate+p.phase)*.8+Math.sin(time*p.rate*.57+p.phase*.7)*.2;
  return {angle:wind*p.amplitude,x:wind*(p.driftX||0),y:Math.sin(time*p.rate+p.phase+.5)*(p.driftY||0)};
}
export function patchWeight(p,x,y){
  const d=Math.hypot((x-p.cx)/p.rx,(y-p.cy)/p.ry);
  const q=Math.min(1,Math.max(0,(d-.62)/.38));
  return 1-q*q*(3-2*q);
}
export function samplePaint(p,x,y,motion){
  const weight=patchWeight(p,x,y),angle=motion.angle*weight;
  const c=Math.cos(angle),s=Math.sin(angle),dx=x-p.px-motion.x*weight,dy=y-p.py-motion.y*weight;
  return {x:p.px+c*dx+s*dy,y:p.py-s*dx+c*dy};
}

function shader(gl,type,source){
  const result=gl.createShader(type);gl.shaderSource(result,source);gl.compileShader(result);
  if(!gl.getShaderParameter(result,gl.COMPILE_STATUS))throw new Error('Cover shader unavailable');
  return result;
}
function gpuRenderer(canvas,image){
  const gl=canvas.getContext('webgl',{alpha:true,antialias:false,depth:false,stencil:false,premultipliedAlpha:false});
  if(!gl)return null;
  const program=gl.createProgram();
  gl.attachShader(program,shader(gl,gl.VERTEX_SHADER,`
    attribute vec2 point;varying vec2 paint;uniform vec2 size;
    void main(){paint=point;gl_Position=vec4(point.x/size.x*2.0-1.0,1.0-point.y/size.y*2.0,0.0,1.0);}`));
  gl.attachShader(program,shader(gl,gl.FRAGMENT_SHADER,`
    precision highp float;varying vec2 paint;uniform sampler2D art;
    uniform vec2 size;uniform vec4 region;uniform vec2 pivot;uniform vec3 motion;
    void main(){
      float weight=1.0-smoothstep(.62,1.0,length((paint-region.xy)/region.zw));
      float angle=motion.x*weight;float c=cos(angle);float s=sin(angle);
      vec2 d=paint-pivot-motion.yz*weight;
      vec2 source=pivot+vec2(c*d.x+s*d.y,-s*d.x+c*d.y);
      gl_FragColor=texture2D(art,vec2(source.x/size.x,1.0-source.y/size.y));
    }`));
  gl.linkProgram(program);if(!gl.getProgramParameter(program,gl.LINK_STATUS))throw new Error('Cover program unavailable');
  gl.useProgram(program);
  const texture=gl.createTexture();gl.activeTexture(gl.TEXTURE0);gl.bindTexture(gl.TEXTURE_2D,texture);
  gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL,true);
  gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MIN_FILTER,gl.LINEAR);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MAG_FILTER,gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_S,gl.CLAMP_TO_EDGE);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_T,gl.CLAMP_TO_EDGE);
  gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA,gl.RGBA,gl.UNSIGNED_BYTE,image);
  gl.uniform1i(gl.getUniformLocation(program,'art'),0);
  gl.uniform2f(gl.getUniformLocation(program,'size'),coverSize.width,coverSize.height);
  const position=gl.getAttribLocation(program,'point');gl.enableVertexAttribArray(position);
  const patchLocation=gl.getUniformLocation(program,'region'),pivotLocation=gl.getUniformLocation(program,'pivot'),motionLocation=gl.getUniformLocation(program,'motion');
  const patches=titleMotionPatches.map(p=>{
    const l=p.cx-p.rx,r=p.cx+p.rx,t=p.cy-p.ry,b=p.cy+p.ry;
    const buffer=gl.createBuffer();gl.bindBuffer(gl.ARRAY_BUFFER,buffer);
    gl.bufferData(gl.ARRAY_BUFFER,new Float32Array([l,t,r,t,l,b,l,b,r,t,r,b]),gl.STATIC_DRAW);
    return {p,buffer};
  });
  return time=>{
    if(gl.isContextLost())return;
    gl.viewport(0,0,canvas.width,canvas.height);gl.clearColor(0,0,0,0);gl.clear(gl.COLOR_BUFFER_BIT);
    for(const {p,buffer} of patches){
      const m=motionAt(p,time);gl.bindBuffer(gl.ARRAY_BUFFER,buffer);gl.vertexAttribPointer(position,2,gl.FLOAT,false,0,0);
      gl.uniform4f(patchLocation,p.cx,p.cy,p.rx,p.ry);gl.uniform2f(pivotLocation,p.px,p.py);gl.uniform3f(motionLocation,m.angle,m.x,m.y);
      gl.drawArrays(gl.TRIANGLES,0,6);
    }
  };
}

function cpuRenderer(canvas,image){
  const context=canvas.getContext('2d');if(!context)return null;
  // Native textured triangles, not per-pixel JavaScript. This keeps touch input
  // responsive even in browsers without WebGL or with a low-power GPU.
  const patches=titleMotionPatches.map(p=>{
    const tile=document.createElement('canvas'),width=p.rx*2,height=p.ry*2,left=p.cx-p.rx,top=p.cy-p.ry;
    tile.width=width;tile.height=height;const brush=tile.getContext('2d');
    brush.drawImage(image,left,top,width,height,0,0,width,height);
    const columns=p.kind==='bell'?4:8,rows=p.kind==='bell'?8:4,vertices=[],triangles=[];
    for(let y=0;y<=rows;y++)for(let x=0;x<=columns;x++){
      const u=x*width/columns,v=y*height/rows;
      vertices.push({u,v,dx:left+u-p.px,dy:top+v-p.py,w:patchWeight(p,left+u,top+v),x:0,y:0});
    }
    for(let y=0;y<rows;y++)for(let x=0;x<columns;x++){
      const a=y*(columns+1)+x,b=a+1,c=a+columns+1,d=c+1;
      triangles.push([vertices[a],vertices[b],vertices[c]],[vertices[c],vertices[b],vertices[d]]);
    }
    return {p,tile,vertices,triangles};
  });
  return time=>{
    context.setTransform(canvas.width/coverSize.width,0,0,canvas.height/coverSize.height,0,0);context.clearRect(0,0,coverSize.width,coverSize.height);
    context.imageSmoothingEnabled=true;
    for(const t of patches){
      const {p,tile,vertices,triangles}=t,m=motionAt(p,time);
      for(const v of vertices){const angle=m.angle*v.w,c=Math.cos(angle),s=Math.sin(angle);v.x=p.px+c*v.dx-s*v.dy+m.x*v.w;v.y=p.py+s*v.dx+c*v.dy+m.y*v.w;}
      for(const [a,b,c] of triangles){
        const du1=b.u-a.u,dv1=b.v-a.v,du2=c.u-a.u,dv2=c.v-a.v,det=du1*dv2-du2*dv1;
        const dx1=b.x-a.x,dy1=b.y-a.y,dx2=c.x-a.x,dy2=c.y-a.y;
        const aa=(dx1*dv2-dx2*dv1)/det,bb=(dy1*dv2-dy2*dv1)/det,cc=(dx2*du1-dx1*du2)/det,dd=(dy2*du1-dy1*du2)/det;
        // Slight clip overlap removes anti-aliased hairline seams between cells.
        const mx=(a.x+b.x+c.x)/3,my=(a.y+b.y+c.y)/3;
        context.save();context.beginPath();
        for(const [i,v] of [a,b,c].entries()){const dx=v.x-mx,dy=v.y-my,k=.35/(Math.hypot(dx,dy)||1);context[i?'lineTo':'moveTo'](v.x+dx*k,v.y+dy*k);}
        context.closePath();context.clip();context.transform(aa,bb,cc,dd,a.x-aa*a.u-cc*a.v,a.y-bb*a.u-dd*a.v);context.drawImage(tile,0,0);context.restore();
      }
    }
  };
}

export function createTitleMotion(canvas,image){
  // Keep a clean canvas available for 2D when a device does not expose WebGL.
  const fallback=canvas.cloneNode(false);
  try{
    const draw=gpuRenderer(canvas,image);
    if(draw){
      canvas.dataset.renderer='webgl';
      canvas.addEventListener('webglcontextlost',event=>{event.preventDefault();canvas.classList.remove('ready');});
      canvas.addEventListener('webglcontextrestored',()=>{const restored=gpuRenderer(canvas,image);if(restored){activeDraw=restored;canvas.classList.add('ready');}});
      let activeDraw=draw;
      return {canvas,draw:time=>activeDraw(time)};
    }
  }catch{/* The original illustration always remains visible below this layer. */}
  canvas.replaceWith(fallback);const draw=cpuRenderer(fallback,image);
  fallback.dataset.renderer='canvas2d';return {canvas:fallback,draw};
}
