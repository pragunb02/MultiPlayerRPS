/** Storage-level failures every DAO reports the same way; the data layer translates them to domain errors. */
export class DuplicateKey extends Error {}
export class VersionConflict extends Error {}
