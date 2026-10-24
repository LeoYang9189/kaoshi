import ExamApp from '../components/exam-app';
import {summaries} from '../lib/papers';
export default function Home(){return <ExamApp initialPapers={summaries()}/>}
