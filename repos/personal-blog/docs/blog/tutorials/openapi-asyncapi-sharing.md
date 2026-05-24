---
tags:
    - Tutorial
    - OpenAPI
    - AsyncAPI
    - JSON
description: |
    Sharing schemas between OpenAPI and AsyncAPI specs to reduce repeated content
image: https://avatars.githubusercontent.com/u/16401334
---

# Sharing Schemas Between OpenAPI and AsyncAPI Specs

If your application exposes HTTP APIs (OpenAPI) and event-driven APIs (AsyncAPI), you have overlapping data models. A `User` object or `Order` payload should look the same whether it arrives via REST or a message queue. Duplicating schemas across two spec files guarantees drift and maintenance pain.

This tutorial covers strategies for sharing schemas between OpenAPI and AsyncAPI.

## The Problem

Consider an e-commerce system:

- A REST endpoint `POST /orders` accepts an `Order` payload (defined in OpenAPI)
- A message broker emits an `OrderPlaced` event with a nearly identical `Order` payload (defined in AsyncAPI)

Without sharing, you end up with two copies of the `Order` schema that inevitably diverge over time.

## Strategy 1: External $ref Files

Both OpenAPI and AsyncAPI support JSON Schema `$ref` pointers to external files. This is the simplest sharing mechanism.

Create a directory structure like:

```
specs/
  schemas/
    order.yaml
    user.yaml
    line-item.yaml
  openapi.yaml
  asyncapi.yaml
```

**schemas/order.yaml:**

```yaml
type: object
required:
  - id
  - customerId
  - items
properties:
  id:
    type: string
    format: uuid
  customerId:
    type: string
  items:
    type: array
    items:
      $ref: ./line-item.yaml
  createdAt:
    type: string
    format: date-time
```

**openapi.yaml** (referencing the shared schema):

```yaml
paths:
  /orders:
    post:
      requestBody:
        content:
          application/json:
            schema:
              $ref: ./schemas/order.yaml
```

**asyncapi.yaml** (referencing the same schema):

```yaml
channels:
  order/placed:
    publish:
      message:
        payload:
          $ref: ./schemas/order.yaml
```

## Strategy 2: YAML Anchors and Aliases

If you prefer keeping everything in fewer files, YAML anchors let you define a schema once and reference it inline:

```yaml
x-shared-schemas:
  Order: &Order
    type: object
    properties:
      id:
        type: string
      items:
        type: array
        items:
          $ref: "#/x-shared-schemas/LineItem"
  LineItem: &LineItem
    type: object
    properties:
      productId:
        type: string
      quantity:
        type: integer

paths:
  /orders:
    post:
      requestBody:
        content:
          application/json:
            schema: *Order
```

This works for single files, but YAML anchors are a parser feature — some tools may not resolve them.

## Strategy 3: Schema Bundling with Tools

For CI/CD pipelines, use tools that resolve and bundle external references at build time:

- **`redocly bundle`** — resolves `$ref` pointers into a single file
- **`speccy resolve`** — similar bundling for OpenAPI
- **`asyncapi bundle`** — the official AsyncAPI CLI tool

Example workflow:

```bash
# Install tools
npm install -g @redocly/cli @asyncapi/cli

# Bundle OpenAPI
redocly bundle specs/openapi.yaml --output dist/openapi.yaml

# Bundle AsyncAPI
asyncapi bundle specs/asyncapi.yaml --output dist/asyncapi.yaml
```

## Keeping Schemas in Sync

For larger teams, consider generating both specs from a common source of truth:

1. **JSON Schema** as the canonical format
2. Code generation from a shared type system (e.g., TypeScript types, Protobuf)
3. A dedicated schema registry

## Summary

Sharing schemas between OpenAPI and AsyncAPI is essential for consistency in polyglot API ecosystems. External `$ref` files offer the best balance of simplicity and tooling support. Bundling ensures compatibility with tools that do not follow references.
