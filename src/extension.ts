import type {
	AgentToolResult,
	ExtensionAPI,
	ExtensionCommandContext,
	ExtensionContext,
} from "@oh-my-pi/pi-coding-agent";
import { GithubActionsClient } from "./github-api";
import { createGithubActionWatchMessageRenderer } from "./render";
import {
	DEFAULT_POLL_INTERVAL_MS,
	GITHUB_ACTION_WATCH_COMMAND,
	GITHUB_ACTION_WATCH_MESSAGE_TYPE,
	type GithubActionRunTarget,
	type GithubActionWatchAttachDetails,
	type GithubActionWatchChange,
	type GithubActionWatchNotificationDetails,
	type GithubActionWatchStopDetails,
	type GithubActionWatchSummary,
	type StopGithubActionWatchParams,
	type WatchGithubActionRunParams,
} from "./types";
import { buildGithubActionWatchSummary } from "./watch-format";
import { WatchRegistry } from "./watch-registry";

export default function githubActionWatchExtension(pi: ExtensionAPI): void {
	pi.setLabel("GitHub Actions Watch");

	const { Type } = pi.typebox;
	const client = new GithubActionsClient((command, args, options) => pi.exec(command, args, options), process.cwd());
	const registry = new WatchRegistry({
		client,
		onChange: change => publishWatchUpdate(pi, change),
		pollIntervalMs: DEFAULT_POLL_INTERVAL_MS,
		logger: pi.logger,
	});

	pi.registerMessageRenderer(
		GITHUB_ACTION_WATCH_MESSAGE_TYPE,
		createGithubActionWatchMessageRenderer({ Container: pi.pi.Container, Spacer: pi.pi.Spacer, Text: pi.pi.Text }),
	);

	pi.registerTool({
		name: "watch_github_action_run",
		label: "Watch GitHub Action Run",
		description:
			"Attach a session-scoped watcher to a GitHub Actions workflow run by repository owner, repo, and run ID.",
		parameters: Type.Object({
			owner: Type.String({ minLength: 1 }),
			repo: Type.String({ minLength: 1 }),
			run_id: Type.Number({ minimum: 1 }),
		}),
		async execute(_toolCallId, params: WatchGithubActionRunParams, _signal, _onUpdate, ctx) {
			return attachWatch(registry, params, ctx);
		},
	});

	pi.registerTool({
		name: "stop_github_action_watch",
		label: "Stop GitHub Action Watch",
		description:
			"Stop a session-scoped GitHub Actions workflow run watcher by watch ID or by owner, repo, and run ID.",
		parameters: Type.Object({
			watch_id: Type.Optional(Type.String({ minLength: 1 })),
			owner: Type.Optional(Type.String({ minLength: 1 })),
			repo: Type.Optional(Type.String({ minLength: 1 })),
			run_id: Type.Optional(Type.Number({ minimum: 1 })),
		}),
		async execute(_toolCallId, params: StopGithubActionWatchParams, _signal, _onUpdate, ctx) {
			return stopWatch(registry, params, ctx);
		},
	});

	pi.registerCommand(GITHUB_ACTION_WATCH_COMMAND, {
		description: "Stop or inspect GitHub Actions workflow run watchers",
		getArgumentCompletions: prefix => {
			const subcommands = ["help", "list", "stop"];
			if (!prefix) {
				return subcommands.map(value => ({ label: value, value }));
			}
			return subcommands.filter(value => value.startsWith(prefix)).map(value => ({ label: value, value }));
		},
		handler: async (args, ctx) => {
			await handleCommand(registry, args, ctx);
		},
	});

	pi.on("session_before_switch", async (_event, ctx) => {
		cleanupCurrentSession(registry, ctx, "switch", pi);
		return undefined;
	});
	pi.on("session_before_branch", async (_event, ctx) => {
		cleanupCurrentSession(registry, ctx, "branch", pi);
		return undefined;
	});
	pi.on("session_shutdown", async () => {
		const stopped = registry.stopAll();
		if (stopped.length > 0) {
			pi.logger.debug("Stopped GitHub Actions watches on shutdown", { count: stopped.length });
		}
	});
}

async function attachWatch(
	registry: WatchRegistry,
	params: WatchGithubActionRunParams,
	ctx: ExtensionContext,
): Promise<AgentToolResult<GithubActionWatchAttachDetails>> {
	const target = normalizeTarget(params);
	const sessionId = ctx.sessionManager.getSessionId();
	const { watch, reused } = await registry.attach(sessionId, target);

	return {
		content: [
			{
				type: "text",
				text: reused
					? `Reusing GitHub Actions watch ${watch.id} for ${formatTarget(target)} (${formatState(watch.state)}).`
					: `Started GitHub Actions watch ${watch.id} for ${formatTarget(target)} (${formatState(watch.state)}).`,
			},
		],
		details: {
			watchId: watch.id,
			reused,
			pollIntervalMs: watch.pollIntervalMs,
			state: watch.state,
			runUrl: watch.state.htmlUrl,
		},
	};
}

