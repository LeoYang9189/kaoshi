import test,{beforeEach,afterEach,mock} from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync,readdirSync} from 'node:fs';
import {ApiError,body,owner,loadAttempt,persist,finalize,examPayload,assertOrigin} from '../lib/exam-server';
import {papers} from '../lib/papers';
import {POST as startExam} from '../app/api/exams/route';
import {POST as createProfile} from '../app/api/profiles/route';
import {GET as getExam,POST as submitExam,PATCH as saveExam} from '../app/api/exams/[id]/route';
import {GET as overview} from '../app/api/overview/route';
import {GET as exportCsv} from '../app/api/export/route';

type Globals={__examTestDB:unknown;__examTestUser:{userId:string}|null};
const globals=globalThis as unknown as Globals;
let sqlite:DatabaseSync;
let time=2000000000000;
let beforeQuery:((sql:string)=>void)|undefined;
const paper=papers[0];
const question=paper.questions[0];
function request(path:string,value:unknown,extra:HeadersInit={}){return new Request('https://exam.example'+path,{method:'POST',headers:{'content-type':'application/json','origin':'https://exam.example',...extra},body:JSON.stringify(value)})}
function dbRow(id='exam-a'){return sqlite.prepare('SELECT * FROM attempts WHERE id=?').get(id)!}
function insertAttempt(id='exam-a',ownerId='owner-a',profileId='profile-a',deadline=time+60000){sqlite.prepare('INSERT INTO attempts (id,owner_id,profile_id,paper_id,started_at,deadline,duration_minutes,status,total_points,question_count) VALUES (?,?,?,?,?,?,?,?,?,?)').run(id,ownerId,profileId,paper.id,time,deadline,90,'in_progress',paper.totalPoints,paper.questions.length)}
function correctSnapshot(){return Object.fromEntries(paper.questions.map(q=>[q.id,q.answer]))}

beforeEach(()=>{
  time=2000000000000;mock.method(Date,'now',()=>time);beforeQuery=undefined;
  sqlite=new DatabaseSync(':memory:');
  for(const f of readdirSync(new URL('../drizzle/',import.meta.url)).filter(f=>f.endsWith('.sql')).sort())sqlite.exec(readFileSync(new URL('../drizzle/'+f,import.meta.url),'utf8'));
  globals.__examTestDB={prepare(sql:string){return {bind(...values:unknown[]){
    const execute=()=>{beforeQuery?.(sql);return sqlite.prepare(sql)};
    return {async first(){return execute().get(...values as [])??null},async all(){return {results:execute().all(...values as [])}},async run(){return execute().run(...values as [])}};
  }}}};
  globals.__examTestUser={userId:'owner-a'};
  sqlite.prepare('INSERT INTO profiles VALUES (?,?,?,?,?)').run('profile-a','owner-a','甲','A',time);
  sqlite.prepare('INSERT INTO profiles VALUES (?,?,?,?,?)').run('profile-b','owner-b','乙','B',time);
});
afterEach(()=>{beforeQuery=undefined;mock.restoreAll();sqlite.close()});

test('missing authentication and another owner cannot read, save, submit, or select a candidate',async()=>{
  globals.__examTestUser=null;await assert.rejects(owner(),(e:unknown)=>e instanceof ApiError&&e.status===401);
  globals.__examTestUser={userId:'owner-a'};insertAttempt('other','owner-b','profile-b');
  for(const action of [()=>loadAttempt('other','owner-a'),()=>persist('other','owner-a',{revision:1,answers:{}}),()=>finalize('other','owner-a')])await assert.rejects(action(),(e:unknown)=>e instanceof ApiError&&e.status===404);
  assert.equal((await getExam(request('/api/exams/other',{}),{params:Promise.resolve({id:'other'})})).status,404);
  assert.equal((await startExam(request('/api/exams',{profileId:'profile-b',paperId:paper.id,durationMinutes:90}))).status,400);
  const payload=await (await overview()).json() as {profiles:unknown[];attempts:unknown[]};assert.equal(payload.profiles.length,1);assert.equal(payload.attempts.length,0);
});

