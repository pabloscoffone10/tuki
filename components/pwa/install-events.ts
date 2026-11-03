"use client";
import { useSyncExternalStore } from "react";
export type InstallEvent=Event&{prompt:()=>Promise<void>;userChoice:Promise<{outcome:"accepted"|"dismissed"}>};
type InstallState={prompt:InstallEvent|null;installed:boolean};
const initial:InstallState={prompt:null,installed:false};let state=initial;
const listeners=new Set<()=>void>();
function emit(next:InstallState){state=next;listeners.forEach(listener=>listener());}
function available(event:Event){event.preventDefault();emit({...state,prompt:event as InstallEvent});}
function installed(){emit({prompt:null,installed:true});}
function subscribe(listener:()=>void){
 if(!listeners.size){window.addEventListener("beforeinstallprompt",available);window.addEventListener("appinstalled",installed);}
 listeners.add(listener);return()=>{listeners.delete(listener);if(!listeners.size){window.removeEventListener("beforeinstallprompt",available);window.removeEventListener("appinstalled",installed);state=initial;}};
}
/** Holds only the browser's transient installation event in this page's memory. */
export function useInstallState(){return useSyncExternalStore(subscribe,()=>state,()=>initial);}
export function consumeInstallPrompt(){emit({...state,prompt:null});}
