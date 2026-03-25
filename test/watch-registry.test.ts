import { describe, expect, it } from "bun:test";
import type { GithubActionRunState, GithubActionRunTarget } from "../src/types";
import { WatchRegistry } from "../src/watch-registry";

function createState(overrides: Partial<GithubActionRunState> = {}): GithubActionRunState {
	return {
		runId: overrides.runId ?? 23343036046,
		workflowName: overrides.workflowName ?? "CI",
		displayTitle: overrides.displayTitle ?? "CI",
		status: overrides.status ?? "queued",
		conclusion: overrides.conclusion,
		event: overrides.event ?? "pull_request",
		headBranch: overrides.headBranch ?? "main",
		headSha: overrides.headSha ?? "abcdef1234567890",
		workflowId: overrides.workflowId ?? 42,
		runAttempt: overrides.runAttempt ?? 1,
		updatedAt: overrides.updatedAt ?? "2026-03-20T00:00:00Z",
		htmlUrl: overrides.htmlUrl ?? "https://github.com/payhawk/emi-service/actions/runs/23343036046",
		inProgressJobNames: overrides.inProgressJobNames ?? [],
		queuedJobNames: overrides.queuedJobNames ?? [],
	};
}

function createTarget(overrides: Partial<GithubActionRunTarget> = {}): GithubActionRunTarget {
	return {
		owner: overrides.owner ?? "payhawk",
		repo: overrides.repo ?? "emi-service",
		runId: overrides.runId ?? 23343036046,
	};
}

function createSequenceClient(states: GithubActionRunState[]) {
	let index = 0;
	return {
		calls: () => index,
		async getWorkflowRun(): Promise<GithubActionRunState> {
			const state = states[Math.min(index, states.length - 1)];
			index += 1;
			return state;
		},
	};
}

function createRegistry(states: GithubActionRunState[]) {
	const timers: Array<() => void> = [];
	const changes: Array<{
		previousStatus: string;
		nextStatus: string;
		previousRunAttempt?: number;
		nextRunAttempt?: number;
	}> = [];
	const client = createSequenceClient(states);
	const registry = new WatchRegistry({
		client,
		onChange: change => {
			changes.push({
				previousStatus: change.previousState.status,
				nextStatus: change.currentState.status,
				previousRunAttempt: change.previousState.runAttempt,
				nextRunAttempt: change.currentState.runAttempt,
			});
		},
		pollIntervalMs: 1_000,
		logger: { debug: () => {}, warn: () => {} },
		now: () => new Date("2026-03-20T12:00:00Z"),
		setTimeoutFn: ((callback: () => void) => {
			timers.push(callback);
			return timers.length as unknown as ReturnType<typeof setTimeout>;
		}) as typeof setTimeout,
		clearTimeoutFn: (() => undefined) as typeof clearTimeout,
	});

	return { registry, client, changes, timers };
}

describe("WatchRegistry", () => {
	it("reuses an existing watch for the same session and target", async () => {
		const initial = createState();
		const { registry, client } = createRegistry([initial]);
		const target = createTarget();

		const first = await registry.attach("session-a", target);
		const second = await registry.attach("session-a", target);

		expect(first.reused).toBe(false);
		expect(second.reused).toBe(true);
		expect(second.watch.id).toBe(first.watch.id);
		expect(client.calls()).toBe(1);
	});

	it("does not emit a change when the fingerprint stays the same", async () => {
		const initial = createState();
		const { registry, changes } = createRegistry([initial, initial]);
		const attached = await registry.attach("session-a", createTarget());

		await registry.pollNow(attached.watch.id);

		expect(changes).toHaveLength(0);
	});

	it("emits a change when the workflow status changes", async () => {
		const queued = createState({ status: "queued", updatedAt: "2026-03-20T00:00:00Z" });
		const inProgress = createState({
			status: "in_progress",
			updatedAt: "2026-03-20T00:01:00Z",
			inProgressJobNames: ["Build and test / Run integration tests / Run tests"],
		});
		const { registry, changes } = createRegistry([queued, inProgress]);
		const attached = await registry.attach("session-a", createTarget());

		await registry.pollNow(attached.watch.id);

		expect(changes).toEqual([
			{
				previousStatus: "queued",
				nextStatus: "in_progress",
				previousRunAttempt: 1,
				nextRunAttempt: 1,
			},
		]);
	});

	it("emits a change when the run attempt changes on rerun", async () => {
		const firstAttempt = createState({ status: "completed", conclusion: "success", runAttempt: 1 });
		const secondAttempt = createState({
			status: "completed",
			conclusion: "success",
			runAttempt: 2,
			updatedAt: "2026-03-20T00:05:00Z",
		});
		const { registry, changes } = createRegistry([firstAttempt, secondAttempt]);
		const attached = await registry.attach("session-a", createTarget());

		await registry.pollNow(attached.watch.id);

		expect(changes).toEqual([
			{
				previousStatus: "completed",
				nextStatus: "completed",
				previousRunAttempt: 1,
				nextRunAttempt: 2,
			},
		]);
	});

	it("emits a change when queued or running job context changes", async () => {
		const waitingForReport = createState({
			status: "queued",
			queuedJobNames: ["Build and test / Image size report / Image size report"],
		});
		const waitingForIntegration = createState({
			status: "queued",
			updatedAt: "2026-03-20T00:02:00Z",
			queuedJobNames: ["Build and test / Run integration tests / Run integration tests without migrations"],
		});
		const { registry, changes } = createRegistry([waitingForReport, waitingForIntegration]);
		const attached = await registry.attach("session-a", createTarget());

		await registry.pollNow(attached.watch.id);

		expect(changes).toEqual([
			{
				previousStatus: "queued",
				nextStatus: "queued",
				previousRunAttempt: 1,
				nextRunAttempt: 1,
			},
		]);
	});

	it("stops watches by id and by session cleanup", async () => {
		const initial = createState();
		const { registry } = createRegistry([initial, initial, initial]);
		const target = createTarget();
		const otherTarget = createTarget({ runId: 23343036047 });
		const thirdTarget = createTarget({ runId: 23343036048 });

		const first = await registry.attach("session-a", target);
		await registry.attach("session-a", otherTarget);
		await registry.attach("session-b", thirdTarget);

		const stoppedById = registry.stopById("session-a", first.watch.id);
		const stoppedBySession = registry.stopSession("session-a");

		expect(stoppedById?.id).toBe(first.watch.id);
		expect(stoppedBySession).toHaveLength(1);
		expect(registry.list("session-a")).toHaveLength(0);
		expect(registry.list("session-b")).toHaveLength(1);
	});
});
