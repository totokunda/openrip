// Tests for src/lib/media/folder-data.ts: `node --test tests/*.test.ts` in packages/renderer.
import { test } from "node:test";
import assert from "node:assert/strict";
import { folderOf, freeFolderName, moveItems, parseFolders } from "../src/lib/media/folder-data.ts";

const f = (id: string, items: string[]) => ({ id, name: id, items });

test("a free folder name", () => {
  assert.equal(freeFolderName([]), "New folder");
  assert.equal(freeFolderName([f("New folder", [])]), "New folder 2");
  assert.equal(freeFolderName([f("New folder", []), f("New folder 2", [])]), "New folder 3");
});

test("moving cards takes them out of their other folder", () => {
  const a = moveItems([f("a", ["x", "y"]), f("b", [])], ["x"], "b");
  assert.deepEqual(a.map((g) => g.items), [["y"], ["x"]]);
  assert.equal(folderOf(a, "x")?.id, "b");
  const out = moveItems(a, ["x"], null);
  assert.deepEqual(out.map((g) => g.items), [["y"], []]);
  assert.equal(folderOf(out, "x"), undefined);
});

test("a card is in a folder once", () => {
  assert.deepEqual(moveItems([f("a", ["x"])], ["x", "x"], "a")[0].items, ["x"]);
});

test("parsing keeps the well-formed folders only", () => {
  assert.equal(parseFolders("no"), undefined);
  assert.deepEqual(parseFolders([{ id: "1", name: "A", items: ["x", 2] }, { id: 3 }]), [{ id: "1", name: "A", items: ["x"] }]);
});
