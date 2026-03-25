export const GITHUB_ACTION_WATCH_COMMAND = "github-action-watch";
export const GITHUB_ACTION_WATCH_MESSAGE_TYPE = "github-action-watch-update";
export const DEFAULT_POLL_INTERVAL_MS = 10_000;

export interface WatchGithubActionRunParams {
	owner: string;
	repo: string;
	run_id: number;
}

export interface StopGithubActionWatchParams {
	watch_id?: string;
	owner?: string;
	repo?: string;
	run_id?: number;
}

export interface GithubActionRunTarget {
	owner: string;
	repo: string;
	runId: number;
}

export interface GithubActionRunState {
	runId: number;
	workflowName?: string;
	displayTitle?: string;
	status: string;
	conclusion?: string;
	event?: string;
	headBranch?: string;
	headSha?: string;
	workflowId?: number;
	runAttempt?: number;
	updatedAt?: string;
	htmlUrl: string;
	inProgressJobNames: string[];
	queuedJobNames: string[];
}

export interface GithubActionWatchSummary {
	id: string;
	sessionId: string;
	target: GithubActionRunTarget;
	state: GithubActionRunState;
	pollIntervalMs: number;
}

export interface GithubActionWatchChange {
	watch: GithubActionWatchSummary;
	previousState: GithubActionRunState;
	currentState: GithubActionRunState;
	observedAt: string;
}

export interface GithubActionWatchNotificationDetails {
	watchId: string;
	owner: string;
	repo: string;
	runId: number;
	previousState: GithubActionRunState;
	currentState: GithubActionRunState;
	observedAt: string;
}

export interface GithubActionWatchAttachDetails {
	watchId: string;
	reused: boolean;
	pollIntervalMs: number;
	state: GithubActionRunState;
	runUrl: string;
}

export interface GithubActionWatchStopDetails {
	stopped: boolean;
	watchId?: string;
	target?: GithubActionRunTarget;
}
