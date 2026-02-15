import { parseProperties, serializeProperties } from "./properties.js";

describe("Properties Parser", () => {
  describe("parseProperties", () => {
    it("parses basic key=value pairs", () => {
      const content = `server-port=25565
max-players=20
motd=A Minecraft Server`;

      const result = parseProperties(content);
      expect(result["server-port"]).toBe("25565");
      expect(result["max-players"]).toBe("20");
      expect(result["motd"]).toBe("A Minecraft Server");
    });

    it("handles comments (lines starting with #)", () => {
      const content = `#Minecraft server properties
#Sat Feb 14 2026
server-port=25565
# This is a comment
max-players=20`;

      const result = parseProperties(content);
      expect(result["server-port"]).toBe("25565");
      expect(result["max-players"]).toBe("20");
      expect(Object.keys(result)).toHaveLength(2);
    });

    it("handles empty values", () => {
      const content = `server-ip=
level-seed=
motd=A Server`;

      const result = parseProperties(content);
      expect(result["server-ip"]).toBe("");
      expect(result["level-seed"]).toBe("");
      expect(result["motd"]).toBe("A Server");
    });

    it("handles key=value with = in value", () => {
      const content = `motd=Welcome to Server=Best
formula=a=b+c`;

      const result = parseProperties(content);
      expect(result["motd"]).toBe("Welcome to Server=Best");
      expect(result["formula"]).toBe("a=b+c");
    });

    it("handles empty lines", () => {
      const content = `server-port=25565

max-players=20

motd=Server`;

      const result = parseProperties(content);
      expect(result["server-port"]).toBe("25565");
      expect(result["max-players"]).toBe("20");
      expect(result["motd"]).toBe("Server");
      expect(Object.keys(result)).toHaveLength(3);
    });

    it("preserves leading spaces in values but trims trailing", () => {
      const content = `motd=  A Server With Spaces  `;

      const result = parseProperties(content);
      expect(result["motd"]).toBe("  A Server With Spaces");
    });

    it("ignores lines without = sign", () => {
      const content = `server-port=25565
invalid line without equals
max-players=20`;

      const result = parseProperties(content);
      expect(result["server-port"]).toBe("25565");
      expect(result["max-players"]).toBe("20");
      expect(Object.keys(result)).toHaveLength(2);
    });
  });

  describe("serializeProperties", () => {
    it("serializes basic properties", () => {
      const props = {
        "server-port": "25565",
        "max-players": "20",
        motd: "A Minecraft Server",
      };

      const result = serializeProperties(props);
      expect(result).toContain("server-port=25565");
      expect(result).toContain("max-players=20");
      expect(result).toContain("motd=A Minecraft Server");
    });

    it("includes header comments", () => {
      const props = {
        "server-port": "25565",
      };

      const result = serializeProperties(props);
      expect(result).toContain("#Minecraft server properties");
      expect(result).toMatch(/#[A-Z][a-z]{2}, \d{2} [A-Z][a-z]{2} \d{4}/); // Date format
    });

    it("sorts properties alphabetically", () => {
      const props = {
        "z-prop": "last",
        "a-prop": "first",
        "m-prop": "middle",
      };

      const result = serializeProperties(props);
      const lines = result.split("\n").filter((l) => l && !l.startsWith("#"));
      expect(lines[0]).toBe("a-prop=first");
      expect(lines[1]).toBe("m-prop=middle");
      expect(lines[2]).toBe("z-prop=last");
    });

    it("handles empty values", () => {
      const props = {
        "server-ip": "",
        "level-seed": "",
      };

      const result = serializeProperties(props);
      expect(result).toContain("server-ip=");
      expect(result).toContain("level-seed=");
    });

    it("ends with newline", () => {
      const props = {
        "server-port": "25565",
      };

      const result = serializeProperties(props);
      expect(result.endsWith("\n")).toBe(true);
    });
  });

  describe("round-trip", () => {
    it("parse then serialize produces equivalent output", () => {
      const original = {
        "server-port": "25565",
        "max-players": "20",
        motd: "A Minecraft Server",
        "server-ip": "",
        "level-seed": "",
        pvp: "true",
        difficulty: "easy",
      };

      const serialized = serializeProperties(original);
      const parsed = parseProperties(serialized);

      expect(parsed).toEqual(original);
    });

    it("preserves unknown keys", () => {
      const content = `#Minecraft server properties
server-port=25565
custom-mod-property=value123
another-unknown=test`;

      const parsed = parseProperties(content);
      expect(parsed["server-port"]).toBe("25565");
      expect(parsed["custom-mod-property"]).toBe("value123");
      expect(parsed["another-unknown"]).toBe("test");

      const serialized = serializeProperties(parsed);
      const reparsed = parseProperties(serialized);

      expect(reparsed["custom-mod-property"]).toBe("value123");
      expect(reparsed["another-unknown"]).toBe("test");
    });
  });
});
