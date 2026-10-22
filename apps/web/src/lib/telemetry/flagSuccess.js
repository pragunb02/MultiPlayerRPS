/**
 * The flags' one success each (CC-312), told when the server really took a batch (review of #162): `telemetry_client`
 * at the first batch taken, and `interruption_counts` at the first batch taken that held an interruption. A count that
 * fails to send is not tried again.
 *
 * @param {{ sendFlagSuccess: (name: string) => Promise<unknown> }} api
 * @returns {(events: ReadonlyArray<{ name: string }>) => void} told with each batch the server took
 */
export function countFlagSuccesses(api) {
  let client = false;
  let interruptions = false;
  const send = (name) => api.sendFlagSuccess(name).catch(() => undefined);
  return (events) => {
    if (!client) {
      client = true;
      send("telemetry_client");
    }
    if (!interruptions && events.some(({ name }) => name === "interruption_ended")) {
      interruptions = true;
      send("interruption_counts");
    }
  };
}
