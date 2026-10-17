import { useCallback, useRef, useState } from "react";
import { squareAtPoint, squareForKey } from "./chessGame.js";

/** How far (in CSS pixels) a pointer must travel before a press becomes a drag, so a shaky click stays a click. */
const DRAG_THRESHOLD_PX = 4;

/** The board's inside box on screen: squares and the floating piece live inside its border. */
function innerBox(board) {
  const rect = board.getBoundingClientRect();
  return {
    left: rect.left + board.clientLeft,
    top: rect.top + board.clientTop,
    width: board.clientWidth,
    height: board.clientHeight,
  };
}

const squareOf = (target) => target.closest("[data-square]")?.dataset.square ?? "";

/**
 * Everything a player does with the board: click (or tap) a piece then a square, drag a piece and drop it, or
 * walk the board with the arrow keys, Home and End, and press Enter or Space. All three end in `onMove`, and only
 * with a legal move.
 *
 * Clicks, taps and Enter all arrive as `click` events on the square buttons. A drag is tracked with pointer
 * events on the board. Once it has really moved, the board captures the pointer, so the button under the drop
 * point never sees a click. The click that some browsers still send after a drag is ignored once.
 *
 * @param {{
 *   chess: import("chess.js").Chess,
 *   colour: "w" | "b",
 *   orientation: "w" | "b",
 *   interactive: boolean,
 *   onMove: (move: { from: string, to: string, promotion?: string }, how: { dragged: boolean }) => void,
 *   onRefuse: (why: "closed" | "not-yours" | "illegal") => void,
 * }} input  `onRefuse` hears about a click that cannot do anything, so the board can say why (CC-164): the
 *   board is closed to this player now, the square holds no piece of theirs, or the move is not legal
 */
export function useBoardInput({ chess, colour, orientation, interactive, onMove, onRefuse }) {
  const [selected, setSelected] = useState("");
  const [drag, setDrag] = useState({ from: "", over: "" });
  const [promotion, setPromotion] = useState({ from: "", to: "" });
  const [cursor, setCursor] = useState(orientation === "w" ? "a1" : "h8");
  const boardRef = useRef(null);
  const ghostRef = useRef(null);
  const attachBoard = useCallback((node) => {
    boardRef.current = node;
  }, []);
  // The press being tracked. It is kept outside React state because pointer moves arrive far faster than the
  // screen can redraw.
  const press = useRef(undefined);
  const ignoreNextClick = useRef(false);

  const ownPieceOn = (square) => chess.get(square)?.color === colour;
  const from = drag.from !== "" ? drag.from : selected;
  const targets = interactive && from !== "" ? chess.moves({ square: from, verbose: true }) : [];

  /**
   * Plays the move from `start` to `end` if it is legal. A promotion first asks which piece. Returns whether
   * the move was legal.
   */
  function attempt(start, end, dragged) {
    const candidates = chess.moves({ square: start, verbose: true }).filter((m) => m.to === end);
    if (candidates.length === 0) {
      return false;
    }
    if (candidates[0].promotion) {
      setPromotion({ from: start, to: end });
    } else {
      onMove({ from: start, to: end }, { dragged });
    }
    return true;
  }

  function click(square, event) {
    // Keyboard clicks have no pointer behind them (detail 0) and are never the tail of a drag.
    if (ignoreNextClick.current && event.detail !== 0) {
      ignoreNextClick.current = false;
      return;
    }
    if (!interactive) {
      onRefuse("closed");
      return;
    }
    if (ownPieceOn(square)) {
      setSelected(square === selected ? "" : square);
      return;
    }
    setSelected("");
    if (selected === "") {
      onRefuse("not-yours");
    } else if (!attempt(selected, square, false)) {
      onRefuse("illegal");
    }
  }

  /**
   * Moves the floating piece under the pointer. It sets the element's style from script, which the CSP allows
   * (only style attributes written in the markup are blocked).
   */
  const placeGhost = useCallback((node) => {
    ghostRef.current = node;
    const current = press.current;
    if (node === null || current === undefined || boardRef.current === null) {
      return;
    }
    const rect = innerBox(boardRef.current);
    const half = rect.width / 16;
    node.style.transform = `translate(${current.x - rect.left - half}px, ${current.y - rect.top - half}px)`;
  }, []);

  function pointerDown(event) {
    ignoreNextClick.current = false;
    const square = squareOf(event.target);
    if (!interactive || event.button !== 0 || !ownPieceOn(square)) {
      return;
    }
    press.current = {
      from: square,
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      x: event.clientX,
      y: event.clientY,
      active: false,
    };
  }

  function pointerMove(event) {
    const current = press.current;
    if (current === undefined || current.pointerId !== event.pointerId) {
      return;
    }
    current.x = event.clientX;
    current.y = event.clientY;
    if (!current.active) {
      const distance = Math.hypot(event.clientX - current.startX, event.clientY - current.startY);
      if (distance < DRAG_THRESHOLD_PX) {
        return;
      }
      current.active = true;
      boardRef.current.setPointerCapture(event.pointerId);
    }
    placeGhost(ghostRef.current);
    const over = squareAtPoint({
      rect: innerBox(boardRef.current),
      x: event.clientX,
      y: event.clientY,
      orientation,
    });
    if (over !== drag.over || drag.from !== current.from) {
      setDrag({ from: current.from, over });
    }
  }

  function endDrag() {
    press.current = undefined;
    setDrag({ from: "", over: "" });
  }

  function pointerUp(event) {
    const current = press.current;
    if (current === undefined || current.pointerId !== event.pointerId) {
      return;
    }
    endDrag();
    if (!current.active) {
      // A plain click. The click event that follows handles it.
      return;
    }
    ignoreNextClick.current = true;
    const target = squareAtPoint({
      rect: innerBox(boardRef.current),
      x: event.clientX,
      y: event.clientY,
      orientation,
    });
    const played = target !== current.from && attempt(current.from, target, true);
    // A drop on an illegal square snaps back, and the piece stays picked up so a click can finish the move.
    setSelected(played ? "" : current.from);
  }

  function keyDown(event) {
    if (event.key === "Escape") {
      endDrag();
      setSelected("");
      return;
    }
    const next = squareForKey({
      square: cursor,
      key: event.key,
      ctrl: event.ctrlKey || event.metaKey,
      orientation,
    });
    if (next === "") {
      return;
    }
    // These keys would scroll the page. On the board they only move the cursor.
    event.preventDefault();
    setCursor(next);
    boardRef.current.querySelector(`[data-square="${next}"]`).focus();
  }

  const cancelPromotion = useCallback(() => setPromotion({ from: "", to: "" }), []);

  function choosePromotion(piece) {
    const chosen = { from: promotion.from, to: promotion.to, promotion: piece };
    setPromotion({ from: "", to: "" });
    onMove(chosen, { dragged: false });
  }

  return {
    selected: interactive ? selected : "",
    dragging: drag.from,
    over: drag.over,
    targets: promotion.to === "" ? targets : [],
    cursor,
    promotion,
    attachBoard,
    attachGhost: placeGhost,
    focus: setCursor,
    click,
    choosePromotion,
    cancelPromotion,
    handlers: {
      onPointerDown: pointerDown,
      onPointerMove: pointerMove,
      onPointerUp: pointerUp,
      onPointerCancel: endDrag,
      onKeyDown: keyDown,
    },
  };
}
