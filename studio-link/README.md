# VOID Studio Link

The bridge between VOID in the browser and the tools in your studio:
TouchDesigner, Ableton (through Max for Live or TouchOSC), Resolume, or
anything else that speaks OSC.

A browser cannot open a UDP port, and OSC lives on UDP. The relay runs on
your machine and passes OSC through untouched, both ways:

```
your tools  --OSC/UDP-->  127.0.0.1:9000  [relay]  --WebSocket-->  VOID
VOID  --WebSocket-->  [relay]  --OSC/UDP-->  127.0.0.1:9001  your tools
```

## Run it

Node 18 or later, nothing to install:

```
node studio-link/relay.mjs
```

or `npm run studio-link` from the repository. Options:

| option | default | |
| --- | --- | --- |
| `--ws` | `8080` | the port VOID connects to (`ws://localhost:8080`) |
| `--in` | `9000` | where your tools send OSC to VOID |
| `--out` | `127.0.0.1:9001` | where VOID's state goes |
| `--any-origin` | off | let any web page connect (only on a network you trust) |

It listens on 127.0.0.1 only. It accepts the piece from this machine
(`localhost`) and from https://mehran-ahmadi.com, and refuses other pages.

## In VOID

- **Play VOID from your tools.** Press a slider's listen dot, choose
  **OSC**, and give it an address (e.g. `/void/glow`). Values are 0-1. The
  **Bridge** field holds the relay's address; CONNECT if you changed it.
- **Send VOID's state out.** LAB > **Studio link** ON. Twenty times a
  second, one OSC message per channel, a float each:

| address | |
| --- | --- |
| `/void/state` | 0 RECONSTRUCT, 1 ALIVE, 2 DRIFT, 3 VOID, 4 REMEMBER |
| `/void/blend` | 0-1, how much the piece has forgotten |
| `/void/memory` | the memory's strength |
| `/void/level`, `/void/bass`, `/void/mid`, `/void/treble` | the sound, 0-1 (with SOUND on) |
| `/void/count` | particles |
| `/void/fps` | frames per second |

## TouchDesigner

The plan named a ready-made `void.tox`. A `.tox` can only be saved from
TouchDesigner itself, so here is the network to build (two operators), and
a script that builds it:

1. **OSC In CHOP**, Network Port `9001`: VOID's state arrives as channels
   (`void/state`, `void/blend`, ...).
2. **OSC Out CHOP**, Network Address `127.0.0.1`, Network Port `9000`:
   channels named like `void/glow` reach every slider listening to
   `/void/glow`. Keep values 0-1.

Or paste `void_td_setup.py` into a Text DAT inside your component and run
it (right-click > Run Script). It was written from TouchDesigner's
documentation and has not been run against TouchDesigner here: if a
parameter name differs in your build, set the two ports by hand. Then save
the component as `void.tox` for your own projects.

## Plain JSON

Tools that speak no OSC can send text frames straight to the relay's
WebSocket: `{"address": "/void/glow", "value": 0.5}`. The relay sends them
on as OSC.
