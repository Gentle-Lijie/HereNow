<script setup lang="ts">
import { onMounted, onBeforeUnmount, reactive, ref, computed } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import {
  Button as AButton,
  Input as AInput,
  Textarea as AInputTextarea,
  InputNumber as AInputNumber,
  Select as ASelect,
  Switch as ASwitch,
  Form as AForm,
  FormItem as AFormItem,
  Modal,
  message,
} from 'ant-design-vue';
import {
  ArrowLeftOutlined,
  PlusOutlined,
  ArrowUpOutlined,
  ArrowDownOutlined,
  DeleteOutlined,
  ArrowRightOutlined,
  UploadOutlined,
} from '@ant-design/icons-vue';
import {
  eventInputSchema,
  fieldSchema,
  stateLabels,
  fieldTypes,
  type EventRecord,
  type Field,
} from '../../../../packages/contracts/src/index';
import { api, errorMessage, formatTime } from '../services/api';
import { toZonedInput, fromZonedInput } from '../services/time';
import MapPicker from './MapPicker.vue';
import EventBrand from '../components/EventBrand.vue';
import { prepareEventLogo } from '../services/event-logo';
const logoInput = ref<HTMLInputElement>(),
  logoLoading = ref(false);
let logoRevision = 0;
async function selectLogo(e: Event) {
  const file = (e.target as HTMLInputElement).files?.[0];
  if (!file) return;
  const revision = ++logoRevision;
  logoLoading.value = true;
  try {
    const logo = await prepareEventLogo(file);
    if (revision === logoRevision) {
      form.checkin_logo = logo;
      error.value = '';
    }
  } catch (cause) {
    if (revision === logoRevision) error.value = errorMessage(cause);
  } finally {
    if (revision === logoRevision) {
      logoLoading.value = false;
      if (logoInput.value) logoInput.value.value = '';
    }
  }
}
onBeforeUnmount(() => {
  logoRevision++;
});
const route = useRoute(),
  router = useRouter(),
  id = computed(() => (route.params.id ? String(route.params.id) : null)),
  event = ref<EventRecord>(),
  saving = ref(false),
  loading = ref(false),
  error = ref('');
const now = new Date();
const localDate = (date: Date) => toZonedInput(date.toISOString(), 'Asia/Shanghai');
const starts = ref(localDate(now)),
  ends = ref(localDate(new Date(now.getTime() + 7200000)));
