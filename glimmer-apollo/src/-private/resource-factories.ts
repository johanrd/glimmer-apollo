// Requires ember-resources >= 7.0 (optional peerDependency).
import { resource, resourceFactory } from 'ember-resources';
import { createCache, getValue, destroy } from '../environment.ts';
import {
  QueryResource,
  type QueryPositionalArgs,
  type QueryOptions,
} from './query.ts';
import {
  MutationResource,
  type MutationPositionalArgs,
  type MutationOptions,
} from './mutation.ts';
import {
  SubscriptionResource,
  type SubscriptionPositionalArgs,
  type SubscriptionOptions,
} from './subscription.ts';
import { Resource } from './resource.ts';
import type { DocumentNode, OperationVariables } from '@apollo/client';
import type { TemplateArgs } from './types.ts';
import type Owner from '@ember/owner';

/**
 * Shared helper that wraps any Resource subclass into an ember-resources
 * `resource()` function. Lifecycle introspection (update / teardown) is
 * derived from the prototype, mirroring ResourceManager.createHelper in
 * resource.ts (lines 87-90).
 */
function wrapResource<
  TInstance extends Resource<TemplateArgs<readonly unknown[]>>,
  TPositionalArgs extends readonly unknown[],
>(
  ResourceClass: new (
    owner: Owner,
    args: TemplateArgs<TPositionalArgs>,
  ) => TInstance,
  thunk: () => TPositionalArgs,
) {
  return resource(({ on, owner }) => {
    const args: TemplateArgs<TPositionalArgs> = {
      get positional() {
        return thunk();
      },
      // named is intentionally empty: all config is passed via positional
      // args as [DocumentNode, Options?], matching the Resource contract.
      named: {},
    };

    const instance = new ResourceClass(owner, args);

    // Introspect lifecycle methods from the prototype, mirroring
    // ResourceManager.createHelper in resource.ts (lines 87-90).
    // MutationResource has no update/teardown, so these are false for it.
    // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
    const proto: Resource<TemplateArgs<TPositionalArgs>> =
      ResourceClass.prototype;
    const hasUpdate = typeof proto.update === 'function';
    const hasTeardown = typeof proto.teardown === 'function';

    on.cleanup(() => {
      if (hasTeardown) instance.teardown!();
      destroy(instance);
    });

    let updateCache: ReturnType<typeof createCache> | undefined;
    if (hasUpdate) {
      // For resources with update (Query, Subscription): setup() and
      // update() are called inside a createCache so their tracked reads
      // (thunk → tracked args) are entangled with this inner cache ONLY.
      //
      // IMPORTANT: We do NOT call getValue(updateCache) eagerly here.
      // Calling it in the resource() callback would leak tracked reads
      // into the outer ember-resources tracking frame, causing the
      // entire resource to be re-created when args change (instead of
      // just calling update()). Setup happens lazily on first property
      // access through the Proxy — consistent with how useResource
      // lazily invokes the helper on first .value access.
      let isSetUp = false;
      updateCache = createCache(() => {
        if (!isSetUp) {
          instance.setup();
          isSetUp = true;
        } else {
          instance.update!();
        }
        return instance;
      });
    } else {
      // Resources without update (e.g. MutationResource): call setup()
      // directly. ResourceManager.createHelper always calls setupInstance
      // for every resource type, so we do the same for forward compat.
      instance.setup();
    }

    return new Proxy(instance, {
      get(target, key) {
        // Skip Symbols to avoid spurious cache evaluations.
        if (updateCache && typeof key === 'string') {
          getValue(updateCache);
        }
        // .bind(target) is required: private fields (#field) have a brand check
        // that fails if `this` is the proxy instead of the real instance.
        const value = Reflect.get(target, key, target);
        // eslint-disable-next-line @typescript-eslint/no-unsafe-return
        return typeof value === 'function' ? value.bind(target) : value;
      },
      // Keep ownKeys/getOwnPropertyDescriptor for consistency
      // with useResource in use-resource.ts (lines 68-73).
      ownKeys(target) {
        if (updateCache) {
          getValue(updateCache);
        }
        return Reflect.ownKeys(target);
      },
      getOwnPropertyDescriptor(target, key) {
        if (updateCache) {
          getValue(updateCache);
        }
        return Reflect.getOwnPropertyDescriptor(target, key);
      },
    });
  });
}

// queryResource accepts either:
//   - A thunk: queryResource(() => [QUERY, options])    — for @use decorator
//   - Direct args: queryResource(QUERY, options)        — for template invocation
export function queryResource<
  TData = unknown,
  TVariables extends OperationVariables = OperationVariables,
>(
  thunkOrDoc: (() => QueryPositionalArgs<TData, TVariables>) | DocumentNode,
  options?: QueryOptions<TData, TVariables>,
) {
  const thunk: () => QueryPositionalArgs<TData, TVariables> =
    typeof thunkOrDoc === 'function'
      ? thunkOrDoc
      : () => [thunkOrDoc, options] as QueryPositionalArgs<TData, TVariables>;

  return wrapResource(QueryResource, thunk);
}
resourceFactory(queryResource);

// mutationResource accepts either:
//   - A thunk: mutationResource(() => [MUTATION, options])    — for @use decorator
//   - Direct args: mutationResource(MUTATION, options)        — for template invocation
export function mutationResource<
  TData = unknown,
  TVariables extends OperationVariables = OperationVariables,
>(
  thunkOrDoc: (() => MutationPositionalArgs<TData, TVariables>) | DocumentNode,
  options?: MutationOptions<TData, TVariables>,
) {
  const thunk: () => MutationPositionalArgs<TData, TVariables> =
    typeof thunkOrDoc === 'function'
      ? thunkOrDoc
      : () =>
          [thunkOrDoc, options] as MutationPositionalArgs<TData, TVariables>;

  return wrapResource(MutationResource, thunk);
}
resourceFactory(mutationResource);

// subscriptionResource accepts either:
//   - A thunk: subscriptionResource(() => [SUB, options])    — for @use decorator
//   - Direct args: subscriptionResource(SUB, options)        — for template invocation
export function subscriptionResource<
  TData = unknown,
  TVariables extends OperationVariables = OperationVariables,
>(
  thunkOrDoc:
    | (() => SubscriptionPositionalArgs<TData, TVariables>)
    | DocumentNode,
  options?: SubscriptionOptions<TData, TVariables>,
) {
  const thunk: () => SubscriptionPositionalArgs<TData, TVariables> =
    typeof thunkOrDoc === 'function'
      ? thunkOrDoc
      : () =>
          [thunkOrDoc, options] as SubscriptionPositionalArgs<
            TData,
            TVariables
          >;

  return wrapResource(SubscriptionResource, thunk);
}
resourceFactory(subscriptionResource);
