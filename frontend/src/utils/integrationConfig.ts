export interface IntegrationConfig {
  githubOwner: string;
  githubRepo: string;
  jiraBaseUrl: string;
  jiraProjectKey: string;
  /**
   * Optional full-URL override for "create issue", with an optional
   * {PROJECT_KEY} placeholder. Jira's real create-issue URL varies by
   * edition/version/project-type (classic vs. team-managed, Cloud vs.
   * Server/Data Center) — there's no single path that works everywhere, so
   * rather than guess one, users who know their instance's actual working
   * URL (found by clicking "Create" in their own Jira UI and copying the
   * resulting address) can paste it here.
   */
  jiraCreateUrlTemplate: string;
  jenkinsBaseUrl: string;
  jenkinsJobPath: string;
  /** Jenkins parameter name the selected test IDs are sent under. Defaults to MULTIPLE_GROUPS but varies by job config. */
  jenkinsTestIdParam: string;
}

const INTEGRATION_CONFIG_KEY = 'jenkins-analyzer-integration-config';

const DEFAULT_CONFIG: IntegrationConfig = {
  githubOwner: '',
  githubRepo: '',
  jiraBaseUrl: '',
  jiraProjectKey: '',
  jiraCreateUrlTemplate: '',
  jenkinsBaseUrl: '',
  jenkinsJobPath: '',
  jenkinsTestIdParam: 'MULTIPLE_GROUPS',
};

export function loadIntegrationConfig(): IntegrationConfig {
  try {
    const data = localStorage.getItem(INTEGRATION_CONFIG_KEY);
    if (!data) return { ...DEFAULT_CONFIG };
    return { ...DEFAULT_CONFIG, ...JSON.parse(data) };
  } catch {
    return { ...DEFAULT_CONFIG };
  }
}

export function saveIntegrationConfig(config: IntegrationConfig): void {
  try {
    localStorage.setItem(INTEGRATION_CONFIG_KEY, JSON.stringify(config));
  } catch {
    // quota exceeded — skip
  }
}

/**
 * GitHub reliably supports prefilling a new issue via query params
 * (title/body/labels) — https://docs.github.com/en/issues/tracking-your-work-with-issues/using-issues/creating-an-issue#creating-an-issue-from-a-url-query
 */
export function buildGithubIssueUrl(config: IntegrationConfig, title: string, body: string): string | null {
  if (!config.githubOwner || !config.githubRepo) return null;
  const params = new URLSearchParams({ title, body });
  return `https://github.com/${config.githubOwner}/${config.githubRepo}/issues/new?${params.toString()}`;
}

/**
 * Jira does not reliably support prefilling the create-issue form via URL —
 * the actual working path varies by edition (Cloud vs. Server/Data Center),
 * version, and project type (classic vs. team-managed), and guessing one
 * (e.g. the Cloud-only `/jira/software/projects/{key}/create` this function
 * used previously) produces a broken link on any other setup, including
 * self-hosted instances on a custom domain.
 *
 * Precedence:
 *   1. `jiraCreateUrlTemplate`, if the user supplied their own known-working
 *      URL (with an optional {PROJECT_KEY} placeholder) — always wins.
 *   2. `/browse/{PROJECT_KEY}` — not a create form, but a URL pattern that
 *      has been stable across every Jira edition/version for over a decade;
 *      it lands on the project itself, one click from Jira's own "Create"
 *      button, so navigation is always correct even without prefill.
 *   3. `/secure/CreateIssue.jspa` — generic create screen when no project
 *      key is configured at all.
 * The body/title still need to be pasted in manually either way, which is
 * what the Copy buttons are for.
 */
export function buildJiraCreateUrl(config: IntegrationConfig): string | null {
  if (!config.jiraBaseUrl) return null;
  const base = config.jiraBaseUrl.replace(/\/$/, '');

  if (config.jiraCreateUrlTemplate) {
    return config.jiraCreateUrlTemplate.replace(/\{PROJECT_KEY\}/g, config.jiraProjectKey || '');
  }

  return config.jiraProjectKey
    ? `${base}/browse/${config.jiraProjectKey}`
    : `${base}/secure/CreateIssue.jspa`;
}

export function extractTestId(testCaseName: string): string | null {
  const parts = testCaseName.split('/');
  if (parts.length === 0) return null;
  const lastPart = parts[parts.length - 1].trim();
  return lastPart || null;
}

/**
 * `jenkinsJobPath` is expected to be the full Jenkins job path segment as it
 * appears in the job's own URL, e.g. "job/digital-ui-automation" or, for a
 * job nested in folders, "job/team-folder/job/digital-ui-automation" — Jenkins
 * repeats the "job/" prefix per folder level, so we must NOT add our own
 * "job/" on top of what the user enters (that produced a broken double
 * "job/job/..." URL previously).
 */
export function buildJenkinsBuildUrl(config: IntegrationConfig, testIds: string[]): string | null {
  if (!config.jenkinsBaseUrl || !config.jenkinsJobPath) return null;
  if (testIds.length === 0) return null;

  const base = config.jenkinsBaseUrl.replace(/\/$/, '');
  const jobPath = config.jenkinsJobPath.replace(/^\//, '').replace(/\/$/, '');
  // Jenkins parameter names are job-specific — MULTIPLE_GROUPS is just the
  // default seen on the one job this feature was built against; other jobs
  // may name their test-selection parameter differently.
  const paramName = config.jenkinsTestIdParam || 'MULTIPLE_GROUPS';
  const testIdValue = testIds.join(',');
  const params = new URLSearchParams({ [paramName]: testIdValue });

  return `${base}/${jobPath}/build?${params.toString()}`;
}
