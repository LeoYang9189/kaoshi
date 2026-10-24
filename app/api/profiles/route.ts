import {owner,db,body,response,safe,ApiError,assertOrigin} from '../../../lib/exam-server';
export async function POST(req:Request){return safe(async()=>{
  assertOrigin(req);const oid=await owner();const b=await body(req);const name=typeof b.name==='string'?b.name.trim():'';const code=typeof b.code==='string'?b.code.trim():'';
  if(!name||name.length>40||!code||code.length>40)throw new ApiError('请填写 1–40 字的姓名和考生编号');
  const profile={id:crypto.randomUUID(),name,code,createdAt:Date.now()};
  const inserted=await db().prepare('INSERT INTO profiles (id,owner_id,name,code,created_at) VALUES (?,?,?,?,?) ON CONFLICT(owner_id,code) DO NOTHING RETURNING id').bind(profile.id,oid,name,code,profile.createdAt).first();
  if(!inserted)throw new ApiError('这个考生编号已存在，请选择已有档案',409);
  return response({profile},201);
})}
