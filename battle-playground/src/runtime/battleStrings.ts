/**
 * Verbatim FireRed decomp battle text strings.
 *
 * Every entry below is a copy-paste of a string definition from
 * `python-scripts/raw-assets/decomp-hacks/firered/src/battle_message.c` with its
 * file:line citation. Placeholders are kept in their decomp form
 * (`{B_ATK_NAME_WITH_PREFIX}`, `{B_BUFF1}`, etc.) — `formatBattleString`
 * substitutes them at print time. Newline `\n` and page-break `\p`
 * control characters are preserved; `BitmapFontPrinter` interprets them.
 *
 * This is intentionally a small hand-curated subset. The runner only
 * needs ~25 STRINGIDs for the move/turn loop. Generating the full table
 * via a Python parser is a follow-up if coverage grows; the citations
 * here make it easy to verify each line against the decomp later.
 */

/**
 * The minimal set of STRINGIDs the runner currently emits. Names match
 * `include/constants/battle_string_ids.h` so future-me can grep for the
 * STRINGID and find this entry.
 */
export type BattleStringId =
  | "STRINGID_USEDMOVE"
  | "STRINGID_ATTACKMISSED"
  | "STRINGID_PKMNAVOIDEDATTACK"
  | "STRINGID_PKMNPROTECTEDITSELF"
  | "STRINGID_ITDOESNTAFFECT"
  | "STRINGID_PKMNFAINTED_TARGET"
  | "STRINGID_PKMNFAINTED_ATTACKER"
  | "STRINGID_PKMNFASTASLEEP"
  | "STRINGID_PKMNISFROZEN"
  | "STRINGID_PKMNISPARALYZED"
  | "STRINGID_PKMNFLINCHED"
  | "STRINGID_PKMNIMMOBILIZEDBYLOVE"
  | "STRINGID_PKMNISCONFUSED"
  | "STRINGID_ITHURTCONFUSION"
  | "STRINGID_PKMNFELLASLEEP"
  | "STRINGID_PKMNWASPOISONED"
  | "STRINGID_PKMNWASBURNED"
  | "STRINGID_PKMNWASPARALYZED"
  | "STRINGID_PKMNWASFROZEN"
  | "STRINGID_PKMNBECAMECONFUSED"
  | "STRINGID_ATTACKERSSTATROSE"
  | "STRINGID_DEFENDERSSTATROSE"
  | "STRINGID_ATTACKERSSTATFELL"
  | "STRINGID_DEFENDERSSTATFELL"
  | "STRINGID_STATSWONTINCREASE"
  | "STRINGID_STATSWONTDECREASE"
  | "STRINGID_CRITICALHIT"
  | "STRINGID_SUPEREFFECTIVE"
  | "STRINGID_NOTVERYEFFECTIVE"
  | "STRINGID_INTROMSG_TRAINER"
  | "STRINGID_INTROSENDOUT_TRAINER"
  | "STRINGID_INTROMSG_WILD"
  | "STRINGID_GOPKMN"
  | "STRINGID_WHATWILLPKMNDO";

/**
 * Raw template strings, sourced from `battle_message.c`. Each entry
 * cites its decomp line so we can verify against fresh decomp pulls.
 *
 * `STRINGID_USEDMOVE` is special-cased in the decomp's
 * `BufferStringBattle` switch (`battle_message.c:1684`) — the actual
 * template is `sText_AttackerUsedX` at line 421:
 *   `"{B_ATK_NAME_WITH_PREFIX} used\n{B_BUFF2}"`
 * with the move name (and trailing `!`) materialised into `{B_BUFF2}`
 * via `ChooseTypeOfMoveUsedString`. We bake the `!` in here so callers
 * don't have to.
 */
