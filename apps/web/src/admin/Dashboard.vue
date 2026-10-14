<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { Button as AButton, Input as AInput, Skeleton as ASkeleton } from 'ant-design-vue';
import {
  PlusOutlined,
  SearchOutlined,
  ArrowRightOutlined,
  EnvironmentOutlined,
  CalendarOutlined,
  QrcodeOutlined,
  TeamOutlined,
  AppstoreOutlined,
  CheckCircleOutlined,
} from '@ant-design/icons-vue';
import { useRouter } from 'vue-router';
import {
  checkinOpensAt,
  stateLabels,
  type EventRecord,
} from '../../../../packages/contracts/src/index';
import { api, errorMessage, formatTime, session } from '../services/api';
const events = ref<EventRecord[]>([]),
  loading = ref(true),
  error = ref(''),
  search = ref(''),
  filter = ref('all'),
  router = useRouter(),
  opening = ref('');
const tabs = [
  { key: 'all', label: '全部活动' },
  { key: 'live', label: '进行中' },
  { key: 'DRAFT', label: '草稿' },
  { key: 'CLOSED', label: '已结束' },
];
const live = (e: EventRecord) =>
  e.state === 'PUBLISHED' && checkinOpensAt(e) <= Date.now() && Date.parse(e.ends_at) > Date.now();
