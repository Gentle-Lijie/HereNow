export type Point = { getLat(): number; getLng(): number };
export interface MapObject {
  on(name: string, callback: (e: { lnglat: Point }) => void): void;
  destroy(): void;
  setCenter(point: number[]): void;
  add(object: unknown): void;
}
export interface Marker {
  on(name: string, cb: () => void): void;
  setPosition(point: number[]): void;
  getPosition(): Point;
}
export interface Circle {
  setCenter(point: number[]): void;
  setRadius(radius: number): void;
}
export interface MapSdk {
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
    _AMapSecurityConfig?: { serviceHost: string };
  }
}

let pending: Promise<MapSdk> | undefined;
function readySdk(): MapSdk | undefined {
  const sdk = window.AMap;
  return sdk &&
    typeof sdk.Map === 'function' &&
    typeof sdk.Marker === 'function' &&
    typeof sdk.Circle === 'function' &&
    typeof sdk.plugin === 'function'
    ? sdk
    : undefined;
}
export async function loadMapSdk(jsKey?: string, serviceHost?: string): Promise<MapSdk> {
  const ready = readySdk();
  if (ready) return ready;
  if (pending) return pending;
  const key = jsKey?.trim();
  if (!key) throw new Error('地图尚未配置，请联系部署管理员开通地图服务，或使用经纬度备用方式。');
  if (!serviceHost) throw new Error('地图安全代理尚未配置，请联系部署管理员。');
  window._AMapSecurityConfig = { serviceHost };
  pending = new Promise<MapSdk>((resolve, reject) => {
    const script = document.createElement('script');
    script.src = `https://webapi.amap.com/maps?v=2.0&key=${encodeURIComponent(key)}`;
    script.async = true;
    const finish = (error?: Error) => {
      clearTimeout(timer);
      script.onload = null;
      script.onerror = null;
      const sdk = readySdk();
      if (error || !sdk) {
        script.remove();
        reject(error ?? new Error('地图服务未能初始化，请检查地图授权与域名配置后重试。'));
      } else resolve(sdk);
    };
    const timer = setTimeout(() => finish(new Error('地图加载超时，请检查网络后重试。')), 12000);
    script.onload = () => finish();
    script.onerror = () => finish(new Error('地图加载失败，请检查网络或地图授权后重试。'));
    document.head.append(script);
  }).finally(() => {
    pending = undefined;
  });
  return pending;
}
