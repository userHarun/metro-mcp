PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS gtfs_datasets (
  dataset_id TEXT PRIMARY KEY,
  source_sha256 TEXT NOT NULL UNIQUE,
  import_schema_version TEXT NOT NULL DEFAULT 'routes-stops-v1',
  feed_version TEXT,
  feed_start_date TEXT,
  feed_end_date TEXT,
  imported_at TEXT NOT NULL,
  route_count INTEGER NOT NULL CHECK (route_count >= 0),
  stop_count INTEGER NOT NULL CHECK (stop_count >= 0)
);

CREATE TABLE IF NOT EXISTS gtfs_state (
  singleton_id INTEGER PRIMARY KEY CHECK (singleton_id = 1),
  active_dataset_id TEXT REFERENCES gtfs_datasets(dataset_id)
);

INSERT OR IGNORE INTO gtfs_state (singleton_id, active_dataset_id) VALUES (1, NULL);

CREATE TABLE IF NOT EXISTS gtfs_routes (
  dataset_id TEXT NOT NULL REFERENCES gtfs_datasets(dataset_id) ON DELETE CASCADE,
  route_id TEXT NOT NULL,
  agency_id TEXT,
  route_short_name TEXT,
  route_long_name TEXT,
  route_desc TEXT,
  route_type INTEGER NOT NULL,
  route_url TEXT,
  route_color TEXT,
  route_text_color TEXT,
  PRIMARY KEY (dataset_id, route_id)
);

CREATE INDEX IF NOT EXISTS idx_gtfs_routes_short_name ON gtfs_routes(dataset_id, route_short_name COLLATE NOCASE);
CREATE INDEX IF NOT EXISTS idx_gtfs_routes_long_name ON gtfs_routes(dataset_id, route_long_name COLLATE NOCASE);

CREATE TABLE IF NOT EXISTS gtfs_stops (
  dataset_id TEXT NOT NULL REFERENCES gtfs_datasets(dataset_id) ON DELETE CASCADE,
  stop_id TEXT NOT NULL,
  stop_code TEXT,
  stop_name TEXT NOT NULL,
  stop_desc TEXT,
  stop_lat REAL NOT NULL CHECK (stop_lat BETWEEN -90 AND 90),
  stop_lon REAL NOT NULL CHECK (stop_lon BETWEEN -180 AND 180),
  zone_id TEXT,
  stop_url TEXT,
  location_type INTEGER,
  parent_station TEXT,
  stop_timezone TEXT,
  wheelchair_boarding INTEGER,
  PRIMARY KEY (dataset_id, stop_id)
);

CREATE INDEX IF NOT EXISTS idx_gtfs_stops_code ON gtfs_stops(dataset_id, stop_code COLLATE NOCASE);
CREATE INDEX IF NOT EXISTS idx_gtfs_stops_name ON gtfs_stops(dataset_id, stop_name COLLATE NOCASE);
CREATE INDEX IF NOT EXISTS idx_gtfs_stops_location ON gtfs_stops(dataset_id, stop_lat, stop_lon);

CREATE VIRTUAL TABLE IF NOT EXISTS gtfs_stop_search USING fts5(
  dataset_id UNINDEXED,
  stop_id UNINDEXED,
  stop_name,
  stop_code,
  stop_desc,
  tokenize = 'unicode61 remove_diacritics 2'
);

CREATE TRIGGER IF NOT EXISTS gtfs_stops_after_insert AFTER INSERT ON gtfs_stops BEGIN
  INSERT INTO gtfs_stop_search(rowid, dataset_id, stop_id, stop_name, stop_code, stop_desc)
  VALUES (new.rowid, new.dataset_id, new.stop_id, new.stop_name, new.stop_code, new.stop_desc);
END;

CREATE TRIGGER IF NOT EXISTS gtfs_stops_after_delete AFTER DELETE ON gtfs_stops BEGIN
  DELETE FROM gtfs_stop_search WHERE rowid = old.rowid;
END;

CREATE TRIGGER IF NOT EXISTS gtfs_stops_after_update AFTER UPDATE ON gtfs_stops BEGIN
  DELETE FROM gtfs_stop_search WHERE rowid = old.rowid;
  INSERT INTO gtfs_stop_search(rowid, dataset_id, stop_id, stop_name, stop_code, stop_desc)
  VALUES (new.rowid, new.dataset_id, new.stop_id, new.stop_name, new.stop_code, new.stop_desc);
END;
