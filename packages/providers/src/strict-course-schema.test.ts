import {it,expect} from 'vitest';
import {strictCourseSchema,omitCourseNulls} from './strict-course-schema.ts';
import {parseAndValidate} from './llm.ts';
it('requires optional wire fields as nullable without mutating the original validation schema',()=>{
 const source={type:'object',properties:{title:{type:'string',minLength:1},guidance:{type:'object',properties:{notes:{type:'string'}},required:['notes'],additionalProperties:false}},required:['title'],additionalProperties:false};
 const wire=strictCourseSchema(source) as any;
 expect(wire.required).toEqual(['title','guidance']);
 expect(wire.properties.guidance.anyOf[1]).toEqual({type:'null'});
 expect(wire.properties.guidance.anyOf[0].required).toEqual(['notes']);
 expect(source.required).toEqual(['title']);
 expect(parseAndValidate(JSON.stringify(omitCourseNulls({title:'test',guidance:null})),source)).toEqual({title:'test'});
 expect(()=>parseAndValidate(JSON.stringify(omitCourseNulls({title:null,guidance:null})),source)).toThrow();
 expect(()=>parseAndValidate(JSON.stringify(omitCourseNulls({title:'',guidance:null})),source)).toThrow();
});
it('retains exact identifiers in unions and keeps array validation local',()=>{
 expect(strictCourseSchema({anyOf:[{const:'source.a'},{const:'source.b'}]})).toEqual({anyOf:[{enum:['source.a']},{enum:['source.b']}]});
 const source={type:'array',items:{type:'string'},uniqueItems:true};
 expect(strictCourseSchema(source)).not.toHaveProperty('uniqueItems');
 expect(()=>parseAndValidate('["a","a"]',source)).toThrow();
});

it('closes placeholder source metadata objects required by strict structured output',()=>{
 expect(strictCourseSchema({type:'array',items:{type:'object'}})).toEqual({type:'array',items:{type:'object',properties:{},required:[],additionalProperties:false}});
});
