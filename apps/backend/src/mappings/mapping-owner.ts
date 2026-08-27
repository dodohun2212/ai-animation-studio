/**
 * Everything the asset-mapping flow needs to know about whatever owns the mappings.
 *
 * It is four facts. That is the whole reason this interface is worth having: the service used to take a
 * `StoredProject` and reach into it, which tied a flow that only asks "how many scenes, which scenes, which
 * revision, and what happens when a review is approved" to a twenty-six field record it never otherwise touched.
 * A Long Project's Episode answers all four — under different field names, in a differently shaped file — and
 * could not be passed in until the questions were stated separately from the record that happened to answer them.
 *
 * Deliberately not here: an identifier, a directory, a workflow state. Where the files live is the repository's
 * business, and what an approval means to the owner is `markMappingApproved`'s — the flow itself has no use for
 * either, and a field it does not use is a field that can be wrong without anything noticing (D-021).
 */
export interface MappingOwner {
  /** How many scenes it has. Every scene scope is checked against this, so a wrong value silently widens or narrows what a mapping covers. */
  readonly sceneCount: number;
  /**
   * The scenes themselves, in order, exactly as stored.
   *
   * `unknown[]` on purpose: this flow reads the length, checks each entry's `number`, and hashes the array to
   * fingerprint the script. It has no business knowing what else is in a scene, and typing it more tightly here
   * would make two owners with genuinely different scene records unable to share this path for no gain.
   */
  readonly scenes: readonly unknown[];
  /** Which revision of the script those scenes came from. A review is only valid against the revision it was begun on. */
  readonly scriptRevision: number;
  /**
   * Told that a review was approved, so the owner can move itself along.
   *
   * The owner decides whether that means anything: a short project advances its workflow state, but only from
   * "waiting for asset mapping review" — approving twice must not push it past somewhere it has already been.
   * Keeping that judgement on the owner is what lets an Episode, whose states are a different set entirely, use
   * this flow without the flow learning either state machine.
   */
  markMappingApproved(mappingRevision: number): Promise<void>;
}

/** Resolves the owner of one scope's mappings. One implementation per kind of owner; the flow never knows which it has. */
export interface MappingOwners {
  get(projectId: string): Promise<MappingOwner>;
}
