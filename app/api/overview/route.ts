import {owner,db,attempt,finalize,response,safe} from '../../../lib/exam-server';
import {summaries} from '../../../lib/papers';
export async function GET(){return safe(async()=>{
  const oid=await owner();const expired=await db().prepare('SELECT id FROM attempts WHERE owner_id=? AND status=? AND deadline<=?').bind(oid,'in_progress',Date.now()).all<{id:string}>();
  for(const a of expired.results)await finalize(a.id,oid);
  const [ps,ats]=await Promise.all([db().prepare('SELECT id,name,code,created_at AS createdAt FROM profiles WHERE owner_id=? ORDER BY created_at').bind(oid).all(),db().prepare('SELECT * FROM attempts WHERE owner_id=? ORDER BY started_at DESC').bind(oid).all()]);
  return response({profiles:ps.results,attempts:ats.results.map(r=>({...attempt(r),answers:{}})),papers:summaries(),serverNow:Date.now()});
})}
