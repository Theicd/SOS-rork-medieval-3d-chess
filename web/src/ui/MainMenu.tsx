import { Crown, Loader2, Settings as SettingsIcon } from "lucide-react";

interface MainMenuProps {
  /** One-tap play: matchmake, else AI, keep hall open for a challenger. */
  onPlay: () => void;
  onOpenSettings: () => void;
  attract: boolean;
  onInteract: () => void;
  /** True while searching for / joining a hall. */
  searching?: boolean;
  /** Short status under the Play button. */
  status?: string | null;
}

export function MainMenu({
  onPlay,
  onOpenSettings,
  attract,
  onInteract,
  searching = false,
  status = null,
}: MainMenuProps) {
  return (
    <div
      className="mc-menu pointer-events-auto absolute inset-0 flex flex-col items-center justify-center overflow-hidden px-5 py-6"
      onPointerDown={onInteract}
      onPointerMove={onInteract}
    >
      <div className="mc-unfurl mc-menu-hero mb-8 min-h-0 shrink text-center">
        <p className="mc-display text-[0.68rem] tracking-[0.55em] text-[#c8ab74]">Anno Domini MCDXCII</p>
        <h1 className="mc-display mc-title-glow mt-2 text-5xl font-bold text-[#f4e3bd] sm:text-6xl">
          KING&apos;S GAMBIT
        </h1>
        <div className="mc-rule mx-auto mt-3 w-64" />
        <p className="mt-3 text-sm italic text-[#c5b28d]">
          {attract ? "A showcase duel is under way — move to take the hall" : "Tap Play. We find a rival, or the computer."}
        </p>
      </div>

      <div className="mc-slate mc-goldleaf mc-rise flex w-full max-w-sm flex-col items-stretch p-5 sm:p-6">
        <button
          type="button"
          className="mc-btn mc-btn-primary flex w-full items-center justify-center gap-2 py-4 text-base tracking-[0.12em] disabled:opacity-60"
          disabled={searching}
          onClick={onPlay}
        >
          {searching ? (
            <>
              <Loader2 size={18} className="animate-spin" /> Looking…
            </>
          ) : (
            <>
              <Crown size={18} /> Play
            </>
          )}
        </button>

        {status ? (
          <p className="mt-3 text-center text-xs italic leading-relaxed text-[#9c8b6c]">{status}</p>
        ) : (
          <p className="mt-3 text-center text-xs italic leading-relaxed text-[#9c8b6c]">
            Online if someone is waiting · otherwise vs computer · a late rival can take the seat for 5 minutes
          </p>
        )}

        <button
          type="button"
          className="mc-btn mt-4 flex w-full items-center justify-center gap-2"
          onClick={onOpenSettings}
        >
          <SettingsIcon size={15} /> Settings
        </button>
      </div>

      <p className="mc-menu-hint mt-5 shrink-0 text-[0.68rem] tracking-[0.2em] text-[#7d6f57]">
        DRAG TO ORBIT · SCROLL TO ZOOM · CLICK A FIGURE TO COMMAND IT
      </p>
    </div>
  );
}

/** Kept for GameShell / settings advanced starts. */
export interface MatchConfig {
  mode: "ai" | "hotseat" | "demo";
  difficulty: import("../core/types").Difficulty;
  playerColor: import("../core/types").Faction;
  clockMinutes: number | null;
  demo?: import("../core/types").DemoOptions;
}
