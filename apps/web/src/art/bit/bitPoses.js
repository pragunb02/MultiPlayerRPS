/**
 * Bit's poses, named as in the story scripts (docs/story/STORY_MODE.md section 3). Idle is the resting pose.
 * Sad is gentle and kind: Bit never cries and is never angry.
 */
export const BIT_POSES = Object.freeze(["idle", "happy", "sad", "thinking", "surprised", "cheer"]);

/** What a screen reader hears for each pose when the picture means something. */
export const BIT_POSE_NAMES = Object.freeze({
  idle: "Bit the arcade robot",
  happy: "Bit the arcade robot, happy",
  sad: "Bit the arcade robot, a little sad",
  thinking: "Bit the arcade robot, thinking",
  surprised: "Bit the arcade robot, surprised",
  cheer: "Bit the arcade robot, cheering",
});
