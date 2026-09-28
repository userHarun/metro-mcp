CREATE TABLE IF NOT EXISTS gtfs_rail_stop_times (
  dataset_id TEXT NOT NULL REFERENCES gtfs_datasets(dataset_id) ON DELETE CASCADE,
  route_id TEXT NOT NULL,
  service_id TEXT NOT NULL,
  trip_id TEXT NOT NULL,
  stop_id TEXT NOT NULL,
  stop_sequence INTEGER NOT NULL,
  departure_seconds INTEGER NOT NULL CHECK (departure_seconds BETWEEN 0 AND 172799),
  headsign TEXT,
  PRIMARY KEY (dataset_id, trip_id, stop_sequence)
);

CREATE INDEX IF NOT EXISTS idx_gtfs_rail_stop_times_lookup
  ON gtfs_rail_stop_times(dataset_id, stop_id, route_id, service_id, departure_seconds);

CREATE TABLE IF NOT EXISTS gtfs_service_calendar (
  dataset_id TEXT NOT NULL REFERENCES gtfs_datasets(dataset_id) ON DELETE CASCADE,
  service_id TEXT NOT NULL,
  start_date TEXT NOT NULL,
  end_date TEXT NOT NULL,
  sunday INTEGER NOT NULL,
  monday INTEGER NOT NULL,
  tuesday INTEGER NOT NULL,
  wednesday INTEGER NOT NULL,
  thursday INTEGER NOT NULL,
  friday INTEGER NOT NULL,
  saturday INTEGER NOT NULL,
  PRIMARY KEY (dataset_id, service_id)
);

CREATE TABLE IF NOT EXISTS gtfs_service_exceptions (
  dataset_id TEXT NOT NULL REFERENCES gtfs_datasets(dataset_id) ON DELETE CASCADE,
  service_id TEXT NOT NULL,
  service_date TEXT NOT NULL,
  exception_type INTEGER NOT NULL CHECK (exception_type IN (1, 2)),
  PRIMARY KEY (dataset_id, service_id, service_date)
);
