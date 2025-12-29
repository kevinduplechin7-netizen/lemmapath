import { useEffect, useMemo, useState } from "react";

type DeferredPrompt = any;

function isIOS() {
  return /iPad|iPhone|iPod/.test(navigator.userAgent);
}
function isStandalone() {
  return window.matchMedia("(display-mode: standalone)").matches || (navigator as any).standalone === true;
}

export function InstallCard() {
  const [deferred, setDeferred] = useState<DeferredPrompt | null>(null);
  const [show, setShow] = useState(false);

  const ios = useMemo(() => isIOS(), []);
  const standalone = useMemo(() => isStandalone(), []);

  useEffect(() => {
    const handler = (e: any) => {
      e.preventDefault();
      setDeferred(e);
      setShow(true);
    };
    window.addEventListener("beforeinstallprompt", handler);
    return () => window.removeEventListener("beforeinstallprompt", handler);
  }, []);

  if (standalone) return null;

  return (
    <div className="panel" style={{ padding: 16, marginTop: 12 }}>
      <div className="row" style={{ justifyContent: "space-between" }}>
        <div style={{ maxWidth: 700 }}>
          <div style={{ fontWeight: 700, marginBottom: 4 }}>Install LemmaPath</div>
          <div style={{ color: "var(--muted)", fontSize: 14 }}>
            Works offline after first load. Install it like an app for faster access.
          </div>
        </div>

        {!ios && deferred && (
          <button
            className="btn primary"
            onClick={async () => {
              try {
                await deferred.prompt();
                setShow(false);
              } catch {
                setShow(false);
              }
            }}
          >
            Install
          </button>
        )}
      </div>

      {ios && (
        <div style={{ marginTop: 12, color: "var(--muted)", fontSize: 14, lineHeight: 1.5 }}>
          <div>
            <strong>iOS Safari:</strong> tap <span className="kbd">Share</span> →{" "}
            <span className="kbd">Add to Home Screen</span>.
          </div>
          <div style={{ marginTop: 6 }}>After installing, open from your home screen for the best experience.</div>
        </div>
      )}

      {!ios && !deferred && show === false && (
        <div style={{ marginTop: 12, color: "var(--muted)", fontSize: 14 }}>
          If you do not see an install button, your browser may not support PWA install for this build.
        </div>
      )}
    </div>
  );
}
