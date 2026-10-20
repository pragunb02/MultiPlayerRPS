import { useState } from "react";
import { AVATAR_UNLOCKS, AVATARS } from "@classicade/shared";
import { Avatar } from "../../art/avatars/Avatar.jsx";
import { Bilingual } from "./Bilingual.jsx";
import { PROFILE_COPY } from "./profileCopy.js";
import styles from "./Profile.module.css";

/** The avatars a player can pick now: today every free one. Coin cosmetics (CC-143) add theirs here. */
const PICKABLE = AVATARS.filter(
  (avatar) => avatar.retired !== true && avatar.unlock.kind === AVATAR_UNLOCKS.FREE,
);

/**
 * The avatar picker on your own profile (CC-034): one radio button per avatar, so arrow keys move between them and
 * a screen reader reads each one's name. Picking one saves it at once, and says so.
 *
 * @param {{ current?: string, guest: boolean, onPick: (avatar: string) => Promise<void> }} props
 */
export function AvatarPicker({ current, guest, onPick }) {
  const [saving, setSaving] = useState("");
  const [status, setStatus] = useState({ tone: "", text: "" });

  async function pick(avatar) {
    setSaving(avatar);
    setStatus({ tone: "", text: "" });
    try {
      await onPick(avatar);
      const { name } = AVATARS.find((entry) => entry.id === avatar);
      setStatus({ tone: "done", text: `${name} is your avatar now.` });
    } catch (err) {
      setStatus({ tone: "error", text: `Couldn't save your avatar. ${err.message}` });
    } finally {
      setSaving("");
    }
  }

  return (
    <fieldset className={styles.picker} aria-busy={saving !== "" ? "true" : undefined}>
      <legend className={styles.legend}>Your avatar</legend>
      <Bilingual copy={PROFILE_COPY.pickAvatar} />
      {guest && <Bilingual copy={PROFILE_COPY.guestAvatar} />}
      <div className={styles.choices}>
        {PICKABLE.map((avatar) => (
          <label key={avatar.id} className={styles.choice}>
            <input
              type="radio"
              name="avatar"
              value={avatar.id}
              className={styles.radio}
              checked={(saving || current) === avatar.id}
              onChange={() => pick(avatar.id)}
              data-cc-control="profile.avatar"
            />
            <Avatar avatar={avatar.id} size={56} className={styles.choiceArt} />
            <span className={styles.choiceName}>{avatar.name}</span>
          </label>
        ))}
      </div>
      <p role={status.tone === "error" ? "alert" : "status"} className={styles[status.tone] ?? styles.muted}>
        {status.text}
      </p>
    </fieldset>
  );
}
