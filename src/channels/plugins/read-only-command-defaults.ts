import type { OpenClawConfig } from "../../config/types.openclaw.js";
import { isBlockedObjectKey } from "../../infra/prototype-keys.js";
import type { PluginManifestRecord } from "../../plugins/manifest-registry.js";
import {
  isPluginEnabled,
  loadPluginManifestRegistryForPluginRegistry,
} from "../../plugins/plugin-registry.js";
import { normalizeOptionalString } from "../../shared/string-coerce.js";

const SAFE_MANIFEST_CHANNEL_ID_PATTERN = /^[a-z0-9][a-z0-9_-]{0,63}$/i;

type ManifestChannelConfigRecord = NonNullable<PluginManifestRecord["channelConfigs"]>[string];

export type ChannelCommandDefaults = {
  nativeCommandsAutoEnabled?: boolean;
  nativeSkillsAutoEnabled?: boolean;
};

function isSafeManifestChannelId(channelId: string): boolean {
  return SAFE_MANIFEST_CHANNEL_ID_PATTERN.test(channelId) && !isBlockedObjectKey(channelId);
}

function readOwnRecordValue(record: Record<string, unknown>, key: string): unknown {
  if (isBlockedObjectKey(key) || !Object.prototype.hasOwnProperty.call(record, key)) {
    return undefined;
  }
  return record[key];
}

function hasExplicitDisabledPluginEntry(
  config: OpenClawConfig | undefined,
  pluginId: string,
): boolean {
  const entries = config?.plugins?.entries;
  if (!entries || typeof entries !== "object" || Array.isArray(entries)) {
    return false;
  }
  const entry = readOwnRecordValue(entries as Record<string, unknown>, pluginId);
  if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
    return false;
  }
  return (entry as { enabled?: unknown }).enabled === false;
}

export function normalizeChannelCommandDefaults(
  value: ChannelCommandDefaults | undefined,
): ChannelCommandDefaults | undefined {
  if (!value) {
    return undefined;
  }
  const nativeCommandsAutoEnabled =
    typeof value.nativeCommandsAutoEnabled === "boolean"
      ? value.nativeCommandsAutoEnabled
      : undefined;
  const nativeSkillsAutoEnabled =
    typeof value.nativeSkillsAutoEnabled === "boolean" ? value.nativeSkillsAutoEnabled : undefined;
  return nativeCommandsAutoEnabled !== undefined || nativeSkillsAutoEnabled !== undefined
    ? {
        ...(nativeCommandsAutoEnabled !== undefined ? { nativeCommandsAutoEnabled } : {}),
        ...(nativeSkillsAutoEnabled !== undefined ? { nativeSkillsAutoEnabled } : {}),
      }
    : undefined;
}

export function resolveReadOnlyChannelCommandDefaults(
  channelId: string,
  options: {
    env?: NodeJS.ProcessEnv;
    stateDir?: string;
    workspaceDir?: string;
    config?: OpenClawConfig;
  } = {},
): ChannelCommandDefaults | undefined {
  const normalizedChannelId = normalizeOptionalString(channelId) ?? "";
  if (!normalizedChannelId || !isSafeManifestChannelId(normalizedChannelId)) {
    return undefined;
  }
  const registry = loadPluginManifestRegistryForPluginRegistry({
    config: options.config,
    stateDir: options.stateDir,
    workspaceDir: options.workspaceDir,
    env: options.env ?? process.env,
    includeDisabled: true,
  });
  for (const record of registry.plugins) {
    if (!record.channels.includes(normalizedChannelId)) {
      continue;
    }
    const enabled = isPluginEnabled({
      pluginId: record.id,
      config: options.config,
      stateDir: options.stateDir,
      workspaceDir: options.workspaceDir,
      env: options.env ?? process.env,
    });
    const explicitlyDisabled =
      hasExplicitDisabledPluginEntry(options.config, record.id) ||
      (record.id !== normalizedChannelId &&
        hasExplicitDisabledPluginEntry(options.config, normalizedChannelId));
    if (!enabled && (record.origin !== "bundled" || explicitlyDisabled)) {
      continue;
    }
    const channelConfigValue = record.channelConfigs
      ? readOwnRecordValue(record.channelConfigs as Record<string, unknown>, normalizedChannelId)
      : undefined;
    const channelConfig =
      channelConfigValue &&
      typeof channelConfigValue === "object" &&
      !Array.isArray(channelConfigValue)
        ? (channelConfigValue as ManifestChannelConfigRecord)
        : undefined;
    const commands = normalizeChannelCommandDefaults(
      channelConfig?.commands ?? record.channelCatalogMeta?.commands,
    );
    if (commands) {
      return commands;
    }
  }
  return undefined;
}
