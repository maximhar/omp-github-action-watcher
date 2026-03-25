import { describe, expect, it } from "bun:test";
import { mapWorkflowRunResponse } from "../src/github-api";
import type { GithubActionRunTarget } from "../src/types";

const target: GithubActionRunTarget = {
	owner: "payhawk",
	repo: "emi-service",
	runId: 23343036046,
};

describe("mapWorkflowRunResponse", () => {
	it("captures running and queued job names for workflow context", () => {
		const state = mapWorkflowRunResponse(
			target,
			{
				id: 23343036046,
				name: "PR",
				display_title: "FT-24318 feat(fx-rebalancing): FX rebalancing core functionality",
				status: "queued",
				event: "pull_request",
				head_branch: "FT-24318-impl",
				head_sha: "493bc33eb40e9c8ab6c414d27e4eaf7130eb1c0c",
				workflow_id: 61771857,
				run_attempt: 1,
				updated_at: "2026-03-25T08:55:06.524Z",
				html_url: "https://github.com/payhawk/emi-service/actions/runs/23343036046",
			},
			{
				jobs: [
					{ name: "Build and test / Run integration tests / Run tests", status: "in_progress" },
					{
						name: "Build and test / Run integration tests / Run integration tests without migrations",
						status: "queued",
					},
					{ name: "Build and test / Run integration tests / On failure for Run integration tests", status: "waiting" },
				],
			},
		);

		expect(state.inProgressJobNames).toEqual(["Build and test / Run integration tests / Run tests"]);
		expect(state.queuedJobNames).toEqual([
			"Build and test / Run integration tests / Run integration tests without migrations",
			"Build and test / Run integration tests / On failure for Run integration tests",
		]);
	});

	it("falls back to empty job context when jobs are unavailable", () => {
		const state = mapWorkflowRunResponse(target, {
			id: 23343036046,
			name: "PR",
			status: "in_progress",
			html_url: "https://github.com/payhawk/emi-service/actions/runs/23343036046",
		});

		expect(state.inProgressJobNames).toEqual([]);
		expect(state.queuedJobNames).toEqual([]);
	});
});