const form = reactive(
  eventInputSchema.parse({
    name: '未命名活动',
    organizer: '主办方',
    starts_at: now.toISOString(),
    ends_at: new Date(now.getTime() + 7200000).toISOString(),
  }),
);
form.name = '';
form.organizer = '';
const locked = computed(() => Boolean(event.value?.configuration_locked));
const checkinStartPreview = computed(() => {
  try {
    const opening =
      Date.parse(fromZonedInput(starts.value, form.timezone)) -
      (form.checkin_early_minutes ?? 0) * 60000;
    return formatTime(new Date(opening).toISOString(), form.timezone);
  } catch {
    return '请填写有效的开始时间';
  }
});
const labels: Record<Field['type'], string> = {
  text: '单行文本',
  textarea: '多行文本',
  phone: '手机号',
  email: '邮箱',
  number: '数字',
  date: '日期',
  select: '单选',
  multiselect: '多选',
  boolean: '确认',
};
const fieldOptions = fieldTypes.map((value) => ({ value, label: labels[value] }));
const optionDrafts = reactive<Record<string, string>>({});
async function load() {
  if (!id.value) return;
  loading.value = true;
  try {
    event.value = (await api<{ event: EventRecord }>(`/admin/events/${id.value}`)).event;
    const data = eventInputSchema.parse(
      Object.fromEntries(Object.entries(event.value).filter(([k]) => k in form)),
    );
    Object.assign(form, data);
    starts.value = toZonedInput(data.starts_at, data.timezone);
    ends.value = toZonedInput(data.ends_at, data.timezone);
    for (const f of form.fields)
      optionDrafts[f.key] = f.options.map((o) => `${o.key}:${o.label}`).join('\n');
  } catch (e) {
    error.value = errorMessage(e);
  } finally {
    loading.value = false;
  }
}
function addField() {
  const key = `field_${Date.now().toString(36)}`;
  form.fields.push(fieldSchema.parse({ key, label: '新字段', type: 'text' }));
}
function frozenField(field: Field) {
  return Boolean(locked.value && event.value?.fields.some((entry) => entry.key === field.key));
}
function setFieldKey(field: Field, value: string) {
  const previous = field.key;
  if (previous === value) return;
  field.key = value;
  if (optionDrafts[previous] !== undefined) {
    optionDrafts[value] = optionDrafts[previous]!;
    delete optionDrafts[previous];
  }
}
function setFieldType(field: Field, value: unknown) {
  const type = fieldTypes.find((entry) => entry === value);
  if (!type) return;
  field.type = type;
  if (!['text', 'textarea', 'email'].includes(type)) field.ignore_case = false;
  if (!['text', 'phone', 'email'].includes(type)) field.roster_match = false;
}
function setRosterMatch(field: Field, enabled: boolean) {
  for (const entry of form.fields) entry.roster_match = false;
  if (enabled) {
    field.roster_match = true;
    field.required = true;
    field.source = 'user';
    field.visibility = 'public';
    field.max_length = Math.min(120, field.max_length);
  }
}
function move(index: number, direction: number) {
  const field = form.fields[index];
  if (!field || index + direction < 0 || index + direction >= form.fields.length) return;
  form.fields.splice(index, 1);
  form.fields.splice(index + direction, 0, field);
}
async function save() {
  if (logoLoading.value) return;
  saving.value = true;
  error.value = '';
  try {
    form.starts_at = fromZonedInput(starts.value, form.timezone);
    form.ends_at = fromZonedInput(ends.value, form.timezone);
    for (const field of form.fields)
      if (['select', 'multiselect'].includes(field.type)) {
        field.options = (optionDrafts[field.key] ?? '')
          .split('\n')
          .map((line) => line.trim())
          .filter(Boolean)
          .map((line) => {
            const colon = line.indexOf(':');
            return {
              key: colon < 0 ? line : line.slice(0, colon),
              label: colon < 0 ? line : line.slice(colon + 1),
            };
          });
      }
    const input = eventInputSchema.parse(form);
    const result = await api<{ event: EventRecord }>(
      id.value ? `/admin/events/${id.value}` : '/admin/events',
      { method: id.value ? 'PATCH' : 'POST', body: input },
    );
    event.value = result.event;
    message.success('活动已保存');
    if (!id.value) await router.replace(`/admin/events/${result.event.id}`);
  } catch (e) {
    error.value = errorMessage(e);
    document
      .querySelector('[role="alert"]')
      ?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  } finally {
    saving.value = false;
  }
}
async function publish() {
  await save();
  if (error.value || !event.value) return;
  try {
    await api(`/admin/events/${event.value.id}/publish`, { method: 'POST' });
    message.success('活动已发布');
    await load();
  } catch (e) {
    error.value = errorMessage(e);
  }
}
function stateChange(state: 'PAUSED' | 'PUBLISHED' | 'CLOSED') {
  Modal.confirm({
    title:
      state === 'CLOSED'
        ? '结束这场活动？'
        : state === 'PAUSED'
          ? '暂停现场签到？'
          : '恢复现场签到？',
    content:
      state === 'CLOSED'
        ? '结束后不能重新开启，已有签到记录会保留。'
        : '操作后，之前的二维码与未完成会话将失效。',
    okText: '确认',
    cancelText: '取消',
    async onOk() {
      try {
        await api(`/admin/events/${id.value}/state`, { method: 'POST', body: { state } });
        await load();
      } catch (e) {
        error.value = errorMessage(e);
      }
    },
  });
}
onMounted(load);
</script>
<template>
  <div>
    <RouterLink to="/admin" class="back-link"><ArrowLeftOutlined /> 返回活动工作台</RouterLink>
    <div class="page-heading">
      <div>
        <h1>{{ id ? '管理活动' : '创建活动' }}</h1>
      </div>
      <div class="actions-row">
        <span v-if="event" class="status-pill" :class="event.state">{{
          stateLabels[event.state]
        }}</span
        ><a-button
          :loading="saving"
          :disabled="logoLoading || event?.state === 'CLOSED'"
          @click="save"
          >保存{{ id ? '修改' : '草稿' }}</a-button
        ><a-button
          v-if="!event || event.state === 'DRAFT'"
          type="primary"
          :loading="saving"
          :disabled="logoLoading"
          @click="publish"
          >发布活动 <ArrowRightOutlined /></a-button
        ><a-button v-if="event?.state === 'PUBLISHED'" @click="stateChange('PAUSED')"
          >暂停签到</a-button
        ><a-button v-if="event?.state === 'PAUSED'" type="primary" @click="stateChange('PUBLISHED')"
          >恢复签到</a-button
        ><a-button
          v-if="event && ['PUBLISHED', 'PAUSED'].includes(event.state)"
          danger
          @click="stateChange('CLOSED')"
          >结束活动</a-button
        >
      </div>
    </div>
    <div v-if="error" class="error-banner" role="alert">{{ error }}</div>
    <div v-if="id" class="tab-links">
      <RouterLink :to="`/admin/events/${id}`">活动配置</RouterLink
      ><RouterLink :to="`/admin/events/${id}/roster`">参与名单</RouterLink
      ><RouterLink :to="`/admin/events/${id}/records`">签到记录</RouterLink>
    </div>
    <a-form :model="form" layout="vertical" :disabled="loading || event?.state === 'CLOSED'"
      ><div class="editor-layout">
        <div class="section-stack">
          <section class="panel">
            <div class="section-number">01 / 基本信息</div>
            <h2 class="panel-title">基本信息</h2>
            <p class="panel-subtitle">活动名称与说明将展示在手机签到页。</p>
            <a-form-item label="活动名称" required
              ><a-input
                v-model:value="form.name"
                placeholder="例如：秋日分享会、团队季度会议"
                :maxlength="120"
            /></a-form-item>
            <div class="form-grid">
              <a-form-item label="主办方" required
                ><a-input
                  v-model:value="form.organizer"
                  placeholder="团队或组织名称" /></a-form-item
              ><a-form-item label="活动类型"
                ><a-select
                  v-model:value="form.category"
                  :options="[
                    { value: 'internal', label: '内部活动' },
                    { value: 'external', label: '对外活动' },
                  ]" /></a-form-item
              ><label class="field-group"
                ><span class="field-label">活动开始时间 *</span
                ><input
                  v-model="starts"
                  class="native-input"
                  type="datetime-local"
                  required
                  :disabled="event?.state === 'CLOSED'" /></label
              ><label class="field-group"
                ><span class="field-label">截止时间 *</span
                ><input
                  v-model="ends"
                  class="native-input"
                  type="datetime-local"
                  required
                  :disabled="event?.state === 'CLOSED'"
              /></label>
            </div>
            <a-form-item
              label="活动开始前开放签到"
              :extra="`签到开放时间：${checkinStartPreview}；0 表示活动开始时开放`"
            >
              <a-input-number
                v-model:value="form.checkin_early_minutes"
                :min="0"
                :max="1440"
                :precision="0"
                style="width: 100%"
              >
                <template #addonAfter>分钟</template>
              </a-input-number>
            </a-form-item>
            <a-form-item label="活动时区（上方时间按此时区填写）"
              ><a-select
                v-model:value="form.timezone"
                :options="[
                  { value: 'Asia/Shanghai', label: '中国标准时间 · Asia/Shanghai' },
                  { value: 'UTC', label: '协调世界时 · UTC' },
                  { value: 'Asia/Tokyo', label: '东京 · Asia/Tokyo' },
                  { value: 'Europe/London', label: '伦敦 · Europe/London' },
                  { value: 'America/New_York', label: '纽约 · America/New_York' },
                ]" /></a-form-item
            ><a-form-item label="活动地点"
              ><a-input
                v-model:value="form.location_label"
                placeholder="城市、场馆与房间" /></a-form-item
            ><a-form-item label="活动说明"
              ><a-input-textarea
                v-model:value="form.description"
                :rows="3"
                :maxlength="2000"
                placeholder="给参与者写一段简短的介绍或提醒"
            /></a-form-item>
            <a-form-item label="活动 Logo" extra="用于扫码签到页和电子码展示页，保存活动后生效">
              <div class="logo-picker">
                <div class="logo-preview">
                  <EventBrand :logo="form.checkin_logo" :name="form.name" />
                  <span>{{ form.checkin_logo ? '活动 Logo 预览' : 'HereNow 默认 Logo' }}</span>
                </div>
                <div class="logo-picker-details">
                  <div class="logo-picker-actions">
                    <a-button :loading="logoLoading" html-type="button" @click="logoInput?.click()">
                      <UploadOutlined />{{ form.checkin_logo ? '替换图片' : '选择图片' }}
                    </a-button>
                    <a-button
                      v-if="form.checkin_logo"
                      type="text"
                      :disabled="logoLoading"
                      @click="form.checkin_logo = null"
                    >
                      恢复默认
                    </a-button>
                  </div>
                  <p class="logo-file-hint">PNG、JPEG 或 WebP · 最大 2 MB</p>
                </div>
              </div>
              <input
                v-show="false"
                ref="logoInput"
                type="file"
                accept="image/png,image/jpeg,image/webp"
                hidden
                tabindex="-1"
                aria-hidden="true"
                :disabled="logoLoading || loading || event?.state === 'CLOSED'"
                @change="selectLogo"
              />
            </a-form-item>
          </section>
          <section class="panel">
            <div class="section-number">02 / 签到方式</div>
            <h2 class="panel-title">签到准入</h2>
            <div class="admission-options">
              <button
                type="button"
                :class="{ selected: form.admission === 'open' }"
                :disabled="event?.state === 'CLOSED'"
                @click="form.admission = 'open'"
              >
                <span class="choice-circle"></span><strong>开放签到</strong
                ><small>无需提前导入名单</small></button
              ><button
                type="button"
                :class="{ selected: form.admission === 'roster' }"
                :disabled="event?.state === 'CLOSED'"
                @click="form.admission = 'roster'"
              >
                <span class="choice-circle"></span><strong>名单签到</strong
                ><small>仅导入名单中的参与者可签到</small>
              </button>
            </div>
          </section>
          <section class="panel">
            <div class="section-number">03 / 签到表单</div>
            <div class="fields-heading">
              <div>
                <h2 class="panel-title">自定义字段</h2>
                <p class="panel-subtitle">
                  最多 30 个字段。关闭“允许重复”后，该字段的相同值不能再次签到。
                </p>
              </div>
              <a-button :disabled="form.fields.length >= 30" @click="addField"
                ><PlusOutlined /> 添加字段</a-button
              >
            </div>
            <p v-if="locked" class="side-hint">
              已有名单或签到记录，已有字段结构已锁定；名称和重复规则仍可调整。
            </p>
            <div v-if="!form.fields.length" class="fields-empty">暂无自定义字段</div>
            <div v-for="(field, index) in form.fields" :key="index" class="field-card">
              <div class="field-card-top">
                <span>字段 {{ String(index + 1).padStart(2, '0') }}</span>
                <div class="actions-row">
                  <button
                    type="button"
                    :disabled="index === 0"
                    aria-label="字段上移"
                    @click="move(index, -1)"
                  >
                    <ArrowUpOutlined /></button
                  ><button
                    type="button"
                    :disabled="index === form.fields.length - 1"
                    aria-label="字段下移"
                    @click="move(index, 1)"
                  >
                    <ArrowDownOutlined /></button
                  ><button
                    type="button"
                    :disabled="frozenField(field)"
                    aria-label="删除字段"
                    @click="form.fields.splice(index, 1)"
                  >
                    <DeleteOutlined />
                  </button>
                </div>
              </div>
              <div class="form-grid">
                <a-form-item label="字段名称"><a-input v-model:value="field.label" /></a-form-item
                ><a-form-item label="字段类型"
                  ><a-select
                    :value="field.type"
                    :disabled="frozenField(field)"
                    :options="fieldOptions"
                    @change="(value) => setFieldType(field, value)" /></a-form-item
                ><a-form-item label="字段键"
                  ><a-input
                    :value="field.key"
                    :disabled="frozenField(field)"
                    placeholder="小写字母、数字、下划线"
                    @update:value="(value) => setFieldKey(field, value)" /></a-form-item
                ><a-form-item label="内容来源"
                  ><a-select
                    v-model:value="field.source"
                    :disabled="frozenField(field) || field.roster_match"
                    :options="[
                      { value: 'user', label: '用户填写' },
                      { value: 'roster', label: '名单权威值（不公开回显）' },
                    ]"
                /></a-form-item>
              </div>
              <a-form-item
                v-if="['select', 'multiselect'].includes(field.type)"
                label="选项（每行 键:显示文字）"
                ><a-input-textarea
                  v-model:value="optionDrafts[field.key]"
                  :rows="3"
                  :disabled="frozenField(field)"
                  placeholder="design:设计\nengineering:研发" /></a-form-item
              ><a-form-item label="填写提示"
                ><a-input v-model:value="field.help_text" placeholder="可选，帮助参与者准确填写"
              /></a-form-item>
              <div class="field-flags">
                <label
                  >允许重复<a-switch v-model:checked="field.allow_duplicates" size="small"
                /></label>
                <label
                  v-if="
                    ['text', 'textarea', 'email'].includes(field.type) &&
                    (!field.allow_duplicates || field.roster_match)
                  "
                  >忽略大小写<a-switch v-model:checked="field.ignore_case" size="small"
                /></label>
                <label v-if="['text', 'phone', 'email'].includes(field.type)"
                  >名单匹配<a-switch
                    :checked="field.roster_match"
                    size="small"
                    :disabled="Boolean(locked)"
                    @change="(value) => setRosterMatch(field, Boolean(value))"
                /></label>
                <label
                  >必填
                  <a-switch
                    v-model:checked="field.required"
                    size="small"
                    :disabled="Boolean(locked) || field.roster_match" /></label
                ><label
                  >仅后台使用
                  <a-switch
                    :checked="field.visibility === 'admin'"
                    size="small"
                    :disabled="frozenField(field) || field.roster_match"
                    @change="(v) => (field.visibility = v ? 'admin' : 'public')"
                /></label>
              </div>
              <p v-if="!field.allow_duplicates && !field.required" class="side-hint">
                未填写时不参与重复校验。
              </p>
            </div>
          </section>
        </div>
        <div class="section-stack editor-side">
          <section class="panel">
            <div class="section-number">04 / 现场定位</div>
            <h2 class="panel-title">定位规则</h2>
            <p class="panel-subtitle">定位辅助判断活动范围，不能保证本人在场。</p>
            <a-form-item label="定位规则"
              ><a-select
                v-model:value="form.location_mode"
                :options="[
                  { value: 'off', label: '关闭 · 不请求位置' },
                  { value: 'record', label: '仅记录 · 失败也可继续' },
                  { value: 'required', label: '强制围栏 · 范围内才可通过' },
                ]" /></a-form-item
            ><template v-if="form.location_mode === 'required'"
              ><MapPicker v-model="form.center" v-model:radius="form.radius" /><a-form-item
                label="围栏半径（米）"
                style="margin-top: 20px"
                ><a-input-number
                  v-model:value="form.radius"
                  :min="50"
                  :max="10000"
                  style="width: 100%" /></a-form-item
              ><a-form-item label="最大定位误差（米）"
                ><a-input-number
                  v-model:value="form.max_accuracy"
                  :min="1"
                  :max="1000"
                  style="width: 100%"
              /></a-form-item>
              <p class="side-hint">
                范围边界、低精度或拒绝定位时，参与者可重试或联系现场工作人员。
              </p></template
            >
          </section>
          <section class="panel">
            <div class="section-number">05 / 隐私与保留</div>
            <h2 class="panel-title">隐私与保留</h2>
            <p class="panel-subtitle">参与者提交前将看到用途、保留期与联系渠道。</p>
            <a-form-item label="联系渠道"
              ><a-input
                v-model:value="form.contact"
                placeholder="主办方邮箱或现场服务台" /></a-form-item
            ><a-form-item label="签到数据保留（天）"
              ><a-input-number
                v-model:value="form.retention_days"
                :min="1"
                :max="365"
                style="width: 100%"
            /></a-form-item>
            <p class="side-hint">精确位置与网络证据单独保存 7 天；导出默认不包含这些信息。</p>
          </section>
          <section class="preflight-note">
            <span>✳</span>
            <h3>发布之前，确认一下</h3>
            <ul>
              <li>开始与截止时间是否准确</li>
              <li>名单模式是否已完成导入</li>
              <li>定位围栏是否在现场验证</li>
              <li>参与者需要填写的信息是否必要</li>
            </ul>
          </section>
        </div>
      </div></a-form
    >
    <div class="editor-savebar">
      <span>保存后，发布活动即可展示动态签到码。</span
      ><a-button
        type="primary"
        :loading="saving"
        :disabled="event?.state === 'CLOSED'"
        @click="save"
        >保存{{ id ? '修改' : '草稿' }}</a-button
      >
    </div>
  </div>
