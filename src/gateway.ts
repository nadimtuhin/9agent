import { Command } from "commander";
import process from "node:process";
import {
  CONFIG_PATH,
  getLastGateway,
  profileName,
  readConfig,
  setLastGateway,
  writeConfig,
} from "./profiles.js";

function resolveEffectiveGateway(): string {
  return process.env.NINEROUTER_URL ?? getLastGateway() ?? "http://localhost:20128/v1";
}

function listGateways(): void {
  const config = readConfig(CONFIG_PATH);
  const active = resolveEffectiveGateway();
  const urls = Object.keys(config.profiles);

  if (urls.length === 0) {
    console.log("No saved gateway profiles.");
    return;
  }

  console.log("Saved gateway profiles:");
  for (const url of urls) {
    const marker = url === active ? " [active]" : "";
    const key = config.profiles[url]?.key ? " (key saved)" : " (no key)";
    console.log(`  ${url}${marker}${key}`);
  }
}

function useGateway(url: string): void {
  const name = profileName(url);
  const config = readConfig(CONFIG_PATH);
  if (!config.profiles[name]) {
    console.error(`No saved profile for ${url}.`);
    process.exit(1);
  }
  setLastGateway(url);
  console.log(`Default gateway set to ${url}.`);
  if (config.profiles[name]?.key) {
    console.log("A key is saved for this gateway.");
  }
}

function forgetGateway(url: string): void {
  const name = profileName(url);
  const config = readConfig(CONFIG_PATH);
  if (!config.profiles[name]) {
    console.error(`No saved profile for ${url}.`);
    process.exit(1);
  }

  const hadKey = Boolean(config.profiles[name]?.key);
  const { [name]: _profile, ...profiles } = config.profiles;
  config.profiles = profiles;

  const hadLastModels = config.lastModels?.[name] !== undefined;
  if (config.lastModels) {
    const { [name]: _models, ...rest } = config.lastModels;
    config.lastModels = rest;
  }

  const clearedLastGateway = config.lastGateway === url;
  if (clearedLastGateway) delete config.lastGateway;

  writeConfig(CONFIG_PATH, config);

  const removed: string[] = [];
  if (hadKey) removed.push("key");
  if (hadLastModels) removed.push("last models");
  if (clearedLastGateway) removed.push("default gateway");

  console.log(
    removed.length > 0
      ? `Forgot ${removed.join(", ")} for ${url}.`
      : `Removed profile for ${url}.`,
  );
}

export function registerGatewayCommands(program: Command): void {
  const gw = program.command("gateway").description("manage saved gateway profiles");
  gw.command("list").description("list saved gateway profiles").action(listGateways);
  gw.command("use <url>").description("set a saved gateway as the default").action(useGateway);
  gw.command("forget <url>")
    .description("remove a saved gateway profile")
    .action(forgetGateway);
}
