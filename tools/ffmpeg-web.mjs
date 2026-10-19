// Which of FFmpeg's source files the browser build compiles, without GNU make (there is none on the
// Windows machine this is built on): the same OBJS lists FFmpeg's Makefiles hold, filtered by what its
// `configure` enabled (config.h and config_components.h in the build directory).
//
//   node tools/ffmpeg-web.mjs <ffmpeg source> <configured build directory>
//
// Writes <build>/ffmpeg_sources.cmake (set(FFMPEG_SOURCES ...), absolute paths) and the one header configure
// does not make, libavutil/ffversion.h. tools/build-ffmpeg-web.sh runs configure and then this;
// the main CMakeLists.txt compiles the list into a static library.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

const [src, build] = process.argv
  .slice(2)
  .map((p) => (p ? path.resolve(p) : p));
if (!src || !build) {
  console.error(
    "usage: node tools/ffmpeg-web.mjs <ffmpeg source> <configured build directory>",
  );
  process.exit(2);
}

// what configure decided: every `#define NAME 1`
const on = new Set();
for (const file of ["config.h", "config_components.h"]) {
  const text = readFileSync(path.join(build, file), "utf8");
  for (const m of text.matchAll(/^#define\s+(\w+)\s+1\s*$/gm)) on.add(m[1]);
}

/** The lines of a Makefile with continuations joined and comments gone. */
function lines(file) {
  const joined = readFileSync(file, "utf8")
    .replace(/\r/g, "")
    .replace(/\\\n[ \t]*/g, " "); // a continuation takes the next line, even an empty one, and no more
  return joined
    .split("\n")
    .map((l) => l.replace(/#.*$/, "").trim())
    .filter(Boolean);
}

/** The objects a library's Makefile adds, given what is enabled. */
function objects(lib) {
  const found = [];
  const walk = (makefile) => {
    const stack = []; // each: whether this branch is live
    const live = () => stack.every(Boolean);
    for (const line of lines(makefile)) {
      let m;
      if ((m = /^ifdef\s+(\w+)$/.exec(line))) stack.push(on.has(m[1]));
      else if ((m = /^ifndef\s+(\w+)$/.exec(line))) stack.push(!on.has(m[1]));
      else if (line === "else") stack.push(!stack.pop());
      else if (line === "endif") stack.pop();
      else if (!live()) continue;
      else if ((m = /^include\s+\$\(SRC_PATH\)\/(\S+)$/.exec(line)))
        walk(path.join(src, m[1]));
      else if ((m = /^-include\s/.exec(line)))
        continue; // the per-architecture ones: ARCH=c has none
      else if ((m = /^OBJS(?:-\$\((!?)(\w+)\))?\s*\+?=\s*(.*)$/.exec(line))) {
        const [, negate, flag, list] = m;
        if (flag !== undefined && on.has(flag) === Boolean(negate)) continue;
        for (const o of list.split(/\s+/))
          if (o.endsWith(".o")) found.push(o.replace(/\.o$/, ".c"));
      }
    }
  };
  walk(path.join(src, lib, "Makefile"));
  return [...new Set(found)].map((c) => path.join(src, lib, c));
}

const libs = ["libavutil", "libavcodec", "libavformat", "libswresample"];
const sources = [];
for (const lib of libs) {
  for (const file of objects(lib)) {
    if (!existsSync(file)) {
      console.error(
        `${lib}/Makefile names ${path.relative(src, file)}, which is not there`,
      );
      process.exit(1);
    }
    sources.push(file);
  }
}

const version = readFileSync(path.join(src, "RELEASE"), "utf8").trim();
mkdirSync(path.join(build, "libavutil"), { recursive: true });
writeFileSync(
  path.join(build, "libavutil", "ffversion.h"),
  `#ifndef AVUTIL_FFVERSION_H\n#define AVUTIL_FFVERSION_H\n#define FFMPEG_VERSION "${version}"\n#endif\n`,
);
const cmake = (p) => p.replace(/\\/g, "/");
writeFileSync(
  path.join(build, "ffmpeg_sources.cmake"),
  [
    "# made by tools/ffmpeg-web.mjs; do not edit",
    `set(FFMPEG_SRC "${cmake(src)}")`,
    `set(FFMPEG_BUILD "${cmake(build)}")`,
    "set(FFMPEG_SOURCES",
    ...sources.map((s) => `  "${cmake(s)}"`),
    ")",
    "",
  ].join("\n"),
);
const counts = Object.fromEntries(
  libs.map((l) => [
    l,
    sources.filter((s) => s.includes(`/${l}/`) || s.includes(`\\${l}\\`))
      .length,
  ]),
);
console.log(`${sources.length} files:`, JSON.stringify(counts));
