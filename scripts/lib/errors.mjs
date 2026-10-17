/**
 * A failure the operator can fix, such as a missing secret or a wrong argument. The command line prints only its
 * message, because the message was written for a person and never contains a secret.
 */
export class OpsError extends Error {
  /**
   * @param {string} message
   * @param {{ cause?: unknown }} [options]
   */
  constructor(message, options = {}) {
    super(message, options);
    this.name = "OpsError";
  }
}
