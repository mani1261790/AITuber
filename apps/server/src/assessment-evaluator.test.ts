import {expect,it,vi} from 'vitest';
import {FixedResponseLlmProvider} from '@aituber/providers';
import {quadraticFunctionsFixture} from '@aituber/content';
import {createAssessmentEvaluator} from './assessment-evaluator.ts';

it('grades the current answer in a new context without carrying over the previous incorrect verdict',async()=>{
 const provider=new FixedResponseLlmProvider([{judgment:'struggle',rationale:'量子化の目的がありません。'},{judgment:'confirmed',rationale:'量子化の目的とnum_predictの役割を説明しています。'}]);
 const create=vi.spyOn(provider,'createContext');
 const evaluate=createAssessmentEvaluator(()=>provider);
 const assessment={...quadraticFunctionsFixture.assessments[0]!,prompt:'量子化の目的とnum_predictの役割を説明してください。',rubric:{criteria:['量子化の目的を説明する。','num_predictは生成トークン数の上限である。'],commonMistakes:[]}};
 const first='num_predictは生成トークン数の上限';
 const second='量子化は数値の精度を下げて容量や計算負荷を軽くします。num_predictは生成トークン数の上限です。';
 expect((await evaluate({course:quadraticFunctionsFixture,assessment,answer:first})).judgment).toBe('struggle');
 expect((await evaluate({course:quadraticFunctionsFixture,assessment,answer:second})).judgment).toBe('confirmed');
 expect(create).toHaveBeenCalledTimes(2);
 expect(JSON.parse(provider.calls[1]!.prompt).answer).toBe(second);
 expect(provider.calls[1]!.prompt).not.toContain('量子化の目的がありません。');
});
