import type { GithubActionRunState, GithubActionWatchNotificationDetails } from "./types";

const MAX_SUMMARY_JOB_NAMES = 2;
const MAX_RENDER_JOB_NAMES = 3;

export function buildGithubActionWatchSummary(details: GithubActionWatchNotificationDetails): string {
	const previous = formatStateText(details.previousState);
	const current = formatStateText(details.currentState);
	const attemptSuffix =
		typeof details.currentState.runAttempt === "number" ? ` (attempt ${details.currentState.runAttempt})` : "";
	const jobContext = buildSummaryJobContext(details.currentState);
	return `GitHub Actions run ${details.owner}/${details.repo}#${details.runId} changed from ${previous} to ${current}${attemptSuffix}.${jobContext}`;
}

export function buildGithubActionWatchRenderLines(details: GithubActionWatchNotificationDetails): string[] {
	const current = details.currentState;
	const lines = [
		`repo: ${details.owner}/${details.repo}`,
		`run: ${details.runId}`,
		`transition: ${formatStateText(details.previousState)} -> ${formatStateText(current)}`,
	];

	if (current.displayTitle || current.workflowName) {
		lines.push(`workflow: ${current.displayTitle ?? current.workflowName}`);
	}
	if (current.inProgressJobNames.length > 0) {
		lines.push(`running jobs: ${formatJobNames(current.inProgressJobNames, MAX_RENDER_JOB_NAMES)}`);
	}
	if (current.queuedJobNames.length > 0) {
		lines.push(`queued jobs: ${formatJobNames(current.queuedJobNames, MAX_RENDER_JOB_NAMES)}`);
	}
	if (current.headBranch) {
		lines.push(`branch: ${current.headBranch}`);
	}
	if (current.headSha) {
		lines.push(`sha: ${shortSha(current.headSha)}`);
	}
	if (typeof current.runAttempt === "number") {
		lines.push(`attempt: ${current.runAttempt}`);
	}
	if (current.event) {
		lines.push(`event: ${current.event}`);
	}
	if (current.updatedAt) {
		lines.push(`updated: ${current.updatedAt}`);
	}
	lines.push(`observed: ${details.observedAt}`);
	lines.push(`url: ${current.htmlUrl}`);

	return lines;
}

export function buildCompactJobContext(state: GithubActionRunState): string | undefined {
	if (state.inProgressJobNames.length > 0) {
		return `running ${formatCompactJobLabel(state.inProgressJobNames[0], state.inProgressJobNames.length)}`;
	}

	if (state.queuedJobNames.length > 0) {
		return `queued ${formatCompactJobLabel(state.queuedJobNames[0], state.queuedJobNames.length)}`;
	}

	return undefined;
}

export function formatStateText(state: GithubActionRunState): string {
	return state.status === "completed" && state.conclusion ? `${state.status}/${state.conclusion}` : state.status;
}

export function shortSha(sha: string): string {
	return sha.slice(0, 7);
}

function buildSummaryJobContext(state: GithubActionRunState): string {
	if (state.inProgressJobNames.length > 0) {
		return ` Active ${pluralize("job", state.inProgressJobNames.length)}: ${formatJobNames(state.inProgressJobNames, MAX_SUMMARY_JOB_NAMES)}.`;
	}

	if (state.queuedJobNames.length > 0) {
		return ` Queued ${pluralize("job", state.queuedJobNames.length)}: ${formatJobNames(state.queuedJobNames, MAX_SUMMARY_JOB_NAMES)}.`;
	}

	return "";
}

function formatCompactJobLabel(jobName: string, totalJobs: number): string {
	const segments = jobName
		.split(" / ")
		.map(segment => segment.trim())
		.filter(Boolean);
	const compactName = segments.length >= 2 ? segments.slice(-2).join(" / ") : jobName;
	const additionalCount = totalJobs - 1;
	return additionalCount > 0 ? `${compactName} +${additionalCount} more` : compactName;
}

function formatJobNames(jobNames: string[], limit: number): string {
	const visibleNames = jobNames.slice(0, limit);
	const additionalCount = jobNames.length - visibleNames.length;
	return additionalCount > 0 ? `${visibleNames.join(" | ")} | +${additionalCount} more` : visibleNames.join(" | ");
}

function pluralize(noun: string, count: number): string {
	return count === 1 ? noun : `${noun}s`;
}
