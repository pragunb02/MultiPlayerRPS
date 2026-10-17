import { createSeededRng } from "../../rng.js";

/**
 * A small, fast chess board for the bot's search. chess.js decides the real game, but it spends about
 * half a millisecond listing moves because it also writes their notation, which would let the bot look
 * at only a few hundred positions per move. This board lists and plays moves in place, so the search
 * can look at tens of thousands. Tests check it against chess.js and against published move counts.
 *
 * Squares use the 0x88 layout: square = rank * 16 + file, with rank 0 being White's back rank. Any
 * square with a bit of 0x88 set is off the board, which makes edge checks a single test.
 *
 * The board is mutable on purpose and private to one search: `makeMove` and `unmakeMove` change it in
 * place instead of copying it at every step. Nothing outside the bot ever sees it.
 */

export const WHITE = 0;
export const BLACK = 1;
export const PAWN = 1;
export const KNIGHT = 2;
export const BISHOP = 3;
export const ROOK = 4;
export const QUEEN = 5;
export const KING = 6;

export const START_FEN = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1";

/** Move kinds that need more than lifting one piece and putting it down. */
export const FLAGS = Object.freeze({ NORMAL: 0, DOUBLE_PUSH: 1, EN_PASSANT: 2, CASTLE: 3 });

const CASTLE_WK = 1;
const CASTLE_WQ = 2;
const CASTLE_BK = 4;
const CASTLE_BQ = 8;

const KNIGHT_STEPS = Object.freeze([33, 31, 18, 14, -33, -31, -18, -14]);
const DIAGONALS = Object.freeze([17, 15, -17, -15]);
const STRAIGHTS = Object.freeze([16, -16, 1, -1]);
const ALL_DIRECTIONS = Object.freeze([...DIAGONALS, ...STRAIGHTS]);
const PROMOTIONS = Object.freeze([QUEEN, KNIGHT, ROOK, BISHOP]);
const LETTERS = Object.freeze({ p: PAWN, n: KNIGHT, b: BISHOP, r: ROOK, q: QUEEN, k: KING });
const TYPE_LETTERS = " pnbrqk";

export const makePiece = (color, type) => (color << 3) | type;
export const colorOf = (piece) => piece >> 3;
export const typeOf = (piece) => piece & 7;
export const rankOf = (square) => square >> 4;
export const fileOf = (square) => square & 7;
const onBoard = (square) => (square & 0x88) === 0;

export const squareName = (square) => "abcdefgh"[fileOf(square)] + (rankOf(square) + 1);
const parseSquare = (name) => (Number(name[1]) - 1) * 16 + "abcdefgh".indexOf(name[0]);

/** Which castling rights survive a move from or to each square (a king or rook moving or being taken). */
const CASTLE_MASK = new Int8Array(128).fill(15);
CASTLE_MASK[0] = 15 & ~CASTLE_WQ;
CASTLE_MASK[4] = 15 & ~(CASTLE_WK | CASTLE_WQ);
CASTLE_MASK[7] = 15 & ~CASTLE_WK;
CASTLE_MASK[112] = 15 & ~CASTLE_BQ;
CASTLE_MASK[116] = 15 & ~(CASTLE_BK | CASTLE_BQ);
CASTLE_MASK[119] = 15 & ~CASTLE_BK;

/**
 * Random keys for position fingerprints (Zobrist hashing): a position's fingerprint is the exclusive or
 * of the keys of its pieces, side to move, castling rights and en passant file, so a move updates it
 * with a handful of operations. A fixed seed keeps them identical on every run.
 */
const keyRng = createSeededRng(0x0c1a551c);
const nextKey = () => Math.floor(keyRng() * 2 ** 32) | 0;
const PIECE_KEYS = Int32Array.from({ length: 16 * 128 }, nextKey);
const CASTLE_KEYS = Int32Array.from({ length: 16 }, nextKey);
const EP_KEYS = Int32Array.from({ length: 8 }, nextKey);
const SIDE_KEY = nextKey();

const pieceKey = (piece, square) => PIECE_KEYS[piece * 128 + square];
const epKey = (ep) => (ep === -1 ? 0 : EP_KEYS[fileOf(ep)]);

/**
 * @typedef {Object} Move
 * @property {number} from
 * @property {number} to
 * @property {number} piece       the piece that moves
 * @property {number} captured    the piece taken, 0 if none
 * @property {number} promotion   the piece type promoted to, 0 if none
 * @property {number} flag        one of FLAGS
 *
 * @typedef {Object} Board
 * @property {Int8Array} squares
 * @property {number} side          WHITE or BLACK to move
 * @property {number} castling      castling rights as bits
 * @property {number} ep            en passant target square, or -1
 * @property {number} halfmove      moves since the last capture or pawn move (for the fifty move rule)
 * @property {[number, number]} kings   each side's king square
 * @property {number} hash          the position's fingerprint
 * @property {Array<{ move: Move, castling: number, ep: number, halfmove: number, hash: number }>} undo
 */

