/**
 * Controllers for the modulation matrix (0.12 slice 5), a lazy chunk:
 * Web MIDI, and OSC over a WebSocket.
 *
 * A browser cannot open a UDP port, so OSC arrives through a bridge that
 * forwards OSC packets as binary WebSocket frames (the 0.13 Studio Link
 * relay will be one; any OSC-to-WebSocket bridge works today). Plain JSON
 * frames - {"address": "/void/x", "value": 0.5} - are accepted too, for
 * tools that speak no OSC. Nothing is sent back; nothing leaves the
 * machine unless the visitor points the bridge elsewhere.
 */

export interface ControllerEvents {
  /** A MIDI control change: channel 1-16, controller 0-127, value 0..1. */
  onMidi(channel: number, cc: number, value01: number): void;
  /** An OSC message's first numeric argument, at an address. */
  onOsc(address: string, value: number): void;
  onStatus(text: string): void;
}

let midiStarted: Promise<boolean> | null = null;

/** Listen to every MIDI input (asks the browser once). Resolves false if MIDI is unavailable or refused. */
export function startMidi(events: ControllerEvents): Promise<boolean> {
  if (midiStarted) return midiStarted;
  const nav = navigator as Navigator & { requestMIDIAccess?: () => Promise<MIDIAccess> };
  if (!nav.requestMIDIAccess) {
    events.onStatus("MIDI IS NOT AVAILABLE IN THIS BROWSER");
    return Promise.resolve(false);
  }
  midiStarted = nav
    .requestMIDIAccess()
    .then((access) => {
      const bind = (input: MIDIInput) => {
        input.onmidimessage = (e: MIDIMessageEvent) => {
          const d = e.data;
          if (!d || d.length < 3) return;
          // Control change: 0xB0-0xBF.
          if ((d[0] & 0xf0) === 0xb0) events.onMidi((d[0] & 0x0f) + 1, d[1], d[2] / 127);
        };
      };
      access.inputs.forEach(bind);
      access.onstatechange = (e: Event) => {
        const port = (e as MIDIConnectionEvent).port;
        if (port && port.type === "input" && port.state === "connected") bind(port as MIDIInput);
      };
      events.onStatus(access.inputs.size ? `MIDI: ${access.inputs.size} INPUT${access.inputs.size > 1 ? "S" : ""}` : "MIDI: NO INPUTS YET");
      return true;
    })
    .catch(() => {
      midiStarted = null;
      events.onStatus("MIDI WAS NOT ALLOWED");
      return false;
    });
  return midiStarted;
}

// --- OSC -----------------------------------------------------------------------

/** Read a 4-byte-padded OSC string at `at`; returns it and the next offset. */
function oscString(view: DataView, at: number): [string, number] {
  let end = at;
  while (end < view.byteLength && view.getUint8(end) !== 0) end++;
  let s = "";
  for (let i = at; i < end; i++) s += String.fromCharCode(view.getUint8(i));
  return [s, (end + 4) & ~3];
}

/**
 * Decode an OSC packet (a message or a bundle) into (address, first
 * numeric argument) pairs. Pure; malformed input yields what it can.
 */
export function decodeOsc(buf: ArrayBuffer, out: Array<[string, number]> = [], depth = 0): Array<[string, number]> {
  if (depth > 8 || buf.byteLength < 4) return out;
  const view = new DataView(buf);
  try {
    const [head, next] = oscString(view, 0);
    if (head === "#bundle") {
      let at = next + 8; // the time tag
      while (at + 4 <= view.byteLength) {
        const size = view.getInt32(at);
        at += 4;
        if (size <= 0 || at + size > view.byteLength) break;
        decodeOsc(buf.slice(at, at + size), out, depth + 1);
        at += size;
      }
      return out;
    }
    if (!head.startsWith("/")) return out;
    const [tags, argsAt] = oscString(view, next);
    if (!tags.startsWith(",")) return out;
    let at = argsAt;
    for (const t of tags.slice(1)) {
      if (t === "f" && at + 4 <= view.byteLength) {
        out.push([head, view.getFloat32(at)]);
        return out;
      }
      if (t === "i" && at + 4 <= view.byteLength) {
        out.push([head, view.getInt32(at)]);
        return out;
      }
      if (t === "d" && at + 8 <= view.byteLength) {
        out.push([head, view.getFloat64(at)]);
        return out;
      }
      if (t === "T" || t === "F") {
        out.push([head, t === "T" ? 1 : 0]);
        return out;
      }
      // Skip arguments that carry no number.
      if (t === "s") at = oscString(view, at)[1];
      else if (t === "b") at += 4 + ((view.getInt32(at) + 3) & ~3);
      else if (t === "h" || t === "t") at += 8;
      else at += 4;
    }
  } catch {
    // Truncated: keep what was read.
  }
  return out;
}

let osc: WebSocket | null = null;

/** Connect to an OSC bridge (replacing any earlier connection). */
export function connectOsc(url: string, events: ControllerEvents): void {
  osc?.close();
  osc = null;
  let ws: WebSocket;
  try {
    ws = new WebSocket(url);
  } catch {
    events.onStatus("OSC: THAT IS NOT A WEBSOCKET ADDRESS");
    return;
  }
  ws.binaryType = "arraybuffer";
  ws.onopen = () => events.onStatus(`OSC: LISTENING ON ${url}`);
  ws.onerror = () => events.onStatus(`OSC: NO BRIDGE AT ${url}`);
  ws.onmessage = (e: MessageEvent) => {
    if (e.data instanceof ArrayBuffer) {
      for (const [address, value] of decodeOsc(e.data)) events.onOsc(address, value);
    } else if (typeof e.data === "string") {
      try {
        const m = JSON.parse(e.data) as { address?: unknown; value?: unknown };
        if (typeof m.address === "string" && typeof m.value === "number") events.onOsc(m.address, m.value);
      } catch {
        // Not JSON: ignored.
      }
    }
  };
  osc = ws;
}

export function disconnectOsc(): void {
  osc?.close();
  osc = null;
}
