import type {CourseSummary} from '@aituber/contracts';
export const materialGroups=[{id:'festival',label:'学園祭デモ'},{id:'ai',label:'AI・ローカルLLM'},{id:'statistics',label:'多変量モデル'},{id:'other',label:'その他'}] as const;
export type MaterialGroup=typeof materialGroups[number]['id'];
const titles:Record<string,string>={
 'festival-aituber-intro-4slides-20261101':'AITuberの仕組み（ショートデモ）',
 'festival-veritas-learning-15slides':'AIの学習の仕組み（VERITAS・長尺版）',
 'festival-veritas-learning-12slides':'AIの学習の仕組み（旧12枚版）',
 'ai-learning-basics':'AIの学習の仕組み（VERITAS）',
 'confounding-causal-comparison':'交絡と因果関係',
};
const order=['festival-aituber-intro-4slides-20261101','festival-veritas-learning-15slides','local-llm-ollama-intro','ai-learning-basics','confounding-causal-comparison','multivariable-conditional-comparison','multivariable-mantel-haenszel','multivariable-logistic-regression','multivariable-poisson-regression','multivariable-cox-model','multivariable-model-checks'];
export function materialTitle(course:CourseSummary){return titles[course.id]??course.title;}
export function isPreviousMaterial(course:CourseSummary){return course.id==='festival-veritas-learning-12slides';}
export function materialGroup(course:CourseSummary):MaterialGroup{if(course.id.startsWith('festival-'))return 'festival';if(course.id.startsWith('multivariable-')||course.id==='confounding-causal-comparison')return 'statistics';if(course.id==='ai-learning-basics'||course.id==='local-llm-ollama-intro')return 'ai';return 'other';}
export function catalogMatches(course:CourseSummary,query:string){const words=query.normalize('NFKC').toLocaleLowerCase().trim().split(/\s+/).filter(Boolean);const text=[materialTitle(course),course.title,course.targetLevel,...course.learningGoals.map(g=>g.description)].join(' ').normalize('NFKC').toLocaleLowerCase();return words.every(word=>text.includes(word));}
export function sortMaterials(courses:CourseSummary[]){return [...courses].sort((a,b)=>{const rank=(id:string)=>{const n=order.indexOf(id);return n<0?order.length:n;};return rank(a.id)-rank(b.id)||materialTitle(a).localeCompare(materialTitle(b),'ja');});}
