export type WorkerEnv = Omit<Env, "METRO_GTFS_API_KEY"> & {
  METRO_GTFS_API_KEY?: string;
};
