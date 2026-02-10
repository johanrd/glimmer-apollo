import ApplicationInstance from '@ember/application/instance';
import type Owner from '@ember/owner';
export { tracked } from '@glimmer/tracking';
import { getOwner as _getOwner } from '@ember/owner';
export { setOwner } from '@ember/owner';
export { getValue, createCache } from '@glimmer/tracking/primitives/cache';
export { registerDestructor } from '@ember/destroyable';
export { waitForPromise } from '@ember/test-waiters';

export function getOwner(obj: object): Owner | undefined {
  if (
    obj instanceof ApplicationInstance ||
    ('lookup' in obj && 'factoryFor' in obj)
  ) {
    return obj as Owner;
  }

  return _getOwner(obj);
}
