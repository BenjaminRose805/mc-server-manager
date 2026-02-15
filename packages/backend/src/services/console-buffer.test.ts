import { ConsoleBuffer } from "./console-buffer.js";

describe("ConsoleBuffer", () => {
  describe("push", () => {
    it("adds a line and returns ConsoleLine with timestamp", () => {
      const buffer = new ConsoleBuffer(5);
      const result = buffer.push("test line");

      expect(result).toHaveProperty("line", "test line");
      expect(result).toHaveProperty("timestamp");
      expect(typeof result.timestamp).toBe("string");
      // Verify it's a valid ISO 8601 timestamp
      expect(new Date(result.timestamp).toISOString()).toBe(result.timestamp);
    });
  });

  describe("getLines", () => {
    it("returns empty array when buffer is empty", () => {
      const buffer = new ConsoleBuffer(5);
      expect(buffer.getLines()).toEqual([]);
    });

    it("returns lines in chronological order", () => {
      const buffer = new ConsoleBuffer(5);
      buffer.push("line 1");
      buffer.push("line 2");
      buffer.push("line 3");

      const lines = buffer.getLines();
      expect(lines).toHaveLength(3);
      expect(lines[0].line).toBe("line 1");
      expect(lines[1].line).toBe("line 2");
      expect(lines[2].line).toBe("line 3");
    });

    it("buffer wraps around when capacity is exceeded", () => {
      const buffer = new ConsoleBuffer(5);

      // Push more than capacity
      buffer.push("line 1");
      buffer.push("line 2");
      buffer.push("line 3");
      buffer.push("line 4");
      buffer.push("line 5");
      buffer.push("line 6"); // This should overwrite line 1
      buffer.push("line 7"); // This should overwrite line 2

      const lines = buffer.getLines();

      // Should only have the last 5 lines
      expect(lines).toHaveLength(5);
      expect(lines[0].line).toBe("line 3");
      expect(lines[1].line).toBe("line 4");
      expect(lines[2].line).toBe("line 5");
      expect(lines[3].line).toBe("line 6");
      expect(lines[4].line).toBe("line 7");
    });
  });

  describe("getSize", () => {
    it("reflects actual count up to capacity", () => {
      const buffer = new ConsoleBuffer(5);

      expect(buffer.getSize()).toBe(0);

      buffer.push("line 1");
      expect(buffer.getSize()).toBe(1);

      buffer.push("line 2");
      buffer.push("line 3");
      expect(buffer.getSize()).toBe(3);

      buffer.push("line 4");
      buffer.push("line 5");
      expect(buffer.getSize()).toBe(5);

      // Push beyond capacity
      buffer.push("line 6");
      expect(buffer.getSize()).toBe(5); // Should stay at capacity

      buffer.push("line 7");
      expect(buffer.getSize()).toBe(5); // Should stay at capacity
    });
  });

  describe("clear", () => {
    it("resets the buffer", () => {
      const buffer = new ConsoleBuffer(5);

      buffer.push("line 1");
      buffer.push("line 2");
      buffer.push("line 3");

      expect(buffer.getSize()).toBe(3);
      expect(buffer.getLines()).toHaveLength(3);

      buffer.clear();

      expect(buffer.getSize()).toBe(0);
      expect(buffer.getLines()).toEqual([]);

      // Verify buffer works correctly after clear
      buffer.push("new line");
      expect(buffer.getSize()).toBe(1);
      expect(buffer.getLines()[0].line).toBe("new line");
    });
  });
});
