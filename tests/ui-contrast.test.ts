// @vitest-environment node
import { readFileSync } from "node:fs";
import { expect,it } from "vitest";
const css=readFileSync('app/globals.css','utf8');
function luminance(hex:string){const channels=hex.match(/[a-f0-9]{2}/gi)!.map(value=>parseInt(value,16)/255).map(value=>value<=.04045?value/12.92:((value+.055)/1.055)**2.4);return channels[0]*.2126+channels[1]*.7152+channels[2]*.0722;}
function contrast(a:string,b:string){const x=luminance(a),y=luminance(b);return(Math.max(x,y)+.05)/(Math.min(x,y)+.05);}
it.each([':root','.dark'])('checks the main solid text/background pairs in %s without asserting a full accessibility certification',theme=>{
 const block=css.slice(css.indexOf(`${theme} {`)).split('}')[0];const tokens=Object.fromEntries([...block.matchAll(/--([a-z-]+):\s*(#[a-f0-9]{6});/gi)].map(match=>[match[1],match[2]]));
 for(const [text,background] of[['foreground','background'],['card-foreground','card'],['primary','card'],['primary-foreground','primary'],['muted-foreground','background'],['muted-foreground','card'],['destructive','card']])expect(contrast(tokens[text],tokens[background]),`${theme}: ${text}/${background}`).toBeGreaterThanOrEqual(4.5);
});
