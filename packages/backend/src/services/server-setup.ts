import fs from 'node:fs';
import path from 'node:path';
import { logger } from '../utils/logger.js';

/**
 * Write eula.txt accepting the Minecraft EULA.
 * Required before a server can start.
 */
export function writeEula(serverDir: string): void {
  const eulaPath = path.join(serverDir, 'eula.txt');
  const content = [
    '#By changing the setting below to TRUE you are indicating your agreement to our EULA (https://aka.ms/MinecraftEULA).',
    `#${new Date().toUTCString()}`,
    'eula=true',
    '',
  ].join('\n');

  fs.writeFileSync(eulaPath, content, 'utf-8');
  logger.debug({ path: eulaPath }, 'eula.txt written');
}

/**
 * Default server.properties values for a new Minecraft server.
 * Only includes the most commonly configured properties.
 * The server will generate the full file on first start.
 */
const DEFAULT_PROPERTIES: Record<string, string> = {
  // Network
  'server-port': '25565',
  'server-ip': '',
  'online-mode': 'true',
  'enable-query': 'false',
  'enable-rcon': 'false',

  // Gameplay
  'gamemode': 'survival',
  'difficulty': 'easy',
  'max-players': '20',
  'pvp': 'true',
  'allow-nether': 'true',
  'spawn-monsters': 'true',
  'spawn-animals': 'true',
  'spawn-npcs': 'true',
  'generate-structures': 'true',

  // World
  'level-name': 'world',
  'level-seed': '',
  'level-type': 'minecraft\\:normal',
  'view-distance': '10',
  'simulation-distance': '10',

  // Server
  'motd': 'A Minecraft Server',
  'white-list': 'false',
  'enforce-whitelist': 'false',
  'max-world-size': '29999984',
  'enable-command-block': 'false',

  // Performance
  'max-tick-time': '60000',
  'network-compression-threshold': '256',
};

/**
 * Write a default server.properties file.
 * Accepts optional overrides (e.g., port from the server config).
 */
export function writeServerProperties(
  serverDir: string,
  overrides: Record<string, string> = {}
): void {
  const props = { ...DEFAULT_PROPERTIES, ...overrides };
  const propsPath = path.join(serverDir, 'server.properties');

  const lines = [
    '#Minecraft server properties',
    `#${new Date().toUTCString()}`,
  ];

  for (const [key, value] of Object.entries(props).sort()) {
    lines.push(`${key}=${value}`);
  }

  lines.push(''); // trailing newline

  fs.writeFileSync(propsPath, lines.join('\n'), 'utf-8');
  logger.debug({ path: propsPath }, 'server.properties written');
}

/**
 * Set up a new server directory with eula.txt and server.properties.
 */
export function setupServerDirectory(
  serverDir: string,
  port: number,
  motd?: string
): void {
  // Ensure directory exists
  fs.mkdirSync(serverDir, { recursive: true });

  // Write eula.txt
  writeEula(serverDir);

  // Write server.properties with port override
  const overrides: Record<string, string> = {
    'server-port': String(port),
  };
  if (motd) {
    overrides['motd'] = motd;
  }
  writeServerProperties(serverDir, overrides);

  logger.info({ serverDir, port }, 'Server directory set up');
}
