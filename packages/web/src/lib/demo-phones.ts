/**
 * One fake customer phone of the demo page, kept in this browser only.
 */
export type DemoSlot = {
  id: string;
  name: string;
  /**
   * `5500` + 9 digits: DDD 00 does not exist, so it never reaches a real number.
   */
  phone: string;
  slug: string;
};

export const MAX_SLOTS = 3;

const storageKey = (userId: string) => `atendy:demo-phones:${userId}`;

// Slots of this tab when localStorage is unavailable (private window, blocked storage).
const memory = new Map<string, DemoSlot[]>();

export const newDemoPhone = () => {
  const digits = crypto.getRandomValues(new Uint32Array(9));

  return `5500${Array.from(digits, (value) => value % 10).join('')}`;
};

export const loadSlots = (userId: string): DemoSlot[] => {
  try {
    const raw = localStorage.getItem(storageKey(userId));

    return raw ? (JSON.parse(raw) as DemoSlot[]).slice(0, MAX_SLOTS) : (memory.get(userId) ?? []);
  } catch {
    return memory.get(userId) ?? [];
  }
};

export const saveSlots = (userId: string, slots: DemoSlot[]) => {
  memory.set(userId, slots);

  try {
    localStorage.setItem(storageKey(userId), JSON.stringify(slots));
  } catch {
    // Kept in memory for this tab.
  }
};
