import { Link } from "react-router";
import { paths } from "../../app/paths.js";
import { LegalPage, LegalSection } from "./LegalPage.jsx";

/** The terms of use, in plain words, for ClassiCade as it works today (CC-046). */
export function TermsPage() {
  return (
    <LegalPage
      title="Terms of use"
      intro="By playing on ClassiCade you agree to these terms. They are short because the site is simple: play fair, be kind, and keep your account to yourself."
    >
      <LegalSection title="1. The service">
        <p>
          ClassiCade lets you play classic games such as Rock Paper Scissors, Tic Tac Toe and Chess with other
          people in your browser. It is free. There is nothing to buy and no ads.
        </p>
      </LegalSection>

      <LegalSection title="2. Who can play">
        <p>
          You can play as a guest or make an account. You need to be at least 13 years old to make an account,
          and if you are under the age of adulthood where you live, a parent or guardian should agree to these
          terms with you.
        </p>
      </LegalSection>

      <LegalSection title="3. Your account">
        <ul>
          <li>Give a real email address that you can use, and keep your password to yourself.</li>
          <li>One person, one account. Do not use someone else&apos;s account or sell yours.</li>
          <li>
            Pick a username others are happy to see. We may change or remove names that are offensive,
            impersonate someone or mislead other players.
          </li>
        </ul>
      </LegalSection>

      <LegalSection title="4. Fair play">
        <ul>
          <li>
            No cheating: no bots, engines or other help during a game, and no playing yourself on purpose.
          </li>
          <li>Do not try to break, overload or get around the site&apos;s limits and protections.</li>
          <li>Do not harass other players or use the site to spread anything unlawful.</li>
        </ul>
        <p>
          The server decides every game by its rules. If we find cheating or abuse we may reset results,
          remove entries from the leaderboards, or close the account.
        </p>
      </LegalSection>

      <LegalSection title="5. What we can promise">
        <p>
          We work to keep ClassiCade running and your progress safe, but the site is offered as it is. Games
          can be interrupted, features can change, and we cannot promise that the site will always be
          available or free of mistakes. As far as the law allows, we are not responsible for losses that come
          from using it.
        </p>
      </LegalSection>

      <LegalSection title="6. Ending things">
        <p>
          You can stop playing at any time and ask us to delete your account. We may suspend or close accounts
          that break these terms.
        </p>
      </LegalSection>

      <LegalSection title="7. Your data">
        <p>
          How we handle your data is explained in the <Link to={paths.privacy()}>privacy policy</Link>.
        </p>
      </LegalSection>

      <LegalSection title="8. Changes">
        <p>
          We may update these terms as the site grows. The date at the top shows the latest version, and
          important changes are announced on the site before they apply.
        </p>
      </LegalSection>
    </LegalPage>
  );
}
