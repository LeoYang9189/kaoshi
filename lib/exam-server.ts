import {env} from 'cloudflare:workers';
import {getChatGPTUser} from '../app/chatgpt-auth';
import {getPaper,publicPaper} from './papers';
import {grade,cleanAnswers,sameAnswers} from './grading';
import type {Attempt} from './exam-types';
export class ApiError extends Error {status:number;constructor(message:string,status=400){super(message);this.status=status}}
export const answerConflictMessage='此答卷已在其他页面更新，请刷新核对；当前草稿未同步。';
export async function owner(){const user=await getChatGPTUser();if(!user)throw new ApiError('请先登录后使用考试档案',401);return user.userId;}
export function db(){if(!env.DB)throw new ApiError('数据库尚未连接',503);return env.DB;}
export function attempt(row:any):Attempt{return {id:row.id,profileId:row.profile_id,paperId:row.paper_id,startedAt:row.started_at,deadline:row.deadline,submittedAt:row.submitted_at,durationMinutes:row.duration_minutes,status:row.status,answers:JSON.parse(row.answers),revision:row.revision,score:row.score,totalPoints:row.total_points,correctCount:row.correct_count,questionCount:row.question_count,accuracy:row.accuracy,timedOut:row.timed_out};}
export async function loadAttempt(id:string,ownerId:string){const row=await db().prepare('SELECT * FROM attempts WHERE id=? AND owner_id=?').bind(id,ownerId).first();if(!row)throw new ApiError('找不到这次考试',404);return attempt(row);}
export async function finalize(id:string,ownerId:string,expectedAnswers?:unknown){
  for(let i=0;i<5;i++){
    const current=await loadAttempt(id,ownerId);if(current.status==='submitted')return current;
    const paper=getPaper(current.paperId)!;const result=grade(paper,current.answers);const now=Date.now();const expired=now>=current.deadline;
    if(expectedAnswers!==undefined&&!expired&&!sameAnswers(paper,current.answers,expectedAnswers))throw new ApiError(answerConflictMessage,409);
    const saved=await db().prepare('UPDATE attempts SET status=?, submitted_at=?, score=?, correct_count=?, accuracy=?, timed_out=? WHERE id=? AND owner_id=? AND status=? AND revision=? RETURNING *').bind('submitted',expired?current.deadline:now,result.score,result.correctCount,result.accuracy,expired?1:0,id,ownerId,'in_progress',current.revision).first();
    if(saved)return attempt(saved);
  }
  throw new ApiError('保存繁忙，请重试',409);
}
export function snapshotAccepted(saved:Attempt,input:unknown){return sameAnswers(getPaper(saved.paperId)!,saved.answers,input)}
export async function body(request:Request):Promise<Record<string,unknown>>{
  const limit=100000;
  if(Number(request.headers.get('content-length')??0)>limit)throw new ApiError('请求过大',413);
  const reader=request.body?.getReader();if(!reader)throw new ApiError('请求格式不正确');
  const chunks:Uint8Array[]=[];let size=0;
  try{
    while(true){const {done,value}=await reader.read();if(done)break;size+=value.byteLength;if(size>limit){await reader.cancel();throw new ApiError('请求过大',413)}chunks.push(value)}
    const bytes=new Uint8Array(size);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.byteLength}
    const parsed:unknown=JSON.parse(new TextDecoder().decode(bytes));
    if(!parsed||typeof parsed!=='object'||Array.isArray(parsed))throw new ApiError('请求格式不正确');
    return parsed as Record<string,unknown>;
  }catch(e){if(e instanceof ApiError)throw e;throw new ApiError('请求格式不正确')}
}
export async function persist(id:string,ownerId:string,payload:Record<string,unknown>){
  const current=await loadAttempt(id,ownerId);if(current.status==='submitted')return current;
  if(Date.now()>=current.deadline)return finalize(id,ownerId);
  if(typeof payload.revision!=='number'||!Number.isSafeInteger(payload.revision)||payload.revision<=0)throw new ApiError('保存版本不正确');
  const answers=cleanAnswers(getPaper(current.paperId)!,payload.answers);
  await db().prepare('UPDATE attempts SET answers=?,revision=? WHERE id=? AND owner_id=? AND status=? AND revision<? AND deadline>?').bind(JSON.stringify(answers),payload.revision,id,ownerId,'in_progress',payload.revision,Date.now()).run();
  const saved=await loadAttempt(id,ownerId);
  return saved.status==='in_progress'&&Date.now()>=saved.deadline?finalize(id,ownerId):saved;
}
export function response(data:unknown,status=200){return Response.json(data,{status,headers:{'Cache-Control':'no-store'}})}
export async function safe(fn:()=>Promise<Response>){try{return await fn()}catch(e){if(e instanceof ApiError)return response({error:e.message},e.status);if(e instanceof Error&&(/答案|选项/.test(e.message)))return response({error:e.message},400);console.error('Exam API error',e);return response({error:'操作未完成，请稍后重试；已保存的记录不会丢失。'},500)}}
export function assertOrigin(req:Request){const origin=req.headers.get('origin');if(origin&&origin!==new URL(req.url).origin)throw new ApiError('请求来源不正确',403)}
export function examPayload(a:Attempt){const p=getPaper(a.paperId)!;return {attempt:a,paper:a.status==='submitted'?p:publicPaper(p),result:a.status==='submitted'?grade(p,a.answers):null,serverNow:Date.now()}}
