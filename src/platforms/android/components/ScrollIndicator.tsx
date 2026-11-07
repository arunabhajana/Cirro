import {useEffect,useRef,type RefObject} from 'react';
// Passive listeners + one compositor update per frame; no React state on scroll.
export default function ScrollIndicator({target,horizontal=false}:{target?:RefObject<HTMLElement|null>;horizontal?:boolean}){
 const track=useRef<HTMLDivElement>(null),thumb=useRef<HTMLSpanElement>(null);
 useEffect(()=>{
  const element=target?.current||document.scrollingElement;if(!element||!track.current||!thumb.current)return;
  const events=target?.current||window;let frame=0,timer:ReturnType<typeof setTimeout>|undefined;
  const paint=()=>{frame=0;const view=horizontal?element.clientWidth:element.clientHeight,total=horizontal?element.scrollWidth:element.scrollHeight,position=horizontal?element.scrollLeft:element.scrollTop;const bar=track.current,handle=thumb.current;if(!bar||!handle)return;const overflow=total>view+1;bar.hidden=!overflow;if(!overflow)return;const length=horizontal?bar.clientWidth:bar.clientHeight;const size=Math.min(length,Math.max(24,length*view/total));const offset=Math.max(0,Math.min(1,position/(total-view)))*(length-size);handle.style[horizontal?'width':'height']=size+'px';handle.style.transform=horizontal?`translate3d(${offset}px,0,0)`:`translate3d(0,${offset}px,0)`;};
  const schedule=()=>{if(!frame)frame=requestAnimationFrame(paint);};
  const scroll=()=>{if(track.current)track.current.dataset.scrolling='true';if(timer)clearTimeout(timer);timer=setTimeout(()=>{if(track.current)delete track.current.dataset.scrolling;},900);schedule();};
  events.addEventListener('scroll',scroll,{passive:true});window.addEventListener('resize',schedule,{passive:true});
  const observed=target?.current||document.querySelector('.m-app')||element;
  const observer=typeof ResizeObserver!=='undefined'?new ResizeObserver(schedule):null;observer?.observe(observed);
  const changes=new MutationObserver(schedule);changes.observe(observed,{childList:true,subtree:true});schedule();
  return()=>{events.removeEventListener('scroll',scroll);window.removeEventListener('resize',schedule);observer?.disconnect();changes.disconnect();if(frame)cancelAnimationFrame(frame);if(timer)clearTimeout(timer);};
 },[target,horizontal]);
 return <div ref={track} hidden aria-hidden="true" className={'m-scroll-indicator '+(horizontal?'horizontal':'vertical')}><span ref={thumb}/></div>;
}
