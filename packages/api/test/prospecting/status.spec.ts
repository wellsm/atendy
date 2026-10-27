import { equal } from 'node:assert/strict';
import { describe, it } from 'node:test';

import { ACK_RANK, canSetStatus } from '../../src/prospecting/status';
import { ProspectStatus } from '../../src/prospecting/types';

describe('prospecting status rules', () => {
  it('allows the admin transitions', () => {
    const allowed = [
      [ProspectStatus.Queued, ProspectStatus.Canceled],
      [ProspectStatus.Queued, ProspectStatus.Manual],
      [ProspectStatus.Failed, ProspectStatus.Queued],
      [ProspectStatus.Canceled, ProspectStatus.Queued],
      [ProspectStatus.Failed, ProspectStatus.Manual],
      [ProspectStatus.Canceled, ProspectStatus.Manual],
      [ProspectStatus.Manual, ProspectStatus.Replied],
      [ProspectStatus.Available, ProspectStatus.Queued],
      [ProspectStatus.Available, ProspectStatus.Canceled],
      [ProspectStatus.Available, ProspectStatus.Manual],
      [ProspectStatus.Queued, ProspectStatus.Available],
      [ProspectStatus.Failed, ProspectStatus.Available],
      [ProspectStatus.Canceled, ProspectStatus.Available]
    ] as const;

    for (const [from, to] of allowed) {
      equal(canSetStatus(from, to, false), true, `${from} -> ${to}`);
    }
  });

  it('frees a sending lead only when it is stuck', () => {
    equal(canSetStatus(ProspectStatus.Sending, ProspectStatus.Queued, true), true);
    equal(canSetStatus(ProspectStatus.Sending, ProspectStatus.Sent, true), true);
    equal(canSetStatus(ProspectStatus.Sending, ProspectStatus.Queued, false), false);
    equal(canSetStatus(ProspectStatus.Sending, ProspectStatus.Sent, false), false);
  });

  it('refuses everything else', () => {
    equal(canSetStatus(ProspectStatus.Sent, ProspectStatus.Queued, false), false);
    equal(canSetStatus(ProspectStatus.Replied, ProspectStatus.Manual, false), false);
    equal(canSetStatus(ProspectStatus.Queued, ProspectStatus.Sent, false), false);
    equal(canSetStatus(ProspectStatus.Available, ProspectStatus.Sent, false), false);
    equal(canSetStatus(ProspectStatus.Manual, ProspectStatus.Available, false), false);
    equal(canSetStatus(ProspectStatus.Sent, ProspectStatus.Available, false), false);
  });

  it('ranks acknowledgements forward', () => {
    equal(ACK_RANK[ProspectStatus.Sent], 1);
    equal(ACK_RANK[ProspectStatus.Delivered], 2);
    equal(ACK_RANK[ProspectStatus.Read], 3);
    equal(ACK_RANK[ProspectStatus.Replied], 4);
  });
});
