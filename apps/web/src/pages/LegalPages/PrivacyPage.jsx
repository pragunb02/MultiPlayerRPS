import { Link } from "react-router";
import { paths } from "../../app/paths.js";
import { LegalPage, LegalSection } from "./LegalPage.jsx";

/**
 * The privacy policy, in plain words, written from what the server really stores (CC-046). When the code starts
 * storing something new, or keeps something for a different time, this page changes in the same pull request.
 */
export function PrivacyPage() {
  return (
    <LegalPage
      title="Privacy policy"
      intro="ClassiCade is a place to play classic games with friends. We keep only what the games need to work, we show no ads, and nothing on this site tracks you for anyone else."
    >
      <LegalSection title="1. Who looks after your data">
        <p>
          ClassiCade is run by its owner as an independent project. The owner decides what is stored and is
          responsible for it. A contact address for privacy questions will be added here before launch.
        </p>
      </LegalSection>

      <LegalSection title="2. What we store, and why">
        <ul>
          <li>
            <strong>Your session.</strong> When you choose to play, as a guest or with an account, we start a
            session: a random id in a cookie, and on our side who that id belongs to. It is how the site knows
            it is still you on the next page and in the game. Just looking around starts no session.
          </li>
          <li>
            <strong>Guests.</strong> A guest gets a random player id and a name like Guest-1234. Nothing else
            is asked or stored about a guest.
          </li>
          <li>
            <strong>Accounts.</strong> If you sign up we store your username, your email address and a
            scrambled form of your password (an scrypt hash). We never store or see the password itself. The
            email address is for logging in and is never shown to other players.
          </li>
          <li>
            <strong>Games you play.</strong> For each finished match we keep the game, the players&apos; ids
            and names, every move and the result. That is your match history, and it lets a match be replayed
            if a result is ever questioned.
          </li>
          <li>
            <strong>Progress.</strong> Your XP, level, statistics, achievements and daily quests, worked out
            from the games you play.
          </li>
          <li>
            <strong>Leaderboards.</strong> Accounts appear on the public leaderboards with their username,
            level and score. Guests never appear on a leaderboard.
          </li>
          <li>
            <strong>Moving from guest to account.</strong> If you play as a guest and then sign up or log in,
            your guest progress and match history move to your account. We keep a note that the move happened
            so it is never done twice.
          </li>
          <li>
            <strong>Accounts from the old ClassiCade.</strong> If you had an account on the earlier version of
            the site, its username, email address and password hash are still kept, so you can log in and
            carry on.
          </li>
        </ul>
      </LegalSection>

      <LegalSection title="3. Cookies">
        <p>
          We use one cookie, <code>cc.sid</code>, and only after you choose to play. It holds the random id of
          your session and nothing else. Scripts on the page cannot read it, and it is only sent over secure
          connections. It is strictly necessary for the site to work, so we do not ask for consent, and you
          can still look around without it. We use no other cookies and no browser storage, and there are no
          advertising, analytics or social media cookies.
        </p>
      </LegalSection>

      <LegalSection title="4. What we do not do">
        <ul>
          <li>No ads, no tracking pixels, no analytics services, no third party scripts or fonts.</li>
          <li>We do not sell or rent your data, and we do not share it for marketing.</li>
          <li>We do not record your IP address with your games or your account.</li>
        </ul>
      </LegalSection>

      <LegalSection title="5. Who else handles it">
        <p>Two services run the site for us and only handle data to do that:</p>
        <ul>
          <li>
            <strong>Render</strong> hosts the server. Like any web host it sees the requests your browser
            sends, including your IP address, and keeps short technical logs.
          </li>
          <li>
            <strong>MongoDB Atlas</strong> hosts the database where everything in section 2 is stored.
          </li>
        </ul>
        <p>
          Their servers may be outside your country, including in the United States. To stop one person from
          flooding the site, the server counts recent requests per IP address for a few minutes. Those counts
          are kept in memory only and are never written to the database.
        </p>
      </LegalSection>

      <LegalSection title="6. How long we keep it">
        <ul>
          <li>
            Sessions end 30 days after your last visit, and then they are deleted. Logging out ends yours at
            once.
          </li>
          <li>Open game rooms live only in the server&apos;s memory and close once they are left or idle.</li>
          <li>
            Daily quests are kept for about a week, weekly leaderboard entries for four weeks after the week.
          </li>
          <li>
            Accounts, match history, progress and achievements are kept until you ask us to delete them. Guest
            progress stays linked to its random id after the session ends, but nobody can sign in as that
            guest again.
          </li>
          <li>
            Server logs record which page was asked for and how it went, without your email or password.
          </li>
        </ul>
      </LegalSection>

      <LegalSection title="7. Your choices and rights">
        <p>
          You can play as a guest without giving us anything about you. You can ask to see the data we hold
          about you, to correct it, or to delete your account and everything linked to it. Until a delete
          button exists, ask the owner at the contact address above. Depending on where you live, you may also
          complain to your data protection authority.
        </p>
      </LegalSection>

      <LegalSection title="8. Children">
        <p>
          ClassiCade is meant for people aged 13 and over. We do not knowingly keep accounts of younger
          children, and we delete one when we learn of it.
        </p>
      </LegalSection>

      <LegalSection title="9. Changes">
        <p>
          When this policy changes, the date at the top changes too. If a change affects what we store, we say
          so on the site before it takes effect. The rules for using the site are in the{" "}
          <Link to={paths.terms()}>terms of use</Link>.
        </p>
      </LegalSection>
    </LegalPage>
  );
}
