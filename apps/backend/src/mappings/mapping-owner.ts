/**
 * Which scope's mapping files to read and write, and where they are.
 *
 * This is everything the storage layer needs and nothing else. It exists so the repository can serve a short
 * project and one Episode of a Long Project without knowing that Episodes exist: whoever owns a layout resolves
 * its own directory and hands the result in, which keeps the dependency pointing one way. The alternative — the
 * repository importing the Long Project path rules — would have made the two modules import each other.
 *
 * `directory` is expected to be resolved and validated already. Only two things construct one of these, and both
 * go through the validating resolver for the layout they own.
 */
export interface MappingLocation {
  /** Stamped into stored mappings and reviews, and checked when they are read back. */
  readonly id: string;
  /** Holds asset_mappings.json, asset_mapping_review.json and asset_snapshots/. */
  readonly directory: string;
  /**
   * Raises the mapping flow's own not-found error when the scope this points at does not exist.
   *
   * Existence is scope-specific — a short project is its project.json, an Episode is a different file in a
   * different shape — so asking the location is what keeps the repository out of that question. A plain
   * directory check would have been generic and wrong: it would have accepted a directory whose project file is
   * missing or malformed, which today is a storage error rather than silence.
   */
  ensureExists(): Promise<void>;
}

/**
 * Everything the asset-mapping flow needs to know about whatever owns the mappings.
 *
 * It is four facts. That is the whole reason this interface is worth having: the service used to take a
 * `StoredProject` and reach into it, which tied a flow that only asks "how many scenes, which scenes, which
 * revision, and what happens when a review is approved" to a twenty-six field record it never otherwise touched.
 * A Long Project's Episode answers all four — under different field names, in a differently shaped file — and
 * could not be passed in until the questions were stated separately from the record that happened to answer them.
 *
 * Deliberately not here: a workflow state. What an approval means to the owner is `markMappingApproved`'s
 * business, and a field this flow does not use is a field that can be wrong without anything noticing (D-021).
 *
 * Where the files live *is* here, by way of MappingLocation. An earlier version of this comment argued it was
 * the repository's business and left it out — that was wrong. The repository can only resolve a directory it
 * already knows the layout of, and knowing an Episode's layout is precisely what it must not have to do. The
 * owner is the one thing that knows both which scope this is and where that scope keeps its files, and holding
 * them apart would have meant two values that always travel together and can disagree.
 */
export interface MappingOwner extends MappingLocation {
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
