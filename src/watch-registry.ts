import { createWorkflowRunFingerprint, type GithubActionsClient } from "./github-api";
import type {
	GithubActionRunState,
	GithubActionRunTarget,
	GithubActionWatchChange,
	GithubActionWatchSummary,
} from "./types";

export interface WatchRegistryLogger {
	debug(message: string, details?: unknown): void;
	warn(message: string, details?: unknown): void;
}

interface WatchRegistryOptions {
	client: Pick<GithubActionsClient, "getWorkflowRun">;
	onChange: (change: GithubActionWatchChange) => void | Promise<void>;
	pollIntervalMs: number;
	logger?: WatchRegistryLogger;
	now?: () => Date;
	setTimeoutFn?: typeof setTimeout;
	clearTimeoutFn?: typeof clearTimeout;
}

interface WatchRecord {
	id: string;
	sessionId: string;
	target: GithubActionRunTarget;
	state: GithubActionRunState;
	fingerprint: string;
	pollIntervalMs: number;
	active: boolean;
	inFlight: boolean;
	lastErrorAt?: number;
	timer?: ReturnType<typeof setTimeout>;
	pollAbortController?: AbortController;
}

const ERROR_LOG_DEBOUNCE_MS = 60_000;
const noopLogger: WatchRegistryLogger = { debug: () => {}, warn: () => {} };

export class WatchRegistry {
	private readonly watchesById = new Map<string, WatchRecord>();
	private readonly watchIdsBySessionTarget = new Map<string, string>();
	private readonly logger: WatchRegistryLogger;
	private readonly now: () => Date;
	private readonly setTimeoutFn: typeof setTimeout;
	private readonly clearTimeoutFn: typeof clearTimeout;

	constructor(private readonly options: WatchRegistryOptions) {
		this.logger = options.logger ?? noopLogger;
		this.now = options.now ?? (() => new Date());
		this.setTimeoutFn = options.setTimeoutFn ?? setTimeout;
		this.clearTimeoutFn = options.clearTimeoutFn ?? clearTimeout;
	}

	async attach(
		sessionId: string,
		target: GithubActionRunTarget,
	): Promise<{ watch: GithubActionWatchSummary; reused: boolean }> {
		const existing = this.getWatchBySessionTarget(sessionId, target);
		if (existing) {
			this.logger.debug("Reusing existing GitHub Actions watch", {
				sessionId,
				watchId: existing.id,
				target,
			});
			return { watch: this.toSummary(existing), reused: true };
		}

		const state = await this.options.client.getWorkflowRun(target);
		const watch: WatchRecord = {
			id: crypto.randomUUID(),
			sessionId,
			target,
			state,
			fingerprint: createWorkflowRunFingerprint(state),
			pollIntervalMs: this.options.pollIntervalMs,
			active: true,
			inFlight: false,
		};

		this.watchesById.set(watch.id, watch);
		this.watchIdsBySessionTarget.set(this.getSessionTargetKey(sessionId, target), watch.id);
		this.schedulePoll(watch);

		this.logger.debug("Started GitHub Actions watch", {
			sessionId,
			watchId: watch.id,
			target,
			status: state.status,
			conclusion: state.conclusion,
			runAttempt: state.runAttempt,
		});

		return { watch: this.toSummary(watch), reused: false };
	}

	list(sessionId: string): GithubActionWatchSummary[] {
		return [...this.watchesById.values()]
			.filter(watch => watch.sessionId === sessionId)
			.map(watch => this.toSummary(watch))
			.sort((left, right) => left.target.runId - right.target.runId);
	}