function computeHash(board) {
  let hash = CASTLE_KEYS[board.castling] ^ epKey(board.ep) ^ (board.side === BLACK ? SIDE_KEY : 0);
  board.squares.forEach((piece, square) => {
    if (piece !== 0) {
      hash ^= pieceKey(piece, square);
    }
  });
  return hash;
}

/**
 * @param {string} fen  a valid position, as chess.js writes it
 * @returns {Board}
 */
export function parseFen(fen) {
  const [placement, side, castling, ep, halfmove] = fen.split(" ");
  const squares = new Int8Array(128);
  const kings = [0, 0];
  placement.split("/").forEach((row, index) => {
    let square = (7 - index) * 16;
    for (const char of row) {
      if (char >= "1" && char <= "8") {
        square += Number(char);
      } else {
        const lower = char.toLowerCase();
        const color = char === lower ? BLACK : WHITE;
        squares[square] = makePiece(color, LETTERS[lower]);
        if (lower === "k") {
          kings[color] = square;
        }
        square += 1;
      }
    }
  });
  const rights = [..."KQkq"].reduce(
    (bits, letter, index) => (castling.includes(letter) ? bits | (1 << index) : bits),
    0,
  );
  const board = {
    squares,
    side: side === "w" ? WHITE : BLACK,
    castling: rights,
    ep: ep === "-" ? -1 : parseSquare(ep),
    halfmove: Number(halfmove),
    kings,
    hash: 0,
    undo: [],
  };
  board.hash = computeHash(board);
  return board;
}

/** Whether any piece of `by` attacks `square`. */
export function isAttacked(board, square, by) {
  const { squares } = board;
  const pawnFrom = by === WHITE ? [square - 15, square - 17] : [square + 15, square + 17];
  const pawn = makePiece(by, PAWN);
  if (pawnFrom.some((from) => onBoard(from) && squares[from] === pawn)) {
    return true;
  }
  const knight = makePiece(by, KNIGHT);
  const king = makePiece(by, KING);
  if (KNIGHT_STEPS.some((step) => onBoard(square + step) && squares[square + step] === knight)) {
    return true;
  }
  if (ALL_DIRECTIONS.some((step) => onBoard(square + step) && squares[square + step] === king)) {
    return true;
  }
  return slides(squares, square, DIAGONALS, by, BISHOP) || slides(squares, square, STRAIGHTS, by, ROOK);
}

/** Whether a `by` queen or `slider` is the first piece met along any of `directions` from `square`. */
function slides(squares, square, directions, by, slider) {
  for (const step of directions) {
    let at = square + step;
    while (onBoard(at) && squares[at] === 0) {
      at += step;
    }
    if (onBoard(at) && colorOf(squares[at]) === by) {
      const type = typeOf(squares[at]);
      if (type === slider || type === QUEEN) {
        return true;
      }
    }
  }
  return false;
}

export const inCheck = (board) => isAttacked(board, board.kings[board.side], board.side ^ 1);

const move = (from, to, piece, captured, promotion = 0, flag = FLAGS.NORMAL) => ({
  from,
  to,
  piece,
  captured,
  promotion,
  flag,
});

function pawnMoves(board, from, piece, tacticalOnly, moves) {
  const { squares, side } = board;
  const forward = side === WHITE ? 16 : -16;
  const lastRank = side === WHITE ? 7 : 0;
  const add = (to, captured, flag) => {
    if (rankOf(to) === lastRank) {
      PROMOTIONS.forEach((type) => moves.push(move(from, to, piece, captured, type)));
    } else if (!tacticalOnly || captured !== 0) {
      moves.push(move(from, to, piece, captured, 0, flag));
    }
  };
  const one = from + forward;
  if (squares[one] === 0) {
    add(one, 0, FLAGS.NORMAL);
    const startRank = side === WHITE ? 1 : 6;
    if (!tacticalOnly && rankOf(from) === startRank && squares[one + forward] === 0) {
      moves.push(move(from, one + forward, piece, 0, 0, FLAGS.DOUBLE_PUSH));
    }
  }
  for (const to of [one - 1, one + 1]) {
    if (!onBoard(to)) {
      continue;
    }
    if (squares[to] !== 0 && colorOf(squares[to]) !== side) {
      add(to, squares[to], FLAGS.NORMAL);
    } else if (to === board.ep) {
      moves.push(move(from, to, piece, makePiece(side ^ 1, PAWN), 0, FLAGS.EN_PASSANT));
    }
  }
}

