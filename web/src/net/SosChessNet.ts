/**
 * Quick-play multiplayer for King's Gambit — same shape as Kart Royale's SosNet:
 * Nostr discovery + NIP-44 signalling + WebRTC data channel. No dedicated
 * relay server required (works on GitHub Pages).
 *
 * Flow after PLAY:
 *   1. Listen briefly for an open hall.
 *   2. Join if one exists; otherwise host.
 *   3. If still alone after a short lobby, start vs AI while staying discoverable
 *      for OPEN_CHALLENGE_MS. A late arrival gets an offer to replace the AI.
 *
 * The host's chess.js copy is authoritative for human vs human.
 */

import { Chess } from "chess.js";
import { SimplePool } from "nostr-tools/pool";
import { finalizeEvent, generateSecretKey, getPublicKey } from "nostr-tools/pure";
import * as nip44 from "nostr-tools/nip44";

import { Emitter } from "../core/emitter";
import type { Faction, GameResult, PieceKind, SquareId } from "../core/types";

export const ROOM_TAG = "sos_chess_v1";
const KIND_ROOM = 33213;
const KIND_SIGNAL = 25213;
const RELAYS = [
  "wss://relay.damus.io",
  "wss://nos.lol",
  "wss://relay.primal.net",
  "wss://relay.snort.social",
];

const ICE: RTCIceServer[] = [
  { urls: ["stun:stun.l.google.com:19302", "stun:stun1.l.google.com:19302"] },
  { urls: "stun:stun.cloudflare.com:3478" },
  {
    urls: ["turn:freeturn.net:3478", "turn:freeturn.net:3478?transport=tcp"],
    username: "free",
    credential: "free",
  },
  { urls: "turns:freeturn.net:5349", username: "free", credential: "free" },
];

const RTC_CONFIG: RTCConfiguration = {
  iceServers: ICE,
  iceTransportPolicy: new URLSearchParams(location.search).get("relay") === "1" ? "relay" : "all",
};

const ROOM_TTL = 45;
const HEARTBEAT_MS = 10_000;
const ANNOUNCE_GAP_MS = 2_000;
const LISTEN_MS = 2_500;
const LOBBY_MS = 5_000;
/** Keep the AI game discoverable this long so a late arrival can take the seat. */
export const OPEN_CHALLENGE_MS = 5 * 60_000;
const JOIN_TIMEOUT_MS = 12_000;
const ICE_WAIT_MS = 4_000;
const OFFER_TIMEOUT_MS = 45_000;

export type ChessNetPhase =
  | "searching"
  | "lobby"
  | "ai"
  | "offer"
  | "pvp"
  | "closed";

interface RoomInfo {
  pubkey: string;
  players: number;
  open: boolean;
  ts: number;
}

interface Peer {
  hostSide: boolean;
  pk: string;
  sid: string;
  pc: RTCPeerConnection;
  ctl: RTCDataChannel | null;
  open: boolean;
  name: string;
}

interface ChessNetEvents {
  phase: { phase: ChessNetPhase; detail: string };
  /** Solo path: start (or keep) a local AI match while the hall stays open. */
  startAi: { color: Faction };
  /** Human vs human is live. */
  startPvp: { color: Faction; opponentName: string };
  /** Someone wants the AI seat — show Accept / Decline. */
  challengeOffer: { name: string };
  moved: { from: string; to: string; promotion: string | null; fen: string; self: boolean };
  over: { result: GameResult };
  notice: { text: string };
  peerLeft: Record<string, never>;
}

function now(): number {
  return Date.now();
}

function nowSec(): number {
  return Math.floor(now() / 1000);
}

function randId(): string {
  return Math.random().toString(36).slice(2, 10);
}

