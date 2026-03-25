import { describe, expect, it } from "bun:test";
import type { GithubActionRunState, GithubActionWatchNotificationDetails } from "../src/types";
import { buildGithubActionWatchRenderLines, buildGithubActionWatchSummary } from "../src/watch-format";

function createState(overrides: Partial<GithubActionRunState> = {}): GithubActionRunState {
	return {
		runId: 23343036046,
		workflowName: "CI",
		displayTitle: "CI",
		status: "queued",
		conclusion: undefined,
		event: "pull_request",
		headBranch: "main",
		headSha: "abcdef1234567890",
		workflowId: 42,
		runAttempt: 1,
		updatedAt: "2026-03-20T00:00:00Z",
		htmlUrl: "https://github.com/payhawk/emi-service/actions/runs/23343036046",
		inProgressJobNames: [],
		queuedJobNames: [],
		...overrides,
	};
}

function createDetails(): GithubActionWatchNotificationDetails {
	return {
		watchId: "watch-1",
		owner: "payhawk",
		repo: "emi-service",
		runId: 23343036046,
		previousState: createState({
			status: "queued",
			updatedAt: "2026-03-20T00:00:00Z",
			queuedJobNames: ["Build and test / Image size report / Image size report"],
		}),
		currentState: createState({
			status: "in_progress",
			updatedAt: "2026-03-20T00:01:00Z",
			inProgressJobNames: ["Build and test / Run integration tests / Run integration tests / Run tests"],
			queuedJobNames: ["Build and test / Run integration tests / Run integration tests without migrations"],
		}),
		observedAt: "2026-03-20T12:00:00Z",
	};
}

describe("GitHub action watch render helpers", () => {
	it("builds a summary describing the state transition and active jobs", () => {
		const summary = buildGithubActionWatchSummary(createDetails());

		expect(summary).toBe(
			"GitHub Actions run payhawk/emi-service#23343036046 changed from queued to in_progress (attempt 1). Active job: Build and test / Run integration tests / Run integration tests / Run tests.",
		);
	});

	it("builds expanded render lines with transition metadata and job context", () => {
		const lines = buildGithubActionWatchRenderLines(createDetails());

		expect(lines).toContain("repo: payhawk/emi-service");
		expect(lines).toContain("run: 23343036046");
		expect(lines).toContain("transition: queued -> in_progress");
		expect(lines).toContain(
			"running jobs: Build and test / Run integration tests / Run integration tests / Run tests",
		);
		expect(lines).toContain(
			"queued jobs: Build and test / Run integration tests / Run integration tests without migrations",
		);
		expect(lines).toContain("branch: main");
		expect(lines).toContain("sha: abcdef1");
		expect(lines).toContain("attempt: 1");
		expect(lines).toContain("event: pull_request");
		expect(lines).toContain("observed: 2026-03-20T12:00:00Z");
		expect(lines).toContain("url: https://github.com/payhawk/emi-service/actions/runs/23343036046");
	});

	it("describes queued jobs when the run drops back to queued", () => {
		const summary = buildGithubActionWatchSummary({
			...createDetails(),
			previousState: createState({ status: "in_progress", inProgressJobNames: ["Build and test / Run unit tests"] }),
			currentState: createState({
				status: "queued",
				queuedJobNames: ["Build and test / Image size report / Image size report"],
			}),
		});

		expect(summary).toBe(
			"GitHub Actions run payhawk/emi-service#23343036046 changed from in_progress to queued (attempt 1). Queued job: Build and test / Image size report / Image size report.",
		);
	});
});
