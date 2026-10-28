import {expect,it} from 'vitest';
import {fallbackCommentTriage} from './comment-classifier.ts';
it('does not silently send questions to after-class when the classifier is unavailable',()=>{
 expect(fallbackCommentTriage('トークンについて、黒板使って教えて')).toBe('immediate');
 expect(fallbackCommentTriage('何が違う？')).toBe('immediate');
 expect(fallbackCommentTriage('授業後にトークンについて教えて')).toBe('later');
 expect(fallbackCommentTriage('ありがとう！')).toBe('ignore');
});