async function stopWatch(
	registry: WatchRegistry,
	params: StopGithubActionWatchParams,
	ctx: ExtensionContext,
): Promise<AgentToolResult<GithubActionWatchStopDetails>> {
	const sessionId = ctx.sessionManager.getSessionId();
	const stopTarget = resolveStopTarget(params);
	const stopped =
		"watchId" in stopTarget
			? registry.stopById(sessionId, stopTarget.watchId)
			: registry.stopByTarget(sessionId, stopTarget.target);

	if (!stopped) {
		return {
			content: [
				{
					type: "text",
					text:
						"watchId" in stopTarget
							? `No active GitHub Actions watch with id ${stopTarget.watchId} exists in this session.`
							: `No active GitHub Actions watch exists for ${formatTarget(stopTarget.target)} in this session.`,
				},
			],
			details: {
				stopped: false,
				watchId: "watchId" in stopTarget ? stopTarget.watchId : undefined,
				target: "target" in stopTarget ? stopTarget.target : undefined,
			},
		};
	}

	return {
		content: [
			{
				type: "text",
				text: `Stopped GitHub Actions watch ${stopped.id} for ${formatTarget(stopped.target)}.`,
			},
		],
		details: { stopped: true, watchId: stopped.id, target: stopped.target },
	};
}

async function handleCommand(registry: WatchRegistry, args: string, ctx: ExtensionCommandContext): Promise<void> {
	const [subcommand, ...rest] = args.trim().split(/\s+/).filter(Boolean);
	if (!subcommand || subcommand === "help") {
		ctx.ui.notify(
			[
				"GitHub Actions Watch",
				"",
				`  /${GITHUB_ACTION_WATCH_COMMAND} list`,
				`  /${GITHUB_ACTION_WATCH_COMMAND} stop <watch-id>`,
			].join("\n"),
			"info",
		);
		return;
	}

	if (subcommand === "list") {
		showWatchList(registry.list(ctx.sessionManager.getSessionId()), ctx);
		return;
	}

	if (subcommand === "stop") {
		const watchId = rest[0];
		if (!watchId) {
			ctx.ui.notify(`Usage: /${GITHUB_ACTION_WATCH_COMMAND} stop <watch-id>`, "error");
			return;
		}

		const stopped = registry.stopById(ctx.sessionManager.getSessionId(), watchId);
		if (!stopped) {
			ctx.ui.notify(`No active GitHub Actions watch with id ${watchId} exists in this session.`, "error");
			return;
		}

		ctx.ui.notify(`Stopped GitHub Actions watch ${stopped.id} for ${formatTarget(stopped.target)}.`, "info");
		return;
	}

	ctx.ui.notify(`Unknown subcommand '${subcommand}'. Use /${GITHUB_ACTION_WATCH_COMMAND} help.`, "error");
}

function showWatchList(watches: GithubActionWatchSummary[], ctx: ExtensionCommandContext): void {
	if (watches.length === 0) {
		ctx.ui.notify("No active GitHub Actions watches in this session.", "info");
		return;
	}

	const lines = ["Active GitHub Actions watches", "", ...watches.map(renderWatchListLine)];
	ctx.ui.notify(lines.join("\n"), "info");
}

function renderWatchListLine(watch: GithubActionWatchSummary): string {
	return `- ${watch.id} | ${formatTarget(watch.target)} | ${formatState(watch.state)}`;
}

function cleanupCurrentSession(registry: WatchRegistry, ctx: ExtensionContext, reason: string, pi: ExtensionAPI): void {
	const sessionId = ctx.sessionManager.getSessionId();
	const stopped = registry.stopSession(sessionId);
	if (stopped.length > 0) {
		pi.logger.debug("Stopped GitHub Actions watches for session lifecycle event", {
			reason,
			sessionId,
			count: stopped.length,
		});
	}
}

function publishWatchUpdate(pi: ExtensionAPI, change: GithubActionWatchChange): void {
	const details: GithubActionWatchNotificationDetails = {
		watchId: change.watch.id,
		owner: change.watch.target.owner,
		repo: change.watch.target.repo,
		runId: change.watch.target.runId,
		previousState: change.previousState,
		currentState: change.currentState,
		observedAt: change.observedAt,
	};

	pi.sendMessage(
		{
			customType: GITHUB_ACTION_WATCH_MESSAGE_TYPE,
			content: buildGithubActionWatchSummary(details),
			display: true,
			details,
			attribution: "agent",
		},
		{ triggerTurn: true, deliverAs: "followUp" },
	);
}

function normalizeTarget(params: WatchGithubActionRunParams): GithubActionRunTarget {
	const owner = params.owner.trim();
	const repo = params.repo.trim();
	const runId = Math.trunc(params.run_id);
	if (!owner || !repo || runId <= 0) {
		throw new Error("owner, repo, and run_id must all be provided to watch a GitHub Actions run.");
	}
	return { owner, repo, runId };
}

type StopTarget = { watchId: string } | { target: GithubActionRunTarget };

function resolveStopTarget(params: StopGithubActionWatchParams): StopTarget {
	if (params.watch_id) {
		return { watchId: params.watch_id.trim() };
	}

	if (!params.owner || !params.repo || params.run_id === undefined) {
		throw new Error(
			"Provide either watch_id or the full owner, repo, and run_id tuple to stop a GitHub Actions watch.",
		);
	}

	return { target: normalizeTarget({ owner: params.owner, repo: params.repo, run_id: params.run_id }) };
}

function formatTarget(target: GithubActionRunTarget): string {
	return `${target.owner}/${target.repo}#${target.runId}`;
}

function formatState(state: { status: string; conclusion?: string }): string {
	return state.status === "completed" && state.conclusion ? `${state.status}/${state.conclusion}` : state.status;
}
