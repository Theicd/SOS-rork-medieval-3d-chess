import { Crown, Loader2, Settings as SettingsIcon } from "lucide-react";

const ORIGINAL_REPO = "https://github.com/ade5791/rork-medieval-3d-chess";

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
      className="mc-menu pointer-events-auto absolute inset-0 flex flex-col items-center overflow-hidden px-5"
      onPointerDown={onInteract}
      onPointerMove={onInteract}
    >
      <div className="mc-topbar">
        <div className="mc-topbar-spacer" />
        <button
          type="button"
          className="mc-gear"
          title="Settings"
          aria-label="Settings"
          onPointerDown={(e) => e.stopPropagation()}
          onClick={(e) => {
            e.stopPropagation();
            onOpenSettings();
          }}
        >
          <SettingsIcon size={24} strokeWidth={2.2} />
        </button>
      </div>

      <div className="mc-menu-hero mc-unfurl shrink-0 pt-[max(4.5rem,12vh)] text-center">
        <p className="mc-display text-[0.68rem] tracking-[0.55em] text-[#c8ab74]">Anno Domini MCDXCII</p>
        <h1 className="mc-display mc-title-glow mt-2 text-5xl font-bold text-[#f4e3bd] sm:text-6xl">
          KING&apos;S GAMBIT
        </h1>
        <div className="mc-rule mx-auto mt-3 w-56 opacity-80" />
        <p className="mt-3 text-sm italic text-[#c5b28d]">
          {attract ? "A showcase duel is under way — move to take the hall" : "Tap Play. We find a rival, or the computer."}
        </p>
      </div>

      <div className="mc-menu-spacer flex-1" />

      <div className="mc-play-dock mc-rise shrink-0 pb-[max(1.25rem,env(safe-area-inset-bottom))]">
        <button
          type="button"
          className="mc-play-fab disabled:opacity-55"
          disabled={searching}
          onClick={onPlay}
        >
          {searching ? (
            <>
              <Loader2 size={20} className="animate-spin" /> Looking…
            </>
          ) : (
            <>
              <Crown size={20} /> Play
            </>
          )}
        </button>
        <p className="mc-play-hint">
          {status ?? "Online if someone is waiting · otherwise vs computer"}
        </p>
      </div>

      <p className="mc-menu-hint shrink-0 pb-3 text-[0.62rem] tracking-[0.18em] text-[#7d6f57]/80">
        DRAG TO ORBIT · SCROLL TO ZOOM · CLICK A FIGURE
      </p>

      <a
        className="mc-credit"
        href={ORIGINAL_REPO}
        target="_blank"
        rel="noopener noreferrer"
        title="Original game on GitHub — ade5791/rork-medieval-3d-chess"
        aria-label="Original King's Gambit on GitHub"
        onPointerDown={(e) => e.stopPropagation()}
        onClick={(e) => e.stopPropagation()}
      >
        <svg viewBox="0 0 16 16" width="22" height="22" fill="currentColor" aria-hidden="true">
          <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z" />
        </svg>
      </a>
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
