import {
  createServerSchema,
  updateServerSchema,
  updatePropertiesSchema,
} from "./validation.js";

describe("Validation Schemas", () => {
  describe("createServerSchema", () => {
    it("valid input passes", () => {
      const input = {
        name: "My Server",
        type: "vanilla",
        mcVersion: "1.21",
        port: 25565,
      };

      const result = createServerSchema.safeParse(input);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.name).toBe("My Server");
        expect(result.data.type).toBe("vanilla");
        expect(result.data.mcVersion).toBe("1.21");
        expect(result.data.port).toBe(25565);
      }
    });

    it("missing name fails", () => {
      const input = {
        type: "vanilla",
        mcVersion: "1.21",
      };

      const result = createServerSchema.safeParse(input);
      expect(result.success).toBe(false);
    });

    it("name over 100 chars fails", () => {
      const input = {
        name: "a".repeat(101),
        type: "vanilla",
        mcVersion: "1.21",
      };

      const result = createServerSchema.safeParse(input);
      expect(result.success).toBe(false);
    });

    it("invalid port below 1024 fails", () => {
      const input = {
        name: "My Server",
        type: "vanilla",
        mcVersion: "1.21",
        port: 1023,
      };

      const result = createServerSchema.safeParse(input);
      expect(result.success).toBe(false);
    });

    it("invalid port above 65535 fails", () => {
      const input = {
        name: "My Server",
        type: "vanilla",
        mcVersion: "1.21",
        port: 65536,
      };

      const result = createServerSchema.safeParse(input);
      expect(result.success).toBe(false);
    });

    it("non-integer port fails", () => {
      const input = {
        name: "My Server",
        type: "vanilla",
        mcVersion: "1.21",
        port: 25565.5,
      };

      const result = createServerSchema.safeParse(input);
      expect(result.success).toBe(false);
    });

    it("type defaults to vanilla", () => {
      const input = {
        name: "My Server",
        mcVersion: "1.21",
      };

      const result = createServerSchema.safeParse(input);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.type).toBe("vanilla");
      }
    });

    it("port defaults to 25565", () => {
      const input = {
        name: "My Server",
        mcVersion: "1.21",
      };

      const result = createServerSchema.safeParse(input);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.port).toBe(25565);
      }
    });

    it("jvmArgs defaults to -Xmx2G -Xms1G", () => {
      const input = {
        name: "My Server",
        mcVersion: "1.21",
      };

      const result = createServerSchema.safeParse(input);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.jvmArgs).toBe("-Xmx2G -Xms1G");
      }
    });

    it("javaPath defaults to java", () => {
      const input = {
        name: "My Server",
        mcVersion: "1.21",
      };

      const result = createServerSchema.safeParse(input);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.javaPath).toBe("java");
      }
    });
  });

  describe("updateServerSchema", () => {
    it("empty object passes (all optional)", () => {
      const input = {};

      const result = updateServerSchema.safeParse(input);
      expect(result.success).toBe(true);
    });

    it("valid partial update passes", () => {
      const input = {
        name: "Updated Server",
      };

      const result = updateServerSchema.safeParse(input);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.name).toBe("Updated Server");
      }
    });

    it("invalid port below 1024 fails", () => {
      const input = {
        port: 1023,
      };

      const result = updateServerSchema.safeParse(input);
      expect(result.success).toBe(false);
    });

    it("invalid port above 65535 fails", () => {
      const input = {
        port: 65536,
      };

      const result = updateServerSchema.safeParse(input);
      expect(result.success).toBe(false);
    });

    it("non-integer port fails", () => {
      const input = {
        port: 25565.5,
      };

      const result = updateServerSchema.safeParse(input);
      expect(result.success).toBe(false);
    });

    it("valid port passes", () => {
      const input = {
        port: 25566,
      };

      const result = updateServerSchema.safeParse(input);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.port).toBe(25566);
      }
    });
  });

  describe("updatePropertiesSchema", () => {
    it("valid record passes", () => {
      const input = {
        properties: {
          "server-port": "25565",
          "max-players": "20",
          motd: "A Minecraft Server",
        },
      };

      const result = updatePropertiesSchema.safeParse(input);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.properties["server-port"]).toBe("25565");
        expect(result.data.properties["max-players"]).toBe("20");
        expect(result.data.properties["motd"]).toBe("A Minecraft Server");
      }
    });

    it("empty key fails", () => {
      const input = {
        properties: {
          "": "value",
        },
      };

      const result = updatePropertiesSchema.safeParse(input);
      expect(result.success).toBe(false);
    });

    it("empty properties object passes", () => {
      const input = {
        properties: {},
      };

      const result = updatePropertiesSchema.safeParse(input);
      expect(result.success).toBe(true);
    });

    it("property values can be empty strings", () => {
      const input = {
        properties: {
          "server-ip": "",
          "level-seed": "",
        },
      };

      const result = updatePropertiesSchema.safeParse(input);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.properties["server-ip"]).toBe("");
        expect(result.data.properties["level-seed"]).toBe("");
      }
    });
  });
});
