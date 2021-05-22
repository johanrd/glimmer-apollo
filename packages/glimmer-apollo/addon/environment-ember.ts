// NOTE: This file is included in the host Ember App. All imports must be global
// and not local. eg. from 'glimmer-apollo/environment' instead of './environment'
import { setEnviromentContext } from 'glimmer-apollo/environment';
import { getOwner, setOwner } from '@ember/application';
import { getValue, createCache } from '@glimmer/tracking/primitives/cache';
import { invokeHelper } from '@ember/helper';
import {
  isDestroying,
  isDestroyed,
  destroy,
  registerDestructor,
  associateDestroyableChild
} from '@ember/destroyable';
import { waitForPromise } from '@ember/test-waiters';

import {
  setHelperManager,
  capabilities as helperCapabilities
} from '@ember/helper';

setEnviromentContext({
  getOwner,
  setOwner,
  createCache: createCache as never,
  getValue,
  invokeHelper,
  waitForPromise: (...args) => {
    // We create this function to wrap waitForPromise due to error when using
    // addon v2 format and auto-import v2. Originaly, waitForPromise would be undefined.
    return waitForPromise(...args);
  },
  setHelperManager,
  helperCapabilities,
  isDestroyed,
  isDestroying,
  destroy,
  registerDestructor,
  associateDestroyableChild
});

export function initialize(/* application */): void {
  // empty
}

export default {
  initialize
};
