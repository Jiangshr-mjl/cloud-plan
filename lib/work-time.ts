import {beijingDate} from './planner';
export type Span = [number,number];
export function mergeSpans(spans:Span[]):Span[]{const result:Span[]=[];for(const [start,end] of [...spans].sort((a,b)=>a[0]-b[0])){const last=result.at(-1);if(last&&start<=last[1])last[1]=Math.max(last[1],end);else result.push([start,end]);}return result;}
export function splitDays(spans:Span[]){const result:Record<string,Span[]>={};for(const [start,end] of spans){let cursor=start;while(cursor<end){const day=beijingDate(new Date(cursor));const boundary=Date.parse(day+'T00:00:00+08:00')+86400000;const stop=Math.min(end,boundary);(result[day]??=[]).push([cursor,stop]);cursor=stop;}}return result;}
export function spanSeconds(spans:Span[]){return Math.floor(mergeSpans(spans).reduce((sum,[a,b])=>sum+b-a,0)/1000);}
