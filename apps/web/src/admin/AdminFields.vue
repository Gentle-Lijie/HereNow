<script setup lang="ts">
import {
  Input as AInput,
  Textarea as AInputTextarea,
  InputNumber as AInputNumber,
  Select as ASelect,
  Switch as ASwitch,
  FormItem as AFormItem,
} from 'ant-design-vue';
import type { Field, Answers, Answer } from '../../../../packages/contracts/src/index';
const props = defineProps<{ fields: Field[]; modelValue: Answers }>();
const emit = defineEmits<{ 'update:modelValue': [Answers] }>();
const numericValue = (key: string): number | undefined => {
  const v = props.modelValue[key];
  return typeof v === 'number' ? v : undefined;
};
const selectValue = (key: string): string | string[] | undefined => {
  const v = props.modelValue[key];
  return typeof v === 'string' || Array.isArray(v) ? v : undefined;
};
function selectUpdate(key: string, value: unknown) {
  if (typeof value === 'string') update(key, value);
  else if (Array.isArray(value) && value.every((v) => typeof v === 'string'))
    update(key, value as string[]);
  else if (value === undefined) update(key, undefined);
}
const update = (key: string, value: Answer | undefined) => {
  const next = { ...props.modelValue };
  if (value === undefined) delete next[key];
  else next[key] = value;
  emit('update:modelValue', next);
};
</script>
<template>
  <template
    v-for="field in fields.filter((f) => f.source === 'user' && f.visibility === 'public')"
    :key="field.key"
    ><a-form-item :label="field.label" :required="field.required"
      ><a-select
        v-if="field.type === 'select' || field.type === 'multiselect'"
        :value="selectValue(field.key)"
        :mode="field.type === 'multiselect' ? 'multiple' : undefined"
        :options="field.options.map((o) => ({ value: o.key, label: o.label }))"
        :placeholder="field.help_text || '请选择'"
        @update:value="(v) => selectUpdate(field.key, v)" /><a-switch
        v-else-if="field.type === 'boolean'"
        :checked="Boolean(modelValue[field.key])"
        @update:checked="(v) => update(field.key, v)" /><a-input-number
        v-else-if="field.type === 'number'"
        :value="numericValue(field.key)"
        style="width: 100%"
        @update:value="(v) => update(field.key, v ?? undefined)" /><a-input-textarea
        v-else-if="field.type === 'textarea'"
        :value="String(modelValue[field.key] ?? '')"
        :maxlength="field.max_length"
        @update:value="(v) => update(field.key, v)" /><input
        v-else-if="field.type === 'date'"
        class="native-input"
        type="date"
        :value="String(modelValue[field.key] ?? '')"
        @input="(e) => update(field.key, (e.target as HTMLInputElement).value)" /><a-input
        v-else
        :value="String(modelValue[field.key] ?? '')"
        :placeholder="field.help_text"
        :maxlength="field.max_length"
        @update:value="(v) => update(field.key, v)" /></a-form-item
  ></template>
</template>
