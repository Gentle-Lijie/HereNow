import { describe, it, expect, vi } from 'vitest';
import { createPipController } from '../apps/web/src/services/pip-controller.js';

class PipWindow extends EventTarget {
  closed = false;
  focus = vi.fn();
  close = vi.fn(() => {
    this.closed = true;
    this.dispatchEvent(new Event('pagehide'));
  });
  asWindow() {
    return this as unknown as Window;
  }
}
describe('Document PiP display lifecycle', () => {
  it('requests a window synchronously before awaiting authentication or renderer imports', async () => {
    const target = new PipWindow(),
      steps: string[] = [],
      unmount = vi.fn();
    const controller = createPipController({
      secure: () => true,
      api: () => ({
        requestWindow: async () => {
          steps.push('window');
          return target.asWindow();
        },
      }),
      authorize: async () => {
        steps.push('authorize');
      },
      loadRenderer: async () => {
        steps.push('import');
        return () => {
          steps.push('mount');
          return unmount;
        };
      },
    });
    const opening = controller.open('1');
    expect(steps).toEqual(['window']);
    await opening;
    expect(steps).toEqual(['window', 'authorize', 'import', 'mount']);
    await controller.open('1');
    expect(target.focus).toHaveBeenCalledOnce();
    expect(steps).toHaveLength(4);
    controller.close();
    expect(unmount).toHaveBeenCalledOnce();
    expect(target.close).toHaveBeenCalledOnce();
  });
  it('rejects unsupported browsers without creating server display sessions', async () => {
    const authorize = vi.fn(),
      loadRenderer = vi.fn();
    const controller = createPipController({
      secure: () => true,
      api: () => undefined,
      authorize,
      loadRenderer,
    });
    await expect(controller.open('1')).rejects.toThrow('不支持 Document PiP');
    expect(authorize).not.toHaveBeenCalled();
    expect(loadRenderer).not.toHaveBeenCalled();
  });
  it('does not mount into a window closed while authentication is pending', async () => {
    const target = new PipWindow();
    let finish: (() => void) | undefined;
    const authorize = () =>
      new Promise<void>((resolve) => {
        finish = resolve;
      });
    const loadRenderer = vi.fn();
    const controller = createPipController({
      secure: () => true,
      api: () => ({ requestWindow: async () => target.asWindow() }),
      authorize,
      loadRenderer,
    });
    const opening = controller.open('1');
    await Promise.resolve();
    target.close();
    finish!();
    await opening;
    expect(loadRenderer).not.toHaveBeenCalled();
  });
  it('unmounts the previous event before opening a different event', async () => {
    const first = new PipWindow(),
      second = new PipWindow(),
      unmount = vi.fn();
    const requestWindow = vi
      .fn()
      .mockResolvedValueOnce(first.asWindow())
      .mockResolvedValueOnce(second.asWindow());
    const controller = createPipController({
      secure: () => true,
      api: () => ({ requestWindow }),
      authorize: async () => {},
      loadRenderer: async () => () => unmount,
    });
    await controller.open('1');
    await controller.open('2');
    expect(first.close).toHaveBeenCalledOnce();
    expect(unmount).toHaveBeenCalledOnce();
    second.close();
    expect(unmount).toHaveBeenCalledTimes(2);
  });
  it('closes a blank window when the backend refuses authorization', async () => {
    const target = new PipWindow(),
      render = vi.fn();
    const controller = createPipController({
      secure: () => true,
      api: () => ({ requestWindow: async () => target.asWindow() }),
      authorize: async () => {
        throw new Error('活动不可用');
      },
      loadRenderer: render,
    });
    await expect(controller.open('1')).rejects.toThrow('活动不可用');
    expect(target.close).toHaveBeenCalledOnce();
    expect(render).not.toHaveBeenCalled();
  });
});