function waitIce(pc: RTCPeerConnection): Promise<void> {
  if (pc.iceGatheringState === "complete") return Promise.resolve();
  return new Promise((resolve) => {
    const done = (): void => {
      pc.removeEventListener("icegatheringstatechange", onChange);
      clearTimeout(timer);
      resolve();
    };
    const onChange = (): void => {
      if (pc.iceGatheringState === "complete") done();
    };
    const timer = setTimeout(done, ICE_WAIT_MS);
    pc.addEventListener("icegatheringstatechange", onChange);
  });
}

function netAllowed(): boolean {
  const q = new URLSearchParams(location.search);
  return q.get("net") !== "0" && q.get("solo") !== "1" && typeof WebSocket !== "undefined";
}

export class SosChessNet extends Emitter<ChessNetEvents> {
  private readonly sk = generateSecretKey();
  private readonly pk = getPublicKey(this.sk);
  private readonly pool = new SimplePool();
  private readonly rooms = new Map<string, RoomInfo>();
  private readonly convKeys = new Map<string, Uint8Array>();
  private readonly seen = new Set<string>();
  private subs: { close: () => void }[] = [];
  private peer: Peer | null = null;
  private joining: Peer | null = null;
  private role: "searching" | "host" | "client" = "searching";
  private phase: ChessNetPhase = "searching";
  private disposed = false;
  private heartbeat = 0;
  private announceTimer = 0;
  private lastAnnounce = 0;
  private timers: number[] = [];
  private openUntil = 0;
  private pendingOffer: { peer: Peer; timer: number } | null = null;
  /** Host-only authoritative board for PvP. */
  private board: Chess | null = null;
  private myColor: Faction = "w";
  private opponentName = "Challenger";

  static supported(): boolean {
    return netAllowed() && typeof RTCPeerConnection !== "undefined";
  }

  start(): void {
    if (this.disposed) return;
    if (!SosChessNet.supported()) {
      this.setPhase("ai", "Playing offline");
      this.emit("startAi", { color: "w" });
      return;
    }
    this.setPhase("searching", "Looking for an opponent…");
    this.listen();
    this.timers.push(
      window.setTimeout(() => void this.matchmake(), this.liveRooms().length ? 400 : LISTEN_MS),
    );
    addEventListener("pagehide", this.onPageHide);
  }

  getPhase(): ChessNetPhase {
    return this.phase;
  }

  getColor(): Faction {
    return this.myColor;
  }

  acceptChallenge(): void {
    const pending = this.pendingOffer;
    if (!pending || this.disposed) return;
    clearTimeout(pending.timer);
    this.pendingOffer = null;
    this.beginPvpAsHost(pending.peer);
  }

  declineChallenge(): void {
    const pending = this.pendingOffer;
    if (!pending) return;
    clearTimeout(pending.timer);
    this.pendingOffer = null;
    this.send(pending.peer, { t: "busy" });
    this.dropPeer(pending.peer);
    this.setPhase("ai", "Still playing the computer");
  }

  submitMove(from: SquareId, to: SquareId, promotion?: PieceKind | null): boolean {
    if (this.phase !== "pvp" || !this.peer?.open) return false;
    if (this.role === "host") {
      return this.hostApply(this.myColor, from, to, promotion ?? null, true);
    }
    this.send(this.peer, { t: "move", from, to, promotion: promotion ?? null });
    return true;
  }

  resign(): void {
    if (this.phase !== "pvp" || !this.peer?.open) return;
    if (this.role === "host") {
      const winner = this.myColor === "w" ? "b" : "w";
      this.finish({ winner, reason: "resignation" }, true);
      return;
    }
    this.send(this.peer, { t: "resign" });
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.leaveRoom();
    for (const t of this.timers) clearTimeout(t);
    this.timers = [];
    clearInterval(this.heartbeat);
    clearTimeout(this.announceTimer);
    if (this.pendingOffer) clearTimeout(this.pendingOffer.timer);
    this.pendingOffer = null;
    removeEventListener("pagehide", this.onPageHide);
    if (this.peer) this.dropPeer(this.peer);
    if (this.joining) {
      try {
        this.joining.pc.close();
      } catch {
        /* closed */
      }
      this.joining = null;
    }
    const subs = this.subs;
    this.subs = [];
    setTimeout(() => {
      for (const sub of subs) {
        try {
          sub.close();
        } catch {
          /* closed */
        }
      }
      try {
        this.pool.close(RELAYS);
      } catch {
        /* closed */
      }
    }, 1200);
    this.clear();
  }

