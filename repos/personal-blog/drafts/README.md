# Drafts / WIP

Articles in this directory are works in progress. They are tracked in git but
**not processed by MkDocs or deployed.** Only files under `docs/` are visible
on the live site.

## Workflow

1. Write your draft here with full frontmatter (tags, description, image).
2. When ready to publish, move the file to the appropriate directory under
   `docs/blog/`:
   - Tutorials → `docs/blog/tutorials/`
   - Opinions → `docs/blog/opinions/`
   - Quick tips → `docs/blog/`
3. Preview locally with `mkdocs serve`.

## Convention

- Use the same frontmatter format as published posts (tags, description, image).
- Keep filenames kebab-case, e.g. `my-new-idea.md`.
- Remove `draft: true` or `search.exclude: true` if present before publishing.