test('concurrent starts produce one active attempt; distinct owners remain independent',async()=>{
  const payload={profileId:'profile-a',paperId:paper.id,durationMinutes:90};
  const responses=await Promise.all(Array.from({length:8},()=>startExam(request('/api/exams',payload))));
  const attempts=await Promise.all(responses.map(async r=>await r.json() as ReturnType<typeof examPayload>));
  assert.equal(new Set(attempts.map(a=>a.attempt.id)).size,1);assert.equal(responses.filter(r=>r.status===201).length,1);
  assert.equal(sqlite.prepare('SELECT count(*) AS n FROM attempts').get()!.n,1);
  assert.equal(attempts[0].attempt.deadline,time+90*60000);
  globals.__examTestUser={userId:'owner-b'};
  assert.equal((await startExam(request('/api/exams',{...payload,profileId:'profile-b'}))).status,201);
});

test('profile uniqueness is atomic and scoped to the authenticated owner',async()=>{
  const responses=await Promise.all(Array.from({length:4},()=>createProfile(request('/api/profiles',{name:'考生',code:'001'}))));
  assert.deepEqual(responses.map(r=>r.status).sort(),[201,409,409,409]);
  globals.__examTestUser={userId:'owner-b'};assert.equal((await createProfile(request('/api/profiles',{name:'另一人',code:'001'}))).status,201);
});

test('older/out-of-order saves never overwrite newer snapshots',async()=>{
  insertAttempt();
  await Promise.all([persist('exam-a','owner-a',{revision:3,answers:{[question.id]:question.answer}}),persist('exam-a','owner-a',{revision:2,answers:{}})]);
  const saved=await persist('exam-a','owner-a',{revision:1,answers:{}});
  assert.equal(saved.revision,3);assert.deepEqual(saved.answers,{[question.id]:question.answer});
  await assert.rejects(persist('exam-a','owner-a',{revision:1.5,answers:{}}),/版本/);
});

test('server deadline rejects late answers and finalizes using the last saved snapshot',async()=>{
  insertAttempt();await persist('exam-a','owner-a',{revision:1,answers:{[question.id]:question.answer}});
  time+=60000;
  const submitted=await persist('exam-a','owner-a',{revision:2,answers:correctSnapshot(),deadline:time+9999999});
  assert.equal(submitted.status,'submitted');assert.equal(submitted.timedOut,1);assert.equal(submitted.submittedAt,submitted.deadline);
  assert.equal(submitted.score,question.points);assert.equal(submitted.revision,1);
});

test('save that crosses the deadline returns a finalized state',async()=>{
  insertAttempt();beforeQuery=(sql)=>{if(sql.startsWith('UPDATE attempts SET answers'))time+=60000};
  const result=await persist('exam-a','owner-a',{revision:1,answers:{}});
  assert.equal(result.status,'submitted');assert.equal(result.timedOut,1);
});

test('parallel submit is idempotent and later saves cannot regress the completed attempt',async()=>{
  insertAttempt();await persist('exam-a','owner-a',{revision:1,answers:correctSnapshot()});
  const results=await Promise.all(Array.from({length:8},()=>finalize('exam-a','owner-a')));
  assert(results.every(a=>a.score===paper.totalPoints&&a.status==='submitted'));
  const original=dbRow();time+=1000;
  await persist('exam-a','owner-a',{revision:999,answers:{}});await finalize('exam-a','owner-a');assert.deepEqual(dbRow(),original);
  assert.equal(examPayload(results[0]).result!.mainScore,100);
  assert.equal(examPayload(results[0]).result!.bonusScore,10);
});

