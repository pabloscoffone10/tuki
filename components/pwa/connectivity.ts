"use client";
import { useSyncExternalStore } from "react";

/** A negative signal blocks sending. A positive signal is not proof the server is reachable. */
export function isOnline(){return typeof navigator==="undefined"||navigator.onLine!==false;}
function subscribe(listener:()=>void){window.addEventListener("online",listener);window.addEventListener("offline",listener);return()=>{window.removeEventListener("online",listener);window.removeEventListener("offline",listener);};}
export function useConnectivity(){return useSyncExternalStore(subscribe,isOnline,()=>true);}
