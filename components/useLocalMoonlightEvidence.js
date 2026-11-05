'use client';
import {useEffect,useRef,useState} from 'react';
import {createMediaEvidenceRecorder} from '../lib/lab/media-evidence.mjs';
import {createLocalMediaSession} from '../lib/lab/local-media-session.mjs';

/** Browser-only, ephemeral local media telemetry. Nothing is uploaded. */
export function useLocalMoonlightEvidence(sessionId,active,frameRef){
 const recorder=useRef(null);
 const [snapshot,setSnapshot]=useState(null);
 useEffect(()=>{
  recorder.current=sessionId?createMediaEvidenceRecorder({sessionId}):null;
  setSnapshot(null);
 },[sessionId]);
 useEffect(()=>{
  if(!active||!sessionId||!frameRef.current)return;
  const frame=frameRef.current;
  if(!globalThis.crypto?.getRandomValues)return;
  const bytes=new Uint8Array(16);
  globalThis.crypto.getRandomValues(bytes);
  const nonce=Array.from(bytes,x=>x.toString(16).padStart(2,'0')).join('');
  const channel=createLocalMediaSession({
   sessionId,source:frame.contentWindow,nonce,recorder:recorder.current
  });
  const hello=()=>{
   if(frame.contentWindow)frame.contentWindow.postMessage(channel.hello(),channel.origin);
  };
  const receive=event=>{
   if(channel.observe(event))setSnapshot(channel.snapshot());
  };
  window.addEventListener('message',receive);
  frame.addEventListener('load',hello);
  const timer=window.setInterval(()=>{
   hello();
   setSnapshot(channel.snapshot());
  },1800);
  hello();
  return ()=>{
   window.clearInterval(timer);
   window.removeEventListener('message',receive);
   frame.removeEventListener('load',hello);
  };
 },[sessionId,active,frameRef]);
 return {mediaSnapshot:snapshot,exportMedia:()=>recorder.current?.export()??null};
}
