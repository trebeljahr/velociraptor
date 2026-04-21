// @ts-nocheck
/*
 * Score-card action row — React port of the Revive / Share / Play-again
 * buttons + the "Press Enter / ● to restart" hint below the game-over
 * PNG preview. The PNG slot itself (<div id="score-card-slot">) and the
 * .visible class toggles on #score-card-overlay / #score-card-panel
 * stay in vanilla ui.ts — the blob lifecycle, the async card generation,
 * and the panel visibility aren't component-tree concerns.
 *
 * All state is owned by ui.ts: reviveCost (null hides the button),
 * reviveKey (increment to restart the .draining keyframe — React
 * re-uses the same CSS class, but we change the `key` prop on the
 * revive button so it remounts and the animation fires from the
 * from-frame again, same effect as the vanilla code's manual reflow
 * trick), shareLabel (updated by ui.ts's clipboard/share-sheet flow
 * via flashShareLabel). The component is a dumb renderer — every click
 * delegates to a callback prop.
 */
import { MouseEvent, KeyboardEvent } from "react";
import { createPortal } from "react-dom";

export interface ScoreCardActionsProps {
  reviveCost: number | null;
  reviveKey: number;
  shareLabel: string;
  onRevive: () => void;
  onShare: () => void;
  onRestart: () => void;
}

export function ScoreCardActions({
  reviveCost,
  reviveKey,
  shareLabel,
  onRevive,
  onShare,
  onRestart,
}: ScoreCardActionsProps) {
  const handleRevive = (e: MouseEvent) => {
    e.stopPropagation();
    onRevive();
  };

  const handleShare = (e: MouseEvent) => {
    e.stopPropagation();
    onShare();
  };

  const handleRestart = (e: MouseEvent) => {
    e.stopPropagation();
    onRestart();
  };

  const handleHintKey = (e: KeyboardEvent) => {
    // role=button + tabindex=0 gets Enter/Space keyboard activation
    // in browsers, but div/p elements don't fire click on Space by
    // default — mirror the vanilla behaviour that made the hint a
    // clickable target for keyboard users too.
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      e.stopPropagation();
      onRestart();
    }
  };

  return (
    <>
      <button
        key={reviveKey}
        className={"revive-btn" + (reviveCost != null ? " draining" : "")}
        type="button"
        hidden={reviveCost == null}
        aria-label="Revive with coins"
        onClick={handleRevive}
      >
        <span className="revive-btn-inner">
          <img
            src="assets/coin.png"
            alt=""
            className="coin-icon"
            aria-hidden="true"
          />
          <span className="revive-btn-label">
            Revive · <span>{reviveCost ?? 0}</span>
          </span>
        </span>
        <span className="revive-btn-progress" aria-hidden="true"></span>
      </button>
      <div className="score-card-actions">
        <button
          className="share-score-btn"
          type="button"
          aria-label="Share your score"
          onClick={handleShare}
        >
          <span className="inner">
            <svg
              xmlns="http://www.w3.org/2000/svg"
              viewBox="0 0 24 24"
              aria-hidden="true"
            >
              <circle cx="18" cy="5" r="3"></circle>
              <circle cx="6" cy="12" r="3"></circle>
              <circle cx="18" cy="19" r="3"></circle>
              <line x1="8.59" y1="13.51" x2="15.42" y2="17.49"></line>
              <line x1="15.41" y1="6.51" x2="8.59" y2="10.49"></line>
            </svg>
            <span className="label">{shareLabel}</span>
          </span>
        </button>
        <button
          className="play-again-btn"
          type="button"
          aria-label="Play again"
          onClick={handleRestart}
        >
          <svg
            xmlns="http://www.w3.org/2000/svg"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth={2}
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <polygon points="6 4 20 12 6 20 6 4"></polygon>
          </svg>
          <span>Play again</span>
        </button>
      </div>
      {(() => {
        // The hint lives outside .score-card-body in the original
        // layout (direct child of #score-card-panel, below the flex
        // container that holds the slot + actions). Portal it to a
        // dedicated root so its position in the flex cascade stays
        // identical to the vanilla DOM.
        const hintHost = document.getElementById("score-card-hint-root");
        if (!hintHost) return null;
        return createPortal(
          <p
            className="score-card-hint"
            role="button"
            tabIndex={0}
            style={{ cursor: "pointer" }}
            onClick={handleRestart}
            onKeyDown={handleHintKey}
          >
            <span className="kbd-hint">
              Press <kbd>Enter</kbd> to restart
            </span>
            <span className="pad-hint">
              <kbd className="gp-select">●</kbd> to restart
            </span>
          </p>,
          hintHost,
        );
      })()}
    </>
  );
}
