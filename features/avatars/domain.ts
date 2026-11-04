export type AvatarKind="profile"|"group";
export const AVATAR_MAX_BYTES=8*1024*1024;
export const AVATAR_OUTPUT_BYTES=512*1024;
export function avatarPath(kind:AvatarKind,targetId:string){return `${kind}/${targetId}/avatar.jpg`;}
export function cropSquare(width:number,height:number,zoom:number,x:number,y:number){
 const size=Math.min(width,height)/Math.max(1,Math.min(3,zoom));
 return {sx:(width-size)*Math.max(0,Math.min(1,x)),sy:(height-size)*Math.max(0,Math.min(1,y)),size};
}
