<script setup lang="ts">
import { ref, computed, onBeforeUnmount, watch, nextTick } from 'vue';
import {
  Button as AButton,
  Input as AInput,
  InputNumber as AInputNumber,
  Modal as AModal,
} from 'ant-design-vue';
import type { EventInput } from '../../../../packages/contracts/src/index';
import { api, errorMessage } from '../services/api';
import { loadMapSdk, type MapObject, type Marker, type Circle } from '../services/map-sdk';
const props = defineProps<{ modelValue: EventInput['center']; radius: number }>();
const emit = defineEmits<{
  'update:modelValue': [EventInput['center']];
  'update:radius': [number];
}>();
const open = ref(false),
  container = ref<HTMLElement>(),
  search = ref(''),
  error = ref(''),
  busy = ref(false),
  results = ref<Array<{ name: string; address: string; latitude: number; longitude: number }>>([]),
  latitude = ref<number | string>(''),
  longitude = ref<number | string>(''),
  coordinate = ref<'WGS84' | 'GCJ-02'>('WGS84'),
  localRadius = ref(props.radius),
  manual = ref(false),
  mapReady = ref(false),
  locating = ref(false),
  locationStatus = ref('');
const validPosition = computed(
  () =>
    typeof latitude.value === 'number' &&
    typeof longitude.value === 'number' &&
    Number.isFinite(latitude.value) &&
    Number.isFinite(longitude.value) &&
    latitude.value >= -90 &&
    latitude.value <= 90 &&
    longitude.value >= -180 &&
    longitude.value <= 180,
);
const canConfirm = computed(
  () =>
    !busy.value &&
    !locating.value &&
    (manual.value || mapReady.value) &&
    validPosition.value &&
    Number.isFinite(localRadius.value) &&
    localRadius.value >= 50 &&
    localRadius.value <= 10000,
);
let map: MapObject | undefined, marker: Marker | undefined, circle: Circle | undefined;
let alive = true;
let initializeEpoch = 0;
let searchTimer: ReturnType<typeof setTimeout> | undefined;
let searchEpoch = 0;
let locationEpoch = 0;
let locationTimer: ReturnType<typeof setTimeout> | undefined;
let autoLocationAttempted = false;
let mapPointerActive = false;
function mapPointerDown() {
  mapPointerActive = true;
  cancelLocation();
  locationStatus.value = '';
}
function cancelLocation() {
  locationEpoch++;
  if (locationTimer) clearTimeout(locationTimer);
  locationTimer = undefined;
  locating.value = false;
}
function cleanup() {
  cancelLocation();
  locationStatus.value = '';
  mapPointerActive = false;
  container.value?.removeEventListener('pointerdown', mapPointerDown, true);
  initializeEpoch++;
  searchEpoch++;
  if (searchTimer) clearTimeout(searchTimer);
  mapReady.value = false;
  busy.value = false;
  map?.destroy();
  map = undefined;
  marker = undefined;
  circle = undefined;
}
async function mapSdk() {
  const key = import.meta.env.VITE_AMAP_KEY as string | undefined;
  if (key?.trim() && !window.AMap) {
    const status = await api<{ ready: boolean }>('/admin/map-config');
    if (!status.ready)
      throw new Error('地图安全配置尚未完成，请联系部署管理员，或使用经纬度备用方式。');
  }
  return loadMapSdk(key, `${location.origin}/api/_AMapService`);
}
async function initialize() {
  cleanup();
  const epoch = initializeEpoch;
  error.value = '';
  results.value = [];
  manual.value = false;
  busy.value = true;
  await nextTick();
  try {
    const sdk = await mapSdk();
    if (!alive || !open.value || epoch !== initializeEpoch || !container.value) return;
    let point = props.modelValue
      ? [props.modelValue.longitude, props.modelValue.latitude]
      : [121.4737, 31.2304];
    if (props.modelValue?.coordinate_system === 'WGS84') {
      const { default: coordinates } = await import('gcoord');
      point = coordinates.transform(
        [props.modelValue.longitude, props.modelValue.latitude],
        coordinates.WGS84,
        coordinates.GCJ02,
      );
    }
    if (!alive || !open.value || epoch !== initializeEpoch || !container.value) return;
    container.value.addEventListener('pointerdown', mapPointerDown, true);
    map = new sdk.Map(container.value, { zoom: 15, center: point });
    marker = new sdk.Marker({ position: point, draggable: true });
    circle = new sdk.Circle({
      center: point,
      radius: localRadius.value,
      fillColor: '#d6603d',
      fillOpacity: 0.12,
      strokeColor: '#d6603d',
      strokeWeight: 2,
    });
    map.add([marker, circle]);
    map.on('click', (e) => {
      // Ignore SDK clicks carried over from the gesture that opened the modal.
      if (alive && open.value && epoch === initializeEpoch && mapPointerActive) {
        mapPointerActive = false;
        choose(e.lnglat.getLat(), e.lnglat.getLng());
      }
    });
    marker.on('dragend', () => {
      if (!alive || !open.value || epoch !== initializeEpoch || !marker) return;
      const p = marker.getPosition();
      choose(p.getLat(), p.getLng());
    });
    if (props.modelValue) {
      latitude.value = point[1]!;
      longitude.value = point[0]!;
      coordinate.value = 'GCJ-02';
    }
    mapReady.value = true;
  } catch (e) {
    if (!alive || !open.value || epoch !== initializeEpoch) return;
    cleanup();
    error.value = errorMessage(e);
    manual.value = true;
  } finally {
    if (epoch === initializeEpoch) {
      busy.value = false;
      if (mapReady.value && !props.modelValue && !autoLocationAttempted) {
        autoLocationAttempted = true;
        locate();
      }
    }
  }
}
function choose(lat: number, lng: number) {
  cancelLocation();
  locationStatus.value = '';
  applyPoint(lat, lng);
}
function applyPoint(lat: number, lng: number) {
  latitude.value = lat;
  longitude.value = lng;
  coordinate.value = 'GCJ-02';
  marker?.setPosition([lng, lat]);
  circle?.setCenter([lng, lat]);
  map?.setCenter([lng, lat]);
}
function locate() {
  if (!mapReady.value || busy.value || manual.value || !open.value) return;
  cancelLocation();
  if (!window.isSecureContext) {
    locationStatus.value = '当前页面无法安全定位，请使用 HTTPS 或 localhost。';
    return;
  }
  if (!navigator.geolocation) {
    locationStatus.value = '当前浏览器不支持定位，可搜索地点或在地图上选点。';
    return;
  }
  searchEpoch++;
  if (searchTimer) clearTimeout(searchTimer);
  results.value = [];
  const epoch = locationEpoch;
  locating.value = true;
  locationStatus.value = '正在获取当前位置…';
  const current = () => alive && open.value && !manual.value && epoch === locationEpoch;
  const failed = (message: string) => {
    if (!current()) return;
    cancelLocation();
    locationStatus.value = message;
  };
  locationTimer = setTimeout(() => failed('定位超时，请重试或在地图上选点。'), 10000);
  try {
    navigator.geolocation.getCurrentPosition(
      (position) => {
        void (async () => {
          if (!current()) return;
          const { latitude: lat, longitude: lng, accuracy } = position.coords;
          if (
            !Number.isFinite(lat) ||
            !Number.isFinite(lng) ||
            !Number.isFinite(accuracy) ||
            lat < -90 ||
            lat > 90 ||
            lng < -180 ||
            lng > 180 ||
            accuracy < 0
          ) {
            failed('定位结果无效，请重试或在地图上选点。');
            return;
          }
          try {
            const { default: coordinates } = await import('gcoord');
            if (!current()) return;
            const [mapLng, mapLat] = coordinates.transform(
              [lng, lat],
              coordinates.WGS84,
              coordinates.GCJ02,
            );
            if (!Number.isFinite(mapLat) || !Number.isFinite(mapLng))
              throw new Error('Invalid coordinate conversion');
            cancelLocation();
            applyPoint(mapLat!, mapLng!);
            locationStatus.value = `已定位，误差约 ${Math.ceil(accuracy)} 米。请核对位置后确认。`;
          } catch {
            failed('定位坐标转换失败，请重试或在地图上选点。');
          }
        })();
      },
      (failure) =>
        failed(
          failure.code === 1
            ? '定位权限被拒绝，请在浏览器设置中允许定位后重试，或在地图上选点。'
            : failure.code === 3
              ? '定位超时，请重试或在地图上选点。'
              : '暂时无法获取当前位置，请重试或在地图上选点。',
        ),
      { enableHighAccuracy: true, maximumAge: 0, timeout: 10000 },
    );
  } catch {
    failed('无法启动定位，请检查浏览器权限或在地图上选点。');
  }
}
function useManual() {
  cancelLocation();
  locationStatus.value = '';
  searchEpoch++;
  if (searchTimer) clearTimeout(searchTimer);
  results.value = [];
  manual.value = true;
}
async function searchPoi() {
  if (busy.value || !mapReady.value || !search.value.trim()) return;
  if (searchTimer) clearTimeout(searchTimer);
  const epoch = ++searchEpoch;
  try {
    const sdk = await mapSdk();
    if (!alive || !open.value || epoch !== searchEpoch) return;
    searchTimer = setTimeout(() => {
      if (alive && open.value && epoch === searchEpoch) {
        searchEpoch++;
        error.value = '地点搜索超时，请重试。';
      }
    }, 12000);
    sdk.plugin(['AMap.PlaceSearch'], () => {
      if (!alive || !open.value || epoch !== searchEpoch) return;
      try {
        new sdk.PlaceSearch({ pageSize: 5 }).search(search.value, (status, result) => {
          if (epoch !== searchEpoch || !alive || !open.value) return;
          if (searchTimer) clearTimeout(searchTimer);
          if (status !== 'complete') {
            results.value = [];
            error.value =
              status === 'no_data'
                ? '没有找到地点，请修改关键词或在地图上选点。'
                : '地点搜索失败，请检查地图授权、域名或服务配额后重试。';
            return;
          }
          error.value = '';
          results.value = (result.poiList?.pois ?? []).map((p) => ({
            name: p.name,
            address: p.address,
            latitude: p.location.getLat(),
            longitude: p.location.getLng(),
          }));
        });
      } catch {
        if (searchTimer) clearTimeout(searchTimer);
        error.value = '地点搜索服务未能初始化，请重试加载地图。';
      }
    });
  } catch (e) {
    if (epoch !== searchEpoch || !alive || !open.value) return;
    if (searchTimer) clearTimeout(searchTimer);
    error.value = errorMessage(e);
  }
}
function show() {
  autoLocationAttempted = false;
  latitude.value = props.modelValue?.latitude ?? '';
  longitude.value = props.modelValue?.longitude ?? '';
  coordinate.value = props.modelValue?.coordinate_system ?? 'WGS84';
  localRadius.value = props.radius;
  manual.value = false;
  results.value = [];
  open.value = true;
  void initialize();
}
function confirm() {
  if (
    !canConfirm.value ||
    typeof latitude.value !== 'number' ||
    typeof longitude.value !== 'number'
  )
    return;
  if (
    !Number.isFinite(latitude.value) ||
    !Number.isFinite(longitude.value) ||
    latitude.value < -90 ||
    latitude.value > 90 ||
    longitude.value < -180 ||
    longitude.value > 180
  )
    return;
  emit('update:modelValue', {
    latitude: latitude.value,
    longitude: longitude.value,
    coordinate_system: coordinate.value,
    provider: manual.value ? 'manual' : 'amap',
  });
  emit('update:radius', localRadius.value);
  open.value = false;
  cleanup();
}
watch(localRadius, (value) => circle?.setRadius(value));
watch(search, () => {
  cancelLocation();
  locationStatus.value = '';
  searchEpoch++;
  if (searchTimer) clearTimeout(searchTimer);
  results.value = [];
});
onBeforeUnmount(() => {
  alive = false;
  cleanup();
});
</script>
<template>
  <div class="map-summary">
    <div>
      <strong>{{ modelValue ? '已设置活动中心' : '还没有设置活动中心' }}</strong>
      <p>
        {{
          modelValue
            ? `${modelValue.latitude.toFixed(6)}, ${modelValue.longitude.toFixed(6)} · ${modelValue.coordinate_system}`
            : '搜索场馆或在地图上选点，确认实际签到区域。'
        }}
      </p>
    </div>
    <a-button @click="show">{{ modelValue ? '修改位置' : '选择活动位置' }}</a-button>
  </div>
  <a-modal
    v-model:open="open"
    title="设置活动位置"
    width="860px"
    :footer="null"
    force-render
    @cancel="cleanup"
    ><div v-if="error" role="alert" class="error-banner">
      {{ error }}
      <a-button :loading="busy" @click="initialize">重试加载地图</a-button>
    </div>
    <div v-show="!manual" class="map-search">
      <a-input
        v-model:value="search"
        aria-label="搜索地址或场馆"
        placeholder="输入城市、地址或场馆名称"
        @press-enter="searchPoi"
      /><a-button :disabled="busy || !mapReady || !search.trim()" @click="searchPoi"
        >搜索地点</a-button
      >
    </div>
    <div v-show="!manual" class="map-location">
      <a-button :loading="locating" :disabled="busy || !mapReady" @click="locate"
        >定位到我附近</a-button
      >
      <span v-if="locationStatus" role="status">{{ locationStatus }}</span>
    </div>
    <div v-if="results.length" class="poi-list">
      <button
        v-for="poi in results"
        :key="`${poi.latitude},${poi.longitude}`"
        @click="choose(poi.latitude, poi.longitude)"
      >
        <strong>{{ poi.name }}</strong
        ><span>{{ poi.address }}</span>
      </button>
    </div>
    <div v-show="!manual" ref="container" class="map-canvas" :aria-busy="busy"></div>
    <button class="backup-toggle" :disabled="busy" @click="manual ? initialize() : useManual()">
      {{ manual ? '返回地图选点' : '使用经纬度备用方式' }}
    </button>
    <div v-if="manual" class="form-grid">
      <label class="field-group"
        ><span class="field-label">纬度</span
        ><input
          v-model.number="latitude"
          class="native-input"
          type="number"
          step="0.000001"
          min="-90"
          max="90" /></label
      ><label class="field-group"
        ><span class="field-label">经度</span
        ><input
          v-model.number="longitude"
          class="native-input"
          type="number"
          step="0.000001"
          min="-180"
          max="180" /></label
      ><label class="field-group"
        ><span class="field-label">原始坐标系</span
        ><select v-model="coordinate" class="native-input">
          <option value="WGS84">WGS84（标准定位）</option>
          <option value="GCJ-02">GCJ-02（高德地图）</option>
        </select></label
      >
    </div>
    <div class="map-footer">
      <label
        >围栏半径（米） <a-input-number v-model:value="localRadius" :min="50" :max="10000"
      /></label>
      <div class="actions-row">
        <a-button
          @click="
            open = false;
            cleanup();
          "
          >取消</a-button
        ><a-button type="primary" :disabled="!canConfirm" @click="confirm">确认位置</a-button>
      </div>
    </div></a-modal
  >
