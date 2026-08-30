/**
 * Deterministic Pseudo-Random Number Generator (Mulberry32)
 * Ensures 100% reproducible synthetic batch generation.
 */
export class PRNG {
  private s: number;

  constructor(seed = 42) {
    this.s = Math.floor(seed);
    if (this.s === 0) this.s = 42;
  }

  /**
   * Generates a float between [0, 1)
   */
  next(): number {
    let t = (this.s += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  /**
   * Generates an integer between [min, max] (inclusive)
   */
  nextInt(min: number, max: number): number {
    return Math.floor(this.next() * (max - min + 1)) + min;
  }

  /**
   * Generates a float between [min, max]
   */
  nextFloat(min: number, max: number): number {
    return this.next() * (max - min) + min;
  }

  /**
   * Picks a random item from an array
   */
  pick<T>(array: readonly T[]): T {
    return array[this.nextInt(0, array.length - 1)];
  }

  /**
   * Picks an item based on relative weights
   */
  weightedPick<T>(items: Array<{ item: T; weight: number }>): T {
    const totalWeight = items.reduce((sum, i) => sum + i.weight, 0);
    let randomVal = this.next() * totalWeight;

    for (const entry of items) {
      if (randomVal < entry.weight) {
        return entry.item;
      }
      randomVal -= entry.weight;
    }

    return items[items.length - 1].item;
  }

  /**
   * Returns true with a given probability [0, 1]
   */
  chance(probability: number): boolean {
    return this.next() < probability;
  }
}
