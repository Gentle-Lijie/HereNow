// Use the request start, not receipt time: network/encoding delays must not extend QR validity.
export function displayClockOffset(serverTime: string, requestStartedAt: number) {
  return Date.parse(serverTime) - requestStartedAt;
}
