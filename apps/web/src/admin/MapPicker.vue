<script setup lang="ts">
import { ref, onBeforeUnmount, watch, nextTick } from 'vue';
import {
  Button as AButton,
  Input as AInput,
  InputNumber as AInputNumber,
  Modal as AModal,
} from 'ant-design-vue';
import type { EventInput } from '../../../../packages/contracts/src/index';
import { errorMessage } from '../services/api';
type Point = { getLat(): number; getLng(): number };
interface MapObject {
  on(name: string, callback: (e: { lnglat: Point }) => void): void;
  destroy(): void;
  setCenter(point: number[]): void;
  add(object: unknown): void;
}
interface Marker {
  on(name: string, cb: () => void): void;
  setPosition(point: number[]): void;
  getPosition(): Point;
}
interface Circle {
  setCenter(point: number[]): void;
  setRadius(radius: number): void;
}
interface MapSdk {
  Map: new (container: HTMLElement, options: unknown) => MapObject;
  Marker: new (options: unknown) => Marker;
  Circle: new (options: unknown) => Circle;
  PlaceSearch: new (options: unknown) => {
    search(
      keyword: string,
      callback: (
        status: string,
        result: { poiList?: { pois: Array<{ name: string; address: string; location: Point }> } },
      ) => void,
    ): void;
  };
  plugin(names: string[], callback: () => void): void;
}
declare global {
  interface Window {
    AMap?: MapSdk;
  }
}
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
  latitude = ref(31.2304),
  longitude = ref(121.4737),
  coordinate = ref<'WGS84' | 'GCJ-02'>('WGS84'),
  localRadius = ref(props.radius),
  manual = ref(false);
let map: MapObject | undefined, marker: Marker | undefined, circle: Circle | undefined;
let alive = true;
let searchEpoch = 0;
function cleanup() {
  searchEpoch++;
  map?.destroy();
  map = undefined;
  marker = undefined;
  circle = undefined;
}
async function loadSdk() {
  if (window.AMap) return window.AMap;
  const key = import.meta.env.VITE_AMAP_KEY as string | undefined;
  if (!key) throw new Error('地图服务暂不可用。可稍后重试，或使用坐标备用方式。');
  await new Promise<void>((resolve, reject) => {
    const s = document.createElement('script');
    s.src = `https://webapi.amap.com/maps?v=2.0&key=${encodeURIComponent(key)}`;
    const timer = setTimeout(() => {
      s.remove();
      reject(new Error('地图加载超时，请重试'));
    }, 12000);
    s.onload = () => {
      clearTimeout(timer);
      resolve();
    };
    s.onerror = () => {
      clearTimeout(timer);
      s.remove();
      reject(new Error('地图加载失败，请重试'));
    };
    document.head.append(s);
  });
  if (!window.AMap) throw new Error('地图服务未能初始化');
  return window.AMap;
}
async function initialize() {
  cleanup();
  error.value = '';
  busy.value = true;
  await nextTick();
  try {
    const sdk = await loadSdk();
    if (!alive || !open.value || !container.value) return;
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
    map.on('click', (e) => choose(e.lnglat.getLat(), e.lnglat.getLng()));
    marker.on('dragend', () => {
      const p = marker!.getPosition();
      choose(p.getLat(), p.getLng());
    });
    latitude.value = point[1]!;
    longitude.value = point[0]!;
    coordinate.value = 'GCJ-02';
  } catch (e) {
    error.value = errorMessage(e);
    manual.value = true;
  } finally {
    busy.value = false;
  }
}
function choose(lat: number, lng: number) {
  latitude.value = lat;
  longitude.value = lng;
  coordinate.value = 'GCJ-02';
  marker?.setPosition([lng, lat]);
  circle?.setCenter([lng, lat]);
  map?.setCenter([lng, lat]);
}
async function searchPoi() {
  const epoch = ++searchEpoch;
  try {
    const sdk = await loadSdk();
    sdk.plugin(['AMap.PlaceSearch'], () => {
      new sdk.PlaceSearch({ pageSize: 5 }).search(search.value, (status, result) => {
        if (epoch !== searchEpoch || !open.value) return;
        if (status !== 'complete') {
          results.value = [];
          error.value = '没有找到地点，请修改关键词或在地图上选点';
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
    });
  } catch (e) {
    error.value = errorMessage(e);
  }
}
function show() {
  latitude.value = props.modelValue?.latitude ?? 31.2304;
  longitude.value = props.modelValue?.longitude ?? 121.4737;
  coordinate.value = props.modelValue?.coordinate_system ?? 'WGS84';
  localRadius.value = props.radius;
  manual.value = false;
  results.value = [];
  open.value = true;
  void initialize();
}
function confirm() {
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
  <a-modal v-model:open="open" title="设置活动位置" width="860px" :footer="null" @cancel="cleanup"
    ><div v-if="error" role="alert" class="error-banner">{{ error }}</div>
    <div class="map-search">
      <a-input
        v-model:value="search"
        aria-label="搜索地址或场馆"
        placeholder="输入城市、地址或场馆名称"
        @press-enter="searchPoi"
      /><a-button :disabled="!search.trim()" @click="searchPoi">搜索地点</a-button>
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
    <button class="backup-toggle" @click="manual = !manual">
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
        ><a-button type="primary" @click="confirm">确认位置</a-button>
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
