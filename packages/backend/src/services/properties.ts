/**
 * Properties service — reads, writes, and provides metadata for
 * Minecraft server.properties files.
 *
 * The server.properties format is a Java properties file:
 *   - Lines starting with # are comments
 *   - Key=value pairs (no quoting needed)
 *   - Keys may contain hyphens and dots
 *   - Order is not significant
 */

import fs from 'node:fs';
import path from 'node:path';
import type { PropertyGroup } from '@mc-server-manager/shared';
import { logger } from '../utils/logger.js';

// ============================================================
// Property Metadata — grouped definitions with descriptions
// ============================================================

/**
 * Comprehensive property definitions grouped logically.
 * Only includes the most commonly configured properties.
 * The server may have additional properties not listed here;
 * those appear in an "Other" section in the UI.
 */
export const PROPERTY_GROUPS: PropertyGroup[] = [
  {
    id: 'gameplay',
    label: 'Gameplay',
    description: 'Core gameplay settings like game mode, difficulty, and player limits',
    properties: [
      {
        key: 'gamemode',
        label: 'Game Mode',
        description: 'The default game mode for new players joining the server.',
        type: 'select',
        defaultValue: 'survival',
        options: [
          { value: 'survival', label: 'Survival' },
          { value: 'creative', label: 'Creative' },
          { value: 'adventure', label: 'Adventure' },
          { value: 'spectator', label: 'Spectator' },
        ],
      },
      {
        key: 'difficulty',
        label: 'Difficulty',
        description: 'Server difficulty level. Affects mob damage, hunger drain, and other survival mechanics.',
        type: 'select',
        defaultValue: 'easy',
        options: [
          { value: 'peaceful', label: 'Peaceful' },
          { value: 'easy', label: 'Easy' },
          { value: 'normal', label: 'Normal' },
          { value: 'hard', label: 'Hard' },
        ],
      },
      {
        key: 'max-players',
        label: 'Max Players',
        description: 'Maximum number of players that can be connected simultaneously.',
        type: 'number',
        defaultValue: '20',
        min: 1,
        max: 1000,
      },
      {
        key: 'pvp',
        label: 'PvP',
        description: 'Whether players can damage each other.',
        type: 'boolean',
        defaultValue: 'true',
      },
      {
        key: 'hardcore',
        label: 'Hardcore',
        description: 'Players are set to spectator mode on death. Only works with survival game mode.',
        type: 'boolean',
        defaultValue: 'false',
      },
      {
        key: 'force-gamemode',
        label: 'Force Game Mode',
        description: 'Force players to join in the default game mode, even if they left in a different one.',
        type: 'boolean',
        defaultValue: 'false',
      },
      {
        key: 'spawn-monsters',
        label: 'Spawn Monsters',
        description: 'Whether hostile mobs can spawn naturally.',
        type: 'boolean',
        defaultValue: 'true',
      },
      {
        key: 'spawn-animals',
        label: 'Spawn Animals',
        description: 'Whether passive mobs (animals) can spawn naturally.',
        type: 'boolean',
        defaultValue: 'true',
      },
      {
        key: 'spawn-npcs',
        label: 'Spawn NPCs',
        description: 'Whether villagers and other NPCs can spawn.',
        type: 'boolean',
        defaultValue: 'true',
      },
      {
        key: 'allow-flight',
        label: 'Allow Flight',
        description: 'Allow players to fly in survival mode (requires mod on client). If false, players are kicked for flying.',
        type: 'boolean',
        defaultValue: 'false',
      },
      {
        key: 'generate-structures',
        label: 'Generate Structures',
        description: 'Whether structures (villages, dungeons, etc.) are generated in new chunks.',
        type: 'boolean',
        defaultValue: 'true',
      },
      {
        key: 'allow-nether',
        label: 'Allow Nether',
        description: 'Whether players can travel to the Nether dimension.',
        type: 'boolean',
        defaultValue: 'true',
      },
      {
        key: 'enable-command-block',
        label: 'Enable Command Blocks',
        description: 'Whether command blocks are enabled on the server.',
        type: 'boolean',
        defaultValue: 'false',
      },
      {
        key: 'spawn-protection',
        label: 'Spawn Protection Radius',
        description: 'Radius of blocks around the spawn point that non-ops cannot modify. Set to 0 to disable.',
        type: 'number',
        defaultValue: '16',
        min: 0,
        max: 1000,
      },
    ],
  },
  {
    id: 'network',
    label: 'Network',
    description: 'Network settings including port, IP binding, and online mode',
    properties: [
      {
        key: 'server-port',
        label: 'Server Port',
        description: 'The port the server listens on. Default is 25565.',
        type: 'number',
        defaultValue: '25565',
        min: 1024,
        max: 65535,
      },
      {
        key: 'server-ip',
        label: 'Server IP',
        description: 'The IP address to bind to. Leave blank to bind to all interfaces.',
        type: 'string',
        defaultValue: '',
      },
      {
        key: 'online-mode',
        label: 'Online Mode',
        description: 'Whether to authenticate players with Mojang servers. Disable only for offline/LAN play.',
        type: 'boolean',
        defaultValue: 'true',
      },
      {
        key: 'white-list',
        label: 'Whitelist',
        description: 'Only allow whitelisted players to connect.',
        type: 'boolean',
        defaultValue: 'false',
      },
      {
        key: 'enforce-whitelist',
        label: 'Enforce Whitelist',
        description: 'Kick non-whitelisted players when the whitelist is reloaded.',
        type: 'boolean',
        defaultValue: 'false',
      },
      {
        key: 'motd',
        label: 'MOTD',
        description: 'Message displayed in the server list. Supports color codes with the section sign.',
        type: 'string',
        defaultValue: 'A Minecraft Server',
      },
      {
        key: 'enable-query',
        label: 'Enable Query',
        description: 'Enable GameSpy4 query protocol for server listing services.',
        type: 'boolean',
        defaultValue: 'false',
      },
      {
        key: 'enable-rcon',
        label: 'Enable RCON',
        description: 'Enable remote console access. Requires setting an RCON password.',
        type: 'boolean',
        defaultValue: 'false',
      },
      {
        key: 'prevent-proxy-connections',
        label: 'Prevent Proxy Connections',
        description: 'If the ISP/AS sent from the server is different from Mojang\'s auth server, the player is kicked.',
        type: 'boolean',
        defaultValue: 'false',
      },
    ],
  },
  {
    id: 'world',
    label: 'World',
    description: 'World generation and rendering settings',
    properties: [
      {
        key: 'level-name',
        label: 'World Name',
        description: 'The name of the world folder. Changing this will create/load a different world.',
        type: 'string',
        defaultValue: 'world',
      },
      {
        key: 'level-seed',
        label: 'World Seed',
        description: 'Seed for world generation. Leave blank for random.',
        type: 'string',
        defaultValue: '',
      },
      {
        key: 'level-type',
        label: 'World Type',
        description: 'The type of world to generate.',
        type: 'select',
        defaultValue: 'minecraft\\:normal',
        options: [
          { value: 'minecraft\\:normal', label: 'Normal' },
          { value: 'minecraft\\:flat', label: 'Flat' },
          { value: 'minecraft\\:large_biomes', label: 'Large Biomes' },
          { value: 'minecraft\\:amplified', label: 'Amplified' },
          { value: 'minecraft\\:single_biome_surface', label: 'Single Biome' },
        ],
      },
      {
        key: 'view-distance',
        label: 'View Distance',
        description: 'How many chunks are visible to players. Higher = more memory usage. 10 is default.',
        type: 'number',
        defaultValue: '10',
        min: 2,
        max: 32,
      },
      {
        key: 'simulation-distance',
        label: 'Simulation Distance',
        description: 'How many chunks around each player are actively simulated (mob AI, redstone, etc.).',
        type: 'number',
        defaultValue: '10',
        min: 2,
        max: 32,
      },
      {
        key: 'max-world-size',
        label: 'Max World Size',
        description: 'Maximum radius of the world border in blocks.',
        type: 'number',
        defaultValue: '29999984',
        min: 1,
        max: 29999984,
      },
    ],
  },
  {
    id: 'advanced',
    label: 'Advanced',
    description: 'Performance tuning and advanced server settings',
    properties: [
      {
        key: 'max-tick-time',
        label: 'Max Tick Time (ms)',
        description: 'Maximum milliseconds a single tick may take before the server watchdog kills the process. Set to -1 to disable.',
        type: 'number',
        defaultValue: '60000',
        min: -1,
        max: 600000,
      },
      {
        key: 'network-compression-threshold',
        label: 'Network Compression Threshold',
        description: 'Packets larger than this (in bytes) are compressed. Set to -1 to disable, 0 to compress everything.',
        type: 'number',
        defaultValue: '256',
        min: -1,
        max: 65535,
      },
      {
        key: 'rate-limit',
        label: 'Rate Limit',
        description: 'Maximum number of packets per second before a player is kicked. 0 to disable.',
        type: 'number',
        defaultValue: '0',
        min: 0,
        max: 10000,
      },
      {
        key: 'op-permission-level',
        label: 'OP Permission Level',
        description: 'Default permission level for ops. 1=bypass protection, 2=cheat commands, 3=manage players, 4=everything.',
        type: 'select',
        defaultValue: '4',
        options: [
          { value: '1', label: '1 - Bypass spawn protection' },
          { value: '2', label: '2 - Cheat commands' },
          { value: '3', label: '3 - Manage players (kick/ban)' },
          { value: '4', label: '4 - Full access' },
        ],
      },
      {
        key: 'player-idle-timeout',
        label: 'Player Idle Timeout (min)',
        description: 'Kick players after this many minutes of inactivity. 0 to disable.',
        type: 'number',
        defaultValue: '0',
        min: 0,
        max: 1440,
      },
      {
        key: 'entity-broadcast-range-percentage',
        label: 'Entity Broadcast Range %',
        description: 'Percentage of default entity tracking range. Lower = less bandwidth usage.',
        type: 'number',
        defaultValue: '100',
        min: 10,
        max: 1000,
      },
      {
        key: 'sync-chunk-writes',
        label: 'Sync Chunk Writes',
        description: 'Whether chunk writes are synchronous. Disabling may improve performance but risks data loss on crash.',
        type: 'boolean',
        defaultValue: 'true',
      },
      {
        key: 'enable-jmx-monitoring',
        label: 'Enable JMX Monitoring',
        description: 'Expose an MBean for JMX monitoring tools.',
        type: 'boolean',
        defaultValue: 'false',
      },
    ],
  },
];

