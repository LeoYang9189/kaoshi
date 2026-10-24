export type Question = { id: string; number: number; section: string; type: 'single'|'multiple'|'boolean'|'text'|'manual'; prompt: string; options?: {key:string;text:string}[]; answer?: string|string[]; acceptedAnswers?: string[]; points:number; explanation?:string; sourcePage?:number; context?:string; image?:string };
export type Paper = {id:string; year:number; subject:string; title:string; durationMinutes:number; totalPoints:number; sourceFiles:string[]; instructions:string; questions:Question[]};
export type Answers = Record<string,string|string[]>;
export type Profile = {id:string; name:string; code:string; createdAt:number};
export type PaperSummary = Omit<Paper,'questions'> & {questionCount:number; sections:string[]};
export type Attempt = {id:string; profileId:string; paperId:string; startedAt:number; deadline:number; submittedAt:number|null; durationMinutes:number; status:string; answers:Answers; revision:number; score:number|null; totalPoints:number; correctCount:number|null; questionCount:number; accuracy:number|null; timedOut:number; mainScore?:number; bonusScore?:number};
export type Review = {questionId:string; correct:boolean; earned:number; expected:string|string[]; explanation:string};
