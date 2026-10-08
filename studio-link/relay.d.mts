/** Types for relay.mjs (the relay itself is plain JavaScript, so it runs on any Node 18+). */
export const MAX_FRAME: number;
export const ALLOWED_ORIGINS: RegExp[];
export function acceptKey(key: string): string;
export function originAllowed(origin: string | undefined, anyOrigin?: boolean): boolean;
export function encodeFrame(payload: Uint8Array, opcode?: number): Uint8Array;
export function parseFrames(buf: Uint8Array): { frames: { fin: boolean; opcode: number; payload: Uint8Array }[]; rest: Uint8Array };
export function encodeOscFloat(address: string, value: number): Uint8Array;
export interface RelayOptions {
  ws: number;
  in: number;
  outHost: string;
  outPort: number;
  anyOrigin: boolean;
  quiet: boolean;
}
export function parseArgs(argv: string[]): RelayOptions;
export function startRelay(opts: RelayOptions): Promise<{ ws: number; in: number; clients(): number; close(): Promise<void> }>;
