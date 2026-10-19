import { useState } from "react";
import { Button } from "../../components/Button/Button.jsx";
import { useAction } from "../../hooks/useAction.js";
import { useBlockedPlayers } from "../../hooks/useBlocks.js";
import styles from "./BlockedPlayers.module.css";

const formatDay = (ms) => new Date(ms).toLocaleDateString(undefined, { dateStyle: "medium" });

/** One blocked player with their Unblock button. */
function BlockedPlayer({ block, onUnblock }) {
  const unblock = useAction(() => onUnblock(block), { id: "profile.blocks.unblock" });
  return (
    <li className={styles.item}>
      <span className={styles.name}>{block.displayName}</span>
      <span className={styles.when}>
        blocked <time dateTime={new Date(block.blockedAt).toISOString()}>{formatDay(block.blockedAt)}</time>
      </span>
      <Button
        control="profile.blocks.unblock"
        variant="secondary"
        action={unblock}
        pendingLabel="Unblocking…"
        aria-label={`Unblock ${block.displayName}`}
      >
        Unblock
      </Button>
    </li>
  );
}

/**
 * The players this player blocked, with a way to unblock each (CC-044, ADR-053). Guests and accounts alike. Only
 * the player's own blocks are listed, never who blocked them.
 */
export function BlockedPlayers() {
  const blocked = useBlockedPlayers();
  const [unblocked, setUnblocked] = useState("");

  async function unblock(block) {
    await blocked.unblock(block.blockId);
    setUnblocked(`${block.displayName} is unblocked.`);
  }

  let body;
  if (blocked.status === "loading") {
    body = <p>Loading…</p>;
  } else if (blocked.status === "error") {
    body = <p role="alert">Couldn&apos;t load your blocked players. {blocked.error.message}</p>;
  } else if (blocked.blocks.length === 0) {
    body = <p className={styles.muted}>You haven&apos;t blocked anyone.</p>;
  } else {
    body = (
      <ul className={styles.list} aria-label="Blocked players">
        {blocked.blocks.map((block) => (
          <BlockedPlayer key={block.blockId} block={block} onUnblock={unblock} />
        ))}
      </ul>
    );
  }
  return (
    <section className={styles.section} aria-labelledby="blocked-players">
      <h2 id="blocked-players">Blocked players</h2>
      <p className={styles.muted}>Blocked players are never put in a room with you. Nobody is told.</p>
      {body}
      {unblocked !== "" && (
        <p role="status" className={styles.muted}>
          {unblocked}
        </p>
      )}
    </section>
  );
}
