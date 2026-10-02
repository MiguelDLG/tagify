import React, { useEffect } from "react";
import { Portal } from "@/components/ui";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faClone, faRotateRight, faTimes } from "@fortawesome/free-solid-svg-icons";
import type { TagDataStructure, TrackData } from "@/types/tagData";
import type { DuplicateGroup, DuplicateReason, TrackIdentity } from "../model/duplicates.types";
import { describeVersion } from "../utils/duplicates.match";
import { useDuplicateScan } from "../hooks/useDuplicateScan";
import styles from "./Duplicates.module.css";

interface DuplicatesModalProps {
  tracks: TagDataStructure["tracks"];
  applyTrackDataUpdates: (updates: Record<string, TrackData | null>) => void;
  onClose: () => void;
}

const REASON_LABELS: Record<DuplicateReason, string> = {
  isrc: "Same recording (ISRC)",
  "explicit-clean": "Explicit & clean versions",
  "same-song": "Same title, artist & length",
};

function formatDuration(ms: number | null): string {
  if (ms === null) return "–";
  const s = Math.round(ms / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

export function VersionBadges({ identity }: { identity: TrackIdentity }) {
  return (
    <span className={styles.badges}>
      <span className={styles.badge}>{describeVersion(identity)}</span>
      {identity.explicit !== null && (
        <span className={`${styles.badge} ${identity.explicit ? styles.explicit : ""}`}>
          {identity.explicit ? "Explicit" : "Clean"}
        </span>
      )}
    </span>
  );
}

const DuplicatesModal: React.FC<DuplicatesModalProps> = ({ tracks, applyTrackDataUpdates, onClose }) => {
  const { status, progress, groups, identities, sourceCounts, scan, merge, keepBoth, setKeeper } =
    useDuplicateScan({ tracks, applyTrackDataUpdates });

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [onClose]);

  const renderGroup = (group: DuplicateGroup) => {
    const keeper = identities.get(group.keeperUri);
    return (
      <div key={group.key} className={styles.group}>
        <div className={styles.groupHeader}>
          <div>
            <div className={styles.songTitle}>{keeper?.name ?? tracks[group.keeperUri]?.name}</div>
            <div className={styles.songArtist}>{keeper?.artists.join(", ")}</div>
          </div>
          <span className={styles.reason}>{REASON_LABELS[group.reason]}</span>
        </div>
        <div className={styles.versions}>
          {group.uris.map((uri) => {
            const identity = identities.get(uri);
            if (!identity) return null;
            const isKeeper = uri === group.keeperUri;
            return (
              <label key={uri} className={`${styles.version} ${isKeeper ? styles.keeper : ""}`}>
                <input
                  type="radio"
                  name={group.key}
                  checked={isKeeper}
                  onChange={() => setKeeper(group, uri)}
                />
                <span className={styles.albumName} title={identity.albumName ?? ""}>
                  {identity.albumName ?? "Unknown release"}
                  {identity.releaseYear ? ` · ${identity.releaseYear}` : ""}
                </span>
                <VersionBadges identity={identity} />
                <span className={styles.meta}>{formatDuration(identity.durationMs)}</span>
                <span className={styles.meta}>{tracks[uri]?.tagIds.length ?? 0} tags</span>
                {isKeeper && <span className={styles.keepLabel}>Keep</span>}
              </label>
            );
          })}
        </div>
        <div className={styles.groupActions}>
          <button className={styles.secondaryButton} onClick={() => keepBoth(group)}>
            Keep both
          </button>
          <button className={styles.primaryButton} onClick={() => merge([group])}>
            Merge
          </button>
        </div>
      </div>
    );
  };

  return (
    <Portal>
      <div className={styles.overlay} onClick={onClose}>
        <div className={styles.modal} onClick={(e) => e.stopPropagation()}>
          <div className={styles.header}>
            <div className={styles.titleGroup}>
              <span className={styles.icon}>
                <FontAwesomeIcon icon={faClone} />
              </span>
              <div>
                <h2>Duplicate songs</h2>
                <p>
                  Same song tagged from different releases (single, album, deluxe, clean/explicit).
                  Merge keeps one version with all tags: explicit &gt; album &gt; deluxe &gt; single &gt; compilation.
                </p>
              </div>
            </div>
            <button className={styles.closeButton} onClick={onClose} aria-label="Close">
              <FontAwesomeIcon icon={faTimes} />
            </button>
          </div>

          <div className={styles.body}>
            {status === "scanning" && (
              <div className={styles.state}>
                Checking release info… {progress.done}/{progress.total}
                <div className={styles.progress}>
                  <div
                    className={styles.progressBar}
                    style={{ width: `${progress.total ? (100 * progress.done) / progress.total : 0}%` }}
                  />
                </div>
              </div>
            )}
            {status === "error" && (
              <div className={styles.state}>
                Could not load release info.{" "}
                <button className={styles.secondaryButton} onClick={scan}>
                  Retry
                </button>
              </div>
            )}
            {status === "done" && groups.length === 0 && (
              <div className={styles.state}>No duplicate versions among your tagged songs.</div>
            )}
            {status === "done" && groups.map(renderGroup)}
          </div>

          <div className={styles.footer}>
            <span className={styles.diagnostics}>
              {identities.size} songs checked · {sourceCounts.isrc} with ISRC
              {sourceCounts.graphql > 0 ? ` · ${sourceCounts.graphql} via GraphQL` : ""}
              {sourceCounts.tagdata > 0 ? ` · ${sourceCounts.tagdata} without release info` : ""}
            </span>
            <div className={styles.footerActions}>
              <button className={styles.secondaryButton} onClick={scan} disabled={status === "scanning"}>
                <FontAwesomeIcon icon={faRotateRight} /> Rescan
              </button>
              <button
                className={styles.primaryButton}
                onClick={() => merge(groups)}
                disabled={status !== "done" || groups.length === 0}
              >
                Merge all ({groups.length})
              </button>
            </div>
          </div>
        </div>
      </div>
    </Portal>
  );
};

export default DuplicatesModal;
