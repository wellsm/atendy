import { equal } from 'node:assert/strict';
import { describe, it } from 'node:test';

import { needsPreparation } from '../../src/menu/preparation';

describe('needsPreparation', () => {
  it('lets the product override the category', () => {
    equal(needsPreparation([{ categoryNeeds: true, productNeeds: false }]), false);
    equal(needsPreparation([{ categoryNeeds: null, productNeeds: true }]), true);
  });

  it('is true when any line needs it', () => {
    equal(
      needsPreparation([
        { categoryNeeds: false, productNeeds: null },
        { categoryNeeds: true, productNeeds: null }
      ]),
      true
    );
  });

  it('is false for no lines or null flags', () => {
    equal(needsPreparation([]), false);
    equal(needsPreparation([{ categoryNeeds: null, productNeeds: null }]), false);
  });
});
