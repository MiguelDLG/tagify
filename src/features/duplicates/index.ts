export { default as DuplicatesModal } from "./components/DuplicatesModal";
export { default as DuplicateBanner } from "./components/DuplicateBanner";
export { resolveDuplicateBeforeAdd } from "./utils/duplicates.sync";
export { dedupeTrackUris, findDuplicateGroups } from "./utils/duplicates.match";
export { loadIgnoredKeys } from "./utils/duplicates.storage";
export type { DuplicateGroup, TrackIdentity } from "./model/duplicates.types";
