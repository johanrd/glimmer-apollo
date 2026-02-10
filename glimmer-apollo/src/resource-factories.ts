// This module requires ember-resources >= 7.0 to be installed.
// It will fail at runtime if ember-resources is not present.
// The main 'glimmer-apollo' import is unaffected.
export {
  queryResource,
  mutationResource,
  subscriptionResource,
  createQueryResource,
  createMutationResource,
  createSubscriptionResource,
} from './-private/resource-factories.ts';
