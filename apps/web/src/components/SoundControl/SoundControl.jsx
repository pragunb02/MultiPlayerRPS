import { useCallback, useState } from "react";
import { Svg } from "../../art/Svg.jsx";
import { useDisclosureMenu } from "../../hooks/useDisclosureMenu.js";
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

/** A small chevron: the sound pill's "more" half. */
function Chevron() {
  return (
    <Svg viewBox="0 0 24 24" width={14} height={14} className={styles.icon}>
      <path d="M6 9l6 6 6-6" className={styles.line} />
    </Svg>
  );
}

/**
 * The sound switch (CC-103). The button is named for what you hear now, "Sound on" or "Sound off", and pressing it
 * switches. The choice is remembered by this browser. Turning sound back on when the slider sits at zero also raises
 * it to the default level, so the switch never looks on while staying silent.
 */
function SoundToggle() {
  const sound = useSound();
  const { muted, volume } = useSoundSettings();
  const on = !muted && volume > 0;

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

  return (
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
  );
}

/** The main volume. A short sample plays at the new level, so the player hears what they chose. */
function VolumeSlider() {
  const sound = useSound();
  const { muted, volume } = useSoundSettings();
  return (
    <input
      type="range"
      className={styles.volume}
      aria-label="Volume"
      min={0}
      max={100}
      step={5}
      value={Math.round(volume * 100)}
      disabled={muted}
      onChange={(event) => {
        sound.setVolume(Number(event.target.value) / 100);
        sound.play(SOUNDS.MOVE);
      }}
    />
  );
}

/**
 * The button that opens the settings for each kind of sound (CC-208), and their dialog. In the menu it is a round
 * gear named by its label; in the sound panel it has room for its words.
 *
 * @param {{ labelled?: boolean }} props
 */
function SettingsButton({ labelled = false }) {
  const [settingsOpen, setSettingsOpen] = useState(false);
  const closeSettings = useCallback(() => setSettingsOpen(false), []);
  return (
    <>
      <button
        type="button"
        className={labelled ? styles.settingsLabelled : styles.settings}
        data-cc-control="header.sound_settings"
        aria-label={labelled ? undefined : "Sound settings"}
        title={labelled ? undefined : "Sound settings"}
        aria-haspopup="dialog"
        onClick={() => setSettingsOpen(true)}
      >
        <Gear />
        {labelled && <span>Sound settings</span>}
      </button>
      <SoundSettings open={settingsOpen} onClose={closeSettings} />
    </>
  );
}

/**
 * The sound controls in a row, for the header's menu on a phone or a tablet (CC-259, CC-324): the switch, the volume
 * slider, which takes the width left over, and the sound settings.
 */
export function SoundControl() {
  return (
    <div className={styles.control}>
      <SoundToggle />
      <VolumeSlider />
      <SettingsButton />
    </div>
  );
}

/**
 * The sound pill in the wide header (CC-324): the switch, one press to mute, and beside it a chevron that opens a
 * small panel with the volume slider and the sound settings. The slider used to sit in the header row itself, the
 * widest control there. The panel closes on Escape, on a press outside it and on a new page (useDisclosureMenu).
 */
export function SoundPopover() {
  const { open, toggle, buttonRef, panelRef } = useDisclosureMenu();
  return (
    <div className={styles.pill}>
      <SoundToggle />
      <button
        type="button"
        ref={buttonRef}
        className={styles.more}
        data-cc-control="header.sound_more"
        aria-label="Sound options"
        title="Volume and sound settings"
        aria-expanded={open}
        aria-controls="header-sound"
        onClick={toggle}
      >
        <Chevron />
      </button>
      <section
        id="header-sound"
        ref={panelRef}
        className={styles.popover}
        aria-label="Sound options"
        hidden={!open}
      >
        {open && (
          <>
            <VolumeSlider />
            <SettingsButton labelled />
          </>
        )}
      </section>
    </div>
  );
}
