<script setup lang="ts">
import { ref, onMounted, onBeforeUnmount, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import {
  Button as AButton,
  Input as AInput,
  Select as ASelect,
  Table as ATable,
  Modal as AModal,
  Form as AForm,
  FormItem as AFormItem,
  Textarea as AInputTextarea,
  message,
} from 'ant-design-vue';
import {
  ArrowLeftOutlined,
  DownloadOutlined,
  PlusOutlined,
  QrcodeOutlined,
  SearchOutlined,
  ReloadOutlined,
} from '@ant-design/icons-vue';
import {
  checkinLabels,
  validateAnswers,
  type Answers,
  type EventRecord,
  type CheckinRecord,
} from '../../../../packages/contracts/src/index';
import { api, errorMessage, formatTime, session } from '../services/api';
import AdminFields from './AdminFields.vue';
const id = String(useRoute().params.id),
  router = useRouter(),
  event = ref<EventRecord>(),
  records = ref<CheckinRecord[]>([]),
  total = ref(0),
  page = ref(1),
  search = ref(''),
  status = ref(''),
  error = ref(''),
  busy = ref(false),
  loading = ref(false),
  manualOpen = ref(false),
  reviewOpen = ref(false),
  selected = ref<CheckinRecord>(),
  identity = ref(''),
  answers = ref<Answers>({}),
  reason = ref(''),
  manualStatus = ref<'CHECKED_IN' | 'PENDING_REVIEW'>('CHECKED_IN'),
  reviewStatus = ref<'CHECKED_IN' | 'REVOKED'>('REVOKED'),
  detail = ref<CheckinRecord>();
let timer: ReturnType<typeof setTimeout> | undefined;
let loadEpoch = 0;
let alive = true;
const columns = [
  { title: '身份标识', dataIndex: 'identity_value', key: 'identity_value' },
  { title: '签到状态', key: 'status' },
  { title: '签到时间', key: 'time' },
  { title: '来源 / 风险', key: 'risk' },
  { title: '操作', key: 'actions' },
];
async function load() {
  const epoch = ++loadEpoch;
  loading.value = true;
  try {
    const [e, r] = await Promise.all([
      api<{ event: EventRecord }>(`/admin/events/${id}`),
      api<{ records: CheckinRecord[]; total: number }>(
        `/admin/events/${id}/checkins?page=${page.value}&search=${encodeURIComponent(search.value)}&status=${status.value}`,
      ),
    ]);
    if (epoch !== loadEpoch || !alive) return;
    event.value = e.event;
    records.value = r.records;
    total.value = r.total;
    error.value = '';
  } catch (e) {
    if (epoch === loadEpoch) error.value = errorMessage(e);
  } finally {
    if (epoch === loadEpoch) loading.value = false;
  }
}
watch([search, status], () => {
  page.value = 1;
  if (timer) clearTimeout(timer);
  timer = setTimeout(() => void load(), 250);
});
async function display() {
  try {
    const r = await api<{ display_url: string }>(`/admin/events/${id}/display-sessions`, {
      method: 'POST',
    });
    await router.push(r.display_url);
  } catch (e) {
    error.value = errorMessage(e);
  }
}
function openManual() {
  identity.value = '';
  answers.value = {};
  reason.value = '';
  manualStatus.value = 'CHECKED_IN';
  manualOpen.value = true;
}
async function manual() {
  busy.value = true;
  try {
    if (!identity.value.trim() || !reason.value.trim())
      throw new Error('请填写身份标识与人工补签原因');
    validateAnswers(
      (event.value?.fields ?? []).filter((f) => f.source === 'user' && f.visibility === 'public'),
      answers.value,
      {},
      'public',
    );
    await api(`/admin/events/${id}/checkins/manual`, {
      method: 'POST',
      body: {
        submission: { identity_value: identity.value, answers: answers.value },
        reason: reason.value,
        status: manualStatus.value,
      },
    });
    manualOpen.value = false;
    message.success('人工记录已保存');
    await load();
  } catch (e) {
    message.error(errorMessage(e));
  } finally {
    busy.value = false;
  }
}
function openReview(record: CheckinRecord) {
  selected.value = record;
  reason.value = '';
  reviewStatus.value = record.status === 'CHECKED_IN' ? 'REVOKED' : 'CHECKED_IN';
  reviewOpen.value = true;
}
async function review() {
  if (!selected.value || !reason.value.trim()) {
    message.error('请填写处理原因');
    return;
  }
  busy.value = true;
  try {
    await api(`/admin/checkins/${selected.value.id}/review`, {
      method: 'POST',
      body: { status: reviewStatus.value, reason: reason.value },
    });
    reviewOpen.value = false;
    message.success('记录状态已更新');
    await load();
  } catch (e) {
    message.error(errorMessage(e));
  } finally {
    busy.value = false;
  }
}
onMounted(load);
onBeforeUnmount(() => {
  alive = false;
  loadEpoch++;
  if (timer) clearTimeout(timer);
});
</script>
<template>
  <div>
    <RouterLink to="/admin" class="back-link"><ArrowLeftOutlined /> 返回活动工作台</RouterLink>
    <div class="page-heading">
      <div>
        <span class="eyebrow">EVERY PRESENCE MATTERS</span>
        <h1>签到记录</h1>
        <p>{{ event?.name }}</p>
      </div>
      <div class="actions-row">
        <a-button @click="openManual"><PlusOutlined /> 人工补签</a-button
        ><a-button type="primary" @click="display"><QrcodeOutlined /> 展示签到码</a-button>
      </div>
    </div>
    <div class="tab-links">
      <RouterLink v-if="session.user?.role === 'admin'" :to="`/admin/events/${id}`"
        >活动配置</RouterLink
      ><RouterLink v-if="session.user?.role === 'admin'" :to="`/admin/events/${id}/roster`"
        >参与名单</RouterLink
      ><RouterLink :to="`/admin/events/${id}/records`">签到记录</RouterLink>
    </div>
    <div v-if="error" role="alert" class="error-banner">{{ error }}</div>
    <section class="records-summary">
      <div>
        <strong>{{ total }}</strong
        ><span>条记录</span>
      </div>
      <p>只把确认成功的签到计为在场，待核验与撤销记录分别保留。</p>
      <a v-if="session.user?.role === 'admin'" :href="`/api/admin/events/${id}/export`"
        ><a-button><DownloadOutlined /> 导出 XLSX</a-button></a
      >
    </section>
    <section class="panel records-panel">
      <div class="records-toolbar">
        <a-input
          v-model:value="search"
          aria-label="搜索身份标识"
          placeholder="搜索身份标识"
          allow-clear
          ><template #prefix><SearchOutlined /></template></a-input
        ><a-select
          v-model:value="status"
          aria-label="筛选签到状态"
          :options="[
            { value: '', label: '全部状态' },
            { value: 'CHECKED_IN', label: '签到成功' },
            { value: 'PENDING_REVIEW', label: '待核验' },
            { value: 'REVOKED', label: '已撤销' },
          ]"
        /><a-button aria-label="刷新记录" @click="load"><ReloadOutlined /></a-button>
      </div>
      <div class="desktop-records">
        <a-table
          :columns="columns"
          :data-source="records"
          row-key="id"
          :loading="loading"
          :pagination="{ current: page, pageSize: 50, total, showSizeChanger: false }"
          @change="
            (p) => {
              page = p.current ?? 1;
              load();
            }
          "
          ><template #bodyCell="{ column, record }"
            ><template v-if="column.key === 'status'"
              ><span class="status-pill" :class="record.status">{{
                checkinLabels[record.status as keyof typeof checkinLabels]
              }}</span></template
            ><template v-if="column.key === 'time'">{{
              formatTime(record.checked_in_at, event?.timezone)
            }}</template
            ><template v-if="column.key === 'risk'"
              ><span class="record-source"
                >{{ record.source === 'manual' ? '人工补签' : '在线签到' }} ·
                {{ record.location_result }}</span
              >
              <div v-if="record.risk_flags.length" class="risk-text">
                {{ record.risk_flags.join('、') }}
              </div></template
            ><template v-if="column.key === 'actions'"
              ><a-button type="link" size="small" @click="detail = record as CheckinRecord"
                >详情</a-button
              ><a-button type="link" size="small" @click="openReview(record as CheckinRecord)">{{
                record.status === 'CHECKED_IN' ? '撤销' : '核验 / 恢复'
              }}</a-button></template
            ></template
          ><template #emptyText
            ><div class="empty-state">
              <QrcodeOutlined class="empty-symbol" />
              <h3>等待第一份在场</h3>
              <p>展示活动二维码，参与者完成签到后，记录会出现在这里。</p>
            </div></template
          ></a-table
        >
      </div>
      <div class="mobile-records">
        <div v-if="!records.length" class="empty-state">
          <h3>还没有签到记录</h3>
          <p>展示二维码，开启现场签到。</p>
        </div>
        <article v-for="record in records" :key="record.id" class="record-card">
          <div>
            <strong>{{ record.identity_value }}</strong
            ><span class="status-pill" :class="record.status">{{
              checkinLabels[record.status]
            }}</span>
          </div>
          <p>
            {{ formatTime(record.checked_in_at, event?.timezone) }} ·
            {{ record.source === 'manual' ? '人工补签' : '在线签到' }}
          </p>
          <p v-if="record.risk_flags.length" class="risk-text">
            {{ record.risk_flags.join('、') }}
          </p>
          <div class="record-card-actions">
            <a-button @click="detail = record as CheckinRecord">查看详情</a-button
            ><a-button @click="openReview(record as CheckinRecord)">{{
              record.status === 'CHECKED_IN' ? '撤销记录' : '核验 / 恢复'
            }}</a-button>
          </div>
        </article>
        <div v-if="total > 50" class="mobile-pages">
          <a-button
            :disabled="page <= 1"
            @click="
              page--;
              load();
            "
            >上一页</a-button
          ><span>{{ page }}</span
          ><a-button
            :disabled="page * 50 >= total"
            @click="
              page++;
              load();
            "
            >下一页</a-button
          >
        </div>
      </div>
    </section>
    <a-modal
      v-model:open="manualOpen"
      title="人工补签"
      ok-text="保存人工记录"
      cancel-text="取消"
      :confirm-loading="busy"
      @ok="manual"
      ><p class="modal-intro">同样按身份去重。人工记录会标明来源，不视为通过定位校验。</p>
      <a-form layout="vertical"
        ><a-form-item :label="event?.identity_label" required
          ><a-input v-model:value="identity" placeholder="输入本次签到的身份标识" /></a-form-item
        ><AdminFields v-model="answers" :fields="event?.fields ?? []" /><a-form-item
          label="记录状态"
          ><a-select
            v-model:value="manualStatus"
            :options="[
              { value: 'CHECKED_IN', label: '已现场确认，签到成功' },
              { value: 'PENDING_REVIEW', label: '待进一步核验' },
            ]" /></a-form-item
        ><a-form-item label="人工处理原因" required
          ><a-input-textarea
            v-model:value="reason"
            :rows="3"
            placeholder="例如：已核验身份，现场定位误差过大" /></a-form-item></a-form></a-modal
    ><a-modal
      v-model:open="reviewOpen"
      title="核验与状态处理"
      ok-text="确认处理"
      cancel-text="取消"
      :confirm-loading="busy"
      @ok="review"
      ><p class="modal-intro">
        身份：{{ selected?.identity_value }}。处理会保留原记录并写入操作审计。
      </p>
      <a-form layout="vertical"
        ><a-form-item label="处理结果"
          ><a-select
            v-model:value="reviewStatus"
            :options="[
              { value: 'CHECKED_IN', label: '确认成功 / 恢复' },
              { value: 'REVOKED', label: '撤销记录' },
            ]" /></a-form-item
        ><a-form-item label="处理原因" required
          ><a-input-textarea v-model:value="reason" :rows="3" /></a-form-item></a-form></a-modal
    ><a-modal :open="Boolean(detail)" title="签到详情" :footer="null" @cancel="detail = undefined"
      ><dl v-if="detail" class="detail-list">
        <dt>身份标识</dt>
        <dd>{{ detail.identity_value }}</dd>
        <dt>当前状态</dt>
        <dd>{{ checkinLabels[detail.status] }}</dd>
        <dt>签到时间</dt>
        <dd>{{ formatTime(detail.checked_in_at, event?.timezone) }}</dd>
        <dt>来源</dt>
        <dd>{{ detail.source === 'manual' ? '人工补签' : '在线签到' }}</dd>
        <dt>位置校验</dt>
        <dd>{{ detail.location_result }}</dd>
        <template v-for="(value, key) in detail.answers" :key="key"
          ><dt>{{ event?.fields.find((f) => f.key === key)?.label ?? key }}</dt>
          <dd>{{ Array.isArray(value) ? value.join('、') : value }}</dd></template
        >
        <dt>风险标记</dt>
        <dd>{{ detail.risk_flags.join('、') || '无' }}</dd>
      </dl></a-modal
    >
  </div>
