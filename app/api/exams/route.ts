import {owner,db,body,response,safe,ApiError,assertOrigin,loadAttempt,examPayload} from '../../../lib/exam-server';
import {getPaper} from '../../../lib/papers';
export async function POST(req:Request){return safe(async()=>{
  assertOrigin(req);const oid=await owner();const b=await body(req);const p=typeof b.paperId==='string'?getPaper(b.paperId):undefined;if(!p)throw new ApiError('请选择有效试卷');
  if(typeof b.durationMinutes!=='number'||![15,30,45,60,90,120,180].includes(b.durationMinutes))throw new ApiError('考试时长不正确');
  if(typeof b.profileId!=='string'||!b.profileId)throw new ApiError('请先选择考生档案');
  const profile=await db().prepare('SELECT id FROM profiles WHERE id=? AND owner_id=?').bind(b.profileId,oid).first();if(!profile)throw new ApiError('请先选择考生档案');
  const id=crypto.randomUUID();const now=Date.now();
  // The existence check and insert are one SQLite statement: simultaneous starts
  // for the same candidate must resume the same active exam.
  const inserted=await db().prepare('INSERT INTO attempts (id,owner_id,profile_id,paper_id,started_at,deadline,duration_minutes,status,total_points,question_count) SELECT ?,?,?,?,?,?,?,?,?,? WHERE NOT EXISTS (SELECT 1 FROM attempts WHERE owner_id=? AND profile_id=? AND status=? AND deadline>?) RETURNING id').bind(id,oid,b.profileId,p.id,now,now+b.durationMinutes*60000,b.durationMinutes,'in_progress',p.totalPoints,p.questions.length,oid,b.profileId,'in_progress',now).first<{id:string}>();
  const active=inserted??await db().prepare('SELECT id FROM attempts WHERE owner_id=? AND profile_id=? AND status=? AND deadline>? ORDER BY started_at DESC LIMIT 1').bind(oid,b.profileId,'in_progress',now).first<{id:string}>();
  if(!active)throw new ApiError('考试状态已更新，请重试',409);
  return response(examPayload(await loadAttempt(active.id,oid)),inserted?201:200);
})}
