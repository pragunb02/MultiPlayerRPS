import { RPS_BEST_OF } from "@classicade/shared";

/** "1 round", or "Best of 3 (first to 2)", so a player who has not met "best of" sees what it means (CC-349). */
const roundsLabel = (n) => (n === 1 ? "1 round" : `Best of ${n} (first to ${Math.ceil(n / 2)})`);

/** @param {{ value: { bestOf?: number }, onChange: (options: object) => void }} props */
export function RpsOptions({ value, onChange }) {
  return (
    <label>
      Match length{" "}
      <select
        value={value.bestOf ?? 3}
        onChange={(event) => onChange({ bestOf: Number(event.target.value) })}
      >
        {RPS_BEST_OF.map((n) => (
          <option key={n} value={n}>
            {roundsLabel(n)}
          </option>
        ))}
      </select>
    </label>
  );
}
