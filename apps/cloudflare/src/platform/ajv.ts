import { Validator, type Schema } from '@cfworker/json-schema';
/** Workers cannot dynamically compile Ajv's generated functions. */
export default class Ajv {
  constructor(options?: unknown) { void options; }
  compile(schema: Schema) {
    const validator = new Validator(schema, '7', false);
    const validate = Object.assign((value: unknown) => {
      const result = validator.validate(value);
      validate.errors = result.errors.map(error=>({instancePath:error.instanceLocation, message:error.error}));
      return result.valid;
    }, {errors: [] as {instancePath:string;message:string}[]});
    return validate;
  }
}
