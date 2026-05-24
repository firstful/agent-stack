---
tags:
    - Tutorial
    - OpenAPI
    - Github Actions
description: |
    How to build models from OpenAPI using Github Actions for CI/CD
image: https://avatars3.githubusercontent.com/u/16343502
---

# Generating Models from OpenAPI with Github Actions

## What is OpenAPI?

![OpenAPI Banner](https://www.openapis.org/wp-content/uploads/sites/3/2018/02/OpenAPI_Logo_Pantone-1.png){width="300" align=right loading=lazy}

[OpenAPI](https://www.openapis.org/) specification files make it much easy for developers to communicate how to interact with an API in a standardized way. OpenAPI is used by many technology companies, including Microsoft, Google, and SalesForce[^1]. OpenAPI files are either YAML or JSON files that define the endpoints and model the data for an HTTP API.

Below are a few snippets from an example definition:

### POST Definition
This snippet defines a POST operation to create a new pet:
```yaml
paths:
  /pets:
    post:
      summary: Create a pet
      operationId: createPet
      requestBody:
        required: true
        content:
          application/json:
            schema:
              $ref: '#/components/schemas/Pet'
      responses:
        '201':
          description: Pet created
          content:
            application/json:
              schema:
                $ref: '#/components/schemas/Pet'
```

### GET Definition with path parameter
This snippet defines a GET operation to fetch a pet by ID:
```yaml
paths:
  /pets/{petId}:
    get:
      summary: Get a pet by ID
      operationId: getPetById
      parameters:
        - name: petId
          in: path
          required: true
          schema:
            type: integer
            format: int64
      responses:
        '200':
          description: A pet
          content:
            application/json:
              schema:
                $ref: '#/components/schemas/Pet'
```

### Pet Schema
This snippet defines the shape of the Pet object:
```yaml
components:
  schemas:
    Pet:
      type: object
      required:
        - id
        - name
      properties:
        id:
          type: integer
          format: int64
        name:
          type: string
        tag:
          type: string
```

## Autogeneration

![Pet Store](https://s3.us-west-1.wasabisys.com/idbwmedia.com/images/api/swagger_editor_pic.png){width="300"  align=right loading=lazy}

Once created, the definition file can be used to generate various types of files. The example to the right shows a Swagger[^2] HTML visualization that many developers will be familiar with. The clean, minimal YAML is automatically transformed into attractive, hostable HTML documentation.

Various tools exist for these kinds of transformations, in this example, we will focus on the ['OpenAPI Generator'](https://github.com/OpenAPITools/openapi-generator) project. This is a Java tool that can be used to generate docs, API clients, and server stubs. This example will focus on API client generation.

In this case, instead of managing the Java package installation, it is simpler to use the NPM CLI provided to execute relevant commands. This can be installed by the following command:

```
npm install @openapitools/openapi-generator-cli -g
```

Alternatively, we can use the `npx` command to run the cli without worrying about the installation. We can now pass the path to our definition and the language we would like to generate to the CLI

```bash
npx @openapitools/openapi-generator-cli generate -g python -i /path/to/my/definition.yaml -o output
```

## Automating with GitHub Actions

Manual generation is useful for one-off tasks, but the real value comes from automating this process in CI/CD. Below is a GitHub Actions workflow that generates typed clients from your OpenAPI spec on every push:

```yaml
name: Generate API Client

on:
  push:
    branches: [main]
    paths:
      - "specs/**"

jobs:
  generate:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - uses: actions/setup-node@v4
        with:
          node-version: "20"

      - name: Generate Python client
        run: |
          npx @openapitools/openapi-generator-cli generate \
            -g python \
            -i specs/api.yaml \
            -o generated/python-client

      - name: Generate TypeScript client
        run: |
          npx @openapitools/openapi-generator-cli generate \
            -g typescript-axios \
            -i specs/api.yaml \
            -o generated/typescript-client

      - name: Upload generated clients as artifacts
        uses: actions/upload-artifact@v4
        with:
          name: generated-clients
          path: generated/
```

## Validating the Spec Before Generation

To catch errors early, add a validation step before generating:

```yaml
- name: Validate OpenAPI spec
  run: |
    npx @openapitools/openapi-generator-cli validate \
      -i specs/api.yaml
```

Or use [Spectral](https://stoplight.io/open-source/spectral) for more fine-grained linting:

```yaml
- name: Lint with Spectral
  run: |
    npx @stoplight/spectral-cli lint specs/api.yaml
```

## Publishing Generated Packages

For teams that consume the API, you can publish generated clients to a package registry:

```yaml
- name: Publish Python client to PyPI
  run: |
    cd generated/python-client
    pip install build twine
    python -m build
    twine upload dist/*
  env:
    TWINE_USERNAME: __token__
    TWINE_PASSWORD: ${{ secrets.PYPI_TOKEN }}
```

## Summary

Combining OpenAPI generation with GitHub Actions creates a workflow where your API clients are always in sync with your specification. This eliminates manual code generation, reduces drift, and ensures that consumers always have access to up-to-date, typed clients.

[^1]: [OpenAPI Initiative members](https://www.openapis.org/membershipmembers)
[^2]: [Article explaining 'Swagger' vs. 'OpenAPI'](https://swagger.io/blog/api-strategy/difference-between-swagger-and-openapi/)