const visible = computed(() =>
  events.value.filter(
    (e) =>
      (!search.value ||
        `${e.name} ${e.location_label}`.toLowerCase().includes(search.value.toLowerCase())) &&
      (filter.value === 'all' ||
        (filter.value === 'live'
          ? live(e)
          : filter.value === 'CLOSED'
            ? e.state === 'CLOSED' || Date.parse(e.ends_at) <= Date.now()
            : e.state === filter.value)),
  ),
);
const totals = computed(() => ({
  live: events.value.filter(live).length,
  checkins: events.value.reduce((n, e) => n + e.checkin_count, 0),
  pending: events.value.reduce((n, e) => n + e.pending_count, 0),
}));
async function refresh() {
  loading.value = true;
  error.value = '';
  try {
    events.value = (await api<{ events: EventRecord[] }>('/admin/events')).events;
  } catch (e) {
    error.value = errorMessage(e);
  } finally {
    loading.value = false;
  }
}
async function display(e: EventRecord) {
  opening.value = e.id;
  try {
    const result = await api<{ display_url: string }>(`/admin/events/${e.id}/display-sessions`, {
      method: 'POST',
    });
    await router.push(result.display_url);
  } catch (err) {
    error.value = errorMessage(err);
  } finally {
    opening.value = '';
  }
}
onMounted(refresh);
</script>
<template>
  <div class="dashboard">
    <section class="dashboard-intro">
      <div>
        <h1>活动工作台</h1>
      </div>
      <a-button
        v-if="session.user?.role === 'admin'"
        type="primary"
        size="large"
        @click="router.push('/admin/events/new')"
        ><PlusOutlined /> 创建活动</a-button
      >
    </section>
    <div v-if="error" class="error-banner" role="alert">
      {{ error }} <button class="inline-retry" @click="refresh">重试</button>
    </div>
    <section class="stats-grid" aria-label="活动统计">
      <div class="stat">
        <div class="stat-label"><span>全部活动</span><AppstoreOutlined /></div>
        <div class="stat-number">{{ events.length }}<small>场</small></div>
      </div>
      <div class="stat">
        <div class="stat-label"><span>正在进行</span><span class="tiny-dot"></span></div>
        <div class="stat-number">{{ totals.live }}<small>场</small></div>
      </div>
      <div class="stat">
        <div class="stat-label"><span>累计签到</span><CheckCircleOutlined /></div>
        <div class="stat-number">{{ totals.checkins.toLocaleString() }}<small>人次</small></div>
      </div>
      <div class="stat">
        <div class="stat-label"><span>待核验</span><TeamOutlined /></div>
        <div class="stat-number" :class="{ attention: totals.pending }">
          {{ totals.pending }}<small>条</small>
        </div>
      </div>
    </section>
    <section class="activity-section">
      <div class="activity-title">
        <h2>
          我的活动 <span>{{ events.length }}</span>
        </h2>
      </div>
      <div class="activity-toolbar">
        <div class="filter-tabs" role="tablist" aria-label="活动分类">
          <button
            v-for="tab in tabs"
            :key="tab.key"
            role="tab"
            :aria-selected="filter === tab.key"
            :class="{ active: filter === tab.key }"
            @click="filter = tab.key"
          >
            {{ tab.label }}
          </button>
        </div>
        <a-input
          v-model:value="search"
          class="activity-search"
          placeholder="搜索活动名称或地点"
          aria-label="搜索活动"
          allow-clear
          ><template #prefix><SearchOutlined class="muted" /></template
        ></a-input>
      </div>
      <a-skeleton v-if="loading" active :paragraph="{ rows: 5 }" />
      <div v-else-if="!visible.length" class="panel empty-state">
        <div class="empty-symbol"><CalendarOutlined /></div>
        <h3>{{ search ? '没有找到匹配的活动' : '暂无活动' }}</h3>
        <p>{{ search ? '试试其他关键词。' : '点击创建活动开始配置。' }}</p>
        <a-button
          v-if="!search && session.user?.role === 'admin'"
          type="primary"
          @click="router.push('/admin/events/new')"
          >创建活动</a-button
        >
      </div>
      <div v-else class="event-grid">
        <article v-for="event in visible" :key="event.id" class="event-card">
          <div class="event-body">
            <div class="event-topline">
              <span class="status-pill" :class="event.state">{{
                event.state === 'PUBLISHED'
                  ? live(event)
                    ? '签到进行中'
                    : checkinOpensAt(event) > Date.now()
                      ? '即将开始'
                      : '签到已截止'
                  : stateLabels[event.state]
              }}</span
              ><span class="event-mode">{{
                `${event.category === 'internal' ? '内部' : '对外'} · ${event.admission === 'roster' ? '名单签到' : '开放签到'}`
              }}</span>
            </div>
            <RouterLink :to="`/admin/events/${event.id}/records`"
              ><h3>{{ event.name }}</h3></RouterLink
            >
            <div class="event-meta">
              <CalendarOutlined /><span
                >{{ formatTime(event.starts_at, event.timezone) }} —
                {{ formatTime(event.ends_at, event.timezone) }}</span
              >
            </div>
            <div class="event-meta">
              <EnvironmentOutlined /><span>{{ event.location_label || '地点待定' }}</span>
            </div>
            <div class="event-attendance">
              <div>
                <strong>{{ event.checkin_count }}</strong
                ><span
                  >人已签到<template v-if="event.admission === 'roster'">
                    / {{ event.participant_count }} 人名单</template
                  ></span
                >
              </div>
              <span v-if="event.pending_count" class="pending-hint"
                >{{ event.pending_count }} 待核验</span
              ><span v-else class="attendance-hint">{{
                event.location_mode === 'off' ? '无需定位' : '已配置定位规则'
              }}</span>
            </div>
            <div class="event-actions">
              <a-button
                v-if="session.user?.role === 'admin'"
                type="text"
                @click="router.push(`/admin/events/${event.id}`)"
                >管理活动 <ArrowRightOutlined /></a-button
              ><a-button
                v-else
                type="text"
                @click="router.push(`/admin/events/${event.id}/records`)"
                >查看记录 <ArrowRightOutlined /></a-button
              ><a-button
                :disabled="!live(event)"
                :loading="opening === event.id"
                @click="display(event)"
                ><QrcodeOutlined /> 展示签到码</a-button
              >
            </div>
          </div>
        </article>
      </div>
    </section>
  </div>
