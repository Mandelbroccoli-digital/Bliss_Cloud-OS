/*
# Bliss OS Core Database Schema

## Purpose
Creates the persistence layer for the Bliss OS cloud desktop environment.
This is a single-tenant app (no sign-in screen), so all data is shared/public
and policies allow both anon and authenticated roles to read and write.

## New Tables

1. **files** — Virtual file system for the Explorer app
   - `id` (uuid, primary key)
   - `name` (text, not null) — file or folder name
   - `path` (text, not null, unique) — full path like /Documents/notes.txt
   - `type` (text, not null) — 'file' or 'folder'
   - `content` (text, nullable) — file contents (text only)
   - `mime_type` (text, nullable) — e.g. text/plain, application/json
   - `size` (integer, default 0) — size in bytes
   - `parent_path` (text, nullable) — parent folder path
   - `created_at` (timestamptz)
   - `updated_at` (timestamptz)

2. **notes** — Quick notes for the Notepad app
   - `id` (uuid, primary key)
   - `title` (text, not null)
   - `content` (text, nullable)
   - `pinned` (boolean, default false)
   - `created_at` (timestamptz)
   - `updated_at` (timestamptz)

3. **diagrams** — Saved Mermaid diagrams for the Diagrammer app
   - `id` (uuid, primary key)
   - `title` (text, not null)
   - `source` (text, not null) — Mermaid syntax
   - `diagram_type` (text, nullable) — flowchart, sequence, class, etc.
   - `created_at` (timestamptz)
   - `updated_at` (timestamptz)

4. **mindmaps** — Saved mind maps for the MindMap app
   - `id` (uuid, primary key)
   - `title` (text, not null)
   - `data` (jsonb, not null) — serialized mind map structure
   - `created_at` (timestamptz)
   - `updated_at` (timestamptz)

5. **app_settings** — Per-app configuration key-value store
   - `id` (uuid, primary key)
   - `app_id` (text, not null) — e.g. 'terminal', 'browser', 'paint'
   - `key` (text, not null) — setting key
   - `value` (text, nullable) — setting value
   - `created_at` (timestamptz)
   - `updated_at` (timestamptz)
   - Unique constraint on (app_id, key)

6. **window_sessions** — Save/restore desktop window layouts
   - `id` (uuid, primary key)
   - `session_name` (text, not null default 'default')
   - `windows` (jsonb, not null) — array of {id, x, y, width, height, maximized, app}
   - `created_at` (timestamptz)
   - `updated_at` (timestamptz)

7. **terminal_history** — Command history for the Terminal app
   - `id` (uuid, primary key)
   - `command` (text, not null)
   - `output` (text, nullable)
   - `created_at` (timestamptz)

## Security
- RLS enabled on all tables.
- All policies use `TO anon, authenticated` with `USING (true)` / `WITH CHECK (true)`
  because this is a single-tenant app with no sign-in — all data is intentionally public.
- No user_id columns or auth.uid() references.

## Notes
1. All tables use `gen_random_uuid()` for primary keys.
2. Timestamps default to `now()` and auto-update on changes via triggers.
3. The files table has a unique constraint on `path` to prevent duplicates.
4. app_settings has a unique constraint on (app_id, key) for upsert support.
*/

