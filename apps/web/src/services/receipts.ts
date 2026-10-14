import type { Answers, Field } from '../../../../packages/contracts/src/index.js';
import { formatAnswer } from './fields.js';

export function receiptAnswers(fields: Field[], savedAnswers: Answers) {
  return fields
    .filter((field) => field.visibility === 'public' && field.source === 'user')
    .map((field) => {
      const value = savedAnswers[field.key];
      const empty =
        value === undefined || value === '' || (Array.isArray(value) && value.length === 0);
      return {
        key: field.key,
        label: field.label,
        value: empty ? '未填写' : formatAnswer(field, value),
      };
    });
}
