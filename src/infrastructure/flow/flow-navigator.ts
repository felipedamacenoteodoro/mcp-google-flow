import type { ProjectNavigator, WorkspaceStatus } from '../../application/ports.js';
import type { ProjectSummary } from '../../domain/library.js';
import { FLOW_ORIGIN, FlowUrl } from '../../domain/project-url.js';
import { anyOf, APP_SETTLE_MS, FlowPage, isSignedInUrl } from './flow-page.js';

const MAX_SCROLL_ROUNDS = 60;

export class FlowNavigator implements ProjectNavigator {
  constructor(private readonly flow: FlowPage) {}

  async status(): Promise<WorkspaceStatus> {
    const currentUrl = this.flow.peekUrl();
    return {
      browserConnected: this.flow.connected,
      signedIn: currentUrl !== null && isSignedInUrl(currentUrl, this.flow.labels.signedOutPath),
      currentUrl,
    };
  }

  async openSignIn(): Promise<'own-chrome' | 'plain-window'> {
    return this.flow.openForSignIn(FlowUrl.home().href);
  }

  /** The home page loads projects as you scroll, so keep scrolling until no new card appears. */
  async listProjects(limit: number): Promise<ProjectSummary[]> {
    const page = await this.goHome();
    const links = this.flow.byAria(page, this.flow.labels.openProjectLink, 'a');
    // Stop after two rounds in a row without new cards: one slow page load must not end the listing.
    let idleRounds = 0;
    for (let round = 0; round < MAX_SCROLL_ROUNDS && idleRounds < 2; round++) {
      const before = await links.count();
      if (before >= limit) break;
      if (before > 0) await links.nth(before - 1).scrollIntoViewIfNeeded();
      await page.waitForTimeout(2_000);
      idleRounds = (await links.count()) > before ? 0 : idleRounds + 1;
    }
    const hrefs = [...new Set(await links.evaluateAll((all) => all.map((a) => a.getAttribute('href') ?? '')))];
    return hrefs
      .filter((href) => /^\/project\/[0-9a-f-]{36}$/.test(href))
      .slice(0, limit)
      .map((href) => ({ id: href.slice('/project/'.length), url: `${FLOW_ORIGIN}${href}` }));
  }

  async createProject(): Promise<string> {
    const page = await this.goHome();
    await this.flow.ui('new project', () =>
      page.getByRole('button', { name: new RegExp(this.flow.labels.newProject) }).first().click(),
    );
    await page.waitForTimeout(APP_SETTLE_MS);
    // Flow's agent rewrites prompts on its own; keep it off for predictable output.
    const agent = page.locator('button', { hasText: anyOf(this.flow.labels.agentToggle) }).first();
    if ((await agent.count()) > 0 && (await agent.getAttribute('aria-pressed')) === 'true') {
      await agent.click();
      await page.waitForTimeout(1_000);
    }
    return page.url();
  }

  async openProject(url: FlowUrl): Promise<void> {
    const page = await this.flow.page();
    await this.flow.open(page, url.href);
    await page.waitForTimeout(APP_SETTLE_MS);
    this.flow.requireSignedIn(page);
  }

  async screenshot(): Promise<Buffer> {
    return (await this.flow.page()).screenshot({ type: 'jpeg', quality: 60 });
  }

  private async goHome() {
    const page = await this.flow.page();
    await this.flow.open(page, FlowUrl.home().href);
    await page.waitForTimeout(APP_SETTLE_MS);
    this.flow.requireSignedIn(page);
    return page;
  }
}
