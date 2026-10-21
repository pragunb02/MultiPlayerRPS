/**
 * The two chess colours, as the server names them ("w" and "b"). Kept apart from chessGame.js, which imports
 * chess.js, so a screen that only needs these words, such as the daily puzzle card on home, never downloads the
 * chess library (CC-322).
 */
export const colourName = (colour) => (colour === "w" ? "white" : "black");
export const opposite = (colour) => (colour === "w" ? "b" : "w");
