import { NetworkStatus } from '@apollo/client';
import { equal } from '@wry/equality';
import { resource, resourceFactory } from 'ember-resources';

import {
  tracked,
  waitForPromise,
  setOwner,
  createCache,
  getValue,
} from '../environment.ts';
import { getClient } from './client.ts';
import ObservableQueryState from './observable.ts';
import { createPromise, getFastboot, settled } from './utils.ts';

import type {
  ApolloClient,
  DocumentNode,
  ErrorLike,
  MaybeMasked,
  OperationVariables,
  ObservableQuery,
} from '@apollo/client';
import type { Subscription } from 'rxjs';

export type QueryOptions<TData, TVariables extends OperationVariables> = Omit<
  ApolloClient.WatchQueryOptions<TData, TVariables>,
  'query'
> & {
  skip?: boolean;
  ssr?: boolean;
  clientId?: string;
  onComplete?: (data: MaybeMasked<TData> | undefined) => void;
  onError?: (error: ErrorLike) => void;
};

export type QueryPositionalArgs<
  TData,
  TVariables extends OperationVariables = OperationVariables,
> = [DocumentNode, QueryOptions<TData, TVariables>?];

export class QueryState<
  TData,
  TVariables extends OperationVariables = OperationVariables,
> extends ObservableQueryState<TData, TVariables> {
  @tracked loading = false;
  @tracked error?: ErrorLike;
  @tracked data: MaybeMasked<TData> | undefined;
  @tracked networkStatus: NetworkStatus = NetworkStatus.loading;
  @tracked promise!: Promise<void>;

  #stopped = false;
  #subscription?: Subscription;
  #firstPromiseReject: (() => unknown) | undefined;
  #currentOptions?: QueryOptions<TData, TVariables>;

  /** @internal – do not call directly; used by the resource factory. */
  _start(
    query: DocumentNode,
    options: QueryOptions<TData, TVariables> = {} as QueryOptions<
      TData,
      TVariables
    >,
  ): void {
    this.#stopped = false;
    this.#currentOptions = options;
    const client = getClient(this, options.clientId);

    const fastboot = getFastboot(this);

    if (
      fastboot &&
      fastboot.isFastBoot &&
      (options.ssr === false || options.skip === true)
    ) {
      return;
    }

    let [promise, firstResolve, firstReject] = createPromise(); // eslint-disable-line prefer-const
    this.#firstPromiseReject = firstReject;
    this.promise = promise;

    const isSkipped = options.skip === true;
    const fetchPolicy = isSkipped ? 'standby' : options.fetchPolicy;

    if (isSkipped || fetchPolicy === 'standby') {
      this.loading = false;
      if (firstResolve) {
        firstResolve();
        firstResolve = undefined;
      }
    } else {
      this.loading = true;
    }

    const observable = client.watchQuery<TData, TVariables>({
      query,
      ...options,
      fetchPolicy,
      // Apollo Client 4 defaults notifyOnNetworkStatusChange to true.
      // We preserve the AC3 default to avoid emitting intermediate loading
      // states during refetch/fetchMore, which would cause consumers relying
      // on synchronous loading checks to see unexpected flickers.
      notifyOnNetworkStatusChange: options.notifyOnNetworkStatusChange ?? false,
    } as ApolloClient.WatchQueryOptions<TData, TVariables>);

    this._setObservable(observable);

    // Apollo Client 4: errors arrive via result.error, not the error callback.
    this.#subscription = observable.subscribe((result) => {
      this.#onComplete(result);
      if (firstResolve && !result.loading) {
        firstResolve();
        firstResolve = undefined;
      }
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

  #onComplete(result: ObservableQuery.Result<MaybeMasked<TData>>): void {
    const { loading, error, data, networkStatus } = result;

    this.loading = loading;
    // AC4 types data as DeepPartial<TData> for returnPartialData; cast to stricter TData.
    this.data = data as MaybeMasked<TData> | undefined;
    this.networkStatus = networkStatus;
    this.error = error;

    if (error) {
      if (typeof this.#firstPromiseReject === 'function') {
        this.#firstPromiseReject();
        this.#firstPromiseReject = undefined;
      }
    }

    this.#handleOnCompleteOrOnError();
  }

  #handleOnCompleteOrOnError(): void {
    if (this.#stopped) {
      return;
    }

    const options = this.#currentOptions;
    const { onComplete, onError } = options || {};
    const { data, error } = this;

    if (onComplete && !error) {
      onComplete(data);
    } else if (onError && error) {
      onError(error);
    }
  }
}

export type { QueryState as QueryResource };

/**
 * Create a query resource. Can be used with ember-resources' @use decorator
 * or in templates via resourceFactory.
 */
export function queryResource<
  TData = unknown,
  TVariables extends OperationVariables = OperationVariables,
>(thunk: () => QueryPositionalArgs<TData, TVariables>) {
  return resource(({ on, owner }) => {
    let previousArgs: QueryPositionalArgs<TData, TVariables> | undefined;
    const state = new QueryState<TData, TVariables>();
    setOwner(state, owner);

    const updateCache = createCache(() => {
      const positionalArgs = thunk();
      if (!equal(previousArgs, positionalArgs)) {
        if (previousArgs) state._stop();
        previousArgs = positionalArgs;
        const [query, options] = positionalArgs;
        state._start(query, options);
      }
    });

    getValue(updateCache);

    on.cleanup(() => state._stop());

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
resourceFactory(queryResource);

/**
 * Create a curried query resource factory. Call with a document to get a
 * reusable resource that accepts options (or a thunk returning options).
 *
 * ```ts
 * const userInfo = createQueryResource<UserInfoQuery, UserInfoQueryVariables>(USER_INFO);
 *
 * // In a class with @use:
 * @use query = userInfo(() => ({ variables: { id: '1' } }));
 *
 * // In a template:
 * {{#let (userInfo (hash variables=(hash id="1"))) as |q|}} ... {{/let}}
 * ```
 */
export function createQueryResource<
  TData = unknown,
  TVariables extends OperationVariables = OperationVariables,
>(document: DocumentNode) {
  function inner(
    thunkOrOptions?:
      | (() => QueryOptions<TData, TVariables> | undefined)
      | QueryOptions<TData, TVariables>,
  ) {
    const optionsThunk =
      typeof thunkOrOptions === 'function'
        ? thunkOrOptions
        : () => thunkOrOptions;
    return queryResource<TData, TVariables>(() => [document, optionsThunk()]);
  }
  resourceFactory(inner);
  return inner;
}
