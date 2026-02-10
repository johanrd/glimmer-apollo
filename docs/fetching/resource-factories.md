---
order: 4
---

# Resource Factories

Resource factories let you use Apollo queries, mutations, and subscriptions directly in templates — including template-only components — without needing a backing class. They integrate with `ember-resources` and also support the `@use` decorator and composability.

The existing `useQuery`, `useMutation`, and `useSubscription` functions continue to work unchanged. Resource factories are additive.

## Prerequisites

`ember-resources` is an optional peer dependency of `glimmer-apollo`. Importing from `glimmer-apollo/resource-factories` **requires `ember-resources` to be installed** — the import will fail at runtime if the package is not present. The main `glimmer-apollo` import is unaffected and continues to work without `ember-resources`.

Install `ember-resources` as a dependency of your app:

```sh
pnpm add ember-resources
```

```sh
npm install ember-resources
```

## Curried Resource Factories

The recommended way to use resource factories in templates is via **curried factories**. Call `createQueryResource` / `createMutationResource` / `createSubscriptionResource` with a GraphQL document to get a reusable resource that can be invoked in templates or with `@use`:

### createQueryResource in templates

```gts:user-profile.gts
import { gql } from 'glimmer-apollo';
import { createQueryResource } from 'glimmer-apollo/resource-factories';

const GET_USER = gql`
  query GetUser($id: ID!) {
    user(id: $id) {
      id
      firstName
      lastName
    }
  }
`;

const getUser = createQueryResource(GET_USER);

<template>
  {{#let (getUser (hash variables=(hash id=@userId))) as |user|}}
    {{#if user.loading}}
      Loading...
    {{else if user.error}}
      Error!: {{user.error.message}}
    {{else}}
      <h1>{{user.data.user.firstName}} {{user.data.user.lastName}}</h1>
    {{/if}}
  {{/let}}
</template>
```

When `@userId` changes, the resource is re-created with the new variables.

### createMutationResource in templates

```gts:create-note.gts
import Component from '@glimmer/component';
import { on } from '@ember/modifier';
import { gql } from 'glimmer-apollo';
import { createMutationResource } from 'glimmer-apollo/resource-factories';

const CREATE_NOTE = gql`
  mutation CreateNote($input: NoteInput!) {
    createNote(input: $input) {
      id
      title
    }
  }
`;

const createNote = createMutationResource(CREATE_NOTE);

<template>
  {{#let (createNote) as |mutation|}}
    <button {{on "click" (fn mutation.mutate (hash input=(hash title="New Note")))}}>
      Create Note
    </button>

    {{#if mutation.loading}}
      Creating...
    {{else if mutation.called}}
      Created: {{mutation.data.createNote.title}}
    {{/if}}
  {{/let}}
</template>
```

### createSubscriptionResource in templates

```gts:latest-message.gts
import { gql } from 'glimmer-apollo';
import { createSubscriptionResource } from 'glimmer-apollo/resource-factories';

const ON_MESSAGE_ADDED = gql`
  subscription OnMessageAdded($channel: String!) {
    messageAdded(channel: $channel) {
      id
      message
    }
  }
`;

const onMessageAdded = createSubscriptionResource(ON_MESSAGE_ADDED);

<template>
  {{#let (onMessageAdded (hash variables=(hash channel="general"))) as |sub|}}
    {{#if sub.loading}}
      Connecting...
    {{else if sub.error}}
      Error!: {{sub.error.message}}
    {{else}}
      New Message: {{sub.data.messageAdded.message}}
    {{/if}}
  {{/let}}
</template>
```

## Usage with @use decorator

Curried resource factories work with the `@use` decorator from `ember-resources` in class-based components. Pass a thunk returning options for reactive tracked dependencies:

```gts:notes.gts
import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';
import { on } from '@ember/modifier';
import { action } from '@ember/object';
import { use } from 'ember-resources';
import { gql } from 'glimmer-apollo';
import { createQueryResource } from 'glimmer-apollo/resource-factories';

const GET_NOTES = gql`
  query GetNotes($isArchived: Boolean) {
    notes(isArchived: $isArchived) {
      id
      title
      description
    }
  }
