import { Link } from "react-router";
import { PROFILE_VISIBILITY } from "@classicade/shared";
import { paths } from "../../app/paths.js";
import { useAction } from "../../hooks/useAction.js";
import { Button } from "../Button/Button.jsx";
import { Bilingual } from "./Bilingual.jsx";
import { PROFILE_COPY } from "./profileCopy.js";
import styles from "./Profile.module.css";

/**
 * Who sees your profile (CC-034, ADR-065), with your profile's own link. Every profile starts private. Only an adult
 * account can make it public. Everyone else sees why it stays hidden, and the switch says why it cannot act.
 *
 * @param {{
 *   profile: { handle: string, visibility: string, canBePublic: boolean },
 *   onChange: (visibility: "public" | "private") => Promise<void>,
 * }} props
 */
export function ProfileVisibility({ profile, onChange }) {
  const isPublic = profile.canBePublic && profile.visibility === PROFILE_VISIBILITY.PUBLIC;
  const next = isPublic ? PROFILE_VISIBILITY.PRIVATE : PROFILE_VISIBILITY.PUBLIC;
  const change = useAction(() => onChange(next), { id: "profile.visibility" });
  return (
    <section className={styles.visibility} aria-labelledby="profile-visibility">
      <h3 id="profile-visibility">Who sees your profile</h3>
      {profile.canBePublic ? (
        <>
          <Bilingual copy={isPublic ? PROFILE_COPY.publicNow : PROFILE_COPY.privateNow} />
          {!isPublic && <Bilingual copy={PROFILE_COPY.makePublic} />}
        </>
      ) : (
        <Bilingual copy={PROFILE_COPY.locked} />
      )}
      <Button
        control="profile.visibility"
        variant="secondary"
        action={change}
        pendingLabel="Saving…"
        reason={profile.canBePublic ? "" : "Only players aged 18 or over can make their profile public"}
      >
        {isPublic ? "Make my profile private" : "Make my profile public"}
      </Button>
      <p className={styles.muted}>
        <Bilingual copy={PROFILE_COPY.link} as="span" />:{" "}
        <Link to={paths.player(profile.handle)} data-cc-control="profile.public_link">
          {paths.player(profile.handle)}
        </Link>
      </p>
    </section>
  );
}
