import { useCallback, useEffect, useState } from "react";
import { Download, X } from "lucide-react";

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
  /** Home screen only — hide during a match. */
  visible: boolean;
}

/**
 * Left-edge install bookmark: slides open from the left on the home screen,
 * auto-closes after 5s, and leaves a tab head you can tap to reopen.
 */
export function InstallPrompt({ visible }: InstallPromptProps) {
  const [deferred, setDeferred] = useState<InstallPromptEvent | null>(null);
  const [open, setOpen] = useState(false);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [installed, setInstalled] = useState(() => isStandalone());

  useEffect(() => {
    registerChessServiceWorker();
  }, []);

  useEffect(() => {
    if (isStandalone()) {
      setInstalled(true);
      return;
    }
    const onPrompt = (e: Event): void => {
      e.preventDefault();
      setDeferred(e as InstallPromptEvent);
    };
    const onInstalled = (): void => {
      setInstalled(true);
      setDeferred(null);
      setDialogOpen(false);
      setOpen(false);
    };
    window.addEventListener("beforeinstallprompt", onPrompt);
    window.addEventListener("appinstalled", onInstalled);
    return () => {
      window.removeEventListener("beforeinstallprompt", onPrompt);
      window.removeEventListener("appinstalled", onInstalled);
    };
  }, []);

  // Auto-open once when the home screen is shown, then tuck back to the tab.
  useEffect(() => {
    if (!visible || installed) {
      setOpen(false);
      return;
    }
    setOpen(true);
    const close = window.setTimeout(() => setOpen(false), 5000);
    return () => clearTimeout(close);
  }, [visible, installed]);

  const runPrompt = useCallback(async () => {
    if (!deferred) return;
    const event = deferred;
    setDeferred(null);
    await event.prompt().catch(() => {});
    const choice = await event.userChoice.catch(() => null);
    if (choice?.outcome === "accepted") setInstalled(true);
  }, [deferred]);

  const startInstall = useCallback(() => {
    if (deferred) void runPrompt();
    else setDialogOpen(true);
  }, [deferred, runPrompt]);

  if (installed || !visible) return null;

  return (
    <>
      <div
        className={`mc-install-drawer${open ? " open" : ""}`}
        onPointerDown={(e) => e.stopPropagation()}
      >
        <button
          type="button"
          className="mc-install-tab"
          title="Install game"
          aria-label="Install game"
          aria-expanded={open}
          onClick={() => setOpen(true)}
        >
          <Download size={16} strokeWidth={2.4} />
          <span className="mc-install-tab-txt">Install</span>
        </button>

        <div className="mc-install-panel">
          <img alt="" src={iconUrl()} width={28} height={28} />
          <span className="mc-display mc-install-title">Install</span>
          <button type="button" className="mc-install-action" onClick={startInstall} aria-label="Install game">
            <Download size={14} />
          </button>
          <button
            type="button"
            className="mc-install-close"
            aria-label="Close"
            onClick={() => setOpen(false)}
          >
            <X size={14} />
          </button>
        </div>
      </div>

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
            {isIOS() ? (
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
            ) : (
              <div className="mc-install-dlg-row">
                <button type="button" className="mc-btn" onClick={() => setDialogOpen(false)}>
                  Not now
                </button>
                <button
                  type="button"
                  className="mc-btn mc-btn-primary"
                  onClick={() => {
                    setDialogOpen(false);
                    if (deferred) void runPrompt();
                  }}
                >
                  Install
                </button>
              </div>
            )}
          </div>
        </div>
      ) : null}
    </>
  );
}
