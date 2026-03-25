import type { ExecOptions, ExecResult } from "@oh-my-pi/pi-coding-agent";
import type { GithubActionRunState, GithubActionRunTarget } from "./types";

export type GithubCommandExecutor = (command: string, args: string[], options?: ExecOptions) => Promise<ExecResult>;

interface WorkflowRunResponse {
	id: number;
	name?: string;
	display_title?: string;
	status?: string;
	conclusion?: string | null;
	event?: string;
	head_branch?: string;
	head_sha?: string;
	workflow_id?: number;
	run_attempt?: number;
	updated_at?: string;
	html_url?: string;
}

interface WorkflowRunJobsResponse {
	jobs?: WorkflowRunJobResponse[];
}

interface WorkflowRunJobResponse {
	name?: string;
	status?: string;
}

const GH_AUTH_ERROR_RE = /gh auth login|not logged into any hosts|authentication failed|invalid token|oauth token/i;
const GH_NOT_FOUND_RE = /\b404\b|not found/i;
const QUEUED_JOB_STATUSES = new Set(["queued", "pending", "requested", "waiting"]);

export function createWorkflowRunFingerprint(state: GithubActionRunState): string {
	return JSON.stringify({
		runId: state.runId,
		status: state.status,
		conclusion: state.conclusion,
		event: state.event,
		headBranch: state.headBranch,
		headSha: state.headSha,
		workflowId: state.workflowId,
		runAttempt: state.runAttempt,
		updatedAt: state.updatedAt,
		htmlUrl: state.htmlUrl,
		inProgressJobNames: state.inProgressJobNames,
		queuedJobNames: state.queuedJobNames,
	});
}

export class GithubActionsClient {
	constructor(
		private readonly exec: GithubCommandExecutor,
		private readonly cwd: string,
	) {}

	async getWorkflowRun(target: GithubActionRunTarget, signal?: AbortSignal): Promise<GithubActionRunState> {
		const runPath = `/repos/${target.owner}/${target.repo}/actions/runs/${target.runId}`;
		const jobsPath = `${runPath}/jobs?per_page=100`;
		const payload = await this.readGhJson<WorkflowRunResponse>({
			target,
			path: runPath,
			description: `GitHub Actions run ${formatRunRef(target)}`,
			signal,
		});
		const jobsPayload = await this.readGhJson<WorkflowRunJobsResponse>({
			target,
			path: jobsPath,
			description: `GitHub Actions jobs for ${formatRunRef(target)}`,
			signal,
		}).catch(error => {
			if (signal?.aborted) {
				throw error;
			}

			return undefined;
		});

		return mapWorkflowRunResponse(target, payload, jobsPayload);
	}

	private async readGhJson<T>({
		target,
		path,
		description,
		signal,
	}: {
		target: GithubActionRunTarget;
		path: string;
		description: string;
		signal?: AbortSignal;
	}): Promise<T> {
		const args = ["api", "-H", "Accept: application/vnd.github+json", path];

		let result: ExecResult;
		try {
			result = await this.exec("gh", args, { cwd: this.cwd, signal, timeout: 15_000 });
		} catch {
			throw new Error(
				"GitHub CLI (gh) is not installed or could not be executed. Install it from https://cli.github.com/.",
			);
		}

		if (signal?.aborted) {
			throw new Error("GitHub Actions watch poll was cancelled.");
		}

		if (result.code !== 0) {
			throw new Error(normalizeGhError(target, result, description));
		}

		try {
			return JSON.parse(result.stdout) as T;
		} catch {
			throw new Error(`GitHub CLI returned invalid JSON while reading ${description}.`);
		}
	}
}

export function mapWorkflowRunResponse(
	target: GithubActionRunTarget,
	payload: WorkflowRunResponse,
	jobsPayload?: WorkflowRunJobsResponse,
): GithubActionRunState {
	const htmlUrl = payload.html_url;
	if (!htmlUrl) {
		throw new Error(`GitHub Actions run response for ${formatRunRef(target)} did not include html_url.`);
	}

	const { inProgressJobNames, queuedJobNames } = summarizeWorkflowRunJobs(jobsPayload);

	return {
		runId: payload.id ?? target.runId,
		workflowName: payload.name,
		displayTitle: payload.display_title ?? payload.name,
		status: payload.status ?? "unknown",
		conclusion: payload.conclusion ?? undefined,
		event: payload.event,
		headBranch: payload.head_branch,
		headSha: payload.head_sha,
		workflowId: payload.workflow_id,
		runAttempt: payload.run_attempt,
		updatedAt: payload.updated_at,
		htmlUrl,
		inProgressJobNames,
		queuedJobNames,
	};
}

function summarizeWorkflowRunJobs(payload?: WorkflowRunJobsResponse): Pick<GithubActionRunState, "inProgressJobNames" | "queuedJobNames"> {
	const jobs = payload?.jobs ?? [];

	return {
		inProgressJobNames: collectJobNamesByStatus(jobs, status => status === "in_progress"),
		queuedJobNames: collectJobNamesByStatus(jobs, status => QUEUED_JOB_STATUSES.has(status)),
	};
}

function collectJobNamesByStatus(
	jobs: WorkflowRunJobResponse[],
	matches: (status: string) => boolean,
): string[] {
	return [...new Set(jobs.flatMap(job => (job.name && job.status && matches(job.status) ? [job.name] : [])))];
}

function normalizeGhError(target: GithubActionRunTarget, result: ExecResult, description: string): string {
	const stderr = result.stderr.trim();
	const stdout = result.stdout.trim();
	const message = stderr || stdout || `gh api exited with code ${result.code}`;

	if (GH_AUTH_ERROR_RE.test(message)) {
		return "GitHub CLI is not authenticated. Run 'gh auth login' first.";
	}

	if (GH_NOT_FOUND_RE.test(message)) {
		return `GitHub Actions run ${target.runId} was not found in ${target.owner}/${target.repo}.`;
	}

	return `Failed to read ${description} via GitHub CLI: ${message}`;
}

function formatRunRef(target: GithubActionRunTarget): string {
	return `${target.owner}/${target.repo}#${target.runId}`;
}
