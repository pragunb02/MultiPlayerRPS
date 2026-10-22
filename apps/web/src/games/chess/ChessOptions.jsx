import { CHESS_TIME_CONTROLS, DEFAULT_CHESS_TIME_CONTROL } from "@classicade/shared";

/** "Blitz: 5 min each", or "Blitz: 3 min each, +2 s a move", so the added seconds are explained (CC-349). */
const label = (id) => {
  const { initialSeconds, incrementSeconds } = CHESS_TIME_CONTROLS[id];
  const kind = id.split("-")[0];
  return `${kind[0].toUpperCase()}${kind.slice(1)}: ${initialSeconds / 60} min each${incrementSeconds ? `, +${incrementSeconds} s a move` : ""}`;
};

/** @param {{ value: { timeControl?: string }, onChange: (options: object) => void }} props */
export function ChessOptions({ value, onChange }) {
  return (
    <label>
      Clock for each player{" "}
      <select
        value={value.timeControl ?? DEFAULT_CHESS_TIME_CONTROL}
        onChange={(event) => onChange({ timeControl: event.target.value })}
      >
        {Object.keys(CHESS_TIME_CONTROLS).map((id) => (
          <option key={id} value={id}>
            {label(id)}
          </option>
        ))}
      </select>
    </label>
  );
}