</template>
<style scoped>
.records-summary {
  display: flex;
  gap: 25px;
  align-items: center;
  padding: 24px 27px;
  background: #f0f3e9;
  border: 1px solid #e0e7d5;
  border-radius: 10px;
  margin-bottom: 24px;
}
.records-summary > div {
  flex-shrink: 0;
}
.records-summary strong {
  font-size: 35px;
  letter-spacing: -1px;
  color: #506640;
  font-weight: 600;
  margin-right: 12px;
}
.records-summary span {
  font-size: 12px;
  color: #8a9c79;
}
.records-summary p {
  font-size: 12px;
  color: #8b9b7e;
  margin: 0;
  max-width: 400px;
  line-height: 1.8;
}
.records-summary > a {
  margin-left: auto;
}
.records-toolbar {
  display: flex;
  gap: 12px;
  margin-bottom: 25px;
}
.records-toolbar > .ant-input-affix-wrapper {
  max-width: 280px;
}
.records-toolbar > .ant-select {
  min-width: 150px;
}
.records-toolbar > .ant-btn {
  margin-left: auto;
}
.record-source {
  font-size: 11px;
  color: #8d9780;
}
.risk-text {
  font-size: 10px;
  color: #b58734;
  margin-top: 5px;
}
.modal-intro {
  font-size: 12px;
  color: var(--muted);
  line-height: 1.8;
  margin: 10px 0 22px;
}
.detail-list {
  display: grid;
  grid-template-columns: 90px 1fr;
  font-size: 13px;
  row-gap: 16px;
  margin: 25px 0;
}
.detail-list dt {
  color: var(--muted);
}
.detail-list dd {
  margin: 0;
  overflow-wrap: anywhere;
}
.mobile-records {
  display: none;
}
.mobile-pages {
  display: flex;
  justify-content: center;
  align-items: center;
  gap: 18px;
  margin-top: 20px;
}
@media (max-width: 767px) {
  .records-summary {
    padding: 20px 16px;
    gap: 12px;
    flex-wrap: wrap;
  }
  .records-summary p {
    font-size: 11px;
    flex-basis: 100%;
    order: 3;
  }
  .records-summary strong {
    font-size: 30px;
  }
  .records-summary > a {
    margin-left: auto;
  }
  .records-toolbar {
    flex-wrap: wrap;
    gap: 10px;
  }
  .records-toolbar > .ant-input-affix-wrapper {
    max-width: none;
    width: 100%;
  }
  .records-toolbar > .ant-select {
    flex: 1;
  }
  .desktop-records {
    display: none;
  }
  .mobile-records {
    display: block;
  }
  .record-card {
    padding: 18px 0;
    border-bottom: 1px solid var(--border);
  }
  .record-card > div:first-child {
    display: flex;
    justify-content: space-between;
    align-items: center;
    gap: 12px;
  }
  .record-card strong {
    font-size: 15px;
  }
  .record-card p {
    font-size: 11px;
    color: var(--muted);
    margin: 12px 0;
  }
  .record-card-actions {
    display: flex;
    gap: 9px;
  }
  .record-card-actions .ant-btn {
    flex: 1;
    font-size: 12px;
  }
  .record-card .risk-text {
    color: #b58734;
  }
}
</style>
