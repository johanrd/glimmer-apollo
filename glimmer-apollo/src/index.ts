export {
  getClient,
  setClient,
  clearClient,
  clearClients,
} from './-private/client.ts';
export { gql } from '@apollo/client';

// Resource factories (primary API — use with @use decorator or in templates)
export { queryResource, createQueryResource } from './-private/query.ts';
export {
  mutationResource,
  createMutationResource,
} from './-private/mutation.ts';
export {
  subscriptionResource,
  createSubscriptionResource,
} from './-private/subscription.ts';

// Convenience wrappers (for class-body usage without @use)
export { useQuery, useMutation, useSubscription } from './-private/usables.ts';

// Types
export type {
  QueryOptions,
  QueryResource,
  QueryPositionalArgs,
} from './-private/query.ts';
export type {
  MutationOptions,
  MutationResource,
  MutationPositionalArgs,
} from './-private/mutation.ts';
export type {
  SubscriptionOptions,
  SubscriptionResource,
  SubscriptionPositionalArgs,
} from './-private/subscription.ts';
