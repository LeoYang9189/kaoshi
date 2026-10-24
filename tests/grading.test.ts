import test from 'node:test';
import assert from 'node:assert/strict';
import {existsSync} from 'node:fs';
import {grade,isCorrect,cleanAnswers} from '../lib/grading';
import {papers,publicPaper,summaries} from '../lib/papers';
import type {Answers,Question} from '../lib/exam-types';

test('all eight source papers have exactly 752 complete, uniquely numbered questions',()=>{
  assert.equal(papers.length,8);assert.equal(papers.reduce((n,p)=>n+p.questions.length,0),752);
  const ids=new Set<string>();
  for(const p of papers){
    assert.equal(p.totalPoints,p.questions.reduce((n,q)=>n+q.points,0));
    assert([90,120].includes(p.durationMinutes),`${p.id}: invalid source duration`);
    assert.deepEqual(p.questions.map(q=>q.number),Array.from({length:p.questions.length},(_,i)=>i+1));
    for(const q of p.questions){
      assert(!ids.has(q.id));ids.add(q.id);assert(q.prompt.trim());assert(q.points>0);
      assert(q.answer,`${q.id}: missing answer`);assert(q.type!=='manual');
      assert.equal(q.options?.length,q.type==='boolean'?2:4);
      for(const a of Array.isArray(q.answer)?q.answer:[q.answer])assert(q.options?.some(o=>o.key===a),`${q.id}: invalid reference answer`);
      if(q.image)assert(existsSync(new URL('../public'+q.image,import.meta.url)),`${q.id}: missing image`);
    }
  }
});

for(const p of papers){
  test(`${p.id}: correct/blank/multiple scoring and main/FIATA totals`,()=>{
    const answers=Object.fromEntries(p.questions.map(q=>[q.id,q.answer])) as Answers;
    const result=grade(p,cleanAnswers(p,answers));
    assert.equal(result.score,p.totalPoints);assert.equal(result.correctCount,p.questions.length);assert.equal(result.accuracy,100);
    assert.equal(result.mainScore,100);assert.equal(result.bonusScore,p.subject==='business'?10:0);
    assert.equal(grade(p,{}).score,0);assert.equal(grade(p,{}).accuracy,0);
    for(const q of p.questions){
      assert(isCorrect(q,q.answer),q.id);
      if(q.type==='multiple'){
        const expected=q.answer as string[];
        assert(isCorrect(q,[...expected].reverse()),`${q.id}: unordered selections`);
        assert(!isCorrect(q,expected.slice(1)),`${q.id}: partial credit forbidden`);
        const wrong=q.options!.find(o=>!expected.includes(o.key));
        if(wrong)assert(!isCorrect(q,[...expected,wrong.key]),`${q.id}: extra option forbidden`);
      }else{
        const wrong=q.options!.find(o=>o.key!==q.answer)!;
        assert(!isCorrect(q,wrong.key),q.id);
      }
    }
  });
}

test('active exam payloads remove reference answers and explanations from every question',()=>{
  for(const p of papers){
    const pub=publicPaper(p);
    for(const q of pub.questions){assert(!('answer'in q));assert(!('acceptedAnswers'in q));assert(!('explanation'in q))}
    assert(p.questions.every(q=>q.answer),'public conversion mutated private answers');
  }
  for(const summary of summaries())assert(!('questions'in summary));
});

test('answer validation rejects malformed data and unknown options; ignores unrelated question IDs',()=>{
  const p=papers[0],q=p.questions[0],multi=p.questions.find(q=>q.type==='multiple')!;
  for(const input of [null,[],1,'A'])assert.throws(()=>cleanAnswers(p,input),/答案/);
  for(const value of [null,42,{},['A'],'Z','a'])assert.throws(()=>cleanAnswers(p,{[q.id]:value}),/答案|选项/);
  for(const value of ['A',['Z'],[{}],Array(11).fill('A')])assert.throws(()=>cleanAnswers(p,{[multi.id]:value}),/选项/);
  assert.deepEqual(cleanAnswers(p,{unrelated:'A'}),{});
  assert.deepEqual(cleanAnswers(p,{[multi.id]:['B','A','A']}),{[multi.id]:['A','B']});
});

test('text normalization and explicit manual grading stay distinct',()=>{
  const q:Question={id:'t',number:1,section:'text',type:'text',prompt:'term',points:1,answer:'Freight Forwarder',acceptedAnswers:['货运代理人']};
  assert(isCorrect(q,'  FREIGHT   FORWARDER  '));assert(isCorrect(q,'货运代理人'));assert(!isCorrect(q,''));
  assert(!isCorrect({...q,type:'manual'},'Freight Forwarder'));
});
