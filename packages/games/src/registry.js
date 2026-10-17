/**
 * Looks engines up by game id. This is where games plug in: rooms, matches and sockets only ever ask the
 * registry, so a new game needs no changes anywhere else.
 *
 * @param {ReadonlyArray<Readonly<import("./engine.js").GameEngine<any, any, any>>>} engines
 */
export function createEngineRegistry(engines) {
  const byId = new Map();
  for (const engine of engines) {
    if (byId.has(engine.id)) {
      throw new TypeError(`Duplicate game engine id "${engine.id}"`);
    }
    byId.set(engine.id, engine);
  }

  return Object.freeze({
    /** @param {string} id */
    has: (id) => byId.has(id),
    /**
     * @param {string} id  must be a registered id. Check `has` (or validate against the catalog) first.
     */
    get(id) {
      const engine = byId.get(id);
      if (engine === undefined) {
        throw new RangeError(`No game engine registered for "${id}"`);
      }
      return engine;
    },
    ids: () => Object.freeze([...byId.keys()]),
  });
}
