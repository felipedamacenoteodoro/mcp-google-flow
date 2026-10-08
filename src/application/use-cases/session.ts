import type { ProjectSummary } from '../../domain/library.js';
import { FlowUrl } from '../../domain/project-url.js';
import type { ProjectNavigator, WorkspaceStatus } from '../ports.js';

export class SessionUseCases {
  constructor(private readonly navigator: ProjectNavigator) {}

  status(): Promise<WorkspaceStatus> {
    return this.navigator.status();
  }

  /** Opens Flow so the user signs in by hand; the server never sees credentials. */
  signIn(): Promise<'own-chrome' | 'plain-window'> {
    return this.navigator.openSignIn();
  }

  listProjects(limit: number): Promise<ProjectSummary[]> {
    return this.navigator.listProjects(limit);
  }

  async newProject(): Promise<{ url: string }> {
    return { url: await this.navigator.createProject() };
  }

  async openProject(rawUrl: string): Promise<void> {
    await this.navigator.openProject(FlowUrl.parse(rawUrl));
  }

  screenshot(): Promise<Buffer> {
    return this.navigator.screenshot();
  }
}
