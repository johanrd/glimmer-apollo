import { resource, resourceFactory } from 'ember-resources';

import { tracked, waitForPromise, setOwner } from '../environment.ts';
import { getClient } from './client.ts';
import { settled } from './utils.ts';

import type {
  DocumentNode,
  ErrorLike,
  MutationOptions as ApolloMutationOptions,
  MutateResult,
  OperationVariables,
  MaybeMasked,
} from '@apollo/client';

type Maybe<T> = T | undefined | null;

export type MutationOptions<
  TData,
  TVariables extends OperationVariables,
> = Omit<ApolloMutationOptions<TData, TVariables>, 'mutation'> & {
  clientId?: string;
  onComplete?: (data: Maybe<MaybeMasked<TData>>) => void;
  onError?: (error: ErrorLike) => void;
};

export type MutationPositionalArgs<
  TData,
  TVariables extends OperationVariables = OperationVariables,
> = [DocumentNode, MutationOptions<TData, TVariables>?];

// Unlike QueryState/SubscriptionState (which are driven reactively by the
// resource factory and receive args via their START method), MutationState
// needs the thunk in its constructor because `mutate()` is imperative —
// it must read the current args each time the user calls it.
export class MutationState<
  TData,
  TVariables extends OperationVariables = OperationVariables,
> {
  @tracked loading = false;
  @tracked called = false;
  @tracked error?: ErrorLike;
  @tracked data: Maybe<MaybeMasked<TData>>;
  @tracked promise!: Promise<Maybe<MaybeMasked<TData>>>;

  #stopped = false;
  #getArgs: () => MutationPositionalArgs<TData, TVariables>;

  constructor(getArgs: () => MutationPositionalArgs<TData, TVariables>) {
    this.#getArgs = getArgs;
  }

  /** @internal – do not call directly; used by the resource factory. */
  _stop(): void {
    this.#stopped = true;
  }

  // Arrow property so `this` is preserved when accessed through the Proxy.
  mutate = async (
    variables?: TVariables,
    overrideOptions: Omit<
      MutationOptions<TData, TVariables>,
      'variables' | 'mutation'
    > = {} as Omit<
      MutationOptions<TData, TVariables>,
      'variables' | 'mutation'
    >,
  ): Promise<Maybe<MaybeMasked<TData>>> => {
    this.loading = true;
    const [mutation, originalOptions] = this.#getArgs();
    const options = { ...originalOptions, ...overrideOptions };
    const client = getClient(this, options.clientId);

    // Capture callbacks now so we use the ones in effect at mutate() time,
    // not whatever the thunk returns when the async operation completes.
    const { onComplete, onError } = options;

    if (!variables) {
      variables = originalOptions?.variables;
    } else if (variables && originalOptions?.variables) {
      variables = {
        ...originalOptions.variables,
        ...variables,
      };
    }

    this.promise = waitForPromise(
      client.mutate<TData, TVariables>({
        mutation,
        ...options,
        variables,
      } as ApolloMutationOptions<TData, TVariables>),
    )
      .then((result) => {
        this.#onComplete(result, onComplete, onError);
        return this.data;
      })
      .catch((error: ErrorLike) => {
        this.#onError(error, onError);
        return this.data;
      });

    return this.promise;
  };

  // Arrow property so `this` is preserved when accessed through the Proxy.
  settled = (): Promise<void> => settled(this.promise);

  #onComplete(
    result: MutateResult<MaybeMasked<TData>>,
    onComplete?: (data: Maybe<MaybeMasked<TData>>) => void,
    onError?: (error: ErrorLike) => void,
  ): void {
    this.data = result.data;
    this.error = result.error;

    this.#handleOnCompleteOrOnError(onComplete, onError);
  }

  #onError(error: ErrorLike, onError?: (error: ErrorLike) => void): void {
    this.error = error;
    this.data = undefined;

    this.#handleOnCompleteOrOnError(undefined, onError);
  }

  #handleOnCompleteOrOnError(
    onComplete?: (data: Maybe<MaybeMasked<TData>>) => void,
    onError?: (error: ErrorLike) => void,
  ): void {
    this.loading = false;
    this.called = true;

    if (this.#stopped) {
      return;
    }

    const { data, error } = this;

    if (onComplete && !error) {
      onComplete(data);
    } else if (onError && error) {
      onError(error);
    }
  }
}

export type { MutationState as MutationResource };

/**
 * Create a mutation resource. Can be used with ember-resources' @use decorator
 * or in templates via resourceFactory.
 */
export function mutationResource<
  TData = unknown,
  TVariables extends OperationVariables = OperationVariables,
>(thunk: () => MutationPositionalArgs<TData, TVariables>) {
  return resource(({ on, owner }) => {
    const state = new MutationState<TData, TVariables>(thunk);
    setOwner(state, owner);

    on.cleanup(() => state._stop());

    return state;
  });
}
resourceFactory(mutationResource);

/**
 * Create a curried mutation resource factory. Call with a document to get a
 * reusable resource that accepts options (or a thunk returning options).
 *
 * ```ts
 * const login = createMutationResource<LoginMutation, LoginMutationVariables>(LOGIN);
 *
 * // In a class with @use:
 * @use mutation = login(() => ({ variables: { username: 'john' } }));
 * ```
 */
export function createMutationResource<
  TData = unknown,
  TVariables extends OperationVariables = OperationVariables,
>(document: DocumentNode) {
  function inner(
    thunkOrOptions?:
      | (() => MutationOptions<TData, TVariables> | undefined)
      | MutationOptions<TData, TVariables>,
  ) {
    const optionsThunk =
      typeof thunkOrOptions === 'function'
        ? thunkOrOptions
        : () => thunkOrOptions;
    return mutationResource<TData, TVariables>(() => [
      document,
      optionsThunk(),
    ]);
  }
  resourceFactory(inner);
  return inner;
}