export const BATTLE_STRINGS: Record<BattleStringId, string> = {
  // sText_AttackerUsedX, battle_message.c:421 (special-cased at line 1684).
  STRINGID_USEDMOVE: "{B_ATK_NAME_WITH_PREFIX} used\n{B_MOVE_NAME}!",
  // sText_AttackMissed, battle_message.c:65.
  STRINGID_ATTACKMISSED: "{B_ATK_NAME_WITH_PREFIX}'s\nattack missed!",
  // sText_PkmnAvoidedAttack, battle_message.c:69.
  STRINGID_PKMNAVOIDEDATTACK: "{B_DEF_NAME_WITH_PREFIX} avoided\nthe attack!",
  // sText_PkmnProtectedItself, battle_message.c:66.
  STRINGID_PKMNPROTECTEDITSELF: "{B_DEF_NAME_WITH_PREFIX}\nprotected itself!",
  // sText_ItDoesntAffect, battle_message.c:70.
  STRINGID_ITDOESNTAFFECT: "It doesn't affect\n{B_DEF_NAME_WITH_PREFIX}…",
  // sText_TargetFainted, battle_message.c:72.
  STRINGID_PKMNFAINTED_TARGET: "{B_DEF_NAME_WITH_PREFIX}\nfainted!\f",
  // sText_AttackerFainted, battle_message.c:71.
  STRINGID_PKMNFAINTED_ATTACKER: "{B_ATK_NAME_WITH_PREFIX}\nfainted!\f",
  // sText_PkmnFastAsleep, battle_message.c:162.
  STRINGID_PKMNFASTASLEEP: "{B_ATK_NAME_WITH_PREFIX} is fast\nasleep.",
  // sText_PkmnIsFrozen, battle_message.c:100.
  STRINGID_PKMNISFROZEN: "{B_ATK_NAME_WITH_PREFIX} is\nfrozen solid!",
  // sText_PkmnIsParalyzed, battle_message.c:106.
  STRINGID_PKMNISPARALYZED: "{B_ATK_NAME_WITH_PREFIX} is paralyzed!\nIt can't move!",
  // sText_PkmnFlinched, battle_message.c:123.
  STRINGID_PKMNFLINCHED: "{B_ATK_NAME_WITH_PREFIX} flinched!",
  // sText_PkmnImmobilizedByLove, battle_message.c:120.
  STRINGID_PKMNIMMOBILIZEDBYLOVE: "{B_ATK_NAME_WITH_PREFIX} is\nimmobilized by love!",
  // sText_PkmnIsConfused, battle_message.c:114.
  STRINGID_PKMNISCONFUSED: "{B_ATK_NAME_WITH_PREFIX} is\nconfused!",
  // sText_ItHurtConfusion, battle_message.c:337.
  STRINGID_ITHURTCONFUSION: "It hurt itself in its\nconfusion!",
  // sText_PkmnFellAsleep, battle_message.c:83.
  STRINGID_PKMNFELLASLEEP: "{B_EFF_NAME_WITH_PREFIX}\nfell asleep!",
  // sText_PkmnWasPoisoned, battle_message.c:88.
  STRINGID_PKMNWASPOISONED: "{B_EFF_NAME_WITH_PREFIX}\nwas poisoned!",
  // Burned (looked up via STRINGID_PKMNWASBURNED line in the table).
  STRINGID_PKMNWASBURNED: "{B_EFF_NAME_WITH_PREFIX} was burned!",
  // sText_PkmnWasParalyzed, battle_message.c:104.
  STRINGID_PKMNWASPARALYZED: "{B_EFF_NAME_WITH_PREFIX} is paralyzed!\nIt may be unable to move!",
  // Frozen on hit.
  STRINGID_PKMNWASFROZEN: "{B_EFF_NAME_WITH_PREFIX}\nwas frozen solid!",
  // sText_PkmnWasConfused, battle_message.c:116.
  STRINGID_PKMNBECAMECONFUSED: "{B_EFF_NAME_WITH_PREFIX} became\nconfused!",
  // sText_AttackersStatRose, battle_message.c:306.
  STRINGID_ATTACKERSSTATROSE: "{B_ATK_NAME_WITH_PREFIX}'s {B_BUFF1}\n{B_BUFF2}",
  // gText_DefendersStatRose, battle_message.c:307.
  STRINGID_DEFENDERSSTATROSE: "{B_DEF_NAME_WITH_PREFIX}'s {B_BUFF1}\n{B_BUFF2}",
  // sText_AttackersStatFell, battle_message.c:309.
  STRINGID_ATTACKERSSTATFELL: "{B_ATK_NAME_WITH_PREFIX}'s {B_BUFF1}\n{B_BUFF2}",
  // sText_DefendersStatFell, battle_message.c:310.
  STRINGID_DEFENDERSSTATFELL: "{B_DEF_NAME_WITH_PREFIX}'s {B_BUFF1}\n{B_BUFF2}",
  // sText_StatsWontIncrease, battle_message.c:110.
  STRINGID_STATSWONTINCREASE: "{B_ATK_NAME_WITH_PREFIX}'s {B_BUFF1}\nwon't go higher!",
  // sText_StatsWontDecrease, battle_message.c:111.
  STRINGID_STATSWONTDECREASE: "{B_DEF_NAME_WITH_PREFIX}'s {B_BUFF1}\nwon't go lower!",
  // sText_CriticalHit (referenced in battle_message.c:723 → sText_CriticalHit).
  STRINGID_CRITICALHIT: "A critical hit!",
  // sText_SuperEffective (battle_message.c:728).
  STRINGID_SUPEREFFECTIVE: "It's super effective!",
  // sText_NotVeryEffective (battle_message.c:727).
  STRINGID_NOTVERYEFFECTIVE: "It's not very effective…",
  // sText_Trainer1WantsToBattle, battle_message.c:388.
  STRINGID_INTROMSG_TRAINER:
    "{B_TRAINER1_CLASS} {B_TRAINER1_NAME}\nwould like to battle!\f",
  // sText_Trainer1SentOutPkmn, battle_message.c:391.
  STRINGID_INTROSENDOUT_TRAINER:
    "{B_TRAINER1_CLASS} {B_TRAINER1_NAME} sent\nout {B_OPPONENT_MON1_NAME}!",
  // sText_WildPkmnAppeared, battle_message.c:380.
  STRINGID_INTROMSG_WILD: "Wild {B_OPPONENT_MON1_NAME} appeared!\f",
  // sText_GoPkmn, battle_message.c:399.
  STRINGID_GOPKMN: "Go! {B_PLAYER_MON1_NAME}!",
  // gText_WhatWillPkmnDo, battle_message.c:1278. Shown above the 2x2
  // action-menu grid. `{B_ACTIVE_NAME_WITH_PREFIX}` expands to the
  // player's active mon nickname (never "Foe"/"Wild" — the message
  // always addresses the player's active).
  STRINGID_WHATWILLPKMNDO: "What will\n{B_ACTIVE_NAME_WITH_PREFIX} do?",
};

