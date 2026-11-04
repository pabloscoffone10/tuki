"use client";

export type ReceiptImageQuality={dark:boolean;lowContrast:boolean;shadows:boolean;possiblyBlurred:boolean;small:boolean;warnings:string[]};
const pause=()=>new Promise<void>(resolve=>setTimeout(resolve,0));
function check(signal?:AbortSignal){if(signal?.aborted)throw new DOMException("Lectura cancelada","AbortError");}

// Heuristics describe image evidence, never an estimate of recognition accuracy.
export function measureReceiptImage(pixels:Uint8ClampedArray,width:number,height:number,sourceWidth=width):ReceiptImageQuality{
 const gray=new Uint8Array(width*height),histogram=new Uint32Array(256);
 let sum=0,lapSum=0,lapSquares=0,count=0;
 const tileSum=new Float64Array(16),tileCount=new Uint32Array(16);
 for(let i=0;i<gray.length;i++){
  const n=Math.round(pixels[i*4]*0.299+pixels[i*4+1]*0.587+pixels[i*4+2]*0.114);gray[i]=n;histogram[n]++;sum+=n;
  const x=i%width,y=Math.floor(i/width),tile=Math.min(3,Math.floor(y*4/height))*4+Math.min(3,Math.floor(x*4/width));tileSum[tile]+=n;tileCount[tile]++;
 }
 for(let y=1;y<height-1;y++)for(let x=1;x<width-1;x++){const i=y*width+x,n=4*gray[i]-gray[i-1]-gray[i+1]-gray[i-width]-gray[i+width];lapSum+=n;lapSquares+=n*n;count++;}
 let cumulative=0,low=0,high=255;
 for(let i=0;i<256;i++){cumulative+=histogram[i];if(cumulative<gray.length*0.03)low=i;if(cumulative<gray.length*0.97)high=i;}
 const tiles=Array.from(tileSum,(n,i)=>n/Math.max(1,tileCount[i]));
 const dark=sum/Math.max(1,gray.length)<115,lowContrast=high-low<75,shadows=Math.max(...tiles)-Math.min(...tiles)>85;
 const possiblyBlurred=count>0&&lapSquares/count-(lapSum/count)**2<70;
 const small=sourceWidth<900,warnings:string[]=[];
 if(dark)warnings.push("La imagen es oscura: verificá los importes contra el original.");
 if(shadows)warnings.push("Se detectó iluminación desigual o sombras. Podrían ocultar caracteres.");
 if(lowContrast)warnings.push("El ticket tiene poco contraste; revisá especialmente los números tenues.");
 if(possiblyBlurred)warnings.push("La foto podría estar borrosa o tener poco detalle. Una foto enfocada puede mejorar la lectura.");
 if(small)warnings.push("La imagen tiene poca resolución. Se comparará una versión ampliada sin inventar detalle.");
 return {dark,lowContrast,shadows,possiblyBlurred,small,warnings};
}

