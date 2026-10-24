import {ApiError,db,owner,safe} from '../../../lib/exam-server';
import {getPaper} from '../../../lib/papers';

type ExportRow={candidate_name:string;candidate_code:string;paper_id:string;submitted_at:number;started_at:number;score:number;total_points:number;correct_count:number;question_count:number;accuracy:number;duration_minutes:number;timed_out:number};
function csvCell(value:unknown){
  let text=String(value??'');
  if(/^[\s\uFEFF]*[=+@-]/.test(text.normalize('NFKC'))||/^[\t\r\n]/.test(text))text="'"+text;
  return '"'+text.replaceAll('"','""')+'"';
}

export async function GET(req:Request){return safe(async()=>{
  const oid=await owner();const profileId=new URL(req.url).searchParams.get('profileId');
  if(profileId!==null&&!profileId)throw new ApiError('请选择有效考生');
  let filename='全部考生-考试记录.csv';
  if(profileId!==null){
    const profile=await db().prepare('SELECT name FROM profiles WHERE id=? AND owner_id=?').bind(profileId,oid).first<{name:string}>();
    if(!profile)throw new ApiError('找不到考生档案',404);
    filename=profile.name.replace(/[<>:"/\\|?*\u0000-\u001f]/g,'_')+'-考试记录.csv';
  }
  const sql='SELECT p.name AS candidate_name,p.code AS candidate_code,a.paper_id,a.submitted_at,a.started_at,a.score,a.total_points,a.correct_count,a.question_count,a.accuracy,a.duration_minutes,a.timed_out FROM attempts a JOIN profiles p ON p.id=a.profile_id WHERE a.owner_id=? AND p.owner_id=? AND a.status=?'+(profileId!==null?' AND a.profile_id=?':'')+' ORDER BY a.submitted_at DESC,a.id';
  const rows=await db().prepare(sql).bind(oid,oid,'submitted',...(profileId!==null?[profileId]:[])).all<ExportRow>();
  const lines:unknown[][]=[['考生姓名','考生编号','试卷','提交时间（北京时间）','得分','满分','答对题数','题目数','正确率','考试时长（分钟）','超时交卷']];
  for(const row of rows.results){
    const paper=getPaper(row.paper_id);
    lines.push([row.candidate_name,row.candidate_code,paper?`${paper.year} 年 · 国际货代${paper.subject==='english'?'英语':'业务'}`:row.paper_id,new Date(row.submitted_at??row.started_at).toLocaleString('zh-CN',{timeZone:'Asia/Shanghai',hour12:false}),row.score,row.total_points,row.correct_count,row.question_count,row.accuracy,row.duration_minutes,row.timed_out?'是':'否']);
  }
  const encoded=encodeURIComponent(filename).replace(/[!'()*]/g,c=>'%'+c.charCodeAt(0).toString(16).toUpperCase());
  return new Response('\uFEFF'+lines.map(row=>row.map(csvCell).join(',')).join('\r\n')+'\r\n',{headers:{'Content-Type':'text/csv; charset=utf-8','Content-Disposition':`attachment; filename="exam-records.csv"; filename*=UTF-8''${encoded}`,'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'}});
})}
