/**
 * Ring buffer for server console output.
 *
 * Stores a fixed number of timestamped lines. When the buffer is full,
 * the oldest lines are overwritten. This keeps memory bounded even when
 * a server emits thousands of lines (e.g. during world generation).
 */

export interface ConsoleLine {
  line: string;
  timestamp: string; // ISO 8601
}

const DEFAULT_CAPACITY = 1000;

export class ConsoleBuffer {
  private buffer: (ConsoleLine | undefined)[];
  private head = 0; // next write position
  private size = 0;

  constructor(private capacity: number = DEFAULT_CAPACITY) {
    this.buffer = new Array(capacity);
  }

  /**
   * Push a line into the buffer.
   * If the buffer is full, the oldest line is overwritten.
   */
  push(line: string): ConsoleLine {
    const entry: ConsoleLine = {
      line,
      timestamp: new Date().toISOString(),
    };
    this.buffer[this.head] = entry;
    this.head = (this.head + 1) % this.capacity;
    if (this.size < this.capacity) {
      this.size++;
    }
    return entry;
  }

  /**
   * Get all lines in chronological order.
   */
  getLines(): ConsoleLine[] {
    if (this.size === 0) return [];

    const lines: ConsoleLine[] = [];
    // Start reading from the oldest entry
    const start = this.size < this.capacity ? 0 : this.head;
    for (let i = 0; i < this.size; i++) {
      const idx = (start + i) % this.capacity;
      const entry = this.buffer[idx];
      if (entry) {
        lines.push(entry);
      }
    }
    return lines;
  }

  /**
   * Clear all lines.
   */
  clear(): void {
    this.buffer = new Array(this.capacity);
    this.head = 0;
    this.size = 0;
  }

  /**
   * Current number of lines stored.
   */
  getSize(): number {
    return this.size;
  }
}
