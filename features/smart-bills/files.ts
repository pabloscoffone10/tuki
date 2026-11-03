import { TicketError } from "./errors";
import "server-only";
import { PDFDocument } from "pdf-lib";
import sharp from "sharp";
export const MAX_TICKET_BYTES=2*1024*1024;
export async function validateTicket(file:File){
 if(file.size<=0||file.size>MAX_TICKET_BYTES)throw new TicketError("El ticket debe pesar hasta 2 MiB.");
 const bytes=Buffer.from(await file.arrayBuffer());let mime:string;
 if(bytes.subarray(0,5).toString()==="%PDF-")mime="application/pdf";
 else if(bytes.subarray(0,8).toString("hex")==="89504e470d0a1a0a")mime="image/png";
 else if(bytes.subarray(0,3).toString("hex")==="ffd8ff")mime="image/jpeg";
 else if(bytes.subarray(0,4).toString()==="RIFF"&&bytes.subarray(8,12).toString()==="WEBP")mime="image/webp";
 else throw new TicketError("Formato inválido. Subí JPG, PNG, WEBP o PDF.");
 if(file.type!==mime)throw new TicketError("El contenido no coincide con el tipo de archivo.");
 let pages=1;
 if(mime==="application/pdf"){
  let pdf;try{pdf=await PDFDocument.load(bytes,{updateMetadata:false});}catch{throw new TicketError("No pudimos leer el PDF. No se admiten documentos dañados o protegidos.");}
  pages=pdf.getPageCount();if(pages<1||pages>3)throw new TicketError("El PDF puede tener hasta 3 páginas. Separá documentos más largos.");
  if(pdf.getPages().some(p=>p.getWidth()>3000||p.getHeight()>3000))throw new TicketError("Las páginas del PDF son demasiado grandes.");
 }else{
  try{const metadata=await sharp(bytes,{limitInputPixels:16000000,animated:false}).metadata();if(!metadata.width||!metadata.height||(metadata.pages??1)>1||metadata.width*metadata.height>16000000)throw Error();}catch{throw new TicketError("Imagen dañada, animada o demasiado grande (máximo 16 megapíxeles).");}
 }
 return {bytes,mime,pages};
}
