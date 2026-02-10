import { module, test } from 'qunit';
import { setupRenderingTest } from 'ember-qunit';
import { click, render, settled, waitUntil } from '@ember/test-helpers';
import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';
import { on } from '@ember/modifier';
import { use } from 'ember-resources';
import { setClient, gql } from 'glimmer-apollo';
import {
  queryResource,
  mutationResource,
  subscriptionResource,
  createQueryResource,
  createMutationResource,
  createSubscriptionResource,
} from 'glimmer-apollo';
import { ApolloClient, InMemoryCache, HttpLink } from '@apollo/client';
import { MockSubscriptionLink } from 'test-app/tests/helpers/mock-subscription-link';
import { hash } from '@ember/helper';
import type {
  UserInfoQuery,
  UserInfoQueryVariables,
  LoginMutation,
  LoginMutationVariables,
  OnMessageAddedSubscription,
  OnMessageAddedSubscriptionVariables,
} from 'test-app/mocks/handlers';

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

module('Integration | Components | Resource Factories', function (hooks) {
  setupRenderingTest(hooks);

  hooks.beforeEach(function () {
    const client = new ApolloClient({
      cache: new InMemoryCache(),
      link: new HttpLink({ uri: '/graphql' }),
    });
    setClient(this.owner, client);
  });

  test('queryResource renders loading then data in template', async function (assert) {
    class TestComponent extends Component {
      @use query = queryResource<UserInfoQuery, UserInfoQueryVariables>(() => [
        USER_INFO,
        { variables: { id: '1' } },
      ]);

      <template>
        <div data-test-id="query-test">
          {{#if this.query.loading}}
            <span data-test-id="loading">Loading...</span>
          {{else if this.query.error}}
            <span data-test-id="error">{{this.query.error.message}}</span>
          {{else}}
            <span data-test-id="data">{{this.query.data.user.firstName}}</span>
          {{/if}}
        </div>
      </template>
    }

    await render(<template><TestComponent /></template>);

    assert
      .dom('[data-test-id="data"]')
      .hasText('Cathaline', 'renders fetched data');
  });

  test('queryResource re-renders when tracked args change', async function (assert) {
    class State {
      @tracked id = '1';
    }
    const state = new State();

    class TestComponent extends Component {
      @use query = queryResource<UserInfoQuery, UserInfoQueryVariables>(() => [
        USER_INFO,
        { variables: { id: state.id } },
      ]);

      <template>
        <div data-test-id="reactive-test">
          {{#if this.query.loading}}
            <span data-test-id="loading">Loading...</span>
          {{else}}
            <span data-test-id="name">{{this.query.data.user.firstName}}</span>
            <span data-test-id="user-id">{{this.query.data.user.id}}</span>
          {{/if}}
        </div>
      </template>
    }

    await render(<template><TestComponent /></template>);

    assert.dom('[data-test-id="name"]').hasText('Cathaline', 'renders user 1');

    // Change tracked arg
    state.id = '2';

    await settled();

    assert
      .dom('[data-test-id="name"]')
      .hasText('Joth', 'renders user 2 after arg change');
  });

  test('queryResource renders error state in template', async function (assert) {
    class TestComponent extends Component {
      @use query = queryResource<UserInfoQuery, UserInfoQueryVariables>(() => [
        USER_INFO,
        { variables: { id: 'NOT_FOUND' } },
      ]);

      <template>
        <div data-test-id="error-test">
          {{#if this.query.loading}}
            <span data-test-id="loading">Loading...</span>
          {{else if this.query.error}}
            <span data-test-id="error">{{this.query.error.message}}</span>
          {{else}}
            <span data-test-id="data">Has data</span>
          {{/if}}
        </div>
      </template>
    }

    await render(<template><TestComponent /></template>);

    assert
      .dom('[data-test-id="error"]')
      .hasText('User not found', 'renders error message');
  });

  test('mutationResource works in template with click handler', async function (assert) {
    class TestComponent extends Component {
      @use login = mutationResource<LoginMutation, LoginMutationVariables>(
        () => [LOGIN, { variables: { username: 'john' } }]
      );

      doLogin = (): void => {
        this.login.mutate();
      };

      <template>
        <div data-test-id="mutation-test">
          <button
            type="button"
            data-test-id="mutate-btn"
            {{on "click" this.doLogin}}
          >
            Login
          </button>

          {{#if this.login.loading}}
            <span data-test-id="loading">Loading...</span>
          {{else if this.login.called}}
            <span
              data-test-id="result"
            >{{this.login.data.login.firstName}}</span>
          {{/if}}
        </div>
      </template>
    }

    await render(<template><TestComponent /></template>);

    assert
      .dom('[data-test-id="result"]')
      .doesNotExist('no result before mutate');

    await click('[data-test-id="mutate-btn"]');

    assert
      .dom('[data-test-id="result"]')
      .hasText('Joth', 'renders mutation result');
  });

  test('mutationResource prevents callbacks after component teardown', async function (assert) {
    let onCompleteCalled = false;
    let onErrorCalled = false;

    class State {
      @tracked show = true;
    }
    const state = new State();

    class TestComponent extends Component {
      @use login = mutationResource<LoginMutation, LoginMutationVariables>(
        () => [
          LOGIN,
          {
            variables: { username: 'john' },
            onComplete: () => {
              onCompleteCalled = true;
            },
            onError: () => {
              onErrorCalled = true;
            },
          },
        ]
      );

      doLogin = (): void => {
        this.login.mutate();
      };

      <template>
        <div data-test-id="teardown-mutation">
          <button
            type="button"
            data-test-id="mutate-teardown-btn"
            {{on "click" this.doLogin}}
          >
            Login
          </button>
        </div>
      </template>
    }

    await render(
      <template>
        {{#if state.show}}
          <TestComponent />
        {{/if}}
      </template>
    );

    // Fire the mutation via a native DOM click (not the test-helper click,
    // which calls settled() internally and waits for the mutation to finish).
    // This starts the HTTP request synchronously, then we immediately tear
    // down the component so _stop() is called before the response arrives.
    const btn = document.querySelector(
      '[data-test-id="mutate-teardown-btn"]'
    ) as HTMLElement;
    btn.click();
    state.show = false;
    await settled();

    assert
      .dom('[data-test-id="teardown-mutation"]')
      .doesNotExist('component removed');
    assert.false(onCompleteCalled, 'onComplete should not fire after teardown');
    assert.false(onErrorCalled, 'onError should not fire after teardown');
  });
});

module(
  'Integration | Components | Template-Only Resource Factories',
  function (hooks) {
    setupRenderingTest(hooks);

    hooks.beforeEach(function () {
      const client = new ApolloClient({
        cache: new InMemoryCache(),
        link: new HttpLink({ uri: '/graphql' }),
      });
      setClient(this.owner, client);
    });

    test('createQueryResource in template-only with direct args', async function (assert) {
      const options = { variables: { id: '1' } };

      await render(
        <template>
          {{#let (userInfo options) as |q|}}
            <div data-test-id="tpl-query">
              {{#if q.loading}}
                <span data-test-id="loading">Loading...</span>
              {{else if q.error}}
                <span data-test-id="error">{{q.error.message}}</span>
              {{else}}
                <span data-test-id="data">{{q.data.user.firstName}}</span>
              {{/if}}
            </div>
          {{/let}}
        </template>
      );

      assert
        .dom('[data-test-id="data"]')
        .hasText(
          'Cathaline',
          'renders fetched data via template-only invocation'
        );
    });

    test('createQueryResource in template-only with (hash) helper for variables', async function (assert) {
      await render(
        <template>
          {{#let (userInfo (hash variables=(hash id="2"))) as |q|}}
            <div data-test-id="tpl-hash-query">
              {{#if q.loading}}
                <span data-test-id="loading">Loading...</span>
              {{else if q.error}}
                <span data-test-id="error">{{q.error.message}}</span>
              {{else}}
                <span data-test-id="data">{{q.data.user.firstName}}</span>
              {{/if}}
            </div>
          {{/let}}
        </template>
      );

      assert
        .dom('[data-test-id="data"]')
        .hasText(
          'Joth',
          'renders user 2 via template-only invocation with hash helper'
        );
    });
  }
);

module('Integration | Components | subscriptionResource', function (hooks) {
  setupRenderingTest(hooks);

  let link: MockSubscriptionLink;

  hooks.beforeEach(function () {
    link = new MockSubscriptionLink();
    const client = new ApolloClient({
      cache: new InMemoryCache(),
      link,
    });
    setClient(this.owner, client);
  });

  test('subscriptionResource cleans up on component teardown', async function (assert) {
    let unsubscribed = false;
    link.onUnsubscribe(() => {
      unsubscribed = true;
    });

    class State {
      @tracked show = true;
    }
    const state = new State();

    class TestComponent extends Component {
      @use sub = subscriptionResource<
        OnMessageAddedSubscription,
        OnMessageAddedSubscriptionVariables
      >(() => [SUBSCRIPTION, { variables: { channel: 'teardown' } }]);

      <template>
        <div data-test-id="teardown-test">
          {{#if this.sub.loading}}
            <span data-test-id="loading">Loading...</span>
          {{else}}
            <span
              data-test-id="message"
            >{{this.sub.data.messageAdded.message}}</span>
          {{/if}}
        </div>
      </template>
    }

    link.simulateResult({
      result: {
        data: {
          messageAdded: { __typename: 'Message', id: '0', message: 'Hello' },
        },
      },
    });

    await render(
      <template>
        {{#if state.show}}
          <TestComponent />
        {{/if}}
      </template>
    );

    assert
      .dom('[data-test-id="message"]')
      .hasText('Hello', 'subscription data rendered');
    assert.false(unsubscribed, 'not yet unsubscribed');

    // Tear down the component by hiding it
    state.show = false;
    await settled();

    assert
      .dom('[data-test-id="teardown-test"]')
      .doesNotExist('component removed');
    assert.true(unsubscribed, 'subscription was unsubscribed on teardown');
  });

  test('subscriptionResource re-subscribes when tracked args change', async function (assert) {
    const channels: string[] = [];
    link.onSetup(() => {
      channels.push(link.operation?.variables['channel'] as string);
    });

    class State {
      @tracked channel = 'general';
    }
    const state = new State();

    class TestComponent extends Component {
      @use sub = subscriptionResource<
        OnMessageAddedSubscription,
        OnMessageAddedSubscriptionVariables
      >(() => [SUBSCRIPTION, { variables: { channel: state.channel } }]);

      <template>
        <div data-test-id="reactive-sub">
          {{#if this.sub.loading}}
            <span data-test-id="loading">Loading...</span>
          {{else}}
            <span
              data-test-id="message"
            >{{this.sub.data.messageAdded.message}}</span>
          {{/if}}
        </div>
      </template>
    }

    link.simulateResult({
      result: {
        data: {
          messageAdded: {
            __typename: 'Message',
            id: '0',
            message: 'Hello General',
          },
        },
      },
    });

    await render(<template><TestComponent /></template>);

    assert
      .dom('[data-test-id="message"]')
      .hasText('Hello General', 'renders first channel message');

    // Change tracked arg — should unsubscribe old and re-subscribe with new channel
    state.channel = 'random';

    // The new subscription needs a result to render
    link.simulateResult({
      result: {
        data: {
          messageAdded: {
            __typename: 'Message',
            id: '1',
            message: 'Hello Random',
          },
        },
      },
    });

    await waitUntil(
      () => {
        const el = document.querySelector('[data-test-id="message"]');
        return el?.textContent.trim() === 'Hello Random';
      },
      { timeout: 2000 }
    );

    assert
      .dom('[data-test-id="message"]')
      .hasText('Hello Random', 'renders new channel message after arg change');
    assert.true(
      channels.length >= 2,
      'subscription was re-created with new args'
    );
  });

  test('subscriptionResource renders subscription data in template', async function (assert) {
    class TestComponent extends Component {
      @use sub = subscriptionResource<
        OnMessageAddedSubscription,
        OnMessageAddedSubscriptionVariables
      >(() => [SUBSCRIPTION, { variables: { channel: 'general' } }]);

      <template>
        <div data-test-id="sub-test">
          {{#if this.sub.loading}}
            <span data-test-id="loading">Loading...</span>
          {{else if this.sub.error}}
            <span data-test-id="error">{{this.sub.error.message}}</span>
          {{else}}
            <span
              data-test-id="message"
            >{{this.sub.data.messageAdded.message}}</span>
          {{/if}}
        </div>
      </template>
    }

    // Queue first result before render
    link.simulateResult({
      result: {
        data: {
          messageAdded: {
            __typename: 'Message',
            id: '0',
            message: 'Hello World',
          },
        },
      },
    });

    await render(<template><TestComponent /></template>);

    assert
      .dom('[data-test-id="message"]')
      .hasText('Hello World', 'renders first subscription message');

    // Simulate a second message
    link.simulateResult({
      result: {
        data: {
          messageAdded: {
            __typename: 'Message',
            id: '1',
            message: 'Second Message',
          },
        },
      },
    });

    await waitUntil(
      () => {
        const el = document.querySelector('[data-test-id="message"]');
        return el?.textContent.trim() === 'Second Message';
      },
      { timeout: 2000 }
    );

    assert
      .dom('[data-test-id="message"]')
      .hasText('Second Message', 'renders updated subscription message');
  });
});

// Curried resource factory tests (createQueryResource / createMutationResource / createSubscriptionResource)

const userInfo = createQueryResource<UserInfoQuery, UserInfoQueryVariables>(
  USER_INFO
);
const loginMutation = createMutationResource<
  LoginMutation,
  LoginMutationVariables
>(LOGIN);

module(
  'Integration | Components | Curried Resource Factories',
  function (hooks) {
    setupRenderingTest(hooks);

    hooks.beforeEach(function () {
      const client = new ApolloClient({
        cache: new InMemoryCache(),
        link: new HttpLink({ uri: '/graphql' }),
      });
      setClient(this.owner, client);
    });

    test('createQueryResource with @use and thunk options', async function (assert) {
      class TestComponent extends Component {
        @use query = userInfo(() => ({ variables: { id: '1' } }));

        <template>
          <div data-test-id="curried-query">
            {{#if this.query.loading}}
              <span data-test-id="loading">Loading...</span>
            {{else if this.query.error}}
              <span data-test-id="error">{{this.query.error.message}}</span>
            {{else}}
              <span
                data-test-id="data"
              >{{this.query.data.user.firstName}}</span>
            {{/if}}
          </div>
        </template>
      }

      await render(<template><TestComponent /></template>);

      assert
        .dom('[data-test-id="data"]')
        .hasText('Cathaline', 'renders fetched data via curried factory');
    });

    test('createQueryResource re-renders when tracked args change', async function (assert) {
      class State {
        @tracked id = '1';
      }
      const state = new State();

      class TestComponent extends Component {
        @use query = userInfo(() => ({ variables: { id: state.id } }));

        <template>
          <div data-test-id="curried-reactive">
            {{#if this.query.loading}}
              <span data-test-id="loading">Loading...</span>
            {{else}}
              <span
                data-test-id="name"
              >{{this.query.data.user.firstName}}</span>
            {{/if}}
          </div>
        </template>
      }

      await render(<template><TestComponent /></template>);

      assert
        .dom('[data-test-id="name"]')
        .hasText('Cathaline', 'renders user 1');

      state.id = '2';
      await settled();

      assert
        .dom('[data-test-id="name"]')
        .hasText('Joth', 'renders user 2 after arg change');
    });

    test('createQueryResource in template-only with (hash) helper', async function (assert) {
      await render(
        <template>
          {{#let (userInfo (hash variables=(hash id="2"))) as |q|}}
            <div data-test-id="curried-tpl">
              {{#if q.loading}}
                <span data-test-id="loading">Loading...</span>
              {{else if q.error}}
                <span data-test-id="error">{{q.error.message}}</span>
              {{else}}
                <span data-test-id="data">{{q.data.user.firstName}}</span>
              {{/if}}
            </div>
          {{/let}}
        </template>
      );

      assert
        .dom('[data-test-id="data"]')
        .hasText('Joth', 'renders user 2 via curried factory in template');
    });

    test('createMutationResource with @use', async function (assert) {
      class TestComponent extends Component {
        @use login = loginMutation(() => ({ variables: { username: 'john' } }));

        doLogin = (): void => {
          this.login.mutate();
        };

        <template>
          <div data-test-id="curried-mutation">
            <button
              type="button"
              data-test-id="mutate-btn"
              {{on "click" this.doLogin}}
            >
              Login
            </button>

            {{#if this.login.loading}}
              <span data-test-id="loading">Loading...</span>
            {{else if this.login.called}}
              <span
                data-test-id="result"
              >{{this.login.data.login.firstName}}</span>
            {{/if}}
          </div>
        </template>
      }

      await render(<template><TestComponent /></template>);

      assert
        .dom('[data-test-id="result"]')
        .doesNotExist('no result before mutate');

      await click('[data-test-id="mutate-btn"]');

      assert
        .dom('[data-test-id="result"]')
        .hasText('Joth', 'renders mutation result via curried factory');
    });
  }
);

module(
  'Integration | Components | Curried subscriptionResource',
  function (hooks) {
    setupRenderingTest(hooks);

    let link: MockSubscriptionLink;

    hooks.beforeEach(function () {
      link = new MockSubscriptionLink();
      const client = new ApolloClient({
        cache: new InMemoryCache(),
        link,
      });
      setClient(this.owner, client);
    });

    test('createSubscriptionResource with @use', async function (assert) {
      const onMessageAdded = createSubscriptionResource<
        OnMessageAddedSubscription,
        OnMessageAddedSubscriptionVariables
      >(SUBSCRIPTION);

      class TestComponent extends Component {
        @use sub = onMessageAdded(() => ({
          variables: { channel: 'general' },
        }));

        <template>
          <div data-test-id="curried-sub">
            {{#if this.sub.loading}}
              <span data-test-id="loading">Loading...</span>
            {{else}}
              <span
                data-test-id="message"
              >{{this.sub.data.messageAdded.message}}</span>
            {{/if}}
          </div>
        </template>
      }

      link.simulateResult({
        result: {
          data: {
            messageAdded: {
              __typename: 'Message',
              id: '0',
              message: 'Hello Curried',
            },
          },
        },
      });

      await render(<template><TestComponent /></template>);

      assert
        .dom('[data-test-id="message"]')
        .hasText(
          'Hello Curried',
          'renders subscription data via curried factory'
        );
    });

    test('createSubscriptionResource in template-only with (hash) helper', async function (assert) {
      const onMessageAdded = createSubscriptionResource<
        OnMessageAddedSubscription,
        OnMessageAddedSubscriptionVariables
      >(SUBSCRIPTION);

      link.simulateResult({
        result: {
          data: {
            messageAdded: {
              __typename: 'Message',
              id: '0',
              message: 'Template Sub',
            },
          },
        },
      });

      await render(
        <template>
          {{#let
            (onMessageAdded (hash variables=(hash channel="tpl")))
            as |sub|
          }}
            <div data-test-id="curried-tpl-sub">
              {{#if sub.loading}}
                <span data-test-id="loading">Loading...</span>
              {{else}}
                <span
                  data-test-id="message"
                >{{sub.data.messageAdded.message}}</span>
              {{/if}}
            </div>
          {{/let}}
        </template>
      );

      assert
        .dom('[data-test-id="message"]')
        .hasText(
          'Template Sub',
          'renders subscription data via curried factory in template-only context'
        );
    });
  }
);
