import { ProspectStatus } from './types';

export const STUCK_SENDING_MS = 10 * 60_000;

/**
 * Manual status changes from the admin. A `sending` lead can only be freed once it is stuck.
 */
export const canSetStatus = (from: ProspectStatus, to: ProspectStatus, stuck: boolean) => {
  switch (from) {
    case ProspectStatus.Available:
      return to === ProspectStatus.Queued || to === ProspectStatus.Canceled || to === ProspectStatus.Manual;
    case ProspectStatus.Queued:
      return to === ProspectStatus.Available || to === ProspectStatus.Canceled || to === ProspectStatus.Manual;
    case ProspectStatus.Failed:
    case ProspectStatus.Canceled:
      return to === ProspectStatus.Available || to === ProspectStatus.Queued || to === ProspectStatus.Manual;
    case ProspectStatus.Manual:
      return to === ProspectStatus.Replied;
    case ProspectStatus.Sending:
      return stuck && (to === ProspectStatus.Queued || to === ProspectStatus.Sent);
    default:
      return false;
  }
};

/**
 * Delivery acknowledgements only move a lead forward.
 */
export const ACK_RANK: Partial<Record<ProspectStatus, number>> = {
  [ProspectStatus.Sent]: 1,
  [ProspectStatus.Delivered]: 2,
  [ProspectStatus.Read]: 3,
  [ProspectStatus.Replied]: 4
};
