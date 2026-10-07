import { useCallback, useEffect, useState } from "react";

interface InstallPromptEvent extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

function isStandalone(): boolean {
  return (
    matchMedia("(display-mode: fullscreen), (display-mode: standalone)").matches ||
    (navigator as Navigator & { standalone?: boolean }).standalone === true
  );
}

function isIOS(): boolean {
  return (
    /iphone|ipad|ipod/i.test(navigator.userAgent) ||
    (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1)
  );
}

function iconUrl(): string {
  try {
    return new URL("icon.png", document.baseURI).href;
  } catch {
    return "icon.png";
  }
}

/** Registers the service worker once (needed for Chrome's install prompt). */
export function registerChessServiceWorker(): void {
  if (!("serviceWorker" in navigator)) return;
  const swUrl = new URL("sw.js", document.baseURI).href;
  window.addEventListener("load", () => {
    navigator.serviceWorker.register(swUrl).catch(() => {});
  });
}

interface InstallPromptProps {
  /** When false, hide the floating card (e.g. during a match). */
  visible: boolean;
  /** Optional: expose whether install is available (for a top-bar download button). */
  onAvailabilityChange?: (available: boolean) => void;
  /** Imperative open from the top-bar download gear. */
  openSignal?: number;
}

/**
 * Kart-style install UX: a short floating card on the home screen, plus a
 * confirmation dialog (native prompt on Chromium, Share steps on iOS).
 */
export function InstallPrompt({ visible, onAvailabilityChange, openSignal = 0 }: InstallPromptProps) {
  const [deferred, setDeferred] = useState<InstallPromptEvent | null>(null);
  const [available, setAvailable] = useState(() => isIOS() && !isStandalone());
  const [showCard, setShowCard] = useState(false);
  const [cardGone, setCardGone] = useState(false);
  const [dialogOpen, setDialogOpen] = useState(false);

  useEffect(() => {
    registerChessServiceWorker();
  }, []);

  useEffect(() => {
    if (isStandalone()) {
      setAvailable(false);
      onAvailabilityChange?.(false);
      return;
    }

    const onPrompt = (e: Event): void => {
      e.preventDefault();
      setDeferred(e as InstallPromptEvent);
      setAvailable(true);
    };
    const onInstalled = (): void => {
      setAvailable(false);
      setDeferred(null);
      setDialogOpen(false);
      setShowCard(false);
    };
    window.addEventListener("beforeinstallprompt", onPrompt);
    window.addEventListener("appinstalled", onInstalled);
    return () => {
      window.removeEventListener("beforeinstallprompt", onPrompt);
      window.removeEventListener("appinstalled", onInstalled);
    };
  }, [onAvailabilityChange]);

  useEffect(() => {
    onAvailabilityChange?.(available && !isStandalone());
  }, [available, onAvailabilityChange]);

  // Show the floating card briefly when install becomes available on the menu.
  useEffect(() => {
    if (!visible || !available || isStandalone()) {
      setShowCard(false);
      return;
    }
    setShowCard(true);
    setCardGone(false);
    const fade = window.setTimeout(() => setCardGone(true), 5000);
    const hide = window.setTimeout(() => setShowCard(false), 5600);
    return () => {
      clearTimeout(fade);
      clearTimeout(hide);
    };
  }, [visible, available]);

  const runPrompt = useCallback(async () => {
    if (!deferred) return;
    const event = deferred;
    setDeferred(null);
    await event.prompt().catch(() => {});
    const choice = await event.userChoice.catch(() => null);
    if (choice?.outcome === "accepted") setAvailable(false);
  }, [deferred]);

  const openDialog = useCallback(() => {
    if (!available || isStandalone()) return;
    setDialogOpen(true);
  }, [available]);

  useEffect(() => {
    if (openSignal > 0) openDialog();
  }, [openSignal, openDialog]);

  if (isStandalone()) return null;

  return (
    <>
      {showCard && visible ? (
        <button
          type="button"
          className={`mc-install-card${cardGone ? " gone" : ""}`}
          onClick={() => {
            if (deferred) void runPrompt();
            else openDialog();
          }}
        >
          <img alt="" src={iconUrl()} width={40} height={40} />
          <span>
            Install game
            <small>Add to home screen</small>
          </span>
        </button>
      ) : null}

      {dialogOpen ? (
        <div
          className="mc-install-dlg"
          onPointerDown={(e) => {
            if (e.target === e.currentTarget) setDialogOpen(false);
          }}
        >
          <div className="mc-slate mc-goldleaf mc-install-dlg-card">
            <img alt="" src={iconUrl()} width={64} height={64} />
            <h3 className="mc-display">Install King&apos;s Gambit</h3>
            <p>Add the game to your device and open it straight from the home screen.</p>
            <ul>
              <li>Full screen, no browser bars</li>
              <li>After one online load, reopens from device cache</li>
              <li>Playable offline once the hall has finished loading once</li>
            </ul>
            {deferred ? (
              <>
                <p>
                  Tap <b>Install</b> to confirm.
                </p>
                <div className="mc-install-dlg-row">
                  <button type="button" className="mc-btn" onClick={() => setDialogOpen(false)}>
                    Not now
                  </button>
                  <button
                    type="button"
                    className="mc-btn mc-btn-primary"
                    onClick={() => {
                      setDialogOpen(false);
                      void runPrompt();
                    }}
                  >
                    Install
                  </button>
                </div>
              </>
            ) : (
              <>
                <p>
                  Tap <b>Share</b> <span aria-hidden>⬆︎</span> in Safari, then <b>Add to Home Screen</b>.
                </p>
                <div className="mc-install-dlg-row">
                  <button type="button" className="mc-btn mc-btn-primary" onClick={() => setDialogOpen(false)}>
                    Got it
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      ) : null}
    </>
  );
}
