import { RPS_BEST_OF } from "@classicade/shared";

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
            Best of {n}
          </option>
        ))}
      </select>
    </label>
  );
}
