import { createRequire } from 'node:module';
// gcoord publishes a CommonJS runtime and ESM-style declarations. Keep the adapter explicit.
const gcoord = createRequire(import.meta.url)('gcoord') as {
  transform(point: [number, number], from: string, to: string): [number, number];
  GCJ02: string;
  WGS84: string;
};
import type { EventInput, LocationInput } from '../../../../packages/contracts/src/index.js';
import { fail } from './security.js';
export function haversine(
  a: { latitude: number; longitude: number },
  b: { latitude: number; longitude: number },
) {
  const rad = (x: number) => (x * Math.PI) / 180;
  const dlat = rad(b.latitude - a.latitude),
    dlon = rad(b.longitude - a.longitude);
  return (
    6371008.8 *
    2 *
    Math.asin(
      Math.min(
        1,
        Math.sqrt(
          Math.sin(dlat / 2) ** 2 +
            Math.cos(rad(a.latitude)) * Math.cos(rad(b.latitude)) * Math.sin(dlon / 2) ** 2,
        ),
      ),
    )
  );
}
export function normalizeCenter(e: EventInput) {
  if (!e.center) return null;
  if (e.center.coordinate_system === 'WGS84')
    return { latitude: e.center.latitude, longitude: e.center.longitude };
  if (
    e.center.longitude < 73 ||
    e.center.longitude > 135 ||
    e.center.latitude < 18 ||
    e.center.latitude > 54
  )
    fail('COORDINATE_CONVERSION_FAILED', '该地区尚未验证地图坐标转换');
  const converted = gcoord.transform(
    [e.center.longitude, e.center.latitude],
    gcoord.GCJ02,
    gcoord.WGS84,
  );
  return { longitude: converted[0]!, latitude: converted[1]! };
}
export function locationDecision(e: EventInput, location?: LocationInput) {
  if (e.location_mode === 'off') {
    if (location) fail('INVALID_FORM', '当前活动不采集定位');
    return { result: '未采集', distance: null };
  }
  if (!location) {
    if (e.location_mode === 'required')
      fail('LOCATION_DENIED', '此活动需要定位，请获取位置或联系现场工作人员');
    return { result: '未获取', distance: null };
  }
  if (e.location_mode === 'record') return { result: '仅记录', distance: null };
  const center = normalizeCenter(e);
  if (!center) fail('COORDINATE_CONVERSION_FAILED', '活动中心尚未配置');
  const distance = haversine(center!, location);
  if (location.accuracy > e.max_accuracy)
    fail('LOCATION_UNCERTAIN', '定位精度不足，请重试或现场核验');
  const a = location.accuracy + e.conversion_error_budget;
  if (distance + a <= e.radius) return { result: '范围内', distance };
  if (distance - a > e.radius) fail('LOCATION_OUTSIDE', '当前位置在签到范围外');
  return fail('LOCATION_UNCERTAIN', '您位于签到范围边界，请重试或现场核验');
}
