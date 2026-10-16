import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { installMatchMedia } from "../testing/matchMedia.js";
import { AchievementIcon } from "./achievements/AchievementIcon.jsx";
import { LevelBadge } from "./badges/LevelBadge.jsx";
import { RANKS, rankForLevel } from "./badges/ranks.js";
import { CONFETTI_PIECES, Confetti } from "./effects/Confetti.jsx";
import { LevelUpBurst } from "./effects/LevelUpBurst.jsx";
import { StreakFlame } from "./effects/StreakFlame.jsx";
import { XpPop } from "./effects/XpPop.jsx";
import { ChessArt } from "./games/ChessArt.jsx";
import { GameArt } from "./games/GameArt.jsx";
import { FALLBACK_GAME_ART, GAME_ART, gameArtFor } from "./games/gameArt.js";
import { GameIcon } from "./games/GameIcon.jsx";
import { GenericGameArt } from "./games/GenericGameArt.jsx";
import { RpsArt } from "./games/RpsArt.jsx";
import { TicTacToeArt } from "./games/TicTacToeArt.jsx";
import { HeroArt } from "./HeroArt.jsx";
import { EmptyMatches } from "./illustrations/EmptyMatches.jsx";
import { GameOver404 } from "./illustrations/GameOver404.jsx";
import { InviteArt } from "./illustrations/InviteArt.jsx";
import { pixelsOf, pixelWidth } from "./illustrations/pixelFont.js";
import { Logo, LogoMark } from "./Logo.jsx";
import { HandPaper } from "./rps/HandPaper.jsx";
import { HandRock } from "./rps/HandRock.jsx";
import { HandScissors } from "./rps/HandScissors.jsx";
import { MarkO } from "./tictactoe/MarkO.jsx";
import { MarkX } from "./tictactoe/MarkX.jsx";

const svgOf = (container) => container.querySelector("svg");

// Every piece of art takes an optional title: without one it is decoration, with one it is a named image.
const TITLED_ART = [
  ["Logo", Logo],
  ["LogoMark", LogoMark],
  ["RpsArt", RpsArt],
  ["TicTacToeArt", TicTacToeArt],
  ["ChessArt", ChessArt],
  ["GenericGameArt", GenericGameArt],
  ["HandRock", HandRock],
  ["HandPaper", HandPaper],
  ["HandScissors", HandScissors],
  ["MarkX", MarkX],
  ["MarkO", MarkO],
  ["EmptyMatches", EmptyMatches],
  ["InviteArt", InviteArt],
];

describe("art", () => {
  it.each(TITLED_ART)(
    "%s is decorative by default: hidden from screen readers, never focusable",
    (_name, Art) => {
      const { container } = render(<Art />);

      const svg = svgOf(container);
      expect(svg).toHaveAttribute("aria-hidden", "true");
      expect(svg).toHaveAttribute("focusable", "false");
      expect(svg).not.toHaveAttribute("role");
      expect(svg.querySelector("title")).toBeNull();
    },
  );

  it.each(TITLED_ART)("%s with a title is an image named by it", (_name, Art) => {
    render(<Art title="A picture" className="extra" />);

    const image = screen.getByRole("img", { name: "A picture" });
    expect(image).not.toHaveAttribute("aria-hidden");
    expect(image).toHaveClass("extra");
  });

  it("uses no style attribute anywhere (strict CSP)", () => {
    const { container } = render(
      <>
        <HeroArt />
        <GameOver404 />
        {Object.values(GAME_ART).map(({ Art }, index) => (
          <Art key={index} />
        ))}
        <LevelBadge level={50} />
        <AchievementIcon name="trophy" locked />
        <StreakFlame count={3} />
        <Confetti />
        <LevelUpBurst level={2} />
      </>,
    );

    expect(container.ownerDocument.querySelectorAll("[style]")).toHaveLength(0);
    expect(container.ownerDocument.querySelectorAll("style")).toHaveLength(0);
  });

  it("draws the hero scene as decoration", () => {
    const { container } = render(<HeroArt className="hero" />);

    expect(svgOf(container)).toHaveAttribute("aria-hidden", "true");
    expect(svgOf(container)).toHaveClass("hero");
  });

  it("shows the 404 screen as a named image, with a title that can be changed", () => {
    const { rerender } = render(<GameOver404 />);
    expect(screen.getByRole("img", { name: "Arcade screen: game over, page not found" })).toBeInTheDocument();

    rerender(<GameOver404 title="Game over" />);
    expect(screen.getByRole("img", { name: "Game over" })).toBeInTheDocument();
  });
});