/**
 * Stat label table. Mirrors `gStatNamesTable` in `battle_message.c:437`,
 * indexed by pokedata3g stat id (2..8). Labels are ALL CAPS to match the
 * Gen 3 textbox convention (`sText_Attack2 = "ATTACK"`, etc.).
 */
const STAT_LABELS: Record<number, string> = {
  2: "ATTACK",
  3: "DEFENSE",
  4: "SP. ATK",
  5: "SP. DEF",
  6: "SPEED",
  7: "ACCURACY",
  8: "EVASIVENESS",
};

/**
 * Decomp B_BUFF2 verb-phrase for stat changes. Built from
 * `sText_StatSharply` / `sText_StatHarshly` + `sText_StatRose` / `sText_StatFell`.
 * Stages outside ±2 fall back to the closest match (Belly Drum's +12 → "sharply rose!").
 */
function statChangeVerb(stages: number): string {
  if (stages >= 2) return "sharply rose!";
  if (stages === 1) return "rose!";
  if (stages === -1) return "fell!";
  if (stages <= -2) return "harshly fell!";
  return "changed!";
}

/**
 * Substitution context for `formatBattleString`. The runner builds this
 * from the active battle state plus the current event before each call.
 */
export interface BattleStringContext {
  /** ALL CAPS player-active mon nickname (`{B_ACTIVE_NAME_WITH_PREFIX}`). */
  activeNameWithPrefix?: string;
  /** ALL CAPS attacker name with prefix ("BULBASAUR" or "Foe WEEDLE"). */
  atkNameWithPrefix?: string;
  /** ALL CAPS defender name with prefix. */
  defNameWithPrefix?: string;
  /** ALL CAPS effect-target name (used for status_applied lines). */
  effNameWithPrefix?: string;
  /** ALL CAPS player active mon nickname (`B_PLAYER_MON1_NAME`). */
  playerMon1Name?: string;
  /** ALL CAPS opponent active mon nickname (`B_OPPONENT_MON1_NAME`). */
  opponentMon1Name?: string;
  /** Trainer class label (`{B_TRAINER1_CLASS}`). */
  trainer1Class?: string;
  /** Trainer name (`{B_TRAINER1_NAME}`). */
  trainer1Name?: string;
  /** ALL CAPS move name. */
  moveName?: string;
  /** Generic buff slots — used for stat name (B_BUFF1) and verb (B_BUFF2). */
  buff1?: string;
  buff2?: string;
}

