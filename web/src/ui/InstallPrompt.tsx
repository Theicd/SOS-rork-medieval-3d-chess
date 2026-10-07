import { useCallback, useEffect, useState } from "react";
import { Download, Shield, Smartphone, WifiOff, X } from "lucide-react";

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
  open: boolean;
  onClose: () => void;
  /** Fired when the app is already installed or just became installed. */
  onInstalledChange?: (installed: boolean) => void;
}

/**
 * Install confirmation dialog — only opens when the user taps the download icon.
 * Never auto-pops; no sliding tab.
 */
export function InstallPrompt({ open, onClose, onInstalledChange }: InstallPromptProps) {
  const [deferred, setDeferred] = useState<InstallPromptEvent | null>(null);
  const [installed, setInstalled] = useState(() => isStandalone());

  useEffect(() => {
    registerChessServiceWorker();
  }, []);

  useEffect(() => {
    onInstalledChange?.(installed);
  }, [installed, onInstalledChange]);

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
      onClose();
    };
    window.addEventListener("beforeinstallprompt", onPrompt);
    window.addEventListener("appinstalled", onInstalled);
    return () => {
      window.removeEventListener("beforeinstallprompt", onPrompt);
      window.removeEventListener("appinstalled", onInstalled);
    };
  }, [onClose]);

  const runPrompt = useCallback(async () => {
    if (!deferred) return;
    const event = deferred;
    setDeferred(null);
    await event.prompt().catch(() => {});
    const choice = await event.userChoice.catch(() => null);
    if (choice?.outcome === "accepted") setInstalled(true);
  }, [deferred]);

  if (installed || !open) return null;

  return (
    <div
      className="mc-install-dlg"
      onPointerDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="mc-slate mc-goldleaf mc-install-dlg-card">
        <button type="button" className="mc-install-dlg-x" aria-label="Close" onClick={onClose}>
          <X size={16} />
        </button>

        <div className="mc-install-dlg-seal" aria-hidden>
          <img alt="" src={iconUrl()} width={72} height={72} />
          <span className="mc-install-dlg-ring" />
        </div>

        <p className="mc-display mc-install-dlg-eyebrow">Add to device</p>
        <h3 className="mc-display">Install King&apos;s Gambit</h3>
        <p className="mc-install-dlg-lead">
          Keep the hall on your home screen — one tap to return, no browser chrome.
        </p>

        <ul className="mc-install-dlg-perks">
          <li>
            <Smartphone size={15} aria-hidden /> Full screen play
          </li>
          <li>
            <WifiOff size={15} aria-hidden /> Offline after first full load
          </li>
          <li>
            <Shield size={15} aria-hidden /> Cached boards and models on device
          </li>
        </ul>

        {isIOS() ? (
          <>
            <p className="mc-install-dlg-ios">
              Tap <b>Share</b> in Safari, then <b>Add to Home Screen</b>.
            </p>
            <div className="mc-install-dlg-row">
              <button type="button" className="mc-btn mc-btn-primary" onClick={onClose}>
                Got it
              </button>
            </div>
          </>
        ) : (
          <div className="mc-install-dlg-row">
            <button type="button" className="mc-btn" onClick={onClose}>
              Not now
            </button>
            <button
              type="button"
              className="mc-btn mc-btn-primary mc-install-dlg-go"
              onClick={() => {
                if (deferred) void runPrompt();
                else onClose();
              }}
            >
              <Download size={16} /> Install
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