describe("game art registry", () => {
  it("has art, a glyph and an accent for every game", () => {
    for (const gameId of ["rps", "tictactoe", "chess"]) {
      expect(gameArtFor(gameId)).toBe(GAME_ART[gameId]);
    }
    expect(Object.values(GAME_ART).map((entry) => entry.tone)).toEqual(["rps", "tictactoe", "chess"]);
  });

  it("gives an unknown game the joystick, so a newer server never breaks the catalog", () => {
    expect(gameArtFor("ludo")).toBe(FALLBACK_GAME_ART);
  });

  it("renders a game's art by id, with a title when given", () => {
    render(<GameArt gameId="chess" title="Chess" />);

    expect(screen.getByRole("img", { name: "Chess" })).toBeInTheDocument();
  });

  it("renders the joystick art for an unknown game", () => {
    const { container } = render(<GameArt gameId="ludo" className="card" />);

    expect(svgOf(container)).toHaveClass("card");
    expect(svgOf(container)).toHaveAttribute("aria-hidden", "true");
  });

  it.each([
    ["rps", "rps"],
    ["chess", "chess"],
    ["ludo", "primary"],
  ])("draws the %s icon in its accent (%s), 24 px unless asked", (gameId, tone) => {
    const { container } = render(<GameIcon gameId={gameId} />);

    expect(svgOf(container)).toHaveClass(tone);
    expect(svgOf(container)).toHaveAttribute("width", "24");
  });

  it("draws a 32 px icon with a title as a named image", () => {
    render(<GameIcon gameId="tictactoe" size={32} title="Tic Tac Toe" className="x" />);

    const icon = screen.getByRole("img", { name: "Tic Tac Toe" });
    expect(icon).toHaveAttribute("height", "32");
    expect(icon).toHaveClass("x");
  });
});

describe("rankForLevel", () => {
  it.each([
    [1, "Rookie", "bronze"],
    [4, "Rookie", "bronze"],
    [5, "Challenger", "silver"],
    [9, "Challenger", "silver"],
    [10, "Pro", "gold"],
    [19, "Pro", "gold"],
    [20, "Elite", "platinum"],
    [34, "Elite", "platinum"],
    [35, "Master", "platinum"],
    [49, "Master", "platinum"],
    [50, "Legend", "gold"],
    [100, "Legend", "gold"],
  ])("level %i is %s (%s)", (level, name, tier) => {
    expect(rankForLevel(level)).toMatchObject({ name, tier });
  });

  it("covers every level from 1 to 100 without gaps or overlaps", () => {
    RANKS.forEach((rank, index) => {
      const previous = RANKS[index - 1];
      expect(rank.minLevel).toBe(previous ? previous.maxLevel + 1 : 1);
    });
    expect(RANKS.at(-1).maxLevel).toBe(100);
  });

  it("only Master and Legend glow, only Legend has a ring", () => {
    expect(RANKS.filter((r) => r.glow).map((r) => r.name)).toEqual(["Master", "Legend"]);
    expect(RANKS.filter((r) => r.ring).map((r) => r.name)).toEqual(["Legend"]);
  });

  it.each([0, 101, 2.5, undefined, "3"])("refuses %s, which is not a level", (level) => {
    expect(() => rankForLevel(level)).toThrow(RangeError);
  });
});

describe("LevelBadge", () => {
  it("is named by rank and level, and shows the number", () => {
    render(<LevelBadge level={12} />);

    const badge = screen.getByRole("img", { name: "Pro rank, level 12" });
    expect(badge).toHaveTextContent("12");
    expect(badge).toHaveClass("md");
    expect(badge.querySelector("path")).toHaveClass("gold");
  });

  it("can be decoration next to text that already says the level", () => {
    const { container } = render(<LevelBadge level={3} size="sm" decorative className="chip" />);

    expect(svgOf(container)).toHaveAttribute("aria-hidden", "true");
    expect(svgOf(container)).toHaveClass("sm", "chip");
  });

  it("glows from Master up and rings a Legend", () => {
    const { container, rerender } = render(<LevelBadge level={35} />);
    expect(svgOf(container)).toHaveClass("glow");
    expect(svgOf(container).querySelectorAll("path")).toHaveLength(2);

    rerender(<LevelBadge level={50} />);
    expect(svgOf(container)).toHaveClass("glow");
    expect(svgOf(container).querySelector("path")).toHaveClass("sPlatinum");
  });

  it("pops in on request and fits three digits", () => {
    const { container } = render(<LevelBadge level={100} size="lg" pop />);

    expect(svgOf(container)).toHaveClass("pop", "lg");
    expect(container.querySelector("text")).toHaveClass("small");
  });
});