function pieceMoves(board, from, piece, steps, slider, tacticalOnly, moves) {
  const { squares, side } = board;
  for (const step of steps) {
    let to = from + step;
    while (onBoard(to)) {
      const target = squares[to];
      if (target === 0) {
        if (!tacticalOnly) {
          moves.push(move(from, to, piece, 0));
        }
      } else {
        if (colorOf(target) !== side) {
          moves.push(move(from, to, piece, target));
        }
        break;
      }
      if (!slider) {
        break;
      }
      to += step;
    }
  }
}

/** Castling: rights kept, the squares between empty, and the king not in, through or into check. */
function castlingMoves(board, moves) {
  const { squares, side, castling } = board;
  const base = side === WHITE ? 0 : 112;
  const king = makePiece(side, KING);
  const enemy = side ^ 1;
  const safe = (...files) => files.every((file) => !isAttacked(board, base + file, enemy));
  const empty = (...files) => files.every((file) => squares[base + file] === 0);
  const [kingSide, queenSide] = side === WHITE ? [CASTLE_WK, CASTLE_WQ] : [CASTLE_BK, CASTLE_BQ];
  if (castling & kingSide && empty(5, 6) && safe(4, 5, 6)) {
    moves.push(move(base + 4, base + 6, king, 0, 0, FLAGS.CASTLE));
  }
  if (castling & queenSide && empty(1, 2, 3) && safe(4, 3, 2)) {
    moves.push(move(base + 4, base + 2, king, 0, 0, FLAGS.CASTLE));
  }
}

/** Every move by the side to move that obeys how pieces move, including ones that leave its king in check. */
function pseudoMoves(board, tacticalOnly) {
  const moves = [];
  const { squares, side } = board;
  for (let from = 0; from < 128; from += 1) {
    const piece = squares[from];
    if (!onBoard(from) || piece === 0 || colorOf(piece) !== side) {
      continue;
    }
    switch (typeOf(piece)) {
      case PAWN:
        pawnMoves(board, from, piece, tacticalOnly, moves);
        break;
      case KNIGHT:
        pieceMoves(board, from, piece, KNIGHT_STEPS, false, tacticalOnly, moves);
        break;
      case BISHOP:
        pieceMoves(board, from, piece, DIAGONALS, true, tacticalOnly, moves);
        break;
      case ROOK:
        pieceMoves(board, from, piece, STRAIGHTS, true, tacticalOnly, moves);
        break;
      case QUEEN:
        pieceMoves(board, from, piece, ALL_DIRECTIONS, true, tacticalOnly, moves);
        break;
      default:
        pieceMoves(board, from, piece, ALL_DIRECTIONS, false, tacticalOnly, moves);
        if (!tacticalOnly) {
          castlingMoves(board, moves);
        }
    }
  }
  return moves;
}

/**
 * The legal moves of the side to move. With `tacticalOnly`, just captures and promotions, which is what
 * the search looks at once it has reached its depth (so it never stops in the middle of an exchange).
 *
 * @param {Board} board
 * @param {{ tacticalOnly?: boolean }} [options]
 * @returns {Move[]}
 */
export function legalMoves(board, { tacticalOnly = false } = {}) {
  const mover = board.side;
  return pseudoMoves(board, tacticalOnly).filter((candidate) => {
    makeMove(board, candidate);
    const legal = !isAttacked(board, board.kings[mover], mover ^ 1);
    unmakeMove(board);
    return legal;
  });
}

function put(board, square, piece) {
  board.hash ^= pieceKey(piece, square);
  board.squares[square] = piece;
}

function lift(board, square) {
  board.hash ^= pieceKey(board.squares[square], square);
  board.squares[square] = 0;
}

/**
 * Whether an enemy pawn stands next to a pawn that just moved two squares. Only then is an en passant
 * square recorded, as chess.js does, so the same position always gets the same fingerprint.
 */
const besideEnemyPawn = (board, square, side) =>
  [square - 1, square + 1].some((next) => onBoard(next) && board.squares[next] === makePiece(side ^ 1, PAWN));

/** The rook's journey when the king castles to `kingTo`. */
const castleRook = (kingTo) => (fileOf(kingTo) === 6 ? [kingTo + 1, kingTo - 1] : [kingTo - 2, kingTo + 1]);