/**
 * Set of all known property keys (from the groups above).
 */
const KNOWN_KEYS = new Set(
  PROPERTY_GROUPS.flatMap((g) => g.properties.map((p) => p.key)),
);

// ============================================================
// Parsing and Writing
// ============================================================

/**
 * Parse a server.properties file into a key-value Record.
 * Handles comments (#), empty lines, and escaped characters.
 */
export function parseProperties(content: string): Record<string, string> {
  const props: Record<string, string> = {};

  for (const rawLine of content.split('\n')) {
    const line = rawLine.trim();

    // Skip empty lines and comments
    if (!line || line.startsWith('#')) continue;

    // Split on first '=' only (values can contain '=')
    const eqIndex = line.indexOf('=');
    if (eqIndex === -1) continue;

    const key = line.slice(0, eqIndex).trim();
    const value = line.slice(eqIndex + 1); // Don't trim value — spaces may be intentional

    if (key) {
      props[key] = value;
    }
  }

  return props;
}

/**
 * Serialize a key-value Record into server.properties format.
 * Preserves alphabetical ordering.
 */
export function serializeProperties(props: Record<string, string>): string {
  const lines = [
    '#Minecraft server properties',
    `#${new Date().toUTCString()}`,
  ];

  for (const [key, value] of Object.entries(props).sort(([a], [b]) => a.localeCompare(b))) {
    lines.push(`${key}=${value}`);
  }

  lines.push(''); // trailing newline
  return lines.join('\n');
}

/**
 * Read and parse server.properties from a server directory.
 * Returns an empty Record if the file doesn't exist.
 */
export function readServerProperties(serverDir: string): Record<string, string> {
  const propsPath = path.join(serverDir, 'server.properties');

  if (!fs.existsSync(propsPath)) {
    logger.warn({ path: propsPath }, 'server.properties not found');
    return {};
  }

  const content = fs.readFileSync(propsPath, 'utf-8');
  return parseProperties(content);
}

/**
 * Write a full set of properties to server.properties.
 * Overwrites the existing file entirely.
 */
export function writeServerProperties(serverDir: string, props: Record<string, string>): void {
  const propsPath = path.join(serverDir, 'server.properties');
  const content = serializeProperties(props);
  fs.writeFileSync(propsPath, content, 'utf-8');
  logger.info({ path: propsPath, keys: Object.keys(props).length }, 'server.properties updated');
}

/**
 * Check if a property key is in our known metadata definitions.
 */
export function isKnownProperty(key: string): boolean {
  return KNOWN_KEYS.has(key);
}