export async function prepareReceiptImage(file:File,signal?:AbortSignal){
 check(signal);
 let image:ImageBitmap;
 try{image=await createImageBitmap(file,{imageOrientation:"from-image"});}catch{throw Error("No se pudo abrir la foto. Elegí un JPG, PNG o WEBP válido.");}
 const canvases:HTMLCanvasElement[]=[];
 const canvas=(width:number,height:number)=>{const value=document.createElement("canvas");value.width=Math.max(1,Math.round(width));value.height=Math.max(1,Math.round(height));canvases.push(value);return value;};
 try{
  check(signal);
  if(!image.width||!image.height||image.width*image.height>16000000)throw Error("La foto supera el límite de 16 megapíxeles o no tiene dimensiones válidas.");
  const scale=Math.min(1,3200/Math.max(image.width,image.height),Math.sqrt(3000000/(image.width*image.height)));
  const original=canvas(image.width*scale,image.height*scale),context=original.getContext("2d",{willReadFrequently:true});
  if(!context)throw Error("Tu navegador no pudo preparar la imagen. Usá la carga manual o Gemini opcional.");
  context.drawImage(image,0,0,original.width,original.height);
  const sampleScale=Math.min(1,384/Math.max(image.width,image.height)),sample=canvas(image.width*sampleScale,image.height*sampleScale),sampleContext=sample.getContext("2d",{willReadFrequently:true});
  if(!sampleContext)throw Error("No se pudo evaluar la foto.");
  sampleContext.drawImage(image,0,0,sample.width,sample.height);
  const quality=measureReceiptImage(sampleContext.getImageData(0,0,sample.width,sample.height).data,sample.width,sample.height,image.width);
  image.close();
  const enhance=async()=>{
   check(signal);
   const factor=Math.min(2,Math.max(1,1000/original.width),Math.sqrt(3000000/(original.width*original.height)));
   const enhanced=canvas(original.width*factor,original.height*factor),ctx=enhanced.getContext("2d",{willReadFrequently:true});
   if(!ctx)throw Error("No se pudo mejorar la foto.");
   ctx.imageSmoothingEnabled=true;ctx.imageSmoothingQuality="high";ctx.drawImage(original,0,0,enhanced.width,enhanced.height);
   const data=ctx.getImageData(0,0,enhanced.width,enhanced.height),{width,height}=enhanced,gray=new Uint8Array(width*height);
   const histogram=new Uint32Array(256);
   for(let y=0;y<height;y++){
    for(let x=0;x<width;x++){const i=y*width+x,value=Math.round(data.data[i*4]*0.299+data.data[i*4+1]*0.587+data.data[i*4+2]*0.114);gray[i]=value;histogram[value]++;}
    if(y%96===0){check(signal);await pause();}
   }
   let cumulative=0,low=0,high=255;
   for(let i=0;i<256;i++){cumulative+=histogram[i];if(cumulative<gray.length*0.01)low=i;if(cumulative<gray.length*0.99)high=i;}
   const range=Math.max(35,high-low);
   const integral=quality.shadows||quality.lowContrast?new Float64Array((width+1)*(height+1)):null;
   if(integral)for(let y=0;y<height;y++){
    let row=0;for(let x=0;x<width;x++){row+=gray[y*width+x];integral[(y+1)*(width+1)+x+1]=integral[y*(width+1)+x+1]+row;}
    if(y%96===0){check(signal);await pause();}
   }
   for(let y=0;y<height;y++){
    for(let x=0;x<width;x++){
     const i=y*width+x;
     let value:number;
     if(integral){
      const x0=Math.max(0,x-20),x1=Math.min(width,x+21),y0=Math.max(0,y-20),y1=Math.min(height,y+21),stride=width+1;
      const local=(integral[y1*stride+x1]-integral[y0*stride+x1]-integral[y1*stride+x0]+integral[y0*stride+x0])/((x1-x0)*(y1-y0));
      // Adaptive local threshold compensates for uneven illumination; only a candidate.
      value=gray[i]<local-10?0:255;
     }else{
      const neighbor=(gray[i]+gray[y*width+Math.max(0,x-1)]+gray[y*width+Math.min(width-1,x+1)]+gray[Math.max(0,y-1)*width+x]+gray[Math.min(height-1,y+1)*width+x])/5;
      const sharpened=gray[i]+0.35*(gray[i]-neighbor);
      value=Math.max(0,Math.min(255,(sharpened-low)*255/range));
     }
     data.data[i*4]=value;data.data[i*4+1]=value;data.data[i*4+2]=value;
    }
    if(y%64===0){check(signal);await pause();}
   }
   ctx.putImageData(data,0,0);return enhanced;
  };
  const rotate=(degrees:90|180)=>{
   const rotated=canvas(degrees===90?original.height:original.width,degrees===90?original.width:original.height),ctx=rotated.getContext("2d");
   if(!ctx)throw Error("No se pudo comprobar la orientación.");
   ctx.translate(rotated.width/2,rotated.height/2);ctx.rotate(degrees*Math.PI/180);ctx.drawImage(original,-original.width/2,-original.height/2);return rotated;
  };
  const crop=(box:{x0:number;y0:number;x1:number;y1:number},scaleX=2,scaleY=2)=>{
   const x0=Math.max(0,Math.floor(box.x0)),y0=Math.max(0,Math.floor(box.y0));
   const width=Math.min(original.width,Math.ceil(box.x1))-x0,height=Math.min(original.height,Math.ceil(box.y1))-y0;
   if(width<=0||height<=0)throw Error("El recorte OCR no tiene dimensiones válidas.");
   const cropped=canvas(width*scaleX,height*scaleY),ctx=cropped.getContext("2d");
   if(!ctx)throw Error("No se pudo comprobar el recorte del ticket.");
   ctx.drawImage(original,x0,y0,width,height,0,0,cropped.width,cropped.height);return cropped;
  };
  return {original,quality,enhance,rotate,crop,release:()=>{for(const value of canvases){value.width=1;value.height=1;}}};
 }catch(error){image.close();for(const value of canvases){value.width=1;value.height=1;}throw error;}
}