/**
 * Plays a move in place. Only pass moves from `legalMoves` (or the pseudo legal list it filters).
 *
 * @param {Board} board
 * @param {Move} played
 */
export function makeMove(board, played) {
  const { from, to, piece, captured, promotion, flag } = played;
  board.undo.push({
    move: played,
    castling: board.castling,
    ep: board.ep,
    halfmove: board.halfmove,
    hash: board.hash,
  });
  const side = colorOf(piece);
  if (flag === FLAGS.EN_PASSANT) {
    lift(board, to + (side === WHITE ? -16 : 16));
  } else if (captured !== 0) {
    lift(board, to);
  }
  lift(board, from);
  put(board, to, promotion === 0 ? piece : makePiece(side, promotion));
  if (flag === FLAGS.CASTLE) {
    const [rookFrom, rookTo] = castleRook(to);
    lift(board, rookFrom);
    put(board, rookTo, makePiece(side, ROOK));
  }
  if (typeOf(piece) === KING) {
    board.kings[side] = to;
  }
  board.hash ^= CASTLE_KEYS[board.castling] ^ epKey(board.ep) ^ SIDE_KEY;
  board.castling &= CASTLE_MASK[from] & CASTLE_MASK[to];
  board.ep = flag === FLAGS.DOUBLE_PUSH && besideEnemyPawn(board, to, side) ? (from + to) / 2 : -1;
  board.hash ^= CASTLE_KEYS[board.castling] ^ epKey(board.ep);
  board.halfmove = typeOf(piece) === PAWN || captured !== 0 ? 0 : board.halfmove + 1;
  board.side ^= 1;
}

/** Takes back the last move played with `makeMove`. */
export function unmakeMove(board) {
  const { move: played, castling, ep, halfmove, hash } = board.undo.pop();
  const { from, to, piece, captured, flag } = played;
  const side = colorOf(piece);
  board.squares[from] = piece;
  board.squares[to] = 0;
  if (flag === FLAGS.EN_PASSANT) {
    board.squares[to + (side === WHITE ? -16 : 16)] = captured;
  } else {
    board.squares[to] = captured;
  }
  if (flag === FLAGS.CASTLE) {
    const [rookFrom, rookTo] = castleRook(to);
    board.squares[rookTo] = 0;
    board.squares[rookFrom] = makePiece(side, ROOK);
  }
  if (typeOf(piece) === KING) {
    board.kings[side] = from;
  }
  board.castling = castling;
  board.ep = ep;
  board.halfmove = halfmove;
  board.hash = hash;
  board.side = side;
}

/** What a piece's notation adds when another piece of the same kind could also reach the square. */
function disambiguation(from, rivals) {
  if (rivals.length === 0) {
    return "";
  }
  if (rivals.every((other) => fileOf(other.from) !== fileOf(from))) {
    return "abcdefgh"[fileOf(from)];
  }
  if (rivals.every((other) => rankOf(other.from) !== rankOf(from))) {
    return String(rankOf(from) + 1);
  }
  return squareName(from);
}

/**
 * A move's standard notation without the check sign, such as "Nbd7", "exd6", "e8=Q", "O-O".
 *
 * @param {Move} played
 * @param {Move[]} legal   every legal move in the position, to tell apart pieces that could go to the same square
 */
function notation(played, legal) {
  const { from, to, piece, captured, promotion, flag } = played;
  if (flag === FLAGS.CASTLE) {
    return fileOf(to) === 6 ? "O-O" : "O-O-O";
  }
  const takes = captured === 0 ? "" : "x";
  const target = squareName(to);
  if (typeOf(piece) === PAWN) {
    const promoted = promotion === 0 ? "" : `=${TYPE_LETTERS[promotion].toUpperCase()}`;
    return `${captured === 0 ? "" : "abcdefgh"[fileOf(from)]}${takes}${target}${promoted}`;
  }
  const rivals = legal.filter((other) => other.piece === piece && other.to === to && other.from !== from);
  return `${TYPE_LETTERS[typeOf(piece)].toUpperCase()}${disambiguation(from, rivals)}${takes}${target}`;
}

/**
 * Finds the legal move written as `san` (standard notation, as chess.js writes it in game records).
 *
 * @param {Board} board
 * @param {string} san
 * @returns {Move}
 */
export function moveFromSan(board, san) {
  const wanted = san.replace(/[+#]$/, "");
  const legal = legalMoves(board);
  const found = legal.find((candidate) => notation(candidate, legal) === wanted);
  if (found === undefined) {
    throw new RangeError(`"${san}" is not a legal move in this position`);
  }
  return found;
}
