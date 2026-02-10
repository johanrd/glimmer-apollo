/* eslint-disable @typescript-eslint/no-non-null-assertion */
import { module, test } from 'qunit';
import { destroy } from '@ember/destroyable';
import { tracked } from '@glimmer/tracking';
import { setClient, getClient, gql } from 'glimmer-apollo';
import {
  queryResource,
  mutationResource,
  subscriptionResource,
  createQueryResource,
  createMutationResource,
  createSubscriptionResource,
} from 'glimmer-apollo/resource-factories';
import { use } from 'ember-resources';
import { setOwner } from '@ember/owner';
import type Owner from '@ember/owner';
import {
  ApolloClient,
  InMemoryCache,
  type ErrorLike,
  HttpLink,
} from '@apollo/client';
import {
  type UserInfoQuery,
  type UserInfoQueryVariables,
  type LoginMutation,
  type LoginMutationVariables,
  type OnMessageAddedSubscription,
  type OnMessageAddedSubscriptionVariables,
} from '../../app/mocks/handlers';
import sinon from 'sinon';
import { waitUntil } from '@ember/test-helpers';
import { MockSubscriptionLink } from 'test-app/tests/helpers/mock-subscription-link';

const USER_INFO = gql`
  query UserInfo($id: ID!) {
    user(id: $id) {
      id
      firstName
      lastName
    }
  }
`;

const LOGIN = gql`
  mutation Login($username: String!) {
    login(username: $username) {
      id
      firstName
      lastName
    }
  }
`;

const SUBSCRIPTION = gql`
  subscription OnMessageAdded($channel: String!) {
    messageAdded(channel: $channel) {
      id
      message
    }
  }
`;

