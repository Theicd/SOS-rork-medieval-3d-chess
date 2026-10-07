/**
 * S5 regression: the capture-beat watchdog budget must exceed the AUTHORED
 * VISUAL performance of the beat, not merely the sum of its phase windows.
 *
 * Before this was fixed the watchdog fired on every healthy capture on all four
 * QA surfaces. Budgets track the authored visual wall time of the duel
 * (camera frame + clash exchange + finish), not only the phase-window sum.
 *
 * These tests pin the contract that keeps the watchdog a HANG detector:
 *  - every rank's budget clears its measured visual cost with headroom,
 *  - ranged beats get the larger allowance (they pay a much longer tail),
 *  - and every budget still sits below the controller's 12s turn-loop ceiling
 *    so the scene watchdog remains the first line of defence.
 */
import { describe, expect, it } from "vitest";
import { specForCapture } from "../core/combatMachine";
import type { MoveEvent, PieceKind } from "../core/types";

/** Worst estimated visual wall time per branch after duel framing, in seconds. */
const MEASURED_MELEE_S = 8.6;
const MEASURED_RANGED_S = 9.3;

/** GameController's turn-loop ceiling. The scene watchdog must fire first. */
const CONTROLLER_CEILING_S = 12;

function captureEvent(kind: PieceKind): MoveEvent {
  return {
    from: "d2",
    to: "d7",
    kind,
    color: "w",
    san: "Qxd7+",
    capture: { kind: "p", color: "b", square: "d7" },
    promotion: null,
  } as unknown as MoveEvent;
}

const ALL_KINDS: PieceKind[] = ["p", "n", "b", "r", "q", "k"];

describe("capture beat watchdog budget", () => {
  it("produces a spec for every rank that can capture", () => {
    for (const kind of ALL_KINDS) {
      const spec = specForCapture(captureEvent(kind), 0);
      expect(spec, kind).not.toBeNull();
      expect(spec!.budget, kind).toBeGreaterThan(0);
    }
  });

  it("clears the measured visual cost of its own branch", () => {
    for (const kind of ALL_KINDS) {
      const spec = specForCapture(captureEvent(kind), 0)!;
      const measured = spec.ranged ? MEASURED_RANGED_S : MEASURED_MELEE_S;
      expect(spec.budget, `${kind} budget must exceed measured ${measured}s`).toBeGreaterThan(measured);
    }
  });

  it("keeps at least 10 percent headroom over the measured cost", () => {
    for (const kind of ALL_KINDS) {
      const spec = specForCapture(captureEvent(kind), 0)!;
      const measured = spec.ranged ? MEASURED_RANGED_S : MEASURED_MELEE_S;
      expect(spec.budget / measured, `${kind} headroom`).toBeGreaterThanOrEqual(1.1);
    }
  });

  it("gives ranged beats a larger allowance than melee at the same rank weight", () => {
    const ranged = specForCapture(captureEvent("q"), 0)!;
    const melee = specForCapture(captureEvent("r"), 0)!;
    expect(ranged.ranged).toBe(true);
    expect(melee.ranged).toBe(false);
    expect(ranged.budget).toBeGreaterThan(melee.budget);
  });

  it("still fires before the controller turn-loop ceiling", () => {
    for (const kind of ALL_KINDS) {
      const spec = specForCapture(captureEvent(kind), 0)!;
      expect(spec.budget, `${kind} must stay under the ${CONTROLLER_CEILING_S}s ceiling`).toBeLessThan(
        CONTROLLER_CEILING_S,
      );
    }
  });

  it("remains proportional to rank weight within a branch", () => {
    // A queen winds up longer than a bishop; both are ranged, so the only
    // difference is the authored window weight.
    const queen = specForCapture(captureEvent("q"), 0)!;
    const bishop = specForCapture(captureEvent("b"), 0)!;
    expect(queen.ranged && bishop.ranged).toBe(true);
    expect(queen.budget).toBeGreaterThan(bishop.budget);
  });

  it("returns null when the move is not a capture", () => {
    const quiet = { ...captureEvent("q"), capture: null } as unknown as MoveEvent;
    expect(specForCapture(quiet, 0)).toBeNull();
  });
});
