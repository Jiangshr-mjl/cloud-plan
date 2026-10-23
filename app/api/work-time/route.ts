import {env} from 'cloudflare:workers';
import {z} from 'zod';
import {hashKey} from '@/lib/api';
import {mergeSpans,splitDays,spanSeconds,type Span} from '@/lib/work-time';
export const dynamic='force-dynamic';
const schema=z.object({spans:z.array(z.tuple([z.number().int().nonnegative(),z.number().int().nonnegative()])).min(1).max(100)}).strict();
async function handler(request:Request){
 const json=(value:unknown,status=200)=>Response.json(value,{status,headers:{'Cache-Control':'no-store, private','X-Content-Type-Options':'nosniff'}});
 const key=request.headers.get('X-Planner-Key')??'';if(!env.PLANNER_KEY_HASH)return json({error:'服务未配置'},503);
 const hash=await hashKey(key);let diff=hash.length^env.PLANNER_KEY_HASH.length;for(let i=0;i<hash.length;i++)diff|=hash.charCodeAt(i)^env.PLANNER_KEY_HASH.charCodeAt(i);
 if(key.length<32||key.length>256||diff)return json({error:'密钥无效'},401);
 try{
 const db=env.DB;if(!db)return json({error:'数据库不可用'},503);
 if(request.method==='POST'){
 const origin=request.headers.get('Origin');if(origin&&origin!==new URL(request.url).origin)return json({error:'来源无效'},403);
 if(!request.headers.get('Content-Type')?.startsWith('application/json'))return json({error:'需要 JSON'},415);
 const raw=await request.text();if(raw.length>20000)return json({error:'请求过大'},413);
 let value;try{value=JSON.parse(raw);}catch{return json({error:'JSON 无效'},400);}
 const parsed=schema.safeParse(value);const now=Date.now();if(!parsed.success||parsed.data.spans.some(([a,b])=>a<Date.UTC(2026,0,1)||b<=a||b-a>120000||b>now+5000))return json({error:'计时片段无效'},400);
 for(const [day,spans] of Object.entries(splitDays(parsed.data.spans))){let saved=false;for(let attempt=0;attempt<8;attempt++){
 const row=await db.withSession('first-primary').prepare('SELECT revision, intervals FROM work_days WHERE day = ?').bind(day).first<{revision:number;intervals:string}>();const revision=row?.revision??0;
 const merged=mergeSpans([...(row?JSON.parse(row.intervals):[]),...spans]);
 const result=await db.prepare('INSERT INTO work_days (day,revision,intervals) VALUES (?, ?, ?) ON CONFLICT(day) DO UPDATE SET revision=excluded.revision, intervals=excluded.intervals WHERE work_days.revision = ? RETURNING revision').bind(day,revision+1,JSON.stringify(merged),revision).first();if(result){saved=true;break;}}
 if(!saved)return json({error:'计时同步冲突，请重试'},409);
 }
 }else if(request.method!=='GET')return json({error:'不支持此操作'},405);
 const rows=await db.withSession('first-primary').prepare('SELECT day, intervals FROM work_days ORDER BY day DESC').all<{day:string;intervals:string}>();
 return json({days:rows.results.map(row=>({day:row.day,seconds:spanSeconds(JSON.parse(row.intervals) as Span[])}))});
 }catch{return json({error:'工作时长暂未同步，请稍后重试'},503);}
}
export const GET=handler;export const POST=handler;
