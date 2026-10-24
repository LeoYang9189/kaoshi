import type {Answers,Paper,Question} from './exam-types';
const normalize = (v:unknown) => String(v ?? '').normalize('NFKC').trim().replace(/\s+/g,' ').toLowerCase();
export function isCorrect(q:Question,value:unknown):boolean {
  if(q.type==='manual') return false;
  if(q.type==='multiple') {
    if(!Array.isArray(value)) return false;
    const actual=[...new Set(value.map(normalize))].sort();
    const expected=(Array.isArray(q.answer)?q.answer:[String(q.answer)]).map(normalize).sort();
    return actual.length===expected.length && actual.every((v,i)=>v===expected[i]);
  }
  if(Array.isArray(value)||value===undefined||normalize(value)==='') return false;
  return [...(Array.isArray(q.answer)?q.answer:[q.answer]),...(q.acceptedAnswers??[])].some(a=>normalize(a)===normalize(value));
}
export function grade(paper:Paper,answers:Answers) {
  const review=paper.questions.map(q=>({questionId:q.id,correct:isCorrect(q,answers[q.id]),earned:isCorrect(q,answers[q.id])?q.points:0,expected:q.answer??'',explanation:q.explanation??''}));
  const score=review.reduce((s,r)=>s+r.earned,0);
  const correctCount=review.filter(r=>r.correct).length;
  const bonusScore=review.reduce((s,r,i)=>s+(/FIATA|附加/i.test(paper.questions[i].section)?r.earned:0),0);
  return {score:Math.round(score*100)/100,correctCount,accuracy:Math.round(correctCount/paper.questions.length*10000)/100,mainScore:Math.round((score-bonusScore)*100)/100,bonusScore,review};
}
export function cleanAnswers(paper:Paper,input:unknown):Answers {
  if(!input || typeof input!=='object' || Array.isArray(input)) throw new Error('答案格式不正确');
  const answers:Answers={};
  for(const q of paper.questions) {
    const v=(input as Answers)[q.id];
    if(v===undefined || v==='') continue;
    if(q.type==='multiple') {
      if(!Array.isArray(v)||v.length>10||v.some(k=>!q.options?.some(o=>o.key===k))) throw new Error('选项不正确');
      answers[q.id]=[...new Set(v)].sort();
    } else {
      if(typeof v!=='string'||v.length>5000) throw new Error('答案格式不正确');
      if(q.options?.length&&!q.options.some(o=>o.key===v)) throw new Error('选项不正确');
      answers[q.id]=v;
    }
  }
  return answers;
}

// Compare the selected answers, independent of JSON key order, duplicate or
// reordered multiple-choice selections, and absent versus empty selections.
export function sameAnswers(paper:Paper,left:unknown,right:unknown):boolean {
  const signature=(input:unknown)=>{
    const cleaned=cleanAnswers(paper,input);
    return JSON.stringify(paper.questions.map(q=>{
      const value=cleaned[q.id];
      return value===undefined||(Array.isArray(value)&&!value.length)?null:value;
    }));
  };
  return signature(left)===signature(right);
}
