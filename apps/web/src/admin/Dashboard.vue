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
import { stateLabels, type EventRecord } from '../../../../packages/contracts/src/index';
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
  e.state === 'PUBLISHED' &&
  Date.parse(e.starts_at) <= Date.now() &&
  Date.parse(e.ends_at) > Date.now();
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
        <span class="eyebrow">YOUR GATHERINGS, ALL HERE.</span>
        <h1>每一场相聚，都从在场开始<span>。</span></h1>
        <p>创建活动、展示签到码，剩下的交给 HereNow。</p>
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
        <div class="stat-caption">每一次相聚，都在这里</div>
      </div>
      <div class="stat">
        <div class="stat-label"><span>正在进行</span><span class="tiny-dot"></span></div>
        <div class="stat-number">{{ totals.live }}<small>场</small></div>
        <div class="stat-caption">现场签到已开放</div>
      </div>
      <div class="stat">
        <div class="stat-label"><span>累计在场</span><CheckCircleOutlined /></div>
        <div class="stat-number">{{ totals.checkins.toLocaleString() }}<small>人次</small></div>
        <div class="stat-caption">已确认的签到记录</div>
      </div>
      <div class="stat">
        <div class="stat-label"><span>待核验</span><TeamOutlined /></div>
        <div class="stat-number" :class="{ attention: totals.pending }">
          {{ totals.pending }}<small>条</small>
        </div>
        <div class="stat-caption">留给现场工作人员确认</div>
      </div>
    </section>
    <section class="activity-section">
      <div class="activity-title">
        <h2>
          我的活动 <span>{{ events.length }}</span>
        </h2>
        <span class="activity-note">把心思留给活动，把签到交给在场。</span>
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
        <h3>{{ search ? '没有找到匹配的活动' : '下一次相聚，从这里开始' }}</h3>
        <p>{{ search ? '试试其他关键词。' : '创建活动，让现场签到变得简单。' }}</p>
        <a-button
          v-if="!search && session.user?.role === 'admin'"
          type="primary"
          @click="router.push('/admin/events/new')"
          >创建活动</a-button
        >
      </div>
      <div v-else class="event-grid">
        <article v-for="(event, index) in visible" :key="event.id" class="event-card">
          <div class="event-cover" :class="`cover-${index % 3}`">
            <span class="cover-category">{{
              event.category === 'internal' ? '内部活动' : '公开活动'
            }}</span>
            <div class="cover-art" aria-hidden="true">
              <span class="cover-ring"></span><span class="cover-ring secondary"></span
              ><span class="cover-square"></span>
            </div>
            <span class="cover-word">{{
              event.category === 'internal' ? 'GET TOGETHER' : 'MEET & CONNECT'
            }}</span
            ><span class="cover-index">{{ String(index + 1).padStart(2, '0') }}</span>
          </div>
          <div class="event-body">
            <div class="event-topline">
              <span class="status-pill" :class="event.state">{{
                event.state === 'PUBLISHED'
                  ? live(event)
                    ? '签到进行中'
                    : Date.parse(event.starts_at) > Date.now()
                      ? '即将开始'
                      : '签到已截止'
                  : stateLabels[event.state]
              }}</span
              ><span class="event-mode">{{
                event.admission === 'roster' ? '名单签到' : '开放签到'
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
                  >人已在场<template v-if="event.admission === 'roster'">
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
        <button
          v-if="session.user?.role === 'admin' && filter === 'all' && !search"
          class="create-tile"
          @click="router.push('/admin/events/new')"
        >
          <span class="create-tile-icon"><PlusOutlined /></span>
          <h3>准备下一次相聚</h3>
          <p>几步配置，即可开启现场签到</p>
          <span class="create-tile-link">创建新活动 <ArrowRightOutlined /></span>
        </button>
      </div>
    </section>
    <div class="dashboard-bottom">
      <span class="bottom-symbol">✳</span>
      <div>
        <strong>现场的主角是你们，而不是签到流程。</strong>
        <p>活动二维码支持多人同时扫码；不同身份的签到，分别记录。</p>
      </div>
      <span class="bottom-word">LESS FRICTION.<br />MORE CONNECTION.</span>
    </div>
  </div>
</template>
<style scoped>
.dashboard-intro {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin: 2px 0 35px;
  gap: 24px;
}
.dashboard-intro h1 {
  font-size: 29px;
  margin: 13px 0 12px;
  line-height: 1.5;
}
.dashboard-intro h1 > span {
  color: var(--accent);
}
.dashboard-intro p {
  font-size: 13px;
  color: var(--muted);
  margin: 0;
}
.dashboard-intro .ant-btn {
  font-size: 13px;
  height: 43px;
  flex-shrink: 0;
  padding: 0 20px;
}
.stats-grid {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  background: #fff;
  border: 1px solid var(--border);
  border-radius: 11px;
  margin-bottom: 37px;
  padding: 24px 0;
}
.stat {
  padding: 0 27px;
  border-right: 1px solid var(--border);
}
.stat:last-child {
  border: 0;
}
.stat-label {
  display: flex;
  justify-content: space-between;
  font-size: 12px;
  color: #77816e;
  align-items: center;
}
.stat-label > .anticon {
  color: #9ba48f;
  font-size: 15px;
}
.tiny-dot {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: #74a37b;
}
.stat-number {
  font-size: 37px;
  font-weight: 600;
  letter-spacing: -1px;
  margin: 15px 0 8px;
  line-height: 1.1;
  font-variant-numeric: tabular-nums;
}
.stat-number small {
  font-weight: 400;
  font-size: 11px;
  margin-left: 10px;
  color: #9b9f95;
  letter-spacing: 0;
}
.stat-caption {
  font-size: 10px;
  color: #9b9f95;
}
.attention {
  color: #b58530;
}
.activity-title {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 22px;
}
.activity-title h2 {
  font-size: 17px;
  font-weight: 600;
  margin: 0;
}
.activity-title h2 span {
  font-size: 11px;
  background: #ecede6;
  color: #8b9381;
  padding: 3px 7px;
  border-radius: 5px;
  margin-left: 8px;
}
.activity-note {
  font-size: 10px;
  color: #9a9f92;
}
.activity-toolbar {
  display: flex;
  justify-content: space-between;
  gap: 20px;
  margin-bottom: 21px;
  align-items: center;
}
.filter-tabs {
  display: flex;
  gap: 6px;
  background: #efefe8;
  border-radius: 8px;
  padding: 4px;
}
.filter-tabs button {
  background: none;
  border: 0;
  padding: 7px 15px;
  color: #868e7f;
  font-size: 12px;
  border-radius: 5px;
  white-space: nowrap;
  min-height: 32px;
}
.filter-tabs button.active {
  background: white;
  color: #3f4a38;
  box-shadow: 0 1px 4px #00000009;
}
.activity-search {
  width: 232px;
  background: #faf9f6;
  height: 36px;
  font-size: 12px;
}
.event-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 22px;
}
.event-card {
  border: 1px solid var(--border);
  border-radius: 11px;
  overflow: hidden;
  background: #fff;
  transition: box-shadow 0.2s;
}
.event-card:hover {
  box-shadow: 0 5px 20px #293d2910;
}
.event-cover {
  height: 142px;
  background: #e5ebdd;
  position: relative;
  overflow: hidden;
  padding: 20px 24px;
  color: #849576;
}
.cover-category {
  font-size: 9px;
  letter-spacing: 1px;
  padding: 4px 7px;
  border: 1px solid #aab99b70;
  border-radius: 3px;
}
.cover-word {
  position: absolute;
  bottom: 21px;
  left: 24px;
  font-size: 10px;
  letter-spacing: 2.2px;
  font-weight: 700;
}
.cover-index {
  position: absolute;
  right: 24px;
  bottom: 17px;
  font-size: 23px;
  letter-spacing: -1px;
  font-weight: 400;
  opacity: 0.6;
}
.cover-art {
  position: absolute;
  top: 5px;
  right: 60px;
  width: 165px;
  height: 140px;
}
.cover-ring {
  position: absolute;
  width: 92px;
  height: 92px;
  border: 1px solid #a2b68f;
  border-radius: 50%;
  top: 12px;
  left: 35px;
}
.cover-ring.secondary {
  top: 47px;
  left: 67px;
  border-color: #bdc9b1;
}
.cover-square {
  width: 27px;
  height: 27px;
  border: 1px solid #a2b68f;
  position: absolute;
  left: 20px;
  bottom: 18px;
  transform: rotate(23deg);
  border-radius: 2px;
}
.cover-1 {
  background: #eee3d6;
  color: #ac9273;
}
.cover-1 .cover-ring,
.cover-1 .cover-square {
  border-color: #cab597;
}
.cover-2 {
  background: #dfe8eb;
  color: #7e9aa4;
}
.cover-2 .cover-ring,
.cover-2 .cover-square {
  border-color: #a3bbc4;
}
.event-body {
  padding: 22px 24px 14px;
}
.event-topline {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 14px;
}
.event-mode {
  font-size: 10px;
  color: #a3a798;
}
.event-body h3 {
  font-size: 17px;
  font-weight: 600;
  margin: 0 0 18px;
  line-height: 1.6;
}
.event-meta {
  font-size: 11px;
  color: #8b9283;
  display: flex;
  align-items: flex-start;
  gap: 9px;
  margin: 9px 0;
}
.event-meta .anticon {
  margin-top: 2px;
}
.event-attendance {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin: 23px 0 16px;
  padding-top: 17px;
  border-top: 1px solid #eff0ea;
  gap: 12px;
}
.event-attendance strong {
  font-size: 23px;
  letter-spacing: -0.5px;
  margin-right: 9px;
  font-weight: 600;
}
.event-attendance div > span {
  font-size: 10px;
  color: #939b89;
}
.attendance-hint,
.pending-hint {
  font-size: 10px;
  color: #99a28c;
}
.pending-hint {
  color: #b58733;
}
.event-actions {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 5px;
  border-top: 1px solid #f0f1eb;
  padding-top: 13px;
}
.event-actions .ant-btn {
  font-size: 11px;
  height: 34px;
  padding: 0 12px;
}
.event-actions .ant-btn-text {
  padding-left: 0;
  color: #78856a;
}
.create-tile {
  border: 1px dashed #d6dccc;
  border-radius: 11px;
  background: #f7f8f2;
  min-height: 375px;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  color: #8a967d;
  transition: background 0.2s;
}
.create-tile:hover {
  background: #f0f3e8;
}
.create-tile-icon {
  background: #e9eedf;
  display: grid;
  place-items: center;
  border-radius: 50%;
  width: 45px;
  height: 45px;
  font-size: 20px;
  margin-bottom: 19px;
}
.create-tile h3 {
  font-size: 14px;
  color: #6b7c5c;
  font-weight: 500;
  margin: 0 0 11px;
}
.create-tile p {
  font-size: 11px;
  color: #a0aa94;
  margin-bottom: 21px;
}
.create-tile-link {
  font-size: 11px;
  color: #7e906d;
}
.create-tile-link .anticon {
  margin-left: 5px;
}
.dashboard-bottom {
  display: flex;
  align-items: center;
  gap: 21px;
  margin-top: 30px;
  padding: 23px 26px;
  border: 1px solid var(--border);
  border-radius: 10px;
  background: #f6f5f0;
}
.bottom-symbol {
  font-size: 33px;
  color: #a5ae97;
}
.dashboard-bottom strong {
  font-size: 12px;
  font-weight: 500;
  color: #7b856e;
}
.dashboard-bottom p {
  font-size: 10px;
  color: #a0a694;
  margin: 7px 0 0;
}
.bottom-word {
  font-size: 8px;
  letter-spacing: 1.3px;
  color: #a4ad97;
  line-height: 1.8;
  margin-left: auto;
  flex-shrink: 0;
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
  .stat {
    padding: 0 18px;
  }
  .stats-grid {
    padding: 22px 0;
  }
  .stat-caption {
    display: none;
  }
  .dashboard-intro h1 {
    font-size: 24px;
  }
  .activity-note {
    display: none;
  }
  .event-cover {
    height: 115px;
  }
  .event-body {
    padding: 18px 17px 12px;
  }
  .event-meta {
    font-size: 10px;
  }
  .event-attendance {
    align-items: flex-start;
    flex-direction: column;
    gap: 5px;
  }
  .event-actions .ant-btn {
    padding: 0 8px;
    font-size: 10px;
  }
  .bottom-word {
    display: none;
  }
}
@media (max-width: 767px) {
  .dashboard-intro {
    align-items: flex-start;
    flex-direction: column;
    gap: 20px;
    margin-bottom: 26px;
  }
  .dashboard-intro h1 {
    font-size: 24px;
  }
  .dashboard-intro .eyebrow {
    font-size: 9px;
  }
  .stats-grid {
    grid-template-columns: 1fr 1fr;
    row-gap: 25px;
    padding: 22px 0;
    margin-bottom: 28px;
  }
  .stat:nth-child(2) {
    border: 0;
  }
  .stat-number {
    font-size: 32px;
  }
  .stat-caption {
    display: block;
    font-size: 9px;
  }
  .activity-toolbar {
    flex-direction: column;
    align-items: stretch;
    gap: 15px;
  }
  .filter-tabs button {
    flex: 1;
    padding: 8px 10px;
    min-height: 36px;
  }
  .activity-search {
    width: 100%;
    height: 40px;
  }
  .event-grid {
    grid-template-columns: 1fr;
    gap: 18px;
  }
  .event-cover {
    height: 132px;
  }
  .event-body {
    padding: 20px;
  }
  .event-attendance {
    flex-direction: row;
    align-items: center;
  }
  .event-actions .ant-btn {
    height: 40px;
    font-size: 12px;
    padding: 0 12px;
  }
  .create-tile {
    min-height: 215px;
  }
  .dashboard-bottom {
    padding: 20px 15px;
    gap: 13px;
  }
  .dashboard-bottom strong {
    font-size: 11px;
  }
  .dashboard-bottom p {
    font-size: 10px;
  }
  .activity-title {
    margin-bottom: 18px;
  }
}
</style>
