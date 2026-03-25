import type { ExtensionAPI, MessageRenderer, Theme } from "@oh-my-pi/pi-coding-agent";
import type { GithubActionRunState, GithubActionWatchNotificationDetails } from "./types";
import {
	buildCompactJobContext,
	buildGithubActionWatchRenderLines,
	formatStateText,
	shortSha,
} from "./watch-format";

export function createGithubActionWatchMessageRenderer(
	piRuntime: Pick<ExtensionAPI["pi"], "Container" | "Spacer" | "Text">,
): MessageRenderer<GithubActionWatchNotificationDetails> {
	return (message, options, theme) => {
		const details = message.details;
		if (!details) {
			return undefined;
		}

		const { Container, Spacer, Text } = piRuntime;
		const container = new Container();
		container.addChild(new Spacer(1));
		container.addChild(new Text(buildHeaderLine(details, theme), 0, 0));
		container.addChild(new Text(buildTransitionLine(details.previousState, details.currentState, theme), 0, 0));

		if (!options.expanded) {
			container.addChild(new Text(buildCompactMetaLine(details.currentState, details.observedAt, theme), 0, 0));
			return container;
		}

		for (const line of buildGithubActionWatchRenderLines(details)) {
			container.addChild(new Text(styleDetailLine(line, theme), 0, 0));
		}

		return container;
	};
}

function buildHeaderLine(details: GithubActionWatchNotificationDetails, theme: Theme): string {
	return [
		theme.fg("accent", theme.bold("GitHub Actions Watch")),
		theme.fg("muted", `${details.owner}/${details.repo}`),
		theme.fg("dim", `run ${details.runId}`),
	].join("  ");
}

function buildTransitionLine(previous: GithubActionRunState, current: GithubActionRunState, theme: Theme): string {
	return [
		theme.fg("dim", "state"),
		colorizeState(previous, theme),
		theme.fg("dim", "->"),
		colorizeState(current, theme),
	].join(" ");
}

function buildCompactMetaLine(current: GithubActionRunState, observedAt: string, theme: Theme): string {
	const parts = [
		current.displayTitle ?? current.workflowName,
		buildCompactJobContext(current),
		current.headBranch,
		current.headSha ? shortSha(current.headSha) : undefined,
		typeof current.runAttempt === "number" ? `attempt ${current.runAttempt}` : undefined,
		observedAt,
	].filter(Boolean);
	return theme.fg("dim", parts.join(" · "));
}

function styleDetailLine(line: string, theme: Theme): string {
	const separator = line.indexOf(": ");
	if (separator === -1) {
		return theme.fg("muted", line);
	}

	const label = line.slice(0, separator + 1);
	const value = line.slice(separator + 2);
	return `${theme.fg("dim", label)} ${theme.fg("muted", value)}`;
}

function colorizeState(state: GithubActionRunState, theme: Theme): string {
	const color = pickStateColor(state);
	return theme.fg(color, formatStateText(state));
}

function pickStateColor(state: GithubActionRunState): "accent" | "warning" | "success" | "error" | "muted" {
	if (state.status === "completed") {
		if (state.conclusion === "success") return "success";
		if (state.conclusion === "failure" || state.conclusion === "cancelled" || state.conclusion === "timed_out") {
			return "error";
		}
		return "warning";
	}

	if (state.status === "queued" || state.status === "waiting" || state.status === "requested") {
		return "warning";
	}

	if (state.status === "in_progress") {
		return "accent";
	}

	return "muted";
}