test('finalization retries when a concurrent save advances the revision',async()=>{
  insertAttempt();let changed=false;
  beforeQuery=(sql)=>{if(sql.startsWith('UPDATE attempts SET status')&&!changed){changed=true;sqlite.prepare('UPDATE attempts SET answers=?,revision=1 WHERE id=?').run(JSON.stringify(correctSnapshot()),'exam-a')}};
  const result=await finalize('exam-a','owner-a');assert(changed);assert.equal(result.score,paper.totalPoints);assert.equal(result.revision,1);
});

test('submitted API response uses server score and submitted exam review; active response hides keys',async()=>{
  insertAttempt();const active=examPayload(await loadAttempt('exam-a','owner-a'));assert.equal(active.result,null);assert(!('answer'in active.paper.questions[0]));
  const response=await submitExam(request('/api/exams/exam-a',{revision:1,answers:correctSnapshot(),score:0,ownerId:'owner-b'}),{params:Promise.resolve({id:'exam-a'})});
  const payload=await response.json() as ReturnType<typeof examPayload>;assert.equal(response.status,200);assert.equal(payload.attempt.score,paper.totalPoints);assert.equal(payload.result!.accuracy,100);assert('answer'in payload.paper.questions[0]);
});

test('request validation rejects null, arrays, oversized chunked bodies, and cross-origin writes',async()=>{
  for(const value of [null,[],true,'bad'])await assert.rejects(body(request('/',value)),/格式/);
  const stream=new ReadableStream({start(c){c.enqueue(new TextEncoder().encode('{"x":"'+'x'.repeat(100001)+'"}'));c.close()}});
  const oversized=new Request('https://exam.example',{method:'POST',body:stream,duplex:'half'} as RequestInit);
  await assert.rejects(body(oversized),(e:unknown)=>e instanceof ApiError&&e.status===413);
  assert.throws(()=>assertOrigin(request('/',{},{origin:'https://other.example'})),(e:unknown)=>e instanceof ApiError&&e.status===403);
  assert.equal((await startExam(request('/api/exams',null))).status,400);
  assert.equal((await startExam(request('/api/exams',{profileId:'profile-a',paperId:paper.id,durationMinutes:'90'}))).status,400);
});

test('equal revisions with different snapshots explicitly report an unaccepted save',async()=>{
  insertAttempt();await persist('exam-a','owner-a',{revision:1,answers:{[question.id]:question.answer}});
  const response=await saveExam(request('/api/exams/exam-a',{revision:1,answers:{}}),{params:Promise.resolve({id:'exam-a'})});
  const payload=await response.json() as {accepted:boolean;acceptedRevision:number|null;revision:number;message:string};
  assert.equal(response.status,200);assert.equal(payload.accepted,false);assert.equal(payload.acceptedRevision,null);assert.equal(payload.revision,1);assert.match(payload.message,/当前草稿未同步/);
  assert.deepEqual(JSON.parse(String(dbRow().answers)),{[question.id]:question.answer});
});

test('equivalent snapshots acknowledge only the requested revision, not another client revision',async()=>{
  insertAttempt();const multi=paper.questions.find(q=>q.type==='multiple')!;
  await persist('exam-a','owner-a',{revision:3,answers:{[question.id]:question.answer,[multi.id]:['A','B']}});
  for(const revision of [3,1]){
    const response=await saveExam(request('/api/exams/exam-a',{revision,answers:{[multi.id]:['B','A','A'],[question.id]:question.answer}}),{params:Promise.resolve({id:'exam-a'})});
    const payload=await response.json() as {accepted:boolean;acceptedRevision:number;revision:number};
    assert.equal(payload.accepted,true);assert.equal(payload.acceptedRevision,revision);assert.equal(payload.revision,3);
  }
});

test('stale submission cannot silently submit a different persisted snapshot',async()=>{
  insertAttempt();await persist('exam-a','owner-a',{revision:3,answers:correctSnapshot()});
  const response=await submitExam(request('/api/exams/exam-a',{revision:2,answers:{}}),{params:Promise.resolve({id:'exam-a'})});
  assert.equal(response.status,409);assert.match((await response.json() as {error:string}).error,/当前草稿未同步/);
  assert.equal(dbRow().status,'in_progress');assert.equal(dbRow().score,null);
});

