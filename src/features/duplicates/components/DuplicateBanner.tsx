import React from "react";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faClone } from "@fortawesome/free-solid-svg-icons";
import type { TagDataStructure, TrackData } from "@/types/tagData";
import { useDuplicateCheck } from "../hooks/useDuplicateCheck";
import { describeVersion } from "../utils/duplicates.match";
import { VersionBadges } from "./DuplicatesModal";
import styles from "./Duplicates.module.css";

interface DuplicateBannerProps {
  trackUri: string | null;
  trackName?: string;
  trackArtists?: string;
  tracks: TagDataStructure["tracks"];
  applyTrackDataUpdates: (updates: Record<string, TrackData | null>) => void;
}

/** Warns when the track on screen is another version of an already tagged song. */
const DuplicateBanner: React.FC<DuplicateBannerProps> = (props) => {
  const { duplicate, merge, keepBoth } = useDuplicateCheck(props);
  if (!duplicate) return null;

  const { self, others, keeperUri } = duplicate;
  const selfTagged = !!props.tracks[self.uri];
  const keeper = keeperUri === self.uri ? self : others.find((o) => o.uri === keeperUri) ?? others[0];
  const keeperLabel = `${keeper.albumName ?? "release"} (${describeVersion(keeper).toLowerCase()})`;

  let message: string;
  let action: string | null;
  if (selfTagged) {
    message = `This song is tagged more than once (${others.length + 1} versions).`;
    action = `Merge into ${keeperLabel}`;
  } else if (keeperUri === self.uri) {
    message = "You tagged another version of this song; this one is the preferred version.";
    action = "Move tags to this version";
  } else {
    message = `Already tagged as ${keeperLabel}. Tagging this version would duplicate it.`;
    action = null;
  }

  return (
    <div className={styles.banner} role="status">
      <FontAwesomeIcon icon={faClone} className={styles.bannerIcon} />
      <div className={styles.bannerText}>
        <div>{message}</div>
        <div className={styles.bannerVersions}>
          {others.map((o) => (
            <span key={o.uri} className={styles.bannerVersion}>
              {o.albumName ?? "Unknown release"} <VersionBadges identity={o} />
            </span>
          ))}
        </div>
      </div>
      <div className={styles.bannerActions}>
        <button className={styles.secondaryButton} onClick={keepBoth} title="Don't flag these versions again">
          Keep both
        </button>
        {action && (
          <button className={styles.primaryButton} onClick={merge}>
            {action}
          </button>
        )}
      </div>
    </div>
  );
};

export default DuplicateBanner;
