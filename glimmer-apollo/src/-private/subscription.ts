import { resource, resourceFactory } from 'ember-resources';
import { equal } from '@wry/equality';

import { getClient } from './client.ts';
import {
  tracked,
  waitForPromise,
  setOwner,
  createCache,
  getValue,
} from '../environment.ts';
import { getFastboot, createPromise, settled } from './utils.ts';

import type {
  DocumentNode,
  ErrorLike,
  MaybeMasked,
  OperationVariables,
  SubscriptionOptions as ApolloSubscriptionOptions,
} from '@apollo/client';
import type { Subscription } from 'rxjs';

export type SubscriptionOptions<
  TData,
  TVariables extends OperationVariables,
> = Omit<ApolloSubscriptionOptions<TVariables>, 'query'> & {
  ssr?: boolean;
  clientId?: string;
  onData?: (data: MaybeMasked<TData> | undefined) => void;
  onError?: (error: ErrorLike) => void;
  onComplete?: () => void;
};

export type SubscriptionPositionalArgs<
  TData,
  TVariables extends OperationVariables = OperationVariables,
> = [DocumentNode, SubscriptionOptions<TData, TVariables>?];

export class SubscriptionState<
  TData,
  TVariables extends OperationVariables = OperationVariables,
> {
  @tracked loading = true;
  @tracked error?: ErrorLike;
  @tracked data: MaybeMasked<TData> | undefined;
  @tracked promise!: Promise<void>;

  #stopped = false;
  #completed = false;
  #subscription?: Subscription;
  #firstPromiseReject: (() => unknown) | undefined;
  #currentOptions?: SubscriptionOptions<TData, TVariables>;

  /** True when a server subscription is active (not completed or stopped). */
  get hasActiveSubscription(): boolean {
    return !this.#stopped && !this.#completed && !!this.#subscription;
  }

  /** @internal – do not call directly; used by the resource factory. */
  _start(
    query: DocumentNode,
    options?: SubscriptionOptions<TData, TVariables>,
  ): void {
    this.#stopped = false;
    this.#completed = false;
    this.#currentOptions = options;
    const client = getClient(this, options?.clientId);

    this.loading = true;
    const fastboot = getFastboot(this);

    if (fastboot && fastboot.isFastBoot && options && options.ssr === false) {
      return;
    }

    let [promise, firstResolve, firstReject] = createPromise(); // eslint-disable-line prefer-const
    this.#firstPromiseReject = firstReject;
    this.promise = promise;
    const observable = client.subscribe<TData, TVariables>({
      query,
      ...options,
    } as ApolloSubscriptionOptions<TVariables, TData>);

    this.#subscription = observable.subscribe({
      next: (result) => {
        if (this.#stopped) {
          return;
        }
        this.#onNextResult(result);
        if (firstResolve) {
          firstResolve();
          firstResolve = undefined;
          this.#firstPromiseReject = undefined;
        }
      },
      error: (error: unknown) => {
        if (this.#stopped) {
          return;
        }
        this.#onError(error);
        if (firstReject) {
          firstReject();
          firstReject = undefined;
          this.#firstPromiseReject = undefined;
        }
      },
      complete: () => {
        if (this.#stopped) {
          return;
        }
        this.#onComplete();
      },
    });

    waitForPromise(promise).catch(() => {
      // We catch by default as the promise is only meant to be used
      // as an indicator if the query is being initially fetched.
    });

    if (fastboot && fastboot.isFastBoot && options && options.ssr !== false) {
      fastboot.deferRendering(promise);
    }
  }

  /** @internal – do not call directly; used by the resource factory. */
  _stop(): void {
    this.#stopped = true;
    if (this.#subscription) {
      this.#subscription.unsubscribe();
    }
    if (typeof this.#firstPromiseReject === 'function') {
      this.#firstPromiseReject();
      this.#firstPromiseReject = undefined;
    }
  }

  // Arrow property so `this` is preserved when accessed through the Proxy.
  settled = (): Promise<void> => settled(this.promise);

  #onNextResult(result: {
    data?: MaybeMasked<TData>;
    error?: ErrorLike;
  }): void {
    if (result.error) {
      this.#onError(result.error);
      return;
    }

    this.loading = false;
    this.error = undefined;

    const { data } = result;
    if (data == null) {
      this.data = undefined;
    } else {
      this.data = data;
    }

    const { onData } = this.#currentOptions || {};
    if (onData) {
      onData(this.data);
    }
  }

  #onError(error: unknown): void {
    this.loading = false;
    this.data = undefined;
    this.error = error instanceof Error ? error : new Error(String(error));

    const { onError } = this.#currentOptions || {};
    if (onError) {
      onError(this.error);
    }
  }

  #onComplete(): void {
    this.loading = false;

    const { onComplete } = this.#currentOptions || {};
    if (onComplete) {
      onComplete();
    }

    this.#completed = true;
    if (this.#subscription) {
      this.#subscription.unsubscribe();
      this.#subscription = undefined;
    }
  }
}

export type { SubscriptionState as SubscriptionResource };

/**
 * Create a subscription resource. Can be used with ember-resources' @use decorator
 * or in templates via resourceFactory.
 */
export function subscriptionResource<
  TData = unknown,
  TVariables extends OperationVariables = OperationVariables,
>(thunk: () => SubscriptionPositionalArgs<TData, TVariables>) {
  return resource(({ on, owner }) => {
    let previousArgs: SubscriptionPositionalArgs<TData, TVariables> | undefined;
    let finalized = false;
    const state = new SubscriptionState<TData, TVariables>();
    setOwner(state, owner);

    const updateCache = createCache(() => {
      if (finalized) return;
      const positionalArgs = thunk();
      if (!equal(previousArgs, positionalArgs)) {
        if (previousArgs) state._stop();
        previousArgs = positionalArgs;
        const [query, options] = positionalArgs;
        state._start(query, options);
      }
    });

    getValue(updateCache);

    on.cleanup(() => {
      finalized = true;
      state._stop();
    });

    return new Proxy(state, {
      get(target, key): unknown {
        getValue(updateCache);
        return Reflect.get(target, key, target);
      },
      ownKeys(target): (string | symbol)[] {
        return Reflect.ownKeys(target);
      },
      getOwnPropertyDescriptor(target, key): PropertyDescriptor | undefined {
        return Reflect.getOwnPropertyDescriptor(target, key);
      },
    });
  });
}
resourceFactory(subscriptionResource);

/**
 * Create a curried subscription resource factory. Call with a document to get a
 * reusable resource that accepts options (or a thunk returning options).
 *
 * ```ts
 * const onMessage = createSubscriptionResource<OnMessageAddedSubscription, ...>(SUBSCRIPTION);
 *
 * // In a class with @use:
 * @use sub = onMessage(() => ({ variables: { channel: 'general' } }));
 * ```
 */
export function createSubscriptionResource<
  TData = unknown,
  TVariables extends OperationVariables = OperationVariables,
>(document: DocumentNode) {
  function inner(
    thunkOrOptions?:
      | (() => SubscriptionOptions<TData, TVariables> | undefined)
      | SubscriptionOptions<TData, TVariables>,
  ) {
    const optionsThunk =
      typeof thunkOrOptions === 'function'
        ? thunkOrOptions
        : () => thunkOrOptions;
    return subscriptionResource<TData, TVariables>(() => [
      document,
      optionsThunk(),
    ]);
  }
  resourceFactory(inner);
  return inner;
}
