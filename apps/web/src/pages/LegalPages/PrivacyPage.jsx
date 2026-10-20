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
          responsible for it. For privacy questions or requests, open an issue at{" "}
          <a href="https://github.com/pragunb02/MultiPlayerRPS/issues" data-cc-control="legal.contact">
            github.com/pragunb02/MultiPlayerRPS/issues
          </a>{" "}
          saying only that you have a privacy request. Do not put your email, username or anything personal in
          it: the owner will reply and continue the conversation privately.
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
            <strong>Year of birth, if you want.</strong> When you sign up, or later in your profile, you can
            give the year you were born. We keep the year only, never a date, and you can say nothing. We use
            it for one thing: whether you are an adult. If you are under 18, or have not said, we treat you as
            under 18 and show &quot;Hidden player&quot; instead of your username on the public leaderboards.
            We do not accept an account from someone who tells us they are under 13.
          </li>
          <li>
            <strong>Games you play.</strong> For each finished match we keep the game, the players&apos; ids
            and names, every move and the result. That is your match history, and it lets a match be replayed
            if a result is ever questioned.
          </li>
          <li>
            <strong>Game rooms.</strong> While a room is open we store it in our database: the game, the room
            code, the players&apos; ids and names, every move with its time, and the result. That is how a
            game carries on when the server restarts. A room is deleted 30 minutes to 24 hours after the last
            activity: 30 minutes for a room nobody joined or a finished game, 2 hours when every player is
            away, 24 hours when a game sits open with nobody moving. It is deleted at once when the last
            player leaves. A short note that the room closed (its code, game and why) stays for 24 hours, so
            an old link can say what happened.
          </li>
          <li>
            <strong>A daily code for your network.</strong> So that one network cannot open hundreds of rooms,
            each room also keeps a short code worked out from the IP address of the player who opened it, with
            a key that is random, kept only in the server&apos;s memory and replaced every day (UTC). A key
            names rooms for one day, is kept one more day only to count them, and is then deleted. The address
            itself is never stored. Once a key is deleted, nobody, not even us, can turn its codes back into
            an address. The code is deleted with the room.
          </li>
          <li>
            <strong>Progress.</strong> Your XP, level, statistics, achievements and daily quests, worked out
            from the games you play.
          </li>
          <li>
            <strong>Chess rating.</strong> Your chess rating and its last 200 changes, worked out from the
            counted chess games you play against people. Your opponent and anyone watching the room see your
            rating next to your name.
          </li>
          <li>
            <strong>Leaderboards.</strong> Accounts and guests appear on the public leaderboards with their
            level and score. The username shows only for adults: for anyone under 18, or who has not given a
            year of birth, the board shows &quot;Hidden player&quot; instead. A guest shows the name we gave
            it, such as Guest-7K2Q, which it did not choose and which says nothing about it. A guest&apos;s
            places move to the account it signs up for.
          </li>
          <li>
            <strong>Your profile and avatar.</strong> You can pick one of our avatars. Everyone you play with
            sees it beside your name. Your profile has its own random link, which says nothing about who you
            are. It starts private: others see only your name and avatar. If you are 18 or over you can make
            it public, and then anyone with the link sees your name, avatar, level, games, wins and chess
            rating, never your email, age or history. For anyone under 18, a guest, or anyone who has not
            given a year of birth, the profile shows &quot;Hidden player&quot; with the avatar they picked,
            and nothing else. We keep it until you delete your account.
          </li>
          <li>
            <strong>Players you block.</strong> When you block a player, we store that you blocked them, the
            name they had and when, until you unblock them or either account is deleted. The blocked player is
            never told, and only you can see your list.
          </li>
          <li>
            <strong>Players you report.</strong> When you report a player, we store who you reported (by their
            player id, which only our server sees), the name they had, the reason you picked, your note if you
            wrote one, where it happened (a room, a past game or a profile) and the last few moves and
            requests between you, with nobody named. Before your note is saved, any email address or phone
            number in it is replaced with a marker. We keep it so the site&apos;s owner can look at it and, if
            a name breaks the rules, give that account a safe name. The reported player is never told, and
            never learns who reported them. Reports are deleted 180 days after they were made. If you delete
            your account, your reports stay without your name or your note, and reports about you are deleted.
          </li>
          <li>
            <strong>Feedback.</strong> When you send feedback with the Feedback button, we store its type,
            your message, the page you were on (never a room code or a name), the app version, the kind of
            device (phone, tablet or computer) and whether you were a visitor, a guest or signed in. We keep
            it to find and fix what is broken and to learn what players want. Before your message is saved,
            any email address or phone number in it is replaced with a marker. We never store your player id,
            your IP address or your browser details with it. A signed-in adult who asks for a reply can leave
            an email address, and we keep it with the message to reply. Only the site's owner reads feedback,
            in the owner console, and can delete any of it. Feedback is deleted 180 days after it was sent. It
            is not linked to your account, so it is not in your data export and deleting your account cannot
            find it: to have it deleted sooner, ask the owner at the contact address above.
          </li>
          <li>
            <strong>Daily puzzles.</strong> When you make a move or take a hint in a daily puzzle, we store
            how that day&apos;s puzzle went for you: the moves you found, your mistakes and hints, and your
            puzzle streak, until you delete your account. Just looking at a puzzle stores nothing. The result
            you can share names nobody and shows no move.
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
          can still look around without it. We use no other cookies, and there are no advertising, analytics
          or social media cookies.
        </p>
        <p>
          Your browser also keeps one setting for this site, <code>cc.sound</code>: whether sound is on and
          how loud. It is stored only in your browser, is never sent to us, and contains nothing about you.
          Clearing your browser's site data removes it.
        </p>
      </LegalSection>

      <LegalSection title="4. What we do not do">
        <ul>
          <li>No ads, no tracking pixels, no third party analytics, no third party scripts or fonts.</li>
          <li>
            We do not count how you use the site. If we ever do, it will be anonymous counts on our own
            server, with no id for you or your browser and a way to switch it off, and this page will say so
            before it starts.
          </li>
          <li>We do not sell or rent your data, and we do not share it for marketing.</li>
          <li>
            We do not store your IP address in our database or in our own logs. Rooms keep only the daily code
            in section 2.
          </li>
        </ul>
      </LegalSection>

      <LegalSection title="5. Who else handles it">
        <p>Four services run the site for us and only handle data to do that:</p>
        <ul>
          <li>
            <strong>Render</strong> hosts the server. Like any web host it sees the requests your browser
            sends, including your IP address, and keeps short technical logs.
          </li>
          <li>
            <strong>MongoDB Atlas</strong> hosts the database where everything in section 2 is stored.
          </li>
          <li>
            <strong>GitHub</strong> runs our backups. Every night GitHub Actions makes an encrypted copy of
            the whole database and puts it in a storage bucket the owner rents. The copy is locked on the way,
            so only the owner can open it, and the bucket&apos;s provider only ever holds locked data. Each
            copy is deleted after 30 days.
          </li>
          <li>
            <strong>Grafana Labs</strong> (Grafana Cloud, India region) receives counts and timings about how
            the server runs, and the names of its warnings and errors. Never your IP address, email, player
            id, name, room code, cookies or session. We use it to see when the site is slow or failing.
          </li>
        </ul>
        <p>Their servers may be outside your country, including in the United States.</p>
        <p>
          To stop one person from flooding the site, the server counts recent requests and connections per IP
          address, for 1 minute to 1 day, and for as long as a connection stays open. To protect accounts from
          password guessing, it also counts wrong passwords for 15 minutes, and it remembers for 30 days which
          networks signed in to each account, up to 10 per account, so a network you use is never slowed down
          during an attack on your account. For logins it keeps only keyed hashes made with a random key,
          never the email or the address itself. All of this lives in the server&apos;s memory only, is not
          saved anywhere, and is forgotten when the server restarts.
        </p>
      </LegalSection>

      <LegalSection title="6. How long we keep it">
        <ul>
          <li>
            Sessions end 30 days after your last visit. A signed-in session also ends 90 days after you sign
            in, and when the password is changed or &quot;sign out other devices&quot; is used on another
            device. Logging out ends and deletes yours at once. Any other ended session is deleted about 30
            days after its last use.
          </li>
          <li>
            Game rooms are kept 30 minutes to 24 hours after the last activity, and the note that a room
            closed 24 hours more (section 2).
          </li>
          <li>
            Daily quests are kept for about a week, weekly leaderboard entries for four weeks after the week.
            A guest&apos;s leaderboard places are kept 30 days after its last counted game.
          </li>
          <li>
            Accounts, match history, progress, achievements and daily puzzle days are kept until you delete
            your account. Guest progress stays linked to its random id after the session ends, but nobody can
            sign in as that guest again.
          </li>
          <li>
            Backups hold a copy of everything above for 30 days. Something deleted from the database is gone
            from the backups 30 days later.
          </li>
          <li>
            Server logs record each request (what was asked for, how it went and how long it took) and events
            such as signing up, logging in, joining a room and finishing a match, with the player id, room
            code or match id involved. Our own log lines never hold your IP address, email or password. Render
            keeps them for 7 to 14 days, depending on the plan.
          </li>
          <li>
            Counts and timings about how the server runs are kept for 14 days by Grafana Labs (section 5).
          </li>
        </ul>
      </LegalSection>

      <LegalSection title="7. Your choices and rights">
        <p>
          You can play as a guest without giving us anything about you. You can ask to see the data we hold
          about you, to correct it, or to delete your account and everything linked to it. You can download
          your data or delete your account yourself, as the next section says. For anything else, ask the
          owner at the contact address above. Depending on where you live, you may also complain to your data
          protection authority.
        </p>
      </LegalSection>

      <LegalSection title="Deleting your account and downloading your data">
        <p>
          With an account, your{" "}
          <Link to={paths.profile()} data-cc-control="legal.profile">
            profile
          </Link>{" "}
          has two buttons, each asking for your password again:
        </p>
        <ul>
          <li>
            <strong>Download my data</strong> gives you a file (JSON) with your account, your games, progress,
            chess rating, achievements, quests, daily puzzle days, leaderboard places, your profile and avatar
            the players you blocked and the reports you made. Other players appear in it by their display name
            only.
          </li>
          <li>
            <strong>Delete my account</strong> deletes it at once, with your progress, chess rating,
            achievements, quests, daily puzzle days, leaderboard places, profile, blocks, reports about you
            and sessions, and signs you out everywhere. Games you played against other people stay in their
            history with your name replaced by &quot;Deleted player&quot;. A game you are in at that moment
            ends, and your opponent wins. Games against the computer only are deleted. If your account came
            from the earlier version of the site, that old record is closed so it can never sign in again.
          </li>
        </ul>
        <p>
          Every night the database is copied into an encrypted backup, and each backup is deleted after 30
          days. So a deleted account is gone from the backups within 30 days. If we ever restore a backup, we
          delete again every account that was deleted after it was made.
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
          <Link to={paths.terms()} data-cc-control="legal.terms">
            terms of use
          </Link>
          .
        </p>
      </LegalSection>
    </LegalPage>
  );
}
