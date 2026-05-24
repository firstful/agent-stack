#!/usr/bin/env npx tsx
// Generates the OpenAPI 3.0 spec from the declarative route registry (lib/routes.ts).
// Usage: npx tsx generate-openapi.ts > ../config/wiki/openapi.json

import { buildOpenApiSpec } from "./lib/routes";

const spec = buildOpenApiSpec();
process.stdout.write(JSON.stringify(spec, null, 2) + "\n");