`;

const getNotes = createQueryResource(GET_NOTES);

export default class Notes extends Component {
  @tracked isArchived = false;

  @use notes = getNotes(() => ({
    variables: { isArchived: this.isArchived }
  }));

  @action
  toggleIsArchived(): void {
    this.isArchived = !this.isArchived;
  }

  <template>
    <button {{on "click" this.toggleIsArchived}}>
      {{#if this.isArchived}}Show not archived{{else}}Show archived{{/if}}
    </button>

    {{#if this.notes.loading}}
      Loading...
    {{else if this.notes.error}}
      Error!: {{this.notes.error.message}}
    {{else}}
      {{#each this.notes.data.notes as |note|}}
        <div>
          Title: {{note.title}}
          Description: {{note.description}}
        </div>
      {{/each}}
    {{/if}}
  </template>
}
```

Notice there is no `this` argument — the `@use` decorator handles context and destruction automatically.

When `this.isArchived` changes, the query automatically re-executes with the updated variables. Values are compared using deep equality (`@wry/equality`), so setting a tracked property to the same value does not trigger a re-fetch.

### mutationResource with @use

```gts:create-note.gts
import Component from '@glimmer/component';
import { on } from '@ember/modifier';
import { action } from '@ember/object';
import { use } from 'ember-resources';
import { gql } from 'glimmer-apollo';
import { createMutationResource } from 'glimmer-apollo/resource-factories';

const CREATE_NOTE = gql`
  mutation CreateNote($input: NoteInput!) {
    createNote(input: $input) {
      id
      title
      description
    }
  }
`;

const createNote = createMutationResource(CREATE_NOTE);

export default class CreateNote extends Component {
  @use createNoteMutation = createNote();

  @action
  async submit(): Promise<void> {
    await this.createNoteMutation.mutate({
      input: {
        title: 'Title',
        description: 'Description',
        isArchived: false
      }
    });
  }

  <template>
    <button {{on "click" this.submit}}>
      Create Note
    </button>

    {{#if this.createNoteMutation.loading}}
      Creating...
    {{else if this.createNoteMutation.error}}
      Error!: {{this.createNoteMutation.error.message}}
    {{else if this.createNoteMutation.called}}
      <div>
        id: {{this.createNoteMutation.data.createNote.id}}
        Title: {{this.createNoteMutation.data.createNote.title}}
      </div>
    {{/if}}
  </template>
}
```

You can also use the base `queryResource`/`mutationResource`/`subscriptionResource` directly with `@use` by passing a thunk that returns `[document, options]`:

```ts
@use notes = queryResource(() => [GET_NOTES, { variables: { isArchived: this.isArchived } }]);
```

## Available features

All resource factories expose the same properties and methods as their `use*` counterparts:

### queryResource

- **Status**: `loading`, `error`, `data`, `networkStatus`, `promise`
- **Methods**: `refetch()`, `fetchMore()`, `updateQuery()`, `startPolling()`, `stopPolling()`, `subscribeToMore()`, `settled()`
- **Options**: `variables`, `fetchPolicy`, `errorPolicy`, `skip`, `ssr`, `clientId`, `onComplete`, `onError`

### mutationResource

- **Status**: `loading`, `called`, `error`, `data`, `promise`
- **Methods**: `mutate(variables?, options?)`, `settled()`
- **Options**: `variables`, `errorPolicy`, `clientId`, `onComplete`, `onError`

### subscriptionResource

- **Status**: `loading`, `error`, `data`, `promise`
- **Methods**: `settled()`
- **Options**: `variables`, `errorPolicy`, `ssr`, `clientId`, `onData`, `onError`, `onComplete`

## Calling conventions

| Function | Syntax | Use case |
|----------|--------|----------|
| `queryResource` | `queryResource(() => [QUERY, options])` | `@use` decorator with tracked reactivity |
| `createQueryResource` | `const q = createQueryResource(QUERY)` | Curried factory for templates and `@use` |

Curried factories accept both thunks (for `@use` reactivity) and direct options (for template invocation):

```ts
// @use with thunk — tracks reactive dependencies
@use query = getUser(() => ({ variables: { id: this.userId } }));

// Template with direct options
{{#let (getUser (hash variables=(hash id="1"))) as |q|}} ... {{/let}}
```

All factories use the same underlying Resource classes as `useQuery`/`useMutation`/`useSubscription`.