module('queryResource', function (hooks) {
  let ctx = {};
  // Minimal owner stub — mirrors the pattern in existing tests (query-test.ts).
  // Only used via setOwner/getOwner for client lookup; no container/registry needed.
  const owner: Owner = {} as Owner;

  const link = new HttpLink({
    uri: '/graphql',
  });

  const client = new ApolloClient({
    cache: new InMemoryCache(),
    link,
  });

  hooks.beforeEach(() => {
    ctx = {};
    setOwner(ctx, owner);
    setClient(ctx, client);
  });

  hooks.afterEach(() => {
    destroy(ctx);
  });

  test('it fetches the query', async function (assert) {
    const query = use(
      ctx,
      queryResource<UserInfoQuery, UserInfoQueryVariables>(() => [
        USER_INFO,
        { variables: { id: '1' } },
      ])
    );

    assert.equal(query.current.loading, true);
    assert.equal(query.current.data, undefined);
    await query.current.settled();
    assert.equal(query.current.loading, false);
    assert.equal(query.current.error, undefined);
    assert.deepEqual(query.current.data, {
      user: {
        __typename: 'User',
        firstName: 'Cathaline',
        id: '1',
        lastName: 'McCoy',
      },
    });
  });

  test('it refetches the query when args change', async function (assert) {
    class Obj {
      @tracked id = '1';
    }
    const vars = new Obj();

    const query = use(
      ctx,
      queryResource<UserInfoQuery, UserInfoQueryVariables>(() => [
        USER_INFO,
        { variables: { id: vars.id } },
      ])
    );

    assert.equal(query.current.loading, true);
    assert.equal(query.current.data, undefined);
    await query.current.promise;
    assert.equal(query.current.loading, false);
    assert.equal(query.current.data?.user?.id, '1');

    vars.id = '2';
    assert.equal(query.current.loading, true);
    assert.equal(query.current.data?.user?.id, '1');
    await query.current.promise;
    assert.equal(query.current.loading, false);
    assert.equal(query.current.data?.user?.id, '2');
  });

  test('it returns error', async function (assert) {
    const query = use(
      ctx,
      queryResource<UserInfoQuery, UserInfoQueryVariables>(() => [
        USER_INFO,
        { variables: { id: 'NOT_FOUND' } },
      ])
    );

    assert.equal(query.current.loading, true);
    assert.equal(query.current.data, undefined);
    assert.equal(query.current.error, undefined);
    await query.current.settled();
    assert.equal(query.current.loading, false);
    assert.equal(query.current.error?.message, 'User not found');
    assert.equal(query.current.data, undefined);
  });

  test('it calls onComplete', async function (assert) {
    let onCompleteCalled: unknown;
    const query = use(
      ctx,
      queryResource<UserInfoQuery, UserInfoQueryVariables>(() => [
        USER_INFO,
        {
          variables: { id: '2' },
          onComplete: (data) => {
            onCompleteCalled = data;
          },
        },
      ])
    );

    assert.equal(query.current.data, undefined);
    await query.current.settled();

    const expectedData = {
      user: {
        __typename: 'User',
        firstName: 'Joth',
        id: '2',
        lastName: 'Maverick',
      },
    };

    assert.deepEqual(query.current.data as unknown, expectedData);
    assert.deepEqual(onCompleteCalled, expectedData);
  });

  test('it calls onError', async function (assert) {
    let onErrorCalled: ErrorLike;
    const query = use(
      ctx,
      queryResource<UserInfoQuery, UserInfoQueryVariables>(() => [
        USER_INFO,
        {
          variables: { id: 'NOT_FOUND' },
          onError: (error) => {
            onErrorCalled = error;
          },
        },
      ])
    );

    assert.equal(query.current.error, undefined);
    await query.current.settled();

    const expectedError = 'User not found';
    assert.equal(query.current.error?.message, expectedError);
    assert.equal(onErrorCalled!.message, expectedError);
  });

  test('it does not trigger query update if args references change but values are the same', async function (assert) {
    class Obj {
      @tracked id = '1';
    }
    const vars = new Obj();
    const sandbox = sinon.createSandbox();
    const client = getClient(ctx);

    const watchQuery = sandbox.spy(client, 'watchQuery');
    const query = use(
      ctx,
      queryResource<UserInfoQuery, UserInfoQueryVariables>(() => [
        USER_INFO,
        { variables: { id: vars.id } },
      ])
    );

    assert.equal(query.current.data, undefined);
    await query.current.settled();

    vars.id = '1';
    await query.current.settled();

    assert.ok(watchQuery.calledOnce);

    sandbox.restore();
  });

  test('it uses correct client based on clientId option', async function (assert) {
    class Obj {
      @tracked id = '1';
    }
    const vars = new Obj();
    const sandbox = sinon.createSandbox();
    const defaultClient = getClient(ctx);
    const customClient = new ApolloClient({
      cache: new InMemoryCache(),
      link: new HttpLink({
        uri: '/graphql',
      }),
    });
    setClient(ctx, customClient, 'custom-client');

    const defaultClientWatchQuery = sandbox.spy(defaultClient, 'watchQuery');
    const customClientWatchQuery = sandbox.spy(customClient, 'watchQuery');

    const query = use(
      ctx,
      queryResource<UserInfoQuery, UserInfoQueryVariables>(() => [
        USER_INFO,
        {
          variables: { id: vars.id },
          clientId: 'custom-client',
        },
      ])
    );

    await query.current.settled();
    assert.ok(
      customClientWatchQuery.calledOnce,
      'custom client should be used'
    );
    assert.ok(
      defaultClientWatchQuery.notCalled,
      'default client should not be used'
    );

    sandbox.restore();
  });
});

module('mutationResource', function (hooks) {
  let ctx = {};
  // Minimal owner stub — mirrors the pattern in existing tests (query-test.ts).
  // Only used via setOwner/getOwner for client lookup; no container/registry needed.
  const owner: Owner = {} as Owner;

  const client = new ApolloClient({
    cache: new InMemoryCache(),
    link: new HttpLink({
      uri: '/graphql',
    }),
  });

  hooks.beforeEach(() => {
    ctx = {};
    setOwner(ctx, owner);
    setClient(ctx, client);
  });

  hooks.afterEach(() => {
    destroy(ctx);
  });

  test('it executes the mutation', async function (assert) {
    const mutation = use(
      ctx,
      mutationResource<LoginMutation, LoginMutationVariables>(() => [
        LOGIN,
        { variables: { username: 'john' } },
      ])
    );

    assert.equal(mutation.current.loading, false);
    assert.equal(mutation.current.called, false);
    assert.equal(mutation.current.data, undefined);

    mutation.current.mutate();
    assert.equal(mutation.current.loading, true);
    await mutation.current.settled();

    assert.equal(mutation.current.loading, false);
    assert.equal(mutation.current.called, true);
    assert.equal(mutation.current.error, undefined);
    assert.deepEqual(mutation.current.data, {
      login: {
        __typename: 'User',
        firstName: 'Joth',
        id: '2',
        lastName: 'Maverick',
      },
    });
  });

  test('it uses variables passed into mutate', function (assert) {
    const sandbox = sinon.createSandbox();
    const client = getClient(ctx);

    const mutate = sandbox.spy(client, 'mutate');
    const mutation = use(
      ctx,
      mutationResource<LoginMutation, LoginMutationVariables>(() => [
        LOGIN,
        { variables: { username: 'non-existing' } },
      ])
    );

    mutation.current.mutate({ username: 'john' });

    assert.ok(mutate.called);
    assert.deepEqual(mutate.args[0]![0].variables, { username: 'john' });

    sandbox.restore();
  });

  test('it merges variables passed into mutate', function (assert) {
    const sandbox = sinon.createSandbox();
    const client = getClient(ctx);

    const mutate = sandbox.spy(client, 'mutate');
    const mutation = use(
      ctx,
      mutationResource<LoginMutation, LoginMutationVariables>(() => [
        LOGIN,
        { variables: { username: 'non-existing' } },
      ])
    );

    mutation.current.mutate({ username: 'john', isCool: true } as never);

    assert.ok(mutate.called);
    assert.deepEqual(mutate.args[0]![0].variables, {
      isCool: true,
      username: 'john',
    });

    sandbox.restore();
  });
});

