import type { Answers, Field } from '../../../../packages/contracts/src/index.js';
import { formatAnswer } from './fields.js';
import { fieldLabel, type Locale } from './locale.js';

export function receiptAnswers(fields: Field[], savedAnswers: Answers, locale: Locale = 'zh') {
  return fields
    .filter((field) => field.visibility === 'public' && field.source === 'user')
    .map((field) => {
      const value = savedAnswers[field.key];
      const empty =
        value === undefined || value === '' || (Array.isArray(value) && value.length === 0);
      return {
        key: field.key,
        label: fieldLabel(field, locale),
        value: empty
          ? locale === 'zh'
            ? '未填写'
            : 'Not provided'
          : formatAnswer(field, value, locale),
      };
    });
}
