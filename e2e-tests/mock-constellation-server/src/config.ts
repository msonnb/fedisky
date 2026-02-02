/**
 * Configuration for mock Constellation server
 */

export interface Config {
  port: number
  hostname: string
}

export function loadConfig(): Config {
  return {
    port: parseInt(process.env.CONSTELLATION_PORT || '3002', 10),
    hostname: process.env.CONSTELLATION_HOSTNAME || 'localhost',
  }
}