  private onPageHide = (): void => {
    this.leaveRoom();
  };

  private setPhase(phase: ChessNetPhase, detail: string): void {
    this.phase = phase;
    this.emit("phase", { phase, detail });
  }

  private convKey(pk: string): Uint8Array {
    let key = this.convKeys.get(pk);
    if (!key) {
      key = nip44.getConversationKey(this.sk, pk);
      this.convKeys.set(pk, key);
    }
    return key;
  }

  private listen(): void {
    this.subs.push(
      this.pool.subscribeMany(RELAYS, { kinds: [KIND_ROOM], "#t": [ROOM_TAG], since: nowSec() - 60 }, {
        onevent: (ev) => {
          if (ev.pubkey === this.pk) return;
          try {
            const c = JSON.parse(ev.content) as {
              closed?: boolean;
              players?: number;
              open?: boolean;
            };
            if (c.closed) {
              this.rooms.delete(ev.pubkey);
              return;
            }
            const prev = this.rooms.get(ev.pubkey);
            if (prev && prev.ts > ev.created_at) return;
            this.rooms.set(ev.pubkey, {
              pubkey: ev.pubkey,
              players: Math.max(1, Math.min(2, Number(c.players) || 1)),
              open: c.open !== false,
              ts: ev.created_at,
            });
          } catch {
            /* ignore */
          }
        },
      }),
    );
    this.subs.push(
      this.pool.subscribeMany(RELAYS, { kinds: [KIND_SIGNAL], "#p": [this.pk], since: nowSec() - 10 }, {
        onevent: (ev) => {
          if (this.seen.has(ev.id)) return;
          this.seen.add(ev.id);
          let msg: unknown;
          try {
            msg = JSON.parse(nip44.decrypt(ev.content, this.convKey(ev.pubkey)));
          } catch {
            return;
          }
          void this.onSignal(ev.pubkey, msg);
        },
      }),
    );
  }

  private signal(to: string, msg: object): void {
    const ev = finalizeEvent(
      {
        kind: KIND_SIGNAL,
        created_at: nowSec(),
        tags: [
          ["p", to],
          ["t", ROOM_TAG],
        ],
        content: nip44.encrypt(JSON.stringify(msg), this.convKey(to)),
      },
      this.sk,
    );
    void Promise.allSettled(this.pool.publish(RELAYS, ev));
  }

  private announce(closed = false): void {
    if (this.role !== "host" && !closed) return;
    clearTimeout(this.announceTimer);
    this.announceTimer = 0;
    const wait = closed ? 0 : this.lastAnnounce + ANNOUNCE_GAP_MS - now();
    if (wait > 0) {
      this.announceTimer = window.setTimeout(() => {
        if (!this.disposed) this.announce();
      }, wait);
      return;
    }
    this.lastAnnounce = now();
    const open =
      !closed &&
      this.role === "host" &&
      this.phase !== "pvp" &&
      (this.phase === "lobby" || this.phase === "ai" || this.phase === "offer") &&
      (this.openUntil === 0 || now() < this.openUntil);
    const ev = finalizeEvent(
      {
        kind: KIND_ROOM,
        created_at: nowSec(),
        tags: [
          ["d", ROOM_TAG],
          ["t", ROOM_TAG],
        ],
        content: JSON.stringify({
          v: 1,
          room: this.pk,
          players: this.phase === "pvp" ? 2 : 1,
          open,
          closed: closed || !open,
        }),
      },
      this.sk,
    );
    void Promise.allSettled(this.pool.publish(RELAYS, ev));
  }

