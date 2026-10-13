<script setup lang="ts">
import { ref, onMounted, computed } from 'vue';
import { useRoute } from 'vue-router';
import {
  Button as AButton,
  Table as ATable,
  Select as ASelect,
  Input as AInput,
  Switch as ASwitch,
  message,
} from 'ant-design-vue';
import {
  ArrowLeftOutlined,
  UploadOutlined,
  DownloadOutlined,
  CheckCircleOutlined,
  FileTextOutlined,
} from '@ant-design/icons-vue';
import type {
  EventRecord,
  Participant,
  ImportPreview,
} from '../../../../packages/contracts/src/index';
import { api, errorMessage, session } from '../services/api';
const id = String(useRoute().params.id),
  event = ref<EventRecord>(),
  participants = ref<Participant[]>([]),
  error = ref(''),
  busy = ref(false),
  file = ref<File>(),
  mode = ref<'add' | 'update'>('add'),
  sheet = ref(''),
  mapping = ref<Record<string, string>>({}),
  preview = ref<ImportPreview>();
const columns = [
  { title: '身份标识', dataIndex: 'identity_value', key: 'identity_value' },
  { title: '名单资料', key: 'answers' },
  { title: '资格状态', key: 'active' },
];
const mappingFields = computed(() => [
  { key: 'identity_value', label: event.value?.identity_label ?? '身份标识' },
  ...(event.value?.fields ?? []).map((f) => ({ key: f.key, label: f.label })),
]);
async function refresh() {
  try {
    event.value = (await api<{ event: EventRecord }>(`/admin/events/${id}`)).event;
    if (session.user?.role === 'admin')
      participants.value = (
        await api<{ participants: Participant[] }>(`/admin/events/${id}/participants`)
      ).participants;
  } catch (e) {
    error.value = errorMessage(e);
  }
}
function selectFile(e: Event) {
  file.value = (e.target as HTMLInputElement).files?.[0];
  preview.value = undefined;
  error.value = '';
}
async function parse() {
  if (!file.value) return;
  busy.value = true;
  error.value = '';
  try {
    const data = new FormData();
    data.append('mode', mode.value);
    data.append(
      'mapping',
      JSON.stringify(
        Object.fromEntries(Object.entries(mapping.value).filter(([, value]) => value)),
      ),
    );
    if (sheet.value) data.append('sheet', sheet.value);
    data.append('file', file.value);
    preview.value = (
      await api<{ preview: ImportPreview }>(`/admin/events/${id}/imports`, {
        method: 'POST',
        body: data,
      })
    ).preview;
  } catch (e) {
    error.value = errorMessage(e);
  } finally {
    busy.value = false;
  }
}
async function commit() {
  if (!preview.value) return;
  busy.value = true;
  error.value = '';
  try {
    await api(`/admin/imports/${preview.value.id}/commit`, { method: 'POST' });
    message.success('名单已整批导入');
    preview.value = undefined;
    file.value = undefined;
    await refresh();
  } catch (e) {
    error.value = errorMessage(e);
  } finally {
    busy.value = false;
  }
}
async function toggle(p: Participant) {
  try {
    await api(`/admin/events/${id}/participants/${p.id}`, {
      method: 'PATCH',
      body: { active: !p.active },
    });
    p.active = !p.active;
    message.success(p.active ? '资格已启用' : '资格已停用');
  } catch (e) {
    error.value = errorMessage(e);
  }
}
function downloadErrors() {
  if (!preview.value) return;
  const content =
    '行号,原因\n' +
    preview.value.errors
      .map((e) => `${e.row},"${("'" + e.message).replaceAll('"', '""')}"`)
      .join('\n');
  const url = URL.createObjectURL(
    new Blob(['\uFEFF', content], { type: 'text/csv;charset=utf-8' }),
  );
  const a = document.createElement('a');
  a.href = url;
  a.download = 'roster-errors.csv';
  a.click();
  URL.revokeObjectURL(url);
}
onMounted(refresh);
</script>
<template>
  <div>
    <RouterLink to="/admin" class="back-link"><ArrowLeftOutlined /> 返回活动工作台</RouterLink>
    <div class="page-heading">
      <div>
        <span class="eyebrow">WHO'S COMING</span>
        <h1>参与名单</h1>
        <p>{{ event?.name }}</p>
      </div>
      <a v-if="session.user?.role === 'admin'" :href="`/api/admin/events/${id}/template`"
        ><a-button><DownloadOutlined /> 下载导入模板</a-button></a
      >
    </div>
    <div class="tab-links">
      <RouterLink :to="`/admin/events/${id}`">活动配置</RouterLink
      ><RouterLink :to="`/admin/events/${id}/roster`">参与名单</RouterLink
      ><RouterLink :to="`/admin/events/${id}/records`">签到记录</RouterLink>
    </div>
    <div v-if="error" role="alert" class="error-banner">{{ error }}</div>
    <div v-if="session.user?.role !== 'admin'" class="panel empty-state">
      仅管理员可以查看与管理完整名单。
    </div>
    <template v-else
      ><section class="panel import-panel">
        <div class="import-heading">
          <div>
            <h2 class="panel-title">把你的参与者，带到这里。</h2>
            <p class="panel-subtitle">上传 → 映射与预览 → 确认导入。名单不会自动计作已签到。</p>
          </div>
          <span class="import-badge">CSV / XLSX</span>
        </div>
        <label class="upload-area"
          ><input
            type="file"
            accept=".csv,.xlsx"
            aria-label="选择名单文件"
            @change="selectFile"
          /><span class="upload-icon"><UploadOutlined /></span
          ><strong>{{ file ? file.name : '点击选择参与名单' }}</strong
          ><span>单次最多 5 MB、10,000 行；身份列请使用文本，保留前导零。</span></label
        >
        <div class="import-options form-grid">
          <label class="field-group"
            ><span class="field-label">导入方式</span
            ><a-select
              v-model:value="mode"
              style="width: 100%"
              :options="[
                { value: 'add', label: '仅新增 · 已存在身份报错' },
                { value: 'update', label: '按主键更新 · 不覆盖历史签到' },
              ]" /></label
          ><label class="field-group"
            ><span class="field-label">工作表名称（可选）</span
            ><a-input v-model:value="sheet" placeholder="留空使用第一个工作表"
          /></label>
        </div>
        <details class="mapping-details">
          <summary>设置列映射 <span>默认匹配模板中的字段键</span></summary>
          <div class="form-grid mapping-grid">
            <label v-for="f in mappingFields" :key="f.key" class="field-group"
              ><span class="field-label">{{ f.label }} → {{ f.key }}</span
              ><a-input v-model:value="mapping[f.key]" :placeholder="`文件中的列名，默认 ${f.key}`"
            /></label>
          </div>
        </details>
        <div class="import-actions">
          <p>公式、宏与外部链接会被拒绝。错误整批修正后再导入。</p>
          <a-button type="primary" :disabled="!file" :loading="busy" @click="parse"
            ><FileTextOutlined /> 校验并预览</a-button
          >
        </div>
      </section>
      <section v-if="preview" class="panel preview-panel">
        <div class="preview-heading">
          <h2 class="panel-title">导入预览 · {{ preview.total }} 行</h2>
          <span :class="preview.errors.length ? 'preview-error' : 'preview-success'">{{
            preview.errors.length
              ? `${preview.errors.length} 处错误，需要修正`
              : '校验通过，可确认导入'
          }}</span>
        </div>
        <template v-if="preview.errors.length"
          ><div class="import-errors">
            <p v-for="(e, index) in preview.errors.slice(0, 20)" :key="index">
              第 {{ e.row }} 行 · {{ e.message }}
            </p>
          </div>
          <a-button @click="downloadErrors"
            ><DownloadOutlined /> 下载完整错误报告</a-button
          ></template
        >
        <div class="preview-scroll">
          <table>
            <thead>
              <tr>
                <th>行号</th>
                <th>{{ event?.identity_label }}</th>
                <th>名单资料</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="row in preview.rows.slice(0, 10)" :key="row.row">
                <td>{{ row.row }}</td>
                <td>{{ row.identity_value }}</td>
                <td>
                  {{
                    Object.entries(row.answers)
                      .map(([key, value]) => `${key}: ${value}`)
                      .join(' · ') || '—'
                  }}
                </td>
              </tr>
            </tbody>
          </table>
        </div>
        <div class="preview-footer">
          <span>预览展示前 10 行。确认后，全部 {{ preview.rows.length }} 条同时生效。</span
          ><a-button
            type="primary"
            :disabled="preview.errors.length > 0 || !preview.rows.length"
            :loading="busy"
            @click="commit"
            ><CheckCircleOutlined /> 确认导入</a-button
          >
        </div>
      </section>
      <section class="panel roster-panel">
        <div class="roster-heading">
          <h2 class="panel-title">
            当前名单 <span>{{ participants.length }}</span>
          </h2>
          <span class="muted"
            >{{ participants.filter((p) => p.active).length }} 人具有签到资格</span
          >
        </div>
        <a-table
          :columns="columns"
          :data-source="participants"
          row-key="id"
          :pagination="{ pageSize: 20 }"
          :scroll="{ x: 500 }"
          ><template #bodyCell="{ column, record }"
            ><template v-if="column.key === 'answers'"
              ><span class="roster-answers">{{
                Object.entries(record.answers)
                  .map(([key, value]) => `${key}: ${value}`)
                  .join(' · ') || '—'
              }}</span></template
            ><template v-if="column.key === 'active'"
              ><a-switch
                :checked="record.active"
                checked-children="启用"
                un-checked-children="停用"
                @change="toggle(record as Participant)" /></template></template
          ><template #emptyText
            ><div class="empty-state">
              <h3>还没有参与名单</h3>
              <p>开放活动可以直接签到；名单模式需要先导入。</p>
            </div></template
          ></a-table
        >
      </section></template
    >
  </div>