	async pollNow(watchId: string): Promise<void> {
		const watch = this.watchesById.get(watchId);
		if (!watch || !watch.active || watch.inFlight) {
			return;
		}

		watch.inFlight = true;
		watch.pollAbortController = new AbortController();

		try {
			const nextState = await this.options.client.getWorkflowRun(watch.target, watch.pollAbortController.signal);
			if (!watch.active) {
				return;
			}

			const previousState = watch.state;
			const nextFingerprint = createWorkflowRunFingerprint(nextState);
			watch.state = nextState;
			watch.fingerprint = nextFingerprint;
			watch.lastErrorAt = undefined;

			if (nextFingerprint === createWorkflowRunFingerprint(previousState)) {
				return;
			}

			this.logger.debug("Observed GitHub Actions run state change", {
				sessionId: watch.sessionId,
				watchId,
				target: watch.target,
				previousStatus: previousState.status,
				nextStatus: nextState.status,
				previousConclusion: previousState.conclusion,
				nextConclusion: nextState.conclusion,
				previousRunAttempt: previousState.runAttempt,
				nextRunAttempt: nextState.runAttempt,
			});

			await this.options.onChange({
				watch: this.toSummary(watch),
				previousState,
				currentState: nextState,
				observedAt: this.now().toISOString(),
			});
		} catch (error) {
			if (!watch.active || watch.pollAbortController?.signal.aborted) {
				return;
			}

			const now = this.now().getTime();
			if (!watch.lastErrorAt || now - watch.lastErrorAt >= ERROR_LOG_DEBOUNCE_MS) {
				this.logger.warn("GitHub Actions watch poll failed", {
					sessionId: watch.sessionId,
					watchId,
					target: watch.target,
					error: error instanceof Error ? error.message : String(error),
				});
			}
			watch.lastErrorAt = now;
		} finally {
			watch.inFlight = false;
			watch.pollAbortController = undefined;
			if (watch.active) {
				this.schedulePoll(watch);
			}
		}
	}

	stopById(sessionId: string, watchId: string): GithubActionWatchSummary | undefined {
		const watch = this.watchesById.get(watchId);
		if (!watch || watch.sessionId !== sessionId) {
			return undefined;
		}

		this.stopWatch(watch);
		return this.toSummary(watch);
	}

	stopByTarget(sessionId: string, target: GithubActionRunTarget): GithubActionWatchSummary | undefined {
		const watch = this.getWatchBySessionTarget(sessionId, target);
		if (!watch) {
			return undefined;
		}

		this.stopWatch(watch);
		return this.toSummary(watch);
	}

	stopSession(sessionId: string): GithubActionWatchSummary[] {
		const stopped = [...this.watchesById.values()]
			.filter(watch => watch.sessionId === sessionId)
			.map(watch => this.stopWatch(watch));

		if (stopped.length > 0) {
			this.logger.debug("Stopped GitHub Actions watches for session", {
				sessionId,
				count: stopped.length,
			});
		}

		return stopped;
	}

	stopAll(): GithubActionWatchSummary[] {
		return [...this.watchesById.values()].map(watch => this.stopWatch(watch));
	}

	private stopWatch(watch: WatchRecord): GithubActionWatchSummary {
		watch.active = false;
		watch.pollAbortController?.abort();
		watch.pollAbortController = undefined;
		if (watch.timer) {
			this.clearTimeoutFn(watch.timer);
			watch.timer = undefined;
		}
		this.watchesById.delete(watch.id);
		this.watchIdsBySessionTarget.delete(this.getSessionTargetKey(watch.sessionId, watch.target));

		this.logger.debug("Stopped GitHub Actions watch", {
			sessionId: watch.sessionId,
			watchId: watch.id,
			target: watch.target,
		});

		return this.toSummary(watch);
	}

	private schedulePoll(watch: WatchRecord): void {
		if (!watch.active) {
			return;
		}

		if (watch.timer) {
			this.clearTimeoutFn(watch.timer);
		}

		watch.timer = this.setTimeoutFn(() => {
			void this.pollNow(watch.id);
		}, watch.pollIntervalMs);
	}

	private getWatchBySessionTarget(sessionId: string, target: GithubActionRunTarget): WatchRecord | undefined {
		const watchId = this.watchIdsBySessionTarget.get(this.getSessionTargetKey(sessionId, target));
		return watchId ? this.watchesById.get(watchId) : undefined;
	}

	private getSessionTargetKey(sessionId: string, target: GithubActionRunTarget): string {
		return `${sessionId}:${target.owner}/${target.repo}:${target.runId}`;
	}

	private toSummary(watch: WatchRecord): GithubActionWatchSummary {
		return {
			id: watch.id,
			sessionId: watch.sessionId,
			target: watch.target,
			state: watch.state,
			pollIntervalMs: watch.pollIntervalMs,
		};
	}
}
