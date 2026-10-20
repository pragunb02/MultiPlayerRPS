import { AvatarPicker } from "../../components/Profile/AvatarPicker.jsx";
import { ProfileVisibility } from "../../components/Profile/ProfileVisibility.jsx";
import styles from "./ProfilePage.module.css";

/**
 * Your avatar and who sees your profile (CC-034), on your own profile page, for guests and accounts alike.
 *
 * @param {{ own: ReturnType<typeof import("../../hooks/useProfile.js").useOwnProfile>, guest: boolean }} props
 */
export function PublicProfileSettings({ own, guest }) {
  let body;
  if (own.status === "loading") {
    body = <p>Loading…</p>;
  } else if (own.status === "error") {
    body = <p role="alert">Couldn&apos;t load your profile settings. {own.error.message}</p>;
  } else {
    body = (
      <>
        <AvatarPicker current={own.profile.avatar} guest={guest} onPick={own.setAvatar} />
        <ProfileVisibility profile={own.profile} onChange={own.setVisibility} />
      </>
    );
  }
  return (
    <section className={styles.publicProfile} aria-labelledby="public-profile">
      <h2 id="public-profile">Your public profile</h2>
      {body}
    </section>
  );
}
