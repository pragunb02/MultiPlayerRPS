import { Card } from "../../components/Card/Card.jsx";
import { Section } from "../../components/Page/Page.jsx";
import { AvatarPicker } from "../../components/Profile/AvatarPicker.jsx";
import { ProfileVisibility } from "../../components/Profile/ProfileVisibility.jsx";
import { ErrorState, Skeleton } from "../../components/States/States.jsx";

/**
 * Your avatar and who sees your profile (CC-034), on your own profile page, for guests and accounts alike.
 *
 * @param {{ own: ReturnType<typeof import("../../hooks/useProfile.js").useOwnProfile>, guest: boolean }} props
 */
export function PublicProfileSettings({ own, guest }) {
  let body;
  if (own.status === "loading") {
    body = <Skeleton label="Loading your profile settings" shape="tile" count={2} />;
  } else if (own.status === "error") {
    body = (
      <ErrorState
        title={`Couldn't load your profile settings. ${own.error.message}`}
        control="profile.public"
      />
    );
  } else {
    body = (
      <>
        <Card as="div">
          <AvatarPicker current={own.profile.avatar} guest={guest} onPick={own.setAvatar} />
        </Card>
        <Card as="div">
          <ProfileVisibility profile={own.profile} onChange={own.setVisibility} />
        </Card>
      </>
    );
  }
  return (
    <Section
      id="public-profile"
      title="Your public profile"
      description="Your avatar, and who can see your profile page."
    >
      {body}
    </Section>
  );
}
