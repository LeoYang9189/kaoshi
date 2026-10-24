import assert from 'node:assert/strict';
import {readFileSync,readdirSync} from 'node:fs';
import path from 'node:path';
import {DatabaseSync} from 'node:sqlite';

// This test only targets the local preview and creates temporary QA profiles.
const origin='http://127.0.0.1:5173';
let cookies='';const profileIds=[];const testCode=`qa-${Date.now()}`;
async function request(url,method='GET',body,authorized=true){
  const r=await fetch(origin+url,{method,headers:{'Content-Type':'application/json',...(authorized?{Cookie:cookies}:{})},body:body===undefined?undefined:JSON.stringify(body)});
  return {status:r.status,data:await r.json()};
}
function sqliteFiles(dir){return readdirSync(dir,{withFileTypes:true}).flatMap(e=>e.isDirectory()?sqliteFiles(path.join(dir,e.name)):e.name.endsWith('.sqlite')?[path.join(dir,e.name)]:[])}
const dbFile=sqliteFiles('.wrangler/state/v3/d1').find(file=>{const db=new DatabaseSync(file);try{return !!db.prepare("SELECT name FROM sqlite_master WHERE name='attempts'").get()}finally{db.close()}});
assert.ok(dbFile,'Preview database must be migrated first');
function query(sql,...params){const db=new DatabaseSync(dbFile);try{return db.prepare(sql).run(...params)}finally{db.close()}}
const paperFiles=readdirSync('data').filter(f=>/^20\d\d\.json$/.test(f));
const papers=paperFiles.flatMap(f=>JSON.parse(readFileSync(path.join('data',f),'utf8').replace(/^\uFEFF/,'')));
const paper=papers.find(p=>p.id==='2024-english');
try{
  const noAuth=await request('/api/overview','GET',undefined,false);assert.equal(noAuth.status,401);
  const signIn=await fetch(origin+'/signin-with-chatgpt?return_to=/',{redirect:'manual'});
  cookies=signIn.headers.getSetCookie().map(c=>c.split(';')[0]).join('; ');assert.ok(cookies);
  assert.equal((await request('/api/profiles','POST',null)).status,400);
  const overview=await request('/api/overview');assert.equal(overview.status,200);assert.equal(overview.data.papers.length,papers.length);
  const p1=await request('/api/profiles','POST',{name:'自动验证甲',code:testCode+'-a'});assert.equal(p1.status,201);profileIds.push(p1.data.profile.id);
  const p2=await request('/api/profiles','POST',{name:'自动验证乙',code:testCode+'-b'});assert.equal(p2.status,201);profileIds.push(p2.data.profile.id);
  assert.equal((await request('/api/profiles','POST',{name:'重复',code:testCode+'-a'})).status,409);
  const payload={profileId:profileIds[0],paperId:paper.id,durationMinutes:15};
  assert.equal((await request('/api/exams','POST',{...payload,durationMinutes:1})).status,400);
  const created=await Promise.all(Array.from({length:3},()=>request('/api/exams','POST',payload)));
  assert.ok(created.every(r=>r.status===200||r.status===201));
  assert.equal(new Set(created.map(r=>r.data.attempt.id)).size,1,'Concurrent start must produce one active attempt');
  const id=created[0].data.attempt.id;
  const publicPaper=created[0].data.paper;
  assert.ok(publicPaper.questions.every(q=>!('answer'in q)&&!('acceptedAnswers'in q)&&!('explanation'in q)),'Correct answers must not be sent during exam');
  const allCorrect=Object.fromEntries(paper.questions.map(q=>[q.id,q.answer]));
  assert.equal((await request(`/api/exams/${id}`,'PATCH',{answers:allCorrect,revision:2})).status,200);
  await request(`/api/exams/${id}`,'PATCH',{answers:{},revision:1});
  const resumed=await request(`/api/exams/${id}`);assert.equal(Object.keys(resumed.data.attempt.answers).length,paper.questions.length);assert.equal(resumed.data.attempt.revision,2);
  const submitted=await Promise.all([request(`/api/exams/${id}`,'POST',{answers:allCorrect,revision:3}),request(`/api/exams/${id}`,'POST',{answers:allCorrect,revision:3})]);
  assert.ok(submitted.every(r=>r.status===200&&r.data.result.score===paper.totalPoints));assert.ok(submitted.every(r=>r.data.attempt.status==='submitted'));
  const resubmit=await request(`/api/exams/${id}`,'POST',{answers:{},revision:999});assert.equal(resubmit.data.result.score,paper.totalPoints);
  const second=await request('/api/exams','POST',payload);assert.notEqual(second.data.attempt.id,id);
  const id2=second.data.attempt.id;const firstAnswer={[paper.questions[0].id]:paper.questions[0].answer};
  await request(`/api/exams/${id2}`,'PATCH',{answers:firstAnswer,revision:1});
  query('UPDATE attempts SET deadline=? WHERE id=?',Date.now()-1000,id2);
  const timeout=await request(`/api/exams/${id2}`,'POST',{answers:allCorrect,revision:2});
  assert.equal(timeout.data.attempt.timedOut,1);assert.equal(timeout.data.result.correctCount,1,'Answers after deadline must not replace saved draft');
  const third=await request('/api/exams','POST',{...payload,profileId:profileIds[1]});const id3=third.data.attempt.id;
  const blank=await request(`/api/exams/${id3}`,'POST',{answers:{},revision:1});assert.equal(blank.data.result.score,0);assert.equal(blank.data.result.accuracy,0);
  const history=await request('/api/overview');
  assert.equal(history.data.attempts.filter(a=>a.profileId===profileIds[0]).length,2);assert.equal(history.data.attempts.filter(a=>a.profileId===profileIds[1]).length,1);
  assert.ok(history.data.attempts.filter(a=>profileIds.includes(a.profileId)).every(a=>a.status==='submitted'));
  assert.equal((await request(`/api/exams/${id}`,'GET',undefined,false)).status,401);
  console.log(JSON.stringify({passed:true,papers:papers.length,questions:papers.reduce((n,p)=>n+p.questions.length,0),checks:['authentication','body validation','profile separation','duplicate profile rejection','duration validation','concurrent start','answer secrecy','autosave and resume','stale revision rejection','full-score grading','idempotent submit','immutable submitted records','repeated attempts','server deadline','blank grading','persistent history']},null,2));
}finally{
  for(const id of profileIds){query('DELETE FROM attempts WHERE profile_id=?',id);query('DELETE FROM profiles WHERE id=?',id)}
}
