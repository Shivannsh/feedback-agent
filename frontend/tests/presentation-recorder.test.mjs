import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import { test } from "node:test";
import ts from "typescript";

function recorder() {
  const messages = [];
  let Processor;
  const scope = vm.createContext({
    Float32Array,
    sampleRate: 16000,
    currentTime: 0,
    AudioWorkletProcessor: class {
      constructor() {
        this.port = { postMessage: (value) => messages.push(value) };
      }
    },
    registerProcessor: (_, value) => {
      Processor = value;
    },
  });
  vm.runInContext(
    readFileSync(
      new URL("../public/presentation-recorder.js", import.meta.url),
      "utf8",
    ),
    scope,
  );
  const instance = new Processor();
  return {
    messages,
    send: (type, slide) => instance.port.onmessage({ data: { type, slide } }),
    advance: (seconds) => {
      for (let i = 0; i < seconds * 125; i++) {
        instance.process(
          [[new Float32Array(128).fill(0.25)]],
          [[new Float32Array(128)]],
        );
        scope.currentTime += 0.008;
      }
    },
  };
}

test("pause excludes audio and slide events retain a common clock", () => {
  const r = recorder();
  r.send("start", 1);
  r.advance(2);
  r.send("slide", 3);
  r.advance(2);
  r.send("pause");
  r.advance(3);
  r.send("slide", 2);
  r.advance(5);
  r.send("slide", 3);
  r.send("resume");
  r.advance(2);
  r.send("slide", 1);
  r.advance(2);
  r.send("finish");
  const events = r.messages
    .filter((m) => m.type === "event")
    .map((m) => m.event);
  assert.deepEqual(
    events.map((e) => e.time),
    [0, 2, 4, 4, 4, 4, 6, 8],
  );
  assert.equal(events.at(-1).slide, 1);
  assert.ok(Math.abs(events.at(-1).wall_time - 16) < 0.01);
  const samples = r.messages
    .filter((m) => m.type === "chunk")
    .reduce((sum, m) => sum + m.chunk.length, 0);
  assert.equal(samples, 16000 * 8);
  r.send("finish");
  assert.equal(
    r.messages.filter((m) => m.type === "event" && m.event.type === "finish")
      .length,
    1,
  );
});

test("automatically finishes at fifteen minutes and flushes the final audio", () => {
  const r = recorder();
  r.send("start", 1);
  r.advance(901);
  const finish = r.messages.filter(
    (m) => m.type === "event" && m.event.type === "finish",
  );
  assert.equal(finish.length, 1);
  assert.equal(finish[0].event.time, 900);
  assert.equal(
    r.messages
      .filter((m) => m.type === "chunk")
      .reduce((sum, m) => sum + m.chunk.length, 0),
    16000 * 900,
  );
});

test("WAV encoding keeps timing at both requested and fallback device rates", async () => {
  const compiled = ts.transpileModule(
    readFileSync(
      new URL("../components/presentation-audio.ts", import.meta.url),
      "utf8",
    ),
    { compilerOptions: { module: ts.ModuleKind.CommonJS } },
  ).outputText;
  const scope = vm.createContext({
    exports: {},
    Blob,
    DataView,
    Float32Array,
    ArrayBuffer,
  });
  vm.runInContext(compiled, scope);
  for (const rate of [16000, 44100, 48000]) {
    const data = new Float32Array(rate * 2).fill(0.5);
    const blob = scope.exports.makeWav(
      [data.slice(0, 1000), data.slice(1000)],
      rate,
    );
    const buffer = await blob.arrayBuffer();
    const view = new DataView(buffer);
    assert.equal(buffer.byteLength, 44 + 2 * 16000 * 2);
    assert.equal(
      new TextDecoder().decode(new Uint8Array(buffer, 0, 4)),
      "RIFF",
    );
    assert.equal(view.getUint32(24, true), 16000);
    assert.equal(view.getUint16(22, true), 1);
    assert.ok(Math.abs(view.getInt16(44, true) - 16383) <= 1);
  }
});
