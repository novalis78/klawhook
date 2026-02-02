import Database, { Database as DatabaseType, Statement } from 'better-sqlite3';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { existsSync, mkdirSync } from 'fs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA_DIR = process.env.DATA_DIR || join(__dirname, '..', 'data');

// Ensure data directory exists
if (!existsSync(DATA_DIR)) {
  mkdirSync(DATA_DIR, { recursive: true });
}

const dbPath = join(DATA_DIR, 'keyhook.db');
const db: DatabaseType = new Database(dbPath);

// Enable WAL mode for better concurrency
db.pragma('journal_mode = WAL');

// Initialize schema
db.exec(`
  -- Hooks table: stores webhook endpoints created by agents
  CREATE TABLE IF NOT EXISTS hooks (
    id TEXT PRIMARY KEY,
    api_key TEXT NOT NULL,
    name TEXT,
    description TEXT,
    delivery_method TEXT DEFAULT 'poll',
    delivery_config TEXT,
    created_at TEXT DEFAULT (datetime('now')),
    last_triggered_at TEXT,
    event_count INTEGER DEFAULT 0
  );

  -- Events table: stores incoming webhook payloads
  CREATE TABLE IF NOT EXISTS events (
    id TEXT PRIMARY KEY,
    hook_id TEXT NOT NULL,
    method TEXT NOT NULL,
    headers TEXT NOT NULL,
    body TEXT,
    query_params TEXT,
    source_ip TEXT,
    received_at TEXT DEFAULT (datetime('now')),
    delivered_at TEXT,
    FOREIGN KEY (hook_id) REFERENCES hooks(id) ON DELETE CASCADE
  );

  -- Indexes for efficient queries
  CREATE INDEX IF NOT EXISTS idx_hooks_api_key ON hooks(api_key);
  CREATE INDEX IF NOT EXISTS idx_events_hook_id ON events(hook_id);
  CREATE INDEX IF NOT EXISTS idx_events_received_at ON events(received_at);
`);

// Prepared statements for common operations
interface Statements {
  createHook: Statement;
  getHook: Statement;
  getHooksByApiKey: Statement;
  deleteHook: Statement;
  updateHookTrigger: Statement;
  createEvent: Statement;
  getEvents: Statement;
  getUndeliveredEvents: Statement;
  markEventsDelivered: Statement;
  deleteOldEvents: Statement;
  getEventCount: Statement;
}

export const statements: Statements = {
  // Hook operations
  createHook: db.prepare(`
    INSERT INTO hooks (id, api_key, name, description, delivery_method, delivery_config)
    VALUES (?, ?, ?, ?, ?, ?)
  `),

  getHook: db.prepare(`
    SELECT * FROM hooks WHERE id = ?
  `),

  getHooksByApiKey: db.prepare(`
    SELECT id, name, description, delivery_method, created_at, last_triggered_at, event_count
    FROM hooks WHERE api_key = ?
    ORDER BY created_at DESC
  `),

  deleteHook: db.prepare(`
    DELETE FROM hooks WHERE id = ? AND api_key = ?
  `),

  updateHookTrigger: db.prepare(`
    UPDATE hooks
    SET last_triggered_at = datetime('now'), event_count = event_count + 1
    WHERE id = ?
  `),

  // Event operations
  createEvent: db.prepare(`
    INSERT INTO events (id, hook_id, method, headers, body, query_params, source_ip)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `),

  getEvents: db.prepare(`
    SELECT * FROM events
    WHERE hook_id = ?
    ORDER BY received_at DESC
    LIMIT ?
  `),

  getUndeliveredEvents: db.prepare(`
    SELECT * FROM events
    WHERE hook_id = ? AND delivered_at IS NULL
    ORDER BY received_at ASC
    LIMIT ?
  `),

  markEventsDelivered: db.prepare(`
    UPDATE events SET delivered_at = datetime('now') WHERE id = ?
  `),

  deleteOldEvents: db.prepare(`
    DELETE FROM events
    WHERE received_at < datetime('now', '-7 days')
  `),

  getEventCount: db.prepare(`
    SELECT COUNT(*) as count FROM events WHERE hook_id = ?
  `),
};

// Types
export interface Hook {
  id: string;
  api_key: string;
  name: string | null;
  description: string | null;
  delivery_method: 'poll' | 'nostr' | 'email';
  delivery_config: string | null;
  created_at: string;
  last_triggered_at: string | null;
  event_count: number;
}

export interface Event {
  id: string;
  hook_id: string;
  method: string;
  headers: string;
  body: string | null;
  query_params: string | null;
  source_ip: string | null;
  received_at: string;
  delivered_at: string | null;
}

// Cleanup old events periodically (called from main)
export function cleanupOldEvents(): number {
  const result = statements.deleteOldEvents.run();
  return result.changes;
}

console.log(`Database initialized at ${dbPath}`);