</template>
<style scoped>
.dashboard-intro {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 16px;
  margin-bottom: 20px;
}
.dashboard-intro h1 {
  font-size: 24px;
  margin: 0;
}
.dashboard-intro .ant-btn {
  flex-shrink: 0;
}
.stats-grid {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  border: 1px solid var(--border);
  border-radius: 8px;
  margin-bottom: 20px;
  padding: 16px 0;
}
.stat {
  padding: 0 20px;
  border-right: 1px solid var(--border);
}
.stat:last-child {
  border: 0;
}
.stat-label {
  display: flex;
  justify-content: space-between;
  align-items: center;
  font-size: 13px;
  color: var(--muted);
}
.stat-number {
  font-size: 28px;
  font-weight: 600;
  margin-top: 8px;
  line-height: 1.2;
  font-variant-numeric: tabular-nums;
}
.stat-number small {
  font-size: 12px;
  font-weight: 400;
  margin-left: 8px;
  color: var(--muted);
}
.attention {
  color: #a87528;
}
.tiny-dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: var(--green);
}
.activity-title {
  margin-bottom: 12px;
}
.activity-title h2 {
  font-size: 17px;
  margin: 0;
}
.activity-title h2 span {
  font-size: 12px;
  color: var(--muted);
  margin-left: 8px;
}
.activity-toolbar {
  display: flex;
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 16px;
  align-items: center;
}
.filter-tabs {
  display: flex;
  gap: 4px;
  border: 1px solid var(--border);
  border-radius: 8px;
  padding: 4px;
}
.filter-tabs button {
  background: var(--surface);
  border: 0;
  padding: 4px 12px;
  color: var(--muted);
  font-size: 13px;
  border-radius: 4px;
  white-space: nowrap;
  min-height: 32px;
}
.filter-tabs button.active {
  color: var(--accent);
  font-weight: 600;
}
.activity-search {
  width: 240px;
}
.event-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 16px;
}
.event-card {
  border: 1px solid var(--border);
  border-radius: 8px;
  background: var(--surface);
  min-width: 0;
}
.event-body {
  padding: 16px;
}
.event-topline {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 8px;
  margin-bottom: 12px;
}
.event-mode {
  font-size: 12px;
  color: var(--muted);
}
.event-body h3 {
  font-size: 17px;
  margin: 0 0 12px;
  line-height: 1.5;
  overflow-wrap: anywhere;
}
.event-meta {
  font-size: 12px;
  color: var(--muted);
  display: flex;
  align-items: flex-start;
  gap: 8px;
  margin: 8px 0;
}
.event-meta .anticon {
  margin-top: 3px;
}
.event-meta span {
  overflow-wrap: anywhere;
}
.event-attendance {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin: 12px 0;
  padding-top: 12px;
  border-top: 1px solid var(--border);
  gap: 8px;
  flex-wrap: wrap;
}
.event-attendance strong {
  font-size: 22px;
  margin-right: 8px;
  font-weight: 600;
}
.event-attendance div > span,
.attendance-hint,
.pending-hint {
  font-size: 12px;
  color: var(--muted);
}
.pending-hint {
  color: #a87528;
}
.event-actions {
  display: flex;
  justify-content: space-between;
  align-items: center;
  flex-wrap: wrap;
  gap: 8px;
  border-top: 1px solid var(--border);
  padding-top: 12px;
}
.event-actions .ant-btn {
  font-size: 13px;
  padding: 0 12px;
}
.event-actions .ant-btn-text {
  padding-left: 0;
}
.inline-retry {
  background: none;
  border: 0;
  text-decoration: underline;
  color: inherit;
}
@media (min-width: 1500px) {
  .event-grid {
    grid-template-columns: repeat(3, minmax(0, 1fr));
  }
}
@media (max-width: 1023px) {
  .event-grid {
    grid-template-columns: 1fr;
  }
  .stat {
    padding: 0 12px;
  }
}
@media (max-width: 767px) {
  .dashboard-intro {
    gap: 12px;
  }
  .dashboard-intro h1 {
    font-size: 22px;
  }
  .stats-grid {
    grid-template-columns: repeat(2, minmax(0, 1fr));
    row-gap: 16px;
  }
  .stat:nth-child(2) {
    border: 0;
  }
  .activity-toolbar {
    flex-direction: column;
    align-items: stretch;
  }
  .filter-tabs button {
    flex: 1;
    min-height: 44px;
    padding: 4px 8px;
  }
  .activity-search {
    width: 100%;
    min-height: 44px;
  }
}
</style>
