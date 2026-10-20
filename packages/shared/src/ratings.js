/**
 * Where every chess rating starts before its first rated game: Glickman's published defaults for an unrated
 * player (glicko2.pdf, step 1a). One copy for the server's maths and its storage (CC-042, ADR-062).
 */
export const CHESS_RATING_START = Object.freeze({ rating: 1500, deviation: 350, volatility: 0.06 });