module('subscriptionResource', function (hooks) {
  const results = ['Hey There!', 'Hello', 'How are you?'].map(
    (message, id) => ({
      result: {
        data: {
          messageAdded: { __typename: 'Message', id: id.toString(), message },
        },
      },
    })
  );

  let ctx = {};
  // Minimal owner stub — mirrors the pattern in existing tests (query-test.ts).
  // Only used via setOwner/getOwner for client lookup; no container/registry needed.
  const owner: Owner = {} as Owner;
  // Create a fresh link per test to avoid stale observer accumulation.
  // Unlike useSubscription (which uses invokeHelper for proper destroyable
  // cleanup), resource factories via ember-resources' use() may not fire
  // on.cleanup synchronously in non-rendering unit test contexts.
  let link: MockSubscriptionLink;

  hooks.beforeEach(() => {
    link = new MockSubscriptionLink();
    ctx = {};
    setOwner(ctx, owner);
    setClient(
      ctx,
      new ApolloClient({
        cache: new InMemoryCache(),
        link,
      })
    );
  });

  hooks.afterEach(() => {
    destroy(ctx);
  });

  test('it fetches the subscription', async function (assert) {
    link.simulateResult(results[0]!);

    const sub = use(
      ctx,
      subscriptionResource<
        OnMessageAddedSubscription,
        OnMessageAddedSubscriptionVariables
      >(() => [SUBSCRIPTION, { variables: { channel: '1' } }])
    );

    assert.equal(sub.current.loading, true);
    assert.equal(sub.current.data, undefined);
    await sub.current.settled();
    assert.equal(sub.current.loading, false);
    assert.equal(sub.current.error, undefined);
    assert.deepEqual(sub.current.data, {
      messageAdded: {
        __typename: 'Message',
        id: '0',
        message: 'Hey There!',
      },
    });

    link.simulateResult(results[1]!);

    await waitUntil(
      function () {
        return sub.current.data?.messageAdded?.id == '1';
      },
      { timeout: 200 }
    );

    assert.deepEqual(sub.current.data, {
      messageAdded: {
        __typename: 'Message',
        id: '1',
        message: 'Hello',
      },
    });
  });

  test('it re-subscribes when tracked args change', async function (assert) {
    link.simulateResult(results[0]!);

    class Obj {
      @tracked channel = '1';
    }
    const vars = new Obj();

    const sub = use(
      ctx,
      subscriptionResource<
        OnMessageAddedSubscription,
        OnMessageAddedSubscriptionVariables
      >(() => [SUBSCRIPTION, { variables: { channel: vars.channel } }])
    );

    assert.equal(sub.current.loading, true);
    assert.equal(sub.current.data, undefined);
    await sub.current.promise;
    assert.equal(sub.current.loading, false);
    assert.equal(sub.current.data?.messageAdded?.id, '0');

    // Change tracked arg — should trigger re-subscribe
    vars.channel = '2';
    assert.equal(sub.current.loading, true);
    assert.equal(sub.current.data?.messageAdded?.id, '0');

    link.simulateResult(results[1]!);

    await sub.current.promise;
    assert.equal(sub.current.loading, false);
    assert.equal(sub.current.data?.messageAdded?.id, '1');
  });

  // Note: destroy/cleanup test for subscriptionResource is in the
  // integration test suite where the rendering lifecycle properly
  // manages ember-resources cleanup via the destroyable tree.
});

// Curried resource factory tests

const userInfo = createQueryResource<UserInfoQuery, UserInfoQueryVariables>(
  USER_INFO
);

