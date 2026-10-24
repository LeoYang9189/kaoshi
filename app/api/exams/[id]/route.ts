import {owner,body,response,safe,assertOrigin,loadAttempt,finalize,persist,examPayload,snapshotAccepted,answerConflictMessage,ApiError} from '../../../../lib/exam-server';
type Context={params:Promise<{id:string}>};
export async function GET(req:Request,c:Context){return safe(async()=>{const oid=await owner();const {id}=await c.params;let a=await loadAttempt(id,oid);if(a.status!=='submitted'&&Date.now()>=a.deadline)a=await finalize(id,oid);return response(examPayload(a))})}
export async function PATCH(req:Request,c:Context){return safe(async()=>{
  assertOrigin(req);const oid=await owner();const {id}=await c.params;const payload=await body(req);const a=await persist(id,oid,payload);
  if(a.status==='submitted')return response(examPayload(a));
  const accepted=snapshotAccepted(a,payload.answers);
  return response({revision:a.revision,accepted,acceptedRevision:accepted?payload.revision:null,...(!accepted?{message:answerConflictMessage}:{}),status:a.status,serverNow:Date.now()});
})}
export async function POST(req:Request,c:Context){return safe(async()=>{
  assertOrigin(req);const oid=await owner();const {id}=await c.params;const payload=await body(req);const a=await persist(id,oid,payload);
  if(a.status==='submitted')return response(examPayload(a));
  if(!snapshotAccepted(a,payload.answers))throw new ApiError(answerConflictMessage,409);
  return response(examPayload(await finalize(id,oid,payload.answers)));
})}