-- ── files table ──
CREATE TABLE IF NOT EXISTS files (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    name text NOT NULL,
    path text NOT NULL UNIQUE,
    type text NOT NULL DEFAULT 'file',
    content text,
    mime_type text,
    size integer NOT NULL DEFAULT 0,
    parent_path text,
    created_at timestamptz DEFAULT now(),
    updated_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_files_parent_path ON files(parent_path);
CREATE INDEX IF NOT EXISTS idx_files_type ON files(type);

ALTER TABLE files ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "anon_select_files" ON files;
CREATE POLICY "anon_select_files" ON files FOR SELECT
    TO anon, authenticated USING (true);

DROP POLICY IF EXISTS "anon_insert_files" ON files;
CREATE POLICY "anon_insert_files" ON files FOR INSERT
    TO anon, authenticated WITH CHECK (true);

DROP POLICY IF EXISTS "anon_update_files" ON files;
CREATE POLICY "anon_update_files" ON files FOR UPDATE
    TO anon, authenticated USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "anon_delete_files" ON files;
CREATE POLICY "anon_delete_files" ON files FOR DELETE
    TO anon, authenticated USING (true);

-- ── notes table ──
CREATE TABLE IF NOT EXISTS notes (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    title text NOT NULL,
    content text,
    pinned boolean NOT NULL DEFAULT false,
    created_at timestamptz DEFAULT now(),
    updated_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_notes_pinned ON notes(pinned);

ALTER TABLE notes ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "anon_select_notes" ON notes;
CREATE POLICY "anon_select_notes" ON notes FOR SELECT
    TO anon, authenticated USING (true);

DROP POLICY IF EXISTS "anon_insert_notes" ON notes;
CREATE POLICY "anon_insert_notes" ON notes FOR INSERT
    TO anon, authenticated WITH CHECK (true);

DROP POLICY IF EXISTS "anon_update_notes" ON notes;
CREATE POLICY "anon_update_notes" ON notes FOR UPDATE
    TO anon, authenticated USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "anon_delete_notes" ON notes;
CREATE POLICY "anon_delete_notes" ON notes FOR DELETE
    TO anon, authenticated USING (true);

-- ── diagrams table ──
CREATE TABLE IF NOT EXISTS diagrams (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    title text NOT NULL,
    source text NOT NULL,
    diagram_type text,
    created_at timestamptz DEFAULT now(),
    updated_at timestamptz DEFAULT now()
);

ALTER TABLE diagrams ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "anon_select_diagrams" ON diagrams;
CREATE POLICY "anon_select_diagrams" ON diagrams FOR SELECT
    TO anon, authenticated USING (true);

DROP POLICY IF EXISTS "anon_insert_diagrams" ON diagrams;
CREATE POLICY "anon_insert_diagrams" ON diagrams FOR INSERT
    TO anon, authenticated WITH CHECK (true);

DROP POLICY IF EXISTS "anon_update_diagrams" ON diagrams;
CREATE POLICY "anon_update_diagrams" ON diagrams FOR UPDATE
    TO anon, authenticated USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "anon_delete_diagrams" ON diagrams;
CREATE POLICY "anon_delete_diagrams" ON diagrams FOR DELETE
    TO anon, authenticated USING (true);

-- ── mindmaps table ──
CREATE TABLE IF NOT EXISTS mindmaps (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    title text NOT NULL,
    data jsonb NOT NULL,
    created_at timestamptz DEFAULT now(),
    updated_at timestamptz DEFAULT now()
);

ALTER TABLE mindmaps ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "anon_select_mindmaps" ON mindmaps;
CREATE POLICY "anon_select_mindmaps" ON mindmaps FOR SELECT
    TO anon, authenticated USING (true);

DROP POLICY IF EXISTS "anon_insert_mindmaps" ON mindmaps;
CREATE POLICY "anon_insert_mindmaps" ON mindmaps FOR INSERT
    TO anon, authenticated WITH CHECK (true);

DROP POLICY IF EXISTS "anon_update_mindmaps" ON mindmaps;
CREATE POLICY "anon_update_mindmaps" ON mindmaps FOR UPDATE
    TO anon, authenticated USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "anon_delete_mindmaps" ON mindmaps;
CREATE POLICY "anon_delete_mindmaps" ON mindmaps FOR DELETE
    TO anon, authenticated USING (true);

-- ── app_settings table ──
CREATE TABLE IF NOT EXISTS app_settings (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    app_id text NOT NULL,
    key text NOT NULL,
    value text,
    created_at timestamptz DEFAULT now(),
    updated_at timestamptz DEFAULT now(),
    UNIQUE(app_id, key)
);

CREATE INDEX IF NOT EXISTS idx_app_settings_app_id ON app_settings(app_id);

ALTER TABLE app_settings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "anon_select_app_settings" ON app_settings;
CREATE POLICY "anon_select_app_settings" ON app_settings FOR SELECT
    TO anon, authenticated USING (true);

DROP POLICY IF EXISTS "anon_insert_app_settings" ON app_settings;
CREATE POLICY "anon_insert_app_settings" ON app_settings FOR INSERT
    TO anon, authenticated WITH CHECK (true);

DROP POLICY IF EXISTS "anon_update_app_settings" ON app_settings;
CREATE POLICY "anon_update_app_settings" ON app_settings FOR UPDATE
    TO anon, authenticated USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "anon_delete_app_settings" ON app_settings;
CREATE POLICY "anon_delete_app_settings" ON app_settings FOR DELETE
    TO anon, authenticated USING (true);

-- ── window_sessions table ──
CREATE TABLE IF NOT EXISTS window_sessions (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    session_name text NOT NULL DEFAULT 'default',
    windows jsonb NOT NULL,
    created_at timestamptz DEFAULT now(),
    updated_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_window_sessions_name ON window_sessions(session_name);

ALTER TABLE window_sessions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "anon_select_window_sessions" ON window_sessions;
CREATE POLICY "anon_select_window_sessions" ON window_sessions FOR SELECT
    TO anon, authenticated USING (true);

DROP POLICY IF EXISTS "anon_insert_window_sessions" ON window_sessions;
CREATE POLICY "anon_insert_window_sessions" ON window_sessions FOR INSERT
    TO anon, authenticated WITH CHECK (true);

DROP POLICY IF EXISTS "anon_update_window_sessions" ON window_sessions;
CREATE POLICY "anon_update_window_sessions" ON window_sessions FOR UPDATE
    TO anon, authenticated USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "anon_delete_window_sessions" ON window_sessions;
CREATE POLICY "anon_delete_window_sessions" ON window_sessions FOR DELETE
    TO anon, authenticated USING (true);

-- ── terminal_history table ──
CREATE TABLE IF NOT EXISTS terminal_history (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    command text NOT NULL,
    output text,
    created_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_terminal_history_created ON terminal_history(created_at DESC);

ALTER TABLE terminal_history ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "anon_select_terminal_history" ON terminal_history;
CREATE POLICY "anon_select_terminal_history" ON terminal_history FOR SELECT
    TO anon, authenticated USING (true);

DROP POLICY IF EXISTS "anon_insert_terminal_history" ON terminal_history;
CREATE POLICY "anon_insert_terminal_history" ON terminal_history FOR INSERT
    TO anon, authenticated WITH CHECK (true);

DROP POLICY IF EXISTS "anon_update_terminal_history" ON terminal_history;
CREATE POLICY "anon_update_terminal_history" ON terminal_history FOR UPDATE
    TO anon, authenticated USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "anon_delete_terminal_history" ON terminal_history;
CREATE POLICY "anon_delete_terminal_history" ON terminal_history FOR DELETE
    TO anon, authenticated USING (true);

-- ── Auto-update trigger for updated_at columns ──
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = now();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trigger_files_updated_at ON files;
CREATE TRIGGER trigger_files_updated_at BEFORE UPDATE ON files
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS trigger_notes_updated_at ON notes;
CREATE TRIGGER trigger_notes_updated_at BEFORE UPDATE ON notes
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS trigger_diagrams_updated_at ON diagrams;
CREATE TRIGGER trigger_diagrams_updated_at BEFORE UPDATE ON diagrams
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS trigger_mindmaps_updated_at ON mindmaps;
CREATE TRIGGER trigger_mindmaps_updated_at BEFORE UPDATE ON mindmaps
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS trigger_app_settings_updated_at ON app_settings;
CREATE TRIGGER trigger_app_settings_updated_at BEFORE UPDATE ON app_settings
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS trigger_window_sessions_updated_at ON window_sessions;
CREATE TRIGGER trigger_window_sessions_updated_at BEFORE UPDATE ON window_sessions
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
