import { LazyMotion, MotionConfig } from "motion/react";

/** Downloads the animation code after the page has shown, so it never delays the first picture. */
const loadFeatures = () => import("./motionFeatures.js").then((module) => module.default);

/**
 * Turns on Motion animations for what it wraps (ADR-016). LazyMotion keeps the bundle small: the page renders
 * with a tiny core and the `domAnimation` features arrive in a separate file a moment later (anything that
 * animates before then simply appears in place). `strict` makes any full `motion.*` component an error, so
 * nobody pulls in the whole library by accident (use `m.*`). With `reducedMotion="user"`, a player who asked
 * their system for less motion sees elements jump straight to their final place. Motion moves things by
 * setting the element's style from script, which the CSP allows (only style attributes in markup are blocked).
 *
 * @param {{ children: import("react").ReactNode }} props
 */
export function MotionProvider({ children }) {
  return (
    <LazyMotion features={loadFeatures} strict>
      <MotionConfig reducedMotion="user">{children}</MotionConfig>
    </LazyMotion>
  );
}