  private leaveRoom(): void {
    if (this.role === "host") this.announce(true);
  }

  private liveRooms(): RoomInfo[] {
    const cut = nowSec() - ROOM_TTL;
    return [...this.rooms.values()]
      .filter((r) => r.ts >= cut && r.open && r.players < 2)
      .sort((a, b) => b.ts - a.ts);
  }

  private async matchmake(): Promise<void> {
    for (const room of this.liveRooms()) {
      if (this.disposed) return;
      if (await this.tryJoin(room.pubkey)) return;
    }
    if (!this.disposed) this.becomeHost();
  }

  private becomeHost(): void {
    this.role = "host";
    this.myColor = "w";
    this.openUntil = now() + OPEN_CHALLENGE_MS;
    this.setPhase("lobby", "Looking for an opponent…");
    this.announce();
    clearInterval(this.heartbeat);
    this.heartbeat = window.setInterval(() => {
      if (this.role !== "host" || this.disposed) return;
      if (this.openUntil && now() >= this.openUntil && this.phase !== "pvp") {
        // Stop being discoverable; keep an in-progress AI game going.
        this.announce(true);
        clearInterval(this.heartbeat);
        this.openUntil = 0;
        return;
      }
      this.announce();
    }, HEARTBEAT_MS);

    this.timers.push(
      window.setTimeout(() => {
        if (this.disposed || this.phase !== "lobby") return;
        this.setPhase("ai", "Playing the computer — open for a challenger");
        this.emit("startAi", { color: this.myColor });
        this.announce();
      }, LOBBY_MS),
    );
  }

