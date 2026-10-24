import y2021 from '../data/2021.json';
import y2022 from '../data/2022.json';
import y2023 from '../data/2023.json';
import y2024 from '../data/2024.json';
import type {Paper} from './exam-types';
export const papers=[...y2024,...y2023,...y2022,...y2021] as Paper[];
export const getPaper=(id:string)=>papers.find(p=>p.id===id);
export const summaries=()=>papers.map(({questions,...p})=>({...p,questionCount:questions.length,sections:[...new Set(questions.map(q=>q.section))]}));
export function publicPaper(paper:Paper) {return {...paper,questions:paper.questions.map(({answer,acceptedAnswers,explanation,...q})=>q)};}