test('a save racing after submission validation cannot change the submitted snapshot',async()=>{
  insertAttempt();let changed=false;
  beforeQuery=(sql)=>{if(sql.startsWith('UPDATE attempts SET status')&&!changed){changed=true;sqlite.prepare('UPDATE attempts SET answers=?,revision=2 WHERE id=?').run('{}','exam-a')}};
  const response=await submitExam(request('/api/exams/exam-a',{revision:1,answers:correctSnapshot()}),{params:Promise.resolve({id:'exam-a'})});
  assert(changed);assert.equal(response.status,409);assert.equal(dbRow().status,'in_progress');assert.equal(dbRow().revision,2);
});

test('late submission still finalizes the saved answers instead of accepting a late snapshot',async()=>{
  insertAttempt();await persist('exam-a','owner-a',{revision:1,answers:{[question.id]:question.answer}});time+=60000;
  const response=await submitExam(request('/api/exams/exam-a',{revision:2,answers:correctSnapshot()}),{params:Promise.resolve({id:'exam-a'})});
  const payload=await response.json() as ReturnType<typeof examPayload>;
  assert.equal(response.status,200);assert.equal(payload.attempt.status,'submitted');assert.equal(payload.attempt.timedOut,1);assert.equal(payload.attempt.score,question.points);
});

test('CSV export isolates owners and supports one or all of their candidate profiles',async()=>{
  sqlite.prepare('INSERT INTO profiles VALUES (?,?,?,?,?)').run('profile-c','owner-a','丙','C',time);
  for(const [id,oid,pid] of [['a','owner-a','profile-a'],['b','owner-b','profile-b'],['c','owner-a','profile-c']]){insertAttempt(id,oid,pid);await finalize(id,oid)}
  insertAttempt('unfinished','owner-a','profile-a');
  const all=await exportCsv(new Request('https://exam.example/api/export'));
  assert.equal(all.status,200);assert.match(all.headers.get('Content-Disposition')!,/^attachment;.*filename\*=UTF-8''/);assert.match(all.headers.get('Content-Type')!,/text\/csv/);assert.equal(all.headers.get('Cache-Control'),'no-store');
  const bytes=new Uint8Array(await all.arrayBuffer());assert.deepEqual([...bytes.slice(0,3)],[239,187,191]);
  const csv=new TextDecoder().decode(bytes);assert(csv.includes('"甲","A"'));assert(csv.includes('"丙","C"'));assert(!csv.includes('"乙","B"'));assert.equal(csv.trim().split('\r\n').length,3);
  const only=await exportCsv(new Request('https://exam.example/api/export?profileId=profile-c'));const one=await only.text();assert(one.includes('"丙","C"'));assert(!one.includes('"甲","A"'));assert.equal(one.trim().split('\r\n').length,2);
  assert.equal((await exportCsv(new Request('https://exam.example/api/export?profileId=profile-b'))).status,404);
  assert.equal((await exportCsv(new Request('https://exam.example/api/export?profileId=missing'))).status,404);
  globals.__examTestUser=null;assert.equal((await exportCsv(new Request('https://exam.example/api/export'))).status,401);
});

test('CSV export escapes quotes and neutralizes formula-like names and codes',async()=>{
  sqlite.prepare('UPDATE profiles SET name=?,code=? WHERE id=?').run('=HYPERLINK("x")','\t+SUM(1,2)','profile-a');
  insertAttempt();await finalize('exam-a','owner-a');
  const response=await exportCsv(new Request('https://exam.example/api/export?profileId=profile-a'));const csv=await response.text();
  assert(csv.includes('"\'=HYPERLINK(""x"")"'));assert(csv.includes('"\'\t+SUM(1,2)"'));
  assert.match(response.headers.get('Content-Disposition')!,/filename\*=UTF-8''/);assert(!response.headers.get('Content-Disposition')!.includes('\n'));
});