describe("AchievementIcon", () => {
  const NAMES = [
    "flag",
    "trophy",
    "star",
    "crown",
    "centurion",
    "flame",
    "flame-double",
    "calendar",
    "calendar-star",
    "triad",
    "fist",
    "grid",
    "knight",
    "shield",
    "scroll",
  ];

  it.each(NAMES)("draws %s on a medal of its tier", (name) => {
    const { container } = render(<AchievementIcon name={name} tier="silver" />);

    const medal = svgOf(container).querySelector("circle");
    expect(medal).toHaveClass("silver");
    expect(svgOf(container)).toHaveClass("unlocked");
  });

  it("is bronze unless told otherwise, and named when given a title", () => {
    render(<AchievementIcon name="flag" title="First Move" className="x" />);

    const icon = screen.getByRole("img", { name: "First Move" });
    expect(icon.querySelector("circle")).toHaveClass("bronze");
    expect(icon).toHaveClass("x");
  });

  it("shows a locked achievement as a grey medal with a padlock", () => {
    const { container } = render(<AchievementIcon name="crown" tier="gold" locked />);

    expect(svgOf(container)).toHaveClass("isLocked");
    expect(svgOf(container).querySelector("circle")).toHaveClass("locked");
    expect(svgOf(container).querySelectorAll("rect").length).toBeGreaterThan(0);
  });

  it("draws an unknown icon name as a star", () => {
    const unknown = render(<AchievementIcon name="no-such-icon" />).container.innerHTML;
    const star = render(<AchievementIcon name="star" />).container.innerHTML;

    expect(unknown).toBe(star);
  });
});

describe("pixel font", () => {
  it("lights the pixels of each character, left to right", () => {
    const pixels = pixelsOf("40");

    expect(pixels).toContainEqual({ x: 3, y: 0 }); // the 4's stem
    expect(pixels).toContainEqual({ x: 7, y: 0 }); // the 0 starts after a one-pixel gap
    expect(pixelWidth("40")).toBe(11);
  });

  it("refuses a character it can't draw", () => {
    expect(() => pixelsOf("?")).toThrow(RangeError);
  });
});

describe("celebration effects", () => {
  it("throws 24 pieces of confetti that never take clicks or screen-reader focus", () => {
    const { container } = render(<Confetti />);

    const overlay = container.querySelector("[data-effect='confetti']");
    expect(overlay).toHaveAttribute("aria-hidden", "true");
    expect(overlay).toHaveClass("overlay");
    expect(overlay.children).toHaveLength(CONFETTI_PIECES);
    expect(CONFETTI_PIECES).toBe(24);
  });

  it("bursts behind the new level's badge on level-up", () => {
    const { container } = render(<LevelUpBurst level={5} />);

    const burst = container.querySelector("[data-effect='level-up']");
    expect(burst).toHaveAttribute("aria-hidden", "true");
    expect(burst).toHaveTextContent("5");
    expect(burst.querySelectorAll(".rays path")).toHaveLength(12);
  });

  it("floats the XP earned", () => {
    const { container } = render(<XpPop xp={30} />);

    expect(container.querySelector("[data-effect='xp-pop']")).toHaveTextContent("+30 XP");
  });

  it("renders no confetti, burst or XP pop when the player asked for reduced motion", () => {
    installMatchMedia({ reducedMotion: true });

    const { container } = render(
      <>
        <Confetti />
        <LevelUpBurst level={2} />
        <XpPop xp={30} />
      </>,
    );

    expect(container).toBeEmptyDOMElement();
  });
});

describe("StreakFlame", () => {
  it("shows the count and tells screen readers what it is", () => {
    render(<StreakFlame count={4} className="big" />);

    expect(screen.getByText("4-day streak")).toHaveClass("visually-hidden");
    expect(screen.getByText("4")).toHaveAttribute("aria-hidden", "true");
    expect(screen.getByText("4").parentElement).toHaveClass("big");
    expect(screen.getByText("4").parentElement).not.toHaveClass("inactive");
  });

  it("is unlit at zero, and takes a custom label", () => {
    render(<StreakFlame count={0} label="No win streak yet" />);

    expect(screen.getByText("No win streak yet")).toBeInTheDocument();
    expect(screen.getByText("0").parentElement).toHaveClass("inactive");
  });
});
