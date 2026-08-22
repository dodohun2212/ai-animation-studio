import { Injectable } from "@nestjs/common";
import type {
  CreateProjectRequest,
  CreateProjectResponse,
  GetProjectResponse,
  GetProjectSettingsResponse,
  ListProjectsResponse,
  UpdateProjectSettingsRequest,
  UpdateProjectSettingsResponse,
} from "@ai-animation-studio/shared";

import { invalidRequest } from "./project-api.error.js";
import { createStoredProject, toApiProject, toApiSummary } from "./project.mapper.js";
import { applyShortProjectSettings, parseShortProjectSettings, toShortProjectSettings } from "./project-settings.js";
import { LocalProjectRepository } from "./projects.repository.js";

function requireNonEmptyTrimmed(value: unknown, field: string): string {
  if (typeof value !== "string") {
    throw invalidRequest(`${field} must be a string.`, { field });
  }
  const trimmed = value.trim();
  if (trimmed.length === 0) {
    throw invalidRequest(`${field} must not be empty.`, { field });
  }
  return trimmed;
}

@Injectable()
export class ProjectsService {
  constructor(private readonly repository: LocalProjectRepository) {}

  async createProject(request: CreateProjectRequest): Promise<CreateProjectResponse> {
    const projectId = requireNonEmptyTrimmed(request?.projectId, "projectId");
    const topic = requireNonEmptyTrimmed(request?.topic, "topic");
    const timestamp = new Date().toISOString();
    const stored = createStoredProject(projectId, topic, timestamp);
    await this.repository.create(stored);
    return { project: toApiProject(stored) };
  }

  async listProjects(): Promise<ListProjectsResponse> {
    const stored = await this.repository.list();
    const sorted = [...stored].sort(
      (a, b) => Date.parse(b.updated_at) - Date.parse(a.updated_at),
    );
    return { projects: sorted.map(toApiSummary) };
  }

  async getProject(projectId: string): Promise<GetProjectResponse> {
    const trimmed = typeof projectId === "string" ? projectId.trim() : "";
    const stored = await this.repository.findById(trimmed);
    return { project: toApiProject(stored) };
  }

  async getProjectSettings(projectId: string): Promise<GetProjectSettingsResponse> {
    const stored = await this.repository.findById(projectId.trim());
    return { settings: toShortProjectSettings(stored) };
  }

  async updateProjectSettings(
    projectId: string,
    request: UpdateProjectSettingsRequest,
  ): Promise<UpdateProjectSettingsResponse> {
    const stored = await this.repository.findById(projectId.trim());
    const settings = parseShortProjectSettings(request?.settings);
    const updated = applyShortProjectSettings(stored, settings, new Date().toISOString());
    await this.repository.save(updated);
    return { project: toApiProject(updated), settings };
  }
}
