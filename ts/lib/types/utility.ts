/**
 * Extracts the union of values from an `as const` object.
 *
 * Used by every enum conversion in the migration:
 *   export const Foo = { A: 0, B: 1 } as const;
 *   export type Foo = ValueOf<typeof Foo>;  // 0 | 1
 */
export type ValueOf<T> = T[keyof T];
