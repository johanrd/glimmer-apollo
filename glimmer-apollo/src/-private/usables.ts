import { use } from 'ember-resources';
import { queryResource } from './query.ts';
import { mutationResource } from './mutation.ts';
import { subscriptionResource } from './subscription.ts';

import type { QueryPositionalArgs, QueryResource } from './query.ts';
import type { MutationPositionalArgs, MutationResource } from './mutation.ts';
import type {
  SubscriptionPositionalArgs,
  SubscriptionResource,
} from './subscription.ts';
import type { OperationVariables } from '@apollo/client';

export function useQuery<
  TData = unknown,
  TVariables extends OperationVariables = OperationVariables,
>(
  context: object,
  args: () => QueryPositionalArgs<TData, TVariables>,
): QueryResource<TData, TVariables> {
  return use(context, queryResource<TData, TVariables>(args)).current;
}

export function useMutation<
  TData = unknown,
  TVariables extends OperationVariables = OperationVariables,
>(
  context: object,
  args: () => MutationPositionalArgs<TData, TVariables>,
): MutationResource<TData, TVariables> {
  return use(context, mutationResource<TData, TVariables>(args)).current;
}

export function useSubscription<
  TData = unknown,
  TVariables extends OperationVariables = OperationVariables,
>(
  context: object,
  args: () => SubscriptionPositionalArgs<TData, TVariables>,
): SubscriptionResource<TData, TVariables> {
  return use(context, subscriptionResource<TData, TVariables>(args)).current;
}
