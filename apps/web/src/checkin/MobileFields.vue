<script setup lang="ts">
import { ref } from 'vue';
import {
  Field as VanField,
  Popup as VanPopup,
  Picker as VanPicker,
  Checkbox as VanCheckbox,
  CheckboxGroup as VanCheckboxGroup,
  Button as VanButton,
  Switch as VanSwitch,
} from 'vant';
import type { Field, Answer, Answers } from '../../../../packages/contracts/src/index';
import { fieldLabel, t } from '../services/locale';
const props = defineProps<{ fields: Field[]; modelValue: Answers }>();
const emit = defineEmits<{ 'update:modelValue': [Answers] }>();
const selected = ref<Field>(),
  popup = ref(false),
  multiple = ref<string[]>([]);
function update(key: string, value: Answer) {
  emit('update:modelValue', { ...props.modelValue, [key]: value });
}
const display = (f: Field) => {
  const value = props.modelValue[f.key];
  return Array.isArray(value)
    ? value.map((v) => f.options.find((o) => o.key === v)?.label ?? v).join('、')
    : (f.options.find((o) => o.key === value)?.label ?? '');
};
function open(f: Field) {
  selected.value = f;
  multiple.value = Array.isArray(props.modelValue[f.key])
    ? [...(props.modelValue[f.key] as string[])]
    : [];
  popup.value = true;
}
function confirm(e: { selectedValues: Array<string | number> }) {
  if (selected.value) update(selected.value.key, String(e.selectedValues[0] ?? ''));
  popup.value = false;
}
</script>
<template>
  <div>
    <template v-for="field in fields" :key="field.key"
      ><van-field
        v-if="field.type === 'select' || field.type === 'multiselect'"
        :model-value="display(field)"
        :name="field.key"
        :label="fieldLabel(field)"
        label-align="top"
        readonly
        is-link
        :required="field.required"
        :placeholder="field.help_text || t('请选择', 'Please select')"
        :rules="[
          {
            required: field.required,
            message: t(`请选择${fieldLabel(field)}`, `Please select ${fieldLabel(field)}`),
          },
        ]"
        @click="open(field)" /><van-field
        v-else-if="field.type === 'boolean'"
        :name="field.key"
        :label="fieldLabel(field)"
        label-align="top"
        :required="field.required"
        :rules="[
          {
            validator: () => !field.required || props.modelValue[field.key] === true,
            message: t(`请确认${fieldLabel(field)}`, `Please confirm ${fieldLabel(field)}`),
          },
        ]"
        :model-value="modelValue[field.key] ? t('已确认', 'Confirmed') : ''"
        ><template #input
          ><van-switch
            :model-value="Boolean(modelValue[field.key])"
            size="23px"
            @update:model-value="(v) => update(field.key, v)" /></template></van-field
      ><van-field
        v-else-if="field.type === 'date'"
        :model-value="String(modelValue[field.key] ?? '')"
        :name="field.key"
        :label="fieldLabel(field)"
        label-align="top"
        :required="field.required"
        :rules="[
          {
            required: field.required,
            message: t(`请填写${fieldLabel(field)}`, `Please enter ${fieldLabel(field)}`),
          },
        ]"
        ><template #input
          ><input
            class="mobile-date"
            type="date"
            :value="String(modelValue[field.key] ?? '')"
            :aria-label="fieldLabel(field)"
            @input="
              (e) => update(field.key, (e.target as HTMLInputElement).value)
            " /></template></van-field
      ><van-field
        v-else
        :model-value="String(modelValue[field.key] ?? '')"
        :name="field.key"
        :label="fieldLabel(field)"
        label-align="top"
        :type="
          field.type === 'textarea'
            ? 'textarea'
            : field.type === 'number'
              ? 'number'
              : field.type === 'phone'
                ? 'tel'
                : 'text'
        "
        :inputmode="
          field.type === 'phone' ? 'tel' : field.type === 'number' ? 'decimal' : undefined
        "
        :autocomplete="field.type === 'email' ? 'email' : field.type === 'phone' ? 'tel' : 'off'"
        :required="field.required"
        :maxlength="field.max_length"
        :placeholder="
          field.help_text || t(`请输入${fieldLabel(field)}`, `Please enter ${fieldLabel(field)}`)
        "
        :rules="[
          {
            required: field.required,
            message: t(`请填写${fieldLabel(field)}`, `Please enter ${fieldLabel(field)}`),
          },
        ]"
        @update:model-value="
          (v) => update(field.key, field.type === 'number' && v !== '' ? Number(v) : v)
        " /></template
    ><van-popup v-model:show="popup" position="bottom" round safe-area-inset-bottom
      ><van-picker
        v-if="selected?.type === 'select'"
        :title="fieldLabel(selected)"
        :columns="selected.options.map((o) => ({ text: o.label, value: o.key }))"
        :confirm-button-text="t('确认', 'Confirm')"
        :cancel-button-text="t('取消', 'Cancel')"
        @confirm="confirm"
        @cancel="popup = false"
      />
      <div v-else-if="selected" class="multi-picker">
        <h3>{{ fieldLabel(selected) }}</h3>
        <van-checkbox-group v-model="multiple"
          ><van-checkbox v-for="option in selected.options" :key="option.key" :name="option.key">{{
            option.label
          }}</van-checkbox></van-checkbox-group
        ><van-button
          block
          type="primary"
          @click="
            update(selected!.key, multiple);
            popup = false;
          "
          >{{ t('确认选择', 'Confirm selection') }}</van-button
        >
      </div></van-popup
    >
  </div>
</template>
<style scoped>
.mobile-date {
  border: 0;
  background: transparent;
  color: #3f483b;
  font-size: 16px;
  min-height: 44px;
  line-height: 1.5;
  padding: 8px 0;
  max-width: 100%;
  width: 100%;
}
.multi-picker {
  padding: 25px 24px;
}
.multi-picker h3 {
  font-size: 17px;
  margin-bottom: 25px;
}
.multi-picker .van-checkbox {
  min-height: 48px;
  margin: 5px 0;
}
.multi-picker .van-button {
  margin-top: 25px;
}
</style>