module('createQueryResource', function (hooks) {
  let ctx = {};
  const owner: Owner = {} as Owner;

  const link = new HttpLink({
    uri: '/graphql',
  });

  const client = new ApolloClient({
    cache: new InMemoryCache(),
    link,
  });

  hooks.beforeEach(() => {
    ctx = {};
    setOwner(ctx, owner);
    setClient(ctx, client);
  });

  hooks.afterEach(() => {
    destroy(ctx);
  });

  test('it fetches the query with thunk options', async function (assert) {
    const query = use(
      ctx,
      userInfo(() => ({ variables: { id: '1' } }))
    );

    assert.equal(query.current.loading, true);
    await query.current.settled();
    assert.equal(query.current.loading, false);
    assert.equal(query.current.error, undefined);
    assert.deepEqual(query.current.data, {
      user: {
        __typename: 'User',
        firstName: 'Cathaline',
        id: '1',
        lastName: 'McCoy',
      },
    });
  });

  test('it fetches the query with direct options', async function (assert) {
    const query = use(
      ctx,
      userInfo({ variables: { id: '2' } })
    );

    assert.equal(query.current.loading, true);
    await query.current.settled();
    assert.equal(query.current.loading, false);
    assert.deepEqual(query.current.data, {
      user: {
        __typename: 'User',
        firstName: 'Joth',
        id: '2',
        lastName: 'Maverick',
      },
    });
  });

  test('it re-fetches when tracked args change', async function (assert) {
    class Obj {
      @tracked id = '1';
    }
    const vars = new Obj();

    const query = use(
      ctx,
      userInfo(() => ({ variables: { id: vars.id } }))
    );

    assert.equal(query.current.loading, true);
    await query.current.promise;
    assert.equal(query.current.loading, false);
    assert.equal(query.current.data?.user?.id, '1');

    vars.id = '2';
    assert.equal(query.current.loading, true);
    await query.current.promise;
    assert.equal(query.current.loading, false);
    assert.equal(query.current.data?.user?.id, '2');
  });
});

module('createMutationResource', function (hooks) {
  let ctx = {};
  const owner: Owner = {} as Owner;

  const client = new ApolloClient({
    cache: new InMemoryCache(),
    link: new HttpLink({ uri: '/graphql' }),
  });

  const login = createMutationResource<LoginMutation, LoginMutationVariables>(
    LOGIN
  );

  hooks.beforeEach(() => {
    ctx = {};
    setOwner(ctx, owner);
    setClient(ctx, client);
  });

  hooks.afterEach(() => {
    destroy(ctx);
  });

  test('it executes the mutation with thunk options', async function (assert) {
    const mutation = use(
      ctx,
      login(() => ({ variables: { username: 'john' } }))
    );

    assert.equal(mutation.current.loading, false);
    assert.equal(mutation.current.called, false);

    mutation.current.mutate();
    assert.equal(mutation.current.loading, true);
    await mutation.current.settled();

    assert.equal(mutation.current.loading, false);
    assert.equal(mutation.current.called, true);
    assert.deepEqual(mutation.current.data, {
      login: {
        __typename: 'User',
        firstName: 'Joth',
        id: '2',
        lastName: 'Maverick',
      },
    });
  });
});

module('createSubscriptionResource', function (hooks) {
  let ctx = {};
  const owner: Owner = {} as Owner;
  let link: MockSubscriptionLink;

  const onMessageAdded = createSubscriptionResource<
    OnMessageAddedSubscription,
    OnMessageAddedSubscriptionVariables
  >(SUBSCRIPTION);

  hooks.beforeEach(() => {
    link = new MockSubscriptionLink();
    ctx = {};
    setOwner(ctx, owner);
    setClient(
      ctx,
      new ApolloClient({
        cache: new InMemoryCache(),
        link,
      })
    );
  });

  hooks.afterEach(() => {
    destroy(ctx);
  });

  test('it fetches the subscription with thunk options', async function (assert) {
    link.simulateResult({
      result: {
        data: {
          messageAdded: {
            __typename: 'Message',
            id: '0',
            message: 'Hey There!',
          },
        },
      },
    });

    const sub = use(
      ctx,
      onMessageAdded(() => ({ variables: { channel: '1' } }))
    );

    assert.equal(sub.current.loading, true);
    await sub.current.settled();
    assert.equal(sub.current.loading, false);
    assert.deepEqual(sub.current.data, {
      messageAdded: {
        __typename: 'Message',
        id: '0',
        message: 'Hey There!',
      },
    });
  });
});