  private tryJoin(hostPk: string): Promise<boolean> {
    return new Promise((resolve) => {
      const pc = new RTCPeerConnection(RTC_CONFIG);
      const peer: Peer = {
        hostSide: false,
        pk: hostPk,
        sid: randId(),
        pc,
        ctl: null,
        open: false,
        name: "Host",
      };
      this.joining = peer;
      let settled = false;
      const finish = (ok: boolean): void => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        if (this.joining === peer) this.joining = null;
        if (!ok) {
          try {
            pc.close();
          } catch {
            /* closed */
          }
        }
        resolve(ok);
      };
      const timer = setTimeout(() => finish(false), JOIN_TIMEOUT_MS);
      (peer as { fail?: () => void }).fail = () => finish(false);

      peer.ctl = pc.createDataChannel("ctl", { ordered: true });
      peer.ctl.onopen = () => {
        peer.open = true;
        this.role = "client";
        this.peer = peer;
        this.myColor = "b";
        this.send(peer, { t: "hello", name: readName() });
        this.setPhase("lobby", "Waiting for the host…");
        finish(true);
      };
      this.wireChannel(peer);

      void (async () => {
        try {
          await pc.setLocalDescription(await pc.createOffer());
          await waitIce(pc);
          this.signal(hostPk, { type: "offer", sid: peer.sid, sdp: pc.localDescription?.sdp });
        } catch {
          finish(false);
        }
      })();
    });
  }

  private async onSignal(from: string, msg: unknown): Promise<void> {
    if (!msg || typeof msg !== "object") return;
    const m = msg as { type?: string; sid?: string; sdp?: string };
    if (typeof m.type !== "string" || typeof m.sid !== "string") return;

    if (m.type === "offer" && typeof m.sdp === "string") {
      if (this.role !== "host" || this.peer || this.pendingOffer) {
        this.signal(from, { type: "full", sid: m.sid });
        return;
      }
      if (this.phase !== "lobby" && this.phase !== "ai") {
        this.signal(from, { type: "full", sid: m.sid });
        return;
      }
      const pc = new RTCPeerConnection(RTC_CONFIG);
      const peer: Peer = {
        hostSide: true,
        pk: from,
        sid: m.sid,
        pc,
        ctl: null,
        open: false,
        name: "Challenger",
      };
      this.peer = peer;
      pc.ondatachannel = (e) => {
        if (e.channel.label === "ctl") {
          peer.ctl = e.channel;
          this.wireChannel(peer);
        }
      };
      setTimeout(() => {
        if (!peer.open) this.dropPeer(peer);
      }, JOIN_TIMEOUT_MS);
      try {
        await pc.setRemoteDescription({ type: "offer", sdp: m.sdp });
        await pc.setLocalDescription(await pc.createAnswer());
        await waitIce(pc);
        this.signal(from, { type: "answer", sid: m.sid, sdp: pc.localDescription?.sdp });
      } catch {
        this.dropPeer(peer);
      }
      return;
    }

    const j = this.joining;
    if (!j || j.pk !== from || j.sid !== m.sid) return;
    if (m.type === "answer" && typeof m.sdp === "string") {
      try {
        await j.pc.setRemoteDescription({ type: "answer", sdp: m.sdp });
      } catch {
        (j as { fail?: () => void }).fail?.();
      }
    } else if (m.type === "full") {
      (j as { fail?: () => void }).fail?.();
    }
  }

  private wireChannel(peer: Peer): void {
    const { ctl, pc } = peer;
    if (ctl && !(ctl as { __wired?: boolean }).__wired) {
      (ctl as { __wired?: boolean }).__wired = true;
      ctl.onmessage = (e) => {
        let msg: Record<string, unknown>;
        try {
          msg = JSON.parse(String(e.data)) as Record<string, unknown>;
        } catch {
          return;
        }
        this.onCtl(peer, msg);
      };
      ctl.onclose = () => this.lost(peer);
      if (peer.hostSide) {
        ctl.onopen = () => {
          peer.open = true;
        };
        if (ctl.readyState === "open") peer.open = true;
      }
    }
    pc.onconnectionstatechange = () => {
      if (pc.connectionState === "failed" || pc.connectionState === "closed") this.lost(peer);
    };
  }

  private onCtl(peer: Peer, msg: Record<string, unknown>): void {
    const t = msg.t;
    if (t === "hello" && peer.hostSide) {
      peer.name = typeof msg.name === "string" && msg.name.trim() ? msg.name.trim().slice(0, 20) : "Challenger";
      this.opponentName = peer.name;
      if (this.phase === "lobby") {
        this.beginPvpAsHost(peer);
        return;
      }
      if (this.phase === "ai") {
        this.setPhase("offer", `${peer.name} wants to play`);
        const timer = window.setTimeout(() => this.declineChallenge(), OFFER_TIMEOUT_MS);
        this.pendingOffer = { peer, timer };
        this.emit("challengeOffer", { name: peer.name });
        this.send(peer, { t: "wait" });
        return;
      }
      this.send(peer, { t: "busy" });
      this.dropPeer(peer);
      return;
    }

    if (t === "wait" && !peer.hostSide) {
      this.setPhase("lobby", "Host is deciding…");
      return;
    }

    if (t === "busy" && !peer.hostSide) {
      this.emit("notice", { text: "The hall was busy — trying another." });
      this.dropPeer(peer);
      this.role = "searching";
      this.peer = null;
      void this.matchmake();
      return;
    }

    if (t === "start") {
      const color = msg.color === "b" ? "b" : "w";
      this.myColor = color;
      this.opponentName =
        typeof msg.name === "string" && msg.name.trim() ? String(msg.name).trim().slice(0, 20) : "Host";
      this.role = peer.hostSide ? "host" : "client";
      this.peer = peer;
      this.setPhase("pvp", `Playing ${this.opponentName}`);
      this.emit("startPvp", { color: this.myColor, opponentName: this.opponentName });
      return;
    }

    if (t === "move") {
      if (!peer.hostSide) return;
      const from = String(msg.from ?? "");
      const to = String(msg.to ?? "");
      const promotion = (msg.promotion as string | null) ?? null;
      this.hostApply("b", from, to, promotion, false);
      return;
    }

    if (t === "moved") {
      const from = String(msg.from ?? "");
      const to = String(msg.to ?? "");
      const promotion = (msg.promotion as string | null) ?? null;
      const fen = String(msg.fen ?? "");
      const self = Boolean(msg.self);
      this.emit("moved", { from, to, promotion, fen, self });
      return;
    }

    if (t === "resign" && peer.hostSide) {
      this.finish({ winner: "w", reason: "resignation" }, true);
      return;
    }

    if (t === "over") {
      const winner = msg.winner === "w" || msg.winner === "b" ? msg.winner : null;
      const reason = typeof msg.reason === "string" ? msg.reason : "resignation";
      this.emit("over", {
        result: {
          winner,
          reason: reason as GameResult["reason"],
        },
      });
      return;
    }
  }

  private beginPvpAsHost(peer: Peer): void {
    this.peer = peer;
    this.board = new Chess();
    this.myColor = "w";
    this.opponentName = peer.name;
    this.openUntil = 0;
    this.announce(true);
    clearInterval(this.heartbeat);
    this.send(peer, { t: "start", color: "b", name: readName() });
    this.setPhase("pvp", `Playing ${peer.name}`);
    this.emit("startPvp", { color: "w", opponentName: peer.name });
  }

  private hostApply(
    color: Faction,
    from: string,
    to: string,
    promotion: string | null,
    self: boolean,
  ): boolean {
    if (!this.board || !this.peer) return false;
    if (this.board.turn() !== color) return false;
    let move;
    try {
      move = this.board.move({
        from,
        to,
        promotion: promotion === "q" || promotion === "r" || promotion === "b" || promotion === "n" ? promotion : undefined,
      });
    } catch {
      return false;
    }
    if (!move) return false;
    const fen = this.board.fen();
    this.send(this.peer, { t: "moved", from, to, promotion, fen, self: !self });
    // Host applies locally via the same event path as the guest.
    this.emit("moved", { from, to, promotion, fen, self });
    if (this.board.isCheckmate()) {
      this.finish({ winner: color, reason: "checkmate" }, true);
    } else if (
      this.board.isStalemate() ||
      this.board.isDraw() ||
      this.board.isThreefoldRepetition() ||
      this.board.isInsufficientMaterial()
    ) {
      const reason = this.board.isStalemate()
        ? "stalemate"
        : this.board.isThreefoldRepetition()
          ? "threefold"
          : this.board.isInsufficientMaterial()
            ? "insufficient"
            : "draw";
      this.finish({ winner: null, reason }, true);
    }
    return true;
  }

  private finish(result: GameResult, broadcast: boolean): void {
    if (broadcast && this.peer) {
      this.send(this.peer, { t: "over", winner: result.winner, reason: result.reason });
    }
    this.emit("over", { result });
  }

  private send(peer: Peer, msg: object): void {
    if (peer.ctl?.readyState === "open") peer.ctl.send(JSON.stringify(msg));
  }

  private lost(peer: Peer): void {
    if (this.disposed) return;
    if (this.peer === peer || this.pendingOffer?.peer === peer) {
      if (this.pendingOffer?.peer === peer) {
        clearTimeout(this.pendingOffer.timer);
        this.pendingOffer = null;
      }
      this.dropPeer(peer);
      this.emit("peerLeft", {});
      if (this.phase === "pvp") {
        this.emit("notice", { text: "Opponent disconnected." });
      }
    }
  }

  private dropPeer(peer: Peer): void {
    if (this.peer === peer) this.peer = null;
    try {
      peer.pc.close();
    } catch {
      /* closed */
    }
  }
}

function readName(): string {
  try {
    return localStorage.getItem("kg.online.name")?.trim().slice(0, 20) || "Challenger";
  } catch {
    return "Challenger";
  }
}
