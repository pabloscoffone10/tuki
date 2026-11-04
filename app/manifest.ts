import type { MetadataRoute } from "next";
export default function manifest():MetadataRoute.Manifest{
 return {id:"/",name:"Tuki",short_name:"Tuki",description:"Compartir, sin vueltas. Gastos compartidos entre amigos.",lang:"es-UY",start_url:"/",scope:"/",display:"standalone",background_color:"#fafaf8",theme_color:"#5b35e9",icons:[
 {src:"/icons/icon-192.png",sizes:"192x192",type:"image/png",purpose:"any"},
 {src:"/icons/icon-512.png",sizes:"512x512",type:"image/png",purpose:"any"},
 {src:"/icons/icon-512.png",sizes:"512x512",type:"image/png",purpose:"maskable"},
 ]};
}
