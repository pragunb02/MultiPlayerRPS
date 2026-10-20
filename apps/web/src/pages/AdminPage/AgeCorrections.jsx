import { useState } from "react";
import { SITE_NAME } from "@classicade/shared";
import { useServices } from "../../app/servicesContext.js";
import { Button } from "../../components/Button/Button.jsx";
import { Field } from "../../components/Field/Field.jsx";
import { YEAR_NOT_SAID, YearSelect } from "../../components/YearSelect/YearSelect.jsx";
import { useAction } from "../../hooks/useAction.js";
import { ConsoleTabs } from "./ConsoleTabs.jsx";
import consoleStyles from "./AdminPage.module.css";

/** What the account is after a correction, in the owner's words. */
const outcomeOf = ({ username, birthYear, ageGroup }) =>
  `${username}: ${birthYear === undefined ? "no year of birth" : `year of birth ${birthYear}`}, so ${ageGroup}.`;

/**
 * The owner's corrections of a player's year of birth (CC-152, ADR-048.9). A player sets the year once, so a mistake
 * comes to the owner, who checks the request first (for example a message from the account's own email) and then
 * corrects or clears the year here. Clearing makes the account of unknown age again, so its player can set it once
 * more. The server refuses an under 13 year: that account is deleted instead.
 */
export function AgeCorrections() {
  const { api } = useServices();
  const [email, setEmail] = useState("");
  const [year, setYear] = useState(YEAR_NOT_SAID);
  const [done, setDone] = useState("");
  const send = (birthYear) => async () => {
    setDone("");
    setDone(outcomeOf(await api.correctBirthYear({ email: email.trim(), birthYear })));
  };
  const correct = useAction(send(year === YEAR_NOT_SAID ? null : Number(year)), {
    id: "admin.ages.correct",
  });
  const clear = useAction(send(null), { id: "admin.ages.clear" });
  const noEmail = email.trim() === "" ? "Enter the account's email first" : "";

  return (
    <section className={consoleStyles.page} aria-labelledby="ages-title">
      <title>{`Ages · Owner console · ${SITE_NAME}`}</title>
      <meta name="robots" content="noindex, nofollow" />
      <header className={consoleStyles.header}>
        <h1 id="ages-title">Birth year corrections</h1>
        <p className={consoleStyles.lede}>
          Players set their year once. Correct it only after checking the request, such as a message from the
          account&apos;s own email. The year is never logged.
        </p>
      </header>
      <ConsoleTabs current="ages" />
      <form className={consoleStyles.range} onSubmit={(event) => event.preventDefault()} noValidate>
        <Field
          label="Account email"
          type="email"
          autoComplete="off"
          value={email}
          onChange={(event) => setEmail(event.target.value)}
        />
        <YearSelect
          control="admin.ages.year"
          currentYear={new Date().getFullYear()}
          value={year}
          onChange={setYear}
        />
        <Button
          control="admin.ages.correct"
          action={correct}
          reason={noEmail || (year === YEAR_NOT_SAID ? "Choose a year first" : "")}
        >
          Correct the year
        </Button>
        <Button control="admin.ages.clear" variant="secondary" action={clear} reason={noEmail}>
          Clear the year
        </Button>
      </form>
      {done !== "" && (
        <p role="status" data-cc-slot="ages-result">
          {done}
        </p>
      )}
    </section>
  );
}
