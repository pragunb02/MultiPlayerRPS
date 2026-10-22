import { useId } from "react";
import { useSound, useSoundSettings } from "../../hooks/useSound.js";
import { NOTIFICATION_CATEGORIES } from "../../lib/notify/categories.js";
import { Button } from "../Button/Button.jsx";
import { Modal } from "../Modal/Modal.jsx";
import styles from "./SoundSettings.module.css";

/** One kind of notice: its sound on or off, and how loud next to the main volume. */
function CategoryRow({ category }) {
  const sound = useSound();
  const { categories, muted } = useSoundSettings();
  const setting = categories[category.id];
  const labelId = useId();

  function changeVolume(event) {
    sound.setCategory(category.id, { volume: Number(event.target.value) / 100 });
    // A short sample of this kind of notice at its new level.
    sound.play(category.sound);
  }

  return (
    <li className={styles.row}>
      <span id={labelId} className={styles.label}>
        {category.label}
      </span>
      <label className={styles.toggle}>
        <input
          type="checkbox"
          checked={setting.on}
          aria-describedby={labelId}
          data-cc-control="sound_settings.on"
          onChange={(event) => sound.setCategory(category.id, { on: event.target.checked })}
        />
        Sound on
      </label>
      <input
        type="range"
        className={styles.volume}
        aria-label={`${category.label} volume`}
        min={0}
        max={100}
        step={10}
        value={Math.round(setting.volume * 100)}
        disabled={muted || !setting.on}
        data-cc-control="sound_settings.volume"
        onChange={changeVolume}
      />
    </li>
  );
}

/**
 * The sound settings (CC-208): for each kind of notice (requests, moves and your turn, results, rewards, other
 * players, connection) whether it makes a sound and how loud. The words and the screen reader announcement of a
 * notice always stay: only the sound is chosen here. The choices are kept by this browser (ADR-018).
 *
 * @param {{ open: boolean, onClose: () => void }} props
 */
export function SoundSettings({ open, onClose }) {
  const { muted } = useSoundSettings();
  return (
    <Modal
      surface="dialog.sound"
      open={open}
      title="Sound settings"
      onClose={onClose}
      actions={
        <Button control="sound_settings.done" onClick={onClose}>
          Done
        </Button>
      }
    >
      {muted && <p className={styles.note}>All sound is off. Turn it on with the speaker button.</p>}
      <ul className={styles.list}>
        {NOTIFICATION_CATEGORIES.map((category) => (
          <CategoryRow key={category.id} category={category} />
        ))}
      </ul>
      <p className={styles.note}>Every notice also shows on screen and is read out by screen readers.</p>
    </Modal>
  );
}