/**
 * Apply a stat-change context onto a base context. Looks up the stat
 * label and verb-phrase from `statId` and `stages` and stuffs them into
 * `buff1` / `buff2`. Returns a new context — does not mutate `base`.
 */
export function withStatChange(
  base: BattleStringContext,
  statId: number,
  stages: number,
): BattleStringContext {
  return {
    ...base,
    buff1: STAT_LABELS[statId] ?? `STAT${statId}`,
    buff2: statChangeVerb(stages),
  };
}

/**
 * Build the prefixed name for a battler. Mirrors the
 * `HANDLE_NICKNAME_STRING_CASE` macro in `battle_message.c:1813`:
 * non-player battlers get `"Foe "` in trainer battles or `"Wild "` in
 * wild encounters, then the mon nickname in ALL CAPS.
 */
export function nameWithPrefix(
  side: "player" | "opponent",
  rawName: string,
  isWild: boolean,
): string {
  const upper = rawName.toUpperCase();
  if (side === "player") return upper;
  return `${isWild ? "Wild " : "Foe "}${upper}`;
}

/**
 * Substitute `{B_*}` placeholders in a battle string template against
 * the supplied context. Unknown placeholders are left as-is so missing
 * context is visible in the textbox during development. Newline `\n`
 * and page-break `\p` control characters in the template are preserved
 * verbatim — `BitmapFontPrinter` is responsible for honoring them.
 */
export function formatBattleString(
  id: BattleStringId,
  ctx: BattleStringContext,
): string {
  const template = BATTLE_STRINGS[id];
  if (!template) {
    console.warn(`[battleStrings] unknown id ${id}`);
    return id;
  }
  // `\n` (line break) and `\f` (page break, used in place of the
  // decomp's `\p` control char) are preserved verbatim —
  // `BitmapFontPrinter` is responsible for honoring them at print time.
  return template.replace(/\{(B_[A-Z0-9_]+)\}/g, (match, key) => {
    switch (key) {
      case "B_ACTIVE_NAME_WITH_PREFIX":
        return ctx.activeNameWithPrefix ?? match;
      case "B_ATK_NAME_WITH_PREFIX":
        return ctx.atkNameWithPrefix ?? match;
      case "B_DEF_NAME_WITH_PREFIX":
        return ctx.defNameWithPrefix ?? match;
      case "B_EFF_NAME_WITH_PREFIX":
        return ctx.effNameWithPrefix ?? ctx.defNameWithPrefix ?? match;
      case "B_PLAYER_MON1_NAME":
        return ctx.playerMon1Name ?? match;
      case "B_OPPONENT_MON1_NAME":
        return ctx.opponentMon1Name ?? match;
      case "B_TRAINER1_CLASS":
        return ctx.trainer1Class ?? "";
      case "B_TRAINER1_NAME":
        return ctx.trainer1Name ?? "";
      case "B_MOVE_NAME":
        return ctx.moveName ?? match;
      case "B_BUFF1":
        return ctx.buff1 ?? match;
      case "B_BUFF2":
        return ctx.buff2 ?? match;
      default:
        return match;
    }
  });
}