</template>
<style scoped>
.map-summary {
  background: #f7f8f3;
  border: 1px solid var(--border);
  padding: 18px;
  border-radius: 8px;
  display: flex;
  justify-content: space-between;
  gap: 15px;
  align-items: center;
}
.map-summary strong {
  font-size: 13px;
  font-weight: 500;
}
.map-summary p {
  font-size: 12px;
  color: var(--muted);
  margin: 7px 0 0;
  overflow-wrap: anywhere;
}
.map-search {
  display: flex;
  gap: 10px;
  margin-bottom: 15px;
}
.map-location {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 8px 12px;
  margin-bottom: 12px;
}
.map-location > span {
  font-size: 13px;
  color: var(--muted);
  line-height: 1.5;
}
.map-canvas {
  height: 370px;
  border-radius: 8px;
  background: #f1f2ec;
}
.backup-toggle {
  border: 0;
  background: none;
  color: var(--accent);
  font-size: 12px;
  padding: 16px 0;
}
.map-footer {
  display: flex;
  justify-content: space-between;
  gap: 14px;
  flex-wrap: wrap;
  border-top: 1px solid var(--border);
  padding-top: 18px;
}
.map-footer label {
  font-size: 13px;
  display: flex;
  align-items: center;
  gap: 10px;
}
.poi-list {
  display: grid;
  margin-bottom: 14px;
  gap: 6px;
}
.poi-list button {
  text-align: left;
  background: #f7f8f3;
  padding: 10px;
  border: 1px solid var(--border);
  border-radius: 6px;
}
.poi-list span {
  display: block;
  font-size: 11px;
  color: var(--muted);
  margin-top: 5px;
}
@media (max-width: 767px) {
  .map-summary {
    flex-direction: column;
    align-items: flex-start;
  }
  .map-canvas {
    height: 45vh;
  }
  .map-footer {
    flex-direction: column;
  }
}
</style>
