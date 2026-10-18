import { useCallback, useState } from "react";
import { Svg } from "../../art/Svg.jsx";
import { useSound, useSoundSettings } from "../../hooks/useSound.js";
import { DEFAULT_SOUND_SETTINGS } from "../../lib/sound/soundPreferences.js";
import { SOUNDS } from "../../lib/sound/sounds.js";
import styles from "./SoundControl.module.css";
import { SoundSettings } from "./SoundSettings.jsx";

/** A small gear: the settings for each kind of sound. */
function Gear() {
  return (
    <Svg viewBox="0 0 24 24" width={18} height={18} className={styles.icon}>
      <circle cx="12" cy="12" r="3" className={styles.line} />
      <path
        d="M12 2v3M12 19v3M2 12h3M19 12h3M4.9 4.9l2.1 2.1M17 17l2.1 2.1M4.9 19.1L7 17M17 7l2.1-2.1"
        className={styles.line}
      />
    </Svg>
  );
}

/** A speaker, with sound waves when sound is on and a cross when it is off. */
function Speaker({ on }) {
  return (
    <Svg viewBox="0 0 24 24" width={20} height={20} className={styles.icon}>
      <path d="M4 9h4l5-4v14l-5-4H4z" className={styles.body} />
      {on ? (
        <path d="M16 9a4 4 0 0 1 0 6M18.5 6.5a7.5 7.5 0 0 1 0 11" className={styles.line} />
      ) : (
        <path d="M16 9l6 6M22 9l-6 6" className={styles.line} />
      )}
    </Svg>
  );
}

/**
 * The sound switch and volume slider in the header (CC-103). The button is named for what you hear now, "Sound on"
 * or "Sound off", and pressing it switches. The choice is remembered by this browser. Turning sound back on when
 * the slider sits at zero also raises it to the default level, so the switch never looks on while staying silent.
 */
export function SoundControl() {
  const sound = useSound();
  const { muted, volume } = useSoundSettings();
  const on = !muted && volume > 0;
  const [settingsOpen, setSettingsOpen] = useState(false);
  const closeSettings = useCallback(() => setSettingsOpen(false), []);

  function toggle() {
    if (on) {
      sound.setMuted(true);
      return;
    }
    if (volume === 0) {
      sound.setVolume(DEFAULT_SOUND_SETTINGS.volume);
    }
    sound.setMuted(false);
  }

  function changeVolume(event) {
    sound.setVolume(Number(event.target.value) / 100);
    // A short sample at the new level, so the player hears what they chose.
    sound.play(SOUNDS.MOVE);
  }

  return (
    <div className={styles.control}>
      <button
        type="button"
        className={styles.toggle}
        data-cc-control="header.sound"
        aria-label={on ? "Sound on" : "Sound off"}
        title={on ? "Sound on. Press to mute." : "Sound off. Press to turn it on."}
        onClick={toggle}
      >
        <Speaker on={on} />
      </button>
      <input
        type="range"
        className={styles.volume}
        aria-label="Volume"
        min={0}
        max={100}
        step={5}
        value={Math.round(volume * 100)}
        disabled={muted}
        onChange={changeVolume}
      />
      <button
        type="button"
        className={styles.settings}
        data-cc-control="header.sound_settings"
        aria-label="Sound settings"
        title="Sound settings"
        aria-haspopup="dialog"
        onClick={() => setSettingsOpen(true)}
      >
        <Gear />
      </button>
      <SoundSettings open={settingsOpen} onClose={closeSettings} />
    </div>
  );
}
