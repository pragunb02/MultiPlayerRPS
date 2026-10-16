import { Link } from "react-router";
import { paths } from "../../app/paths.js";
import { PageTitle } from "../../components/PageTitle.jsx";

export function NotFoundPage() {
  return (
    <section>
      <PageTitle>Page not found</PageTitle>
      <h1>Page not found</h1>
      <p>
        That page doesn't exist. <Link to={paths.home()}>Back to the games</Link>
      </p>
    </section>
  );
}
