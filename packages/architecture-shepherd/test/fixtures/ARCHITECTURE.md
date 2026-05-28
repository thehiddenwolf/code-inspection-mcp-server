# Architecture

## Layers
- presentation: depends on [domain]
- infrastructure: depends on [domain]
- domain: depends on []

## Components
- packages/web-app: presentation
- packages/api: infrastructure
- packages/core: domain
- src/web: presentation
- src/infra: infrastructure
- src/domain: domain

## Boundaries
- presentation must not import infrastructure directly
- infrastructure may import domain only
