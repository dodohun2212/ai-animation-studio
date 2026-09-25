#!/usr/bin/env node
// Session-start briefing for whichever AI tool opens this repository (see "Session start" in AGENTS.md).
//
// Prints, in about 4 KB: what this project is, where things are written down, the state of the checkout, the
// last commits, and the headlines of docs/00_NOW.md — so an agent can tell the person where things stand
// without reading 18 KB of 00_NOW first. It only reads; it changes nothing and calls no provider.
//
//   node scripts/session-briefing.mjs
//
// The 00_NOW part is a headline extract (section 2-5 bullets and table rows, cut to one line each). It is a
// pointer, not the truth: when the person picks an item, read that item in docs/00_NOW.md in full.

import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import net from "node:net";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function git(...args) {
  try {
    return execFileSync("git", args, { cwd: root, encoding: "utf8" }).trim();
  } catch {
    return "(git failed)";
  }
}

function portOpen(port) {
  return new Promise((resolve) => {
    const socket = net.connect({ host: "127.0.0.1", port });
    const done = (open) => { socket.destroy(); resolve(open); };
    socket.setTimeout(400, () => done(false));
    socket.once("connect", () => done(true));
    socket.once("error", () => done(false));
  });
}

const oneLine = (text, max = 140) => {
  const flat = text.replace(/\*\*/g, "").replace(/`/g, "").replace(/\s+/g, " ").trim();
  return flat.length > max ? `${flat.slice(0, max - 1)}…` : flat;
};

function nowHeadlines() {
  let text;
  try {
    text = readFileSync(path.join(root, "docs", "00_NOW.md"), "utf8");
  } catch {
    return ["(docs/00_NOW.md could not be read)"];
  }
  const out = [];
  let keep = false;
  let inTable = false;
  for (const line of text.split(/\r?\n/)) {
    const heading = /^## (\d+)\./.exec(line);
    if (heading) {
      keep = ["2", "3", "4", "5"].includes(heading[1]);
      inTable = false;
      if (keep) out.push("", oneLine(line.replace(/^## /, "§"), 100));
      continue;
    }
    if (/^## /.test(line)) { keep = false; continue; }
    if (!keep) continue;
    if (line.startsWith("|")) {
      // Skip the header row (first row of a table) and the |---| separator; print each data row's first two cells.
      if (/^\|[\s:|-]+\|$/.test(line)) { inTable = true; continue; }
      if (!inTable) continue;
      const cells = line.split("|").slice(1, -1).map((cell) => cell.trim());
      out.push(`  · ${oneLine(cells.slice(0, 2).join(" — "), 150)}`);
    } else if (line.startsWith("- ")) {
      out.push(`  · ${oneLine(line.slice(2))}`);
    } else if (!line.trim()) {
      inTable = false;
    }
  }
  return out;
}

const branch = git("branch", "--show-current") || "(detached)";
const changed = git("status", "--short").split("\n").filter(Boolean);
const hooksPath = git("config", "core.hooksPath");
const servers = [];
for (const [port, name] of [[3000, "backend"], [5173, "vite"], [4317, "desktop"]]) {
  if (await portOpen(port)) servers.push(`${name}:${port}`);
}

const lines = [
  "=== AI Animation Studio — session briefing ===",
  "",
  "프로젝트: 주제 → 대본 → 이미지 → 영상(Runway) → FFmpeg 병합 → 릴스 MP4 를 만드는 로컬 도구(NestJS · React · Electron).",
  "사용자는 캡틴D 한 명이고, 유료 호출과 게시 버튼은 캡틴D 만 누른다. 마이그레이션은 끝났고 지금은 기능 개선·다듬기 단계.",
  "",
  "어디에 무엇이 적혀 있나:",
  "  docs/00_NOW.md            지금 상태·다음 할 일·결정 대기 — 여기가 정답 (항목을 끝내면 이 파일을 고치고 멈춘다)",
  "  AGENTS.md                 규칙 (유료 호출 안전 · git 안전 · 역할 · 첫 세션 체크리스트)",
  "  docs/06_DECISIONS.md      왜 이렇게 짰나·접은 길 (맨 위 색인, 설계 제안 전에 해당 항목 읽기)",
  "  docs/01 스펙 · 03 워크플로 · 04 API 계약 · 05 디자인 시스템   해당 작업을 할 때만",
  "  docs/02 · docs/archive/    이력 보관소 — 계획으로 읽지 않는다",
  "",
  "환경:",
  `  branch ${branch} · 커밋 안 된 파일 ${changed.length}개${changed.length ? ` (${changed.slice(0, 4).join(", ")}${changed.length > 4 ? ", …" : ""})` : ""}`,
  hooksPath === ".githooks"
    ? "  pre-commit 훅 켜짐"
    : "  !! pre-commit 훅이 꺼져 있다 → git config core.hooksPath .githooks",
  servers.length
    ? `  !! 개발 서버가 돌고 있다 (${servers.join(", ")}) — apps/*/src 를 저장하면 캡틴D 의 서버가 재시작한다. 먼저 물어라`
    : "  개발 서버 없음",
  "",
  "최근 커밋:",
  ...git("log", "--date=short", "--format=  %h %ad %s", "-8").split("\n").map((line) => oneLine(line, 150)),
  "",
  "docs/00_NOW.md 요약 (머리말만 — 고른 항목은 원문을 읽는다; 옛 ⬜·🟡 는 낡았을 수 있다):",
  ...nowHeadlines(),
  "",
  "→ 이 브리핑을 캡틴D 에게 한국어로 10줄 안에 전하고, 어떤 항목부터 할지 물어라. 고르기 전에는 작업을 시작하지 말고 큰 문서를 읽지 마라.",
];

console.log(lines.join("\n"));
