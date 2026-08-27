import { WorkflowState } from "@ai-animation-studio/shared";

import { toShortProjectSettings } from "../projects/project-settings.js";
import { LocalProjectRepository } from "../projects/projects.repository.js";
import type { StoredProject } from "../projects/project-storage.schema.js";
import type { MappingOwner, MappingOwners } from "./mapping-owner.js";
import { LocalProjectAssetMappingsRepository } from "./mappings.repository.js";

/**
 * A short project answering the four questions the mapping flow asks.
 *
 * Every value below is read from exactly where the service used to read it, so this is a change of shape and not
 * of behaviour — the point of the step is that nothing moves while the seam is cut.
 */
class ShortProjectMappingOwner implements MappingOwner {
  constructor(
    private readonly project: StoredProject,
    /** Absent in the contexts that never approve anything, exactly as before — see markMappingApproved. */
    private readonly projects: LocalProjectRepository | undefined,
    readonly directory: string,
  ) {}

  get id(): string {
    return this.project.project_id;
  }

  /**
   * Already true, and known to be, because loading the project is how this owner came to exist.
   *
   * The repository asks every location this before it reads, which is right for one built ahead of use. Asking
   * again here would re-read and re-parse the same file to learn something we are holding the answer to.
   */
  async ensureExists(): Promise<void> {}

  get sceneCount(): number {
    return toShortProjectSettings(this.project).sceneCount;
  }

  get scenes(): readonly unknown[] {
    return this.project.scenes;
  }

  get scriptRevision(): number {
    return this.project.script_revision;
  }

  /**
   * Nothing to do. A short project is already in "waiting for asset mapping review" by the time a review can be
   * begun — the story step puts it there — so there is no transition here to make, and inventing one would be a
   * second place deciding a state this owner does not own at this point.
   */
  async markMappingReviewBegun(): Promise<void> {}

  /**
   * Advances the project, and only from the one state that means "this approval is what it was waiting for".
   *
   * The guard is not defensive tidiness: a review can be approved again after the project has already moved on,
   * and without it that later approval would drag the project backwards to a step it had finished. Re-approving
   * is allowed on purpose (the review itself is rewritten), so the state has to be the thing that refuses.
   */
  async markMappingApproved(mappingRevision: number): Promise<void> {
    if (!this.projects || this.project.workflow_state !== WorkflowState.WaitingForAssetMappingReview) return;
    await this.projects.save({
      ...this.project,
      workflow_state: WorkflowState.AssetMappingApproved,
      mapping_revision: mappingRevision,
      updated_at: new Date().toISOString(),
    });
  }
}

/**
 * Reads short projects through the mappings repository, which is where that read already lived.
 *
 * Leaving it there matters: the repository is what turns "this project does not exist" into the mapping flow's
 * own not-found error, and moving the read would have quietly changed which error a missing project produces.
 */
export class ShortProjectMappingOwners implements MappingOwners {
  constructor(
    private readonly repository: LocalProjectAssetMappingsRepository,
    private readonly projects?: LocalProjectRepository,
  ) {}

  async get(projectId: string): Promise<MappingOwner> {
    const { directory } = this.repository.projectLocation(projectId);
    return new ShortProjectMappingOwner(await this.repository.project(projectId), this.projects, directory);
  }
}
