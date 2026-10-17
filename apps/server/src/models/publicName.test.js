import { describe, expect, it } from "vitest";
import { isOffensiveName, isReservedName } from "./publicName.js";

// Real names and words that look close to a listed word but must always be allowed.
const FAIR_NAMES = [
  "Riya",
  "riya_42",
  "Scunthorpe",
  "Scunthorpe_Utd",
  "Assassin",
  "classic",
  "Classic_Gamer",
  "Dickens",
  "Charles_Dickens",
  "Dickinson",
  "Cockburn",
  "Hancock",
  "Peacock",
  "Sussex",
  "Essex_Lad",
  "Therapist",
  "Grape",
  "Cumberbatch",
  "Shiitake",
  "Matsushita",
  "Penistone",
  "Pakistan",
  "Nazir",
  "Spicy",
  "Raccoon",
  "Analyst",
  "Titan",
  "Fagin",
  "Sniggered",
  "retardant",
  "Randi",
  "Lund",
  "Niki_Lauda",
  "glass_house",
  "Bass_Player",
  "As_You_Like",
  "Modern",
  "Modi",
  "Helpful_Hank",
  "Rooted",
  "Systematic",
  "Badminton_Fan",
  "Abbot",
  "Talbot",
  "TalbotFan",
  "Bottle",
  "Botany",
  "chess_fan",
  "ChessMaster",
  "Player_4821",
  "Guest-7K2Q",
];

describe("isReservedName", () => {
  it.each([
    "admin",
    "Admin",
    "ADMIN",
    "Admin_1",
    "admin1",
    "1admin",
    "a_d_m_i_n",
    "4dm1n",
    "@dmin",
    "TheAdmin",
    "Admin_Riya",
    "xXadminXx",
    "administrator",
    "mod",
    "Mod_Squad",
    "m0d",
    "moderator",
    "SuperModerator",
    "support",
    "Support_Team",
    "help",
    "Help_Desk",
    "staff",
    "Staff_99",
    "official",
    "Official_Riya",
    "system",
    "root",
    "r00t",
    "guest",
    "Guest_ABCD",
    "ClassiCade",
    "classicade_hq",
    "xXClassiCadeXx",
    "c_l_a_s_s_i_c_a_d_e",
    "NoCapGaming",
    "nocap_gaming",
  ])("reserves %j as a staff or company name", (name) => {
    expect(isReservedName(name)).toBe(true);
  });

  it.each([
    "bot",
    "Bot_7",
    "Bot_Easy",
    "BotEasy",
    "EasyBot",
    "chessbot",
    "ChessBots",
    "Chess_Bot",
    "b0t",
    "robot",
    "Robot_99",
    "cpu",
    "CPU_Player",
    "easycpu",
    "computer",
    "TheComputer",
    "npc",
  ])("reserves %j as a bot name", (name) => {
    expect(isReservedName(name)).toBe(true);
  });

  it.each([
    "rps",
    "RPS_1",
    "chess",
    "Chess_2",
    "tictactoe",
    "Tic_Tac_Toe",
    "ttt",
    "RockPaperScissors",
    "rock_paper_scissors",
  ])("reserves the game name %j", (name) => {
    expect(isReservedName(name)).toBe(true);
  });

  it.each(FAIR_NAMES.filter((name) => !name.startsWith("Guest")))("allows %j", (name) => {
    expect(isReservedName(name)).toBe(false);
  });

  it("allows a name that is only digits", () => {
    expect(isReservedName("12345")).toBe(false);
  });
});

describe("isOffensiveName", () => {
  it.each([
    "fuck",
    "FUCK",
    "fuuuuck",
    "f_u_c_k",
    "FuckYou",
    "xXfuckXx",
    "motherfucker",
    "shit",
    "5h1t",
    "sh1tt",
    "Shithead",
    "$hit",
    "bitch_99",
    "cunt",
    "c_u_n_t",
    "whore",
    "slut",
    "wanker",
    "asshole",
    "a55hole",
    "porn_king",
    "nigger",
    "n1gga",
    "faggot",
    "f4ggot",
    "retard",
    "hitler_fan",
    "chutiya",
    "madarchod",
    "ass",
    "a55",
    "aaass",
    "Big_Ass",
    "BigAss",
    "dick",
    "d1ck",
    "BigDick",
    "cock",
    "sex",
    "s3x",
    "Sex_God",
    "Tits",
    "t1t",
    "rape",
    "Nazi_Riya",
    "kys",
    "Pussy_Cat",
  ])("blocks %j", (name) => {
    expect(isOffensiveName(name)).toBe(true);
  });

  it.each(FAIR_NAMES)("allows %j", (name) => {
    expect(isOffensiveName(name)).toBe(false);
  });

  it("reads a part made only of digits as a number, not as leetspeak", () => {
    expect(isOffensiveName("Player_7117")).toBe(false);
    expect(isOffensiveName("7117")).toBe(false);
  });

  it("still blocks an allowlisted word's neighbour when it is rude on its own", () => {
    expect(isOffensiveName("Scunthorpe_shit")).toBe(true);
  });

  it("allows every fallback name a legacy player can get", () => {
    for (let number = 1000; number <= 9999; number += 1) {
      const name = `Player_${number}`;
      expect(isOffensiveName(name) || isReservedName(name), name).toBe(false);
    }
  });
});
