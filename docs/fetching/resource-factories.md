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

## Template-Only Usage

The primary motivation for resource factories is enabling Apollo queries directly in templates using `{{#let}}`.

### queryResource in templates

Pass the query document and an options hash directly to `queryResource`:

```gts:notes.gts
import { gql } from 'glimmer-apollo';
import { queryResource } from 'glimmer-apollo/resource-factories';

const GET_NOTES = gql`
  query GetNotes {
    notes {
      id
      title
      description
    }
  }
`;

<template>
  {{#let (queryResource GET_NOTES) as |notes|}}
    {{#if notes.loading}}
      Loading...
    {{else if notes.error}}
      Error!: {{notes.error.message}}
    {{else}}
      {{#each notes.data.notes as |note|}}
        <div>
          Title: {{note.title}}
          Description: {{note.description}}
        </div>
      {{/each}}
    {{/if}}
  {{/let}}
</template>
```

### Passing variables with the hash helper

Use `(hash ...)` to pass variables and options:

```gts:user-profile.gts
import { gql } from 'glimmer-apollo';
import { queryResource } from 'glimmer-apollo/resource-factories';

const GET_USER = gql`
  query GetUser($id: ID!) {
    user(id: $id) {
      id
      firstName
      lastName
    }
  }
`;

<template>
  {{#let (queryResource GET_USER (hash variables=(hash id=@userId))) as |user|}}
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

### mutationResource in templates

```gts:create-note.gts
import Component from '@glimmer/component';
import { on } from '@ember/modifier';
import { gql } from 'glimmer-apollo';
import { mutationResource } from 'glimmer-apollo/resource-factories';

const CREATE_NOTE = gql`
  mutation CreateNote($input: NoteInput!) {
    createNote(input: $input) {
      id
      title
    }
  }
`;

<template>
  {{#let (mutationResource CREATE_NOTE) as |createNote|}}
    <button {{on "click" (fn createNote.mutate (hash input=(hash title="New Note")))}}>
      Create Note
    </button>

    {{#if createNote.loading}}
      Creating...
    {{else if createNote.called}}
      Created: {{createNote.data.createNote.title}}
    {{/if}}
  {{/let}}
</template>
```

### subscriptionResource in templates

```gts:latest-message.gts
import { gql } from 'glimmer-apollo';
import { subscriptionResource } from 'glimmer-apollo/resource-factories';

const ON_MESSAGE_ADDED = gql`
  subscription OnMessageAdded($channel: String!) {
    messageAdded(channel: $channel) {
      id
      message
    }
  }
`;

<template>
  {{#let (subscriptionResource ON_MESSAGE_ADDED (hash variables=(hash channel="general"))) as |sub|}}
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

Resource factories also work with the `@use` decorator from `ember-resources` in class-based components. Pass a thunk function for reactive tracked dependencies:

```gts:notes.gts
import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';
import { on } from '@ember/modifier';
import { action } from '@ember/object';
import { use } from 'ember-resources';
import { gql } from 'glimmer-apollo';
import { queryResource } from 'glimmer-apollo/resource-factories';

const GET_NOTES = gql`
  query GetNotes($isArchived: Boolean) {
    notes(isArchived: $isArchived) {
      id
      title
      description
    }
  }
`;

export default class Notes extends Component {
  @tracked isArchived = false;

  @use notes = queryResource(() => [
    GET_NOTES,
    { variables: { isArchived: this.isArchived } }
  ]);

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
import { mutationResource } from 'glimmer-apollo/resource-factories';

const CREATE_NOTE = gql`
  mutation CreateNote($input: NoteInput!) {
    createNote(input: $input) {
      id
      title
      description
    }
  }
`;

export default class CreateNote extends Component {
  @use createNote = mutationResource(() => [CREATE_NOTE]);

  @action
  async submit(): Promise<void> {
    await this.createNote.mutate({
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

    {{#if this.createNote.loading}}
      Creating...
    {{else if this.createNote.error}}
      Error!: {{this.createNote.error.message}}
    {{else if this.createNote.called}}
      <div>
        id: {{this.createNote.data.createNote.id}}
        Title: {{this.createNote.data.createNote.title}}
      </div>
    {{/if}}
  </template>
}
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

Each factory accepts two calling conventions:

| Convention | Syntax | Use case |
|-----------|--------|----------|
| Direct args | `queryResource(QUERY, options)` | Template invocation with `{{#let}}` |
| Thunk | `queryResource(() => [QUERY, options])` | `@use` decorator with tracked reactivity |

Both use the same underlying Resource classes as `useQuery`/`useMutation`/`useSubscription`.
