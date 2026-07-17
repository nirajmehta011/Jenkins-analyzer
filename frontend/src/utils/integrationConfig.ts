export interface IntegrationConfig {
  githubOwner: string;
  githubRepo: string;
  jiraBaseUrl: string;
  jiraProjectKey: string;
  jenkinsBaseUrl: string;
  jenkinsJobPath: string;
}

const INTEGRATION_CONFIG_KEY = 'jenkins-analyzer-integration-config';

const DEFAULT_CONFIG: IntegrationConfig = {
  githubOwner: '',
  githubRepo: '',
  jiraBaseUrl: '',
  jiraProjectKey: '',
  jenkinsBaseUrl: '',
  jenkinsJobPath: '',
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
 * Jira Cloud does not reliably support prefilling the create-issue form via
 * URL (varies by screen scheme/version, and the old query-param prefill
 * pattern was deprecated) — this only opens the create page for the
 * configured project. The body/title still need to be pasted in manually,
 * which is what the Copy buttons are for.
 */
export function buildJiraCreateUrl(config: IntegrationConfig): string | null {
  if (!config.jiraBaseUrl) return null;
  const base = config.jiraBaseUrl.replace(/\/$/, '');
  return config.jiraProjectKey
    ? `${base}/jira/software/projects/${config.jiraProjectKey}/create`
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
  const multipleGroups = testIds.join(',');
  const params = new URLSearchParams({ MULTIPLE_GROUPS: multipleGroups });

  return `${base}/${jobPath}/build?${params.toString()}`;
}