</template>
<style scoped>
.import-heading,
.preview-heading,
.roster-heading {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  gap: 15px;
}
.import-badge {
  font-size: 10px;
  color: #909d81;
  border: 1px solid #dce3d1;
  padding: 5px 9px;
  border-radius: 4px;
  white-space: nowrap;
}
.upload-area {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 12px;
  background: #f7f9f2;
  border: 1px dashed #cfd9c4;
  border-radius: 9px;
  padding: 32px 20px;
  text-align: center;
  cursor: pointer;
  position: relative;
}
.upload-area input {
  position: absolute;
  inset: 0;
  opacity: 0;
  width: 100%;
  cursor: pointer;
}
.upload-area strong {
  font-size: 13px;
  font-weight: 500;
  color: #70825d;
  overflow-wrap: anywhere;
  max-width: 100%;
}
.upload-area > span:last-child {
  font-size: 11px;
  color: #99a58c;
  line-height: 1.8;
}
.upload-icon {
  font-size: 24px;
  color: #99af80;
}
.import-options {
  margin-top: 25px;
}
.mapping-details {
  font-size: 12px;
  padding: 12px 0 22px;
  color: #79846f;
}
.mapping-details summary {
  cursor: pointer;
}
.mapping-details summary span {
  color: #a5ad9c;
  margin-left: 10px;
}
.mapping-grid {
  margin-top: 22px;
}
.import-actions {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 15px;
  border-top: 1px solid var(--border);
  padding-top: 20px;
}
.import-actions p {
  font-size: 11px;
  color: var(--muted);
  margin: 0;
}
.preview-panel,
.roster-panel {
  margin-top: 24px;
}
.preview-heading {
  margin-bottom: 18px;
}
.preview-error {
  font-size: 12px;
  color: #b35339;
}
.preview-success {
  font-size: 12px;
  color: #5a865b;
}
.import-errors {
  background: #fff3ee;
  padding: 14px;
  border-radius: 7px;
  margin-bottom: 15px;
  font-size: 12px;
  color: #a94e31;
}
.import-errors p {
  margin: 5px 0;
}
.preview-scroll {
  overflow: auto;
  margin-top: 20px;
}
table {
  width: 100%;
  border-collapse: collapse;
  font-size: 12px;
}
th,
td {
  text-align: left;
  padding: 14px 12px;
  border-bottom: 1px solid var(--border);
  white-space: nowrap;
}
th {
  background: #fafbf7;
  color: #8a957c;
  font-weight: 500;
}
.preview-footer {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 15px;
  margin-top: 20px;
}
.preview-footer > span {
  font-size: 11px;
  color: var(--muted);
}
.roster-heading {
  margin-bottom: 22px;
}
.roster-heading h2 > span {
  font-size: 11px;
  color: #a1aa94;
  margin-left: 9px;
}
.roster-heading > .muted {
  font-size: 11px;
}
.roster-answers {
  font-size: 12px;
  color: #8a927f;
}
@media (max-width: 767px) {
  .import-heading,
  .preview-heading {
    flex-direction: column;
  }
  .import-badge {
    display: none;
  }
  .import-actions,
  .preview-footer {
    align-items: flex-start;
    flex-direction: column;
  }
  .upload-area {
    padding: 28px 14px;
  }
  .mapping-details summary span {
    display: block;
    margin: 8px 0 0;
  }
}
</style>