</template>
<style scoped>
.logo-picker {
  display: grid;
  grid-template-columns: 200px minmax(0, 1fr);
  align-items: center;
  gap: 16px;
}
.logo-preview {
  min-height: 96px;
  padding: 16px;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 12px;
  border: 1px solid var(--border);
  border-radius: 8px;
  background: var(--surface);
}
.logo-preview > span,
.logo-file-hint {
  font-size: 12px;
  color: var(--muted);
  line-height: 1.5;
}
.logo-preview :deep(.event-logo) {
  max-width: 100%;
}
.logo-picker-details {
  min-width: 0;
}
.logo-picker-actions {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 8px;
}
.logo-picker-actions :deep(.ant-btn) {
  min-height: 44px;
}
.logo-file-hint {
  margin: 8px 0 0;
}
@media (max-width: 640px) {
  .logo-picker {
    grid-template-columns: minmax(0, 1fr);
    gap: 12px;
  }
}
.editor-layout {
  display: grid;
  align-items: start;
  grid-template-columns: minmax(0, 1.65fr) minmax(290px, 1fr);
  gap: 16px;
}
.section-number {
  font-size: 10px;
  letter-spacing: 1px;
  color: #98a28d;
  margin-bottom: 16px;
}
.admission-options {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 13px;
  margin: 0 0 25px;
}
.admission-options button {
  text-align: left;
  padding: 17px 16px;
  background: #fff;
  border: 1px solid var(--border);
  border-radius: 8px;
  position: relative;
}
.admission-options button.selected {
  border-color: #d6603d;
  background: #fdf7f3;
}
.admission-options strong {
  font-size: 13px;
  font-weight: 500;
  display: block;
  margin-bottom: 8px;
}
.admission-options small {
  font-size: 11px;
  color: var(--muted);
  line-height: 1.6;
  display: block;
}
.choice-circle {
  position: absolute;
  right: 13px;
  top: 16px;
  width: 12px;
  height: 12px;
  border: 1px solid #d3d8ce;
  border-radius: 50%;
}
.selected .choice-circle {
  background: var(--accent);
  border: 3px solid #f4d6c9;
}
.switch-line {
  display: flex;
  justify-content: space-between;
  align-items: center;
  font-size: 13px;
  gap: 16px;
}
.switch-line small {
  display: block;
  color: var(--muted);
  font-size: 11px;
  margin-top: 7px;
}
.fields-heading {
  display: flex;
  justify-content: space-between;
  gap: 14px;
  align-items: flex-start;
}
.fields-heading .ant-btn {
  font-size: 11px;
  flex-shrink: 0;
}
.fields-empty {
  font-size: 12px;
  color: #9ca58e;
  border: 1px dashed #dae0d1;
  padding: 26px 16px;
  text-align: center;
  border-radius: 8px;
}
.field-card {
  background: var(--surface);
  border: 1px solid #e6eadd;
  border-radius: 8px;
  padding: 18px;
  margin-top: 16px;
}
.field-card-top {
  display: flex;
  justify-content: space-between;
  align-items: center;
  font-size: 10px;
  letter-spacing: 1px;
  color: #8e9b80;
  margin-bottom: 19px;
}
.field-card-top button {
  border: 0;
  background: transparent;
  color: #81936d;
  padding: 7px;
  font-size: 12px;
}
.field-card-top button:disabled {
  opacity: 0.3;
  cursor: default;
}
.field-card .ant-form-item {
  margin-bottom: 15px;
}
.field-flags {
  display: flex;
  gap: 12px 20px;
  flex-wrap: wrap;
  font-size: 12px;
  color: #7a866b;
}
.field-flags label {
  display: flex;
  gap: 9px;
  align-items: center;
}
.side-hint {
  font-size: 11px;
  color: #9ba48d;
  margin: 0;
  line-height: 1.9;
}
.preflight-note {
  padding: 16px 22px;
}
.preflight-note > span {
  color: #a9b99a;
  font-size: 30px;
}
.preflight-note h3 {
  font-size: 13px;
  color: #788a66;
  margin: 13px 0;
}
.preflight-note ul {
  padding-left: 18px;
  font-size: 11px;
  color: #99a48c;
  line-height: 2.3;
}
.editor-savebar {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 15px;
  margin-top: 16px;
  padding: 16px 0;
  border-top: 1px solid var(--border);
}
.editor-savebar span {
  font-size: 12px;
  color: var(--muted);
}
@media (max-width: 1100px) {
  .editor-layout {
    grid-template-columns: 1fr;
  }
  .editor-side {
    grid-template-columns: 1fr 1fr;
  }
  .preflight-note {
    display: none;
  }
}
@media (max-width: 767px) {
  .editor-side {
    grid-template-columns: 1fr;
  }
  .fields-heading {
    flex-direction: column;
    margin-bottom: 18px;
  }
  .field-card {
    padding: 16px;
  }
  .field-flags {
    gap: 8px 16px;
  }
  .field-flags label {
    min-height: 44px;
  }
  .field-card-top button {
    min-width: 44px;
    min-height: 44px;
  }
  .editor-savebar span {
    font-size: 11px;
  }
  .admission-options button {
    padding: 15px 12px;
  }
}
</style>
