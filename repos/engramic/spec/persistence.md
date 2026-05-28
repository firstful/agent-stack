# Persistence Requirements

The following MUST persist durably:

1. Raw transcript spans
2. Summary nodes
3. Embeddings
4. Memory handles
5. Conversation DAG
6. Tool orchestration state

---

## Storage Model

Recommended:

- PostgreSQL for metadata
- Object store for transcripts
- Vector DB for embeddings
- Redis for hot working set cache
