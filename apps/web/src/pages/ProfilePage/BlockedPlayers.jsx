import { useState } from "react";
import { Button } from "../../components/Button/Button.jsx";
import { Card } from "../../components/Card/Card.jsx";
import { Section } from "../../components/Page/Page.jsx";
import { EmptyState, ErrorState, Skeleton } from "../../components/States/States.jsx";
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
    body = <Skeleton label="Loading your blocked players" shape="row" />;
  } else if (blocked.status === "error") {
    body = (
      <ErrorState
        title={`Couldn't load your blocked players. ${blocked.error.message}`}
        control="profile.blocks"
      />
    );
  } else if (blocked.blocks.length === 0) {
    body = (
      <EmptyState title="You haven't blocked anyone." headingLevel={3}>
        Block a player from their seat in a room. They are never told.
      </EmptyState>
    );
  } else {
    body = (
      <Card as="div">
        <ul className={styles.list} aria-label="Blocked players">
          {blocked.blocks.map((block) => (
            <BlockedPlayer key={block.blockId} block={block} onUnblock={unblock} />
          ))}
        </ul>
      </Card>
    );
  }
  return (
    <Section
      id="blocked-players"
      title="Blocked players"
      description="Blocked players are never put in a room with you. Nobody is told."
    >
      {body}
      {unblocked !== "" && (
        <p role="status" className={styles.muted}>
          {unblocked}
        </p>
      )}
    </Section>
  );
}
