# Agent Instructions

## Backward Compatibility

Always ensure schema changes include a migration path for existing databases.
SQLite's `CREATE TABLE IF NOT EXISTS` is a no-op against existing tables, so
new columns must be added via `ALTER TABLE ADD COLUMN` guarded by a
`PRAGMA table_info` check in `init()`.

Failing open on validation (silently accepting bad input that undermines a
security control) is never acceptable. Validate at the schema boundary and
fail closed in the enforcement layer.

## Minimal Edits

Prefer targeted edits over rewriting entire files. Write the least amount of
code needed to fix the issue — avoid restructuring, reformatting, or moving
existing code unless it's directly part of the fix.
