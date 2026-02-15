import {
  compareMcVersions,
  getMinJavaForMcVersion,
  getJavaMajorVersion,
  checkJavaMcCompat,
  MC_JAVA_COMPAT,
} from "./index.js";

describe("compareMcVersions", () => {
  it("returns 0 for equal versions", () => {
    expect(compareMcVersions("1.20", "1.20")).toBe(0);
    expect(compareMcVersions("1.20.1", "1.20.1")).toBe(0);
    expect(compareMcVersions("1.9", "1.9")).toBe(0);
  });

  it("compares numerically not lexicographically (1.20 > 1.9)", () => {
    expect(compareMcVersions("1.20", "1.9")).toBeGreaterThan(0);
    expect(compareMcVersions("1.9", "1.20")).toBeLessThan(0);
  });

  it("compares patch versions correctly (1.20.1 > 1.20)", () => {
    expect(compareMcVersions("1.20.1", "1.20")).toBeGreaterThan(0);
    expect(compareMcVersions("1.20", "1.20.1")).toBeLessThan(0);
  });

  it("handles versions with different segment counts (1.20 vs 1.20.0)", () => {
    expect(compareMcVersions("1.20", "1.20.0")).toBe(0);
    expect(compareMcVersions("1.20.0", "1.20")).toBe(0);
  });

  it("compares minor versions correctly (1.0 < 1.1)", () => {
    expect(compareMcVersions("1.0", "1.1")).toBeLessThan(0);
    expect(compareMcVersions("1.1", "1.0")).toBeGreaterThan(0);
  });

  it("handles multi-digit segments correctly", () => {
    expect(compareMcVersions("1.21.11", "1.21.2")).toBeGreaterThan(0);
    expect(compareMcVersions("1.21.2", "1.21.11")).toBeLessThan(0);
  });
});

describe("getMinJavaForMcVersion", () => {
  it("returns Java 21 for MC 1.21", () => {
    const result = getMinJavaForMcVersion("1.21");
    expect(result).not.toBeNull();
    expect(result?.minJava).toBe(21);
    expect(result?.label).toBe("Java 21+");
  });

  it("returns Java 17 for MC 1.20.4", () => {
    const result = getMinJavaForMcVersion("1.20.4");
    expect(result).not.toBeNull();
    expect(result?.minJava).toBe(17);
    expect(result?.label).toBe("Java 17+");
  });

  it("returns Java 8 for MC 1.16.5", () => {
    const result = getMinJavaForMcVersion("1.16.5");
    expect(result).not.toBeNull();
    expect(result?.minJava).toBe(8);
    expect(result?.label).toBe("Java 8+");
  });

  it("returns highest known requirement for unknown high version", () => {
    const result = getMinJavaForMcVersion("1.99.99");
    expect(result).not.toBeNull();
    expect(result?.minJava).toBe(21);
    expect(result?.label).toBe("Java 21+");
  });

  it("returns Java 8 for very old version", () => {
    const result = getMinJavaForMcVersion("1.8.9");
    expect(result).not.toBeNull();
    expect(result?.minJava).toBe(8);
    expect(result?.label).toBe("Java 8+");
  });

  it("handles snapshot versions by stripping suffix", () => {
    const result = getMinJavaForMcVersion("1.21-pre1");
    expect(result).not.toBeNull();
    expect(result?.minJava).toBe(21);
  });

  it("handles versions with underscores", () => {
    const result = getMinJavaForMcVersion("1.20_experimental");
    expect(result).not.toBeNull();
    expect(result?.minJava).toBe(17);
  });
});

describe("getJavaMajorVersion", () => {
  it("extracts major version from old format (1.8.0_392 -> 8)", () => {
    expect(getJavaMajorVersion("1.8.0_392")).toBe(8);
  });

  it("extracts major version from new format (21.0.1 -> 21)", () => {
    expect(getJavaMajorVersion("21.0.1")).toBe(21);
  });

  it("extracts major version from Java 17 format (17.0.2 -> 17)", () => {
    expect(getJavaMajorVersion("17.0.2")).toBe(17);
  });

  it("handles Java 11 format", () => {
    expect(getJavaMajorVersion("11.0.15")).toBe(11);
  });

  it("handles old Java 7 format", () => {
    expect(getJavaMajorVersion("1.7.0_80")).toBe(7);
  });
});

describe("checkJavaMcCompat", () => {
  it("returns null for compatible pair (Java 21 + MC 1.21)", () => {
    const result = checkJavaMcCompat("21.0.1", "1.21");
    expect(result).toBeNull();
  });

  it("returns warning string for incompatible pair (Java 8 + MC 1.21)", () => {
    const result = checkJavaMcCompat("1.8.0_392", "1.21");
    expect(result).not.toBeNull();
    expect(result).toContain("Minecraft 1.21");
    expect(result).toContain("Java 21+");
    expect(result).toContain("1.8.0_392");
    expect(result).toContain("Java 8");
  });

  it("returns null for compatible old pair (Java 8 + MC 1.16.5)", () => {
    const result = checkJavaMcCompat("1.8.0_392", "1.16.5");
    expect(result).toBeNull();
  });

  it("returns null for compatible pair (Java 17 + MC 1.20.4)", () => {
    const result = checkJavaMcCompat("17.0.2", "1.20.4");
    expect(result).toBeNull();
  });

  it("returns warning for Java 8 with MC 1.20", () => {
    const result = checkJavaMcCompat("1.8.0_392", "1.20");
    expect(result).not.toBeNull();
    expect(result).toContain("Java 17+");
  });

  it("returns null for higher Java version than required", () => {
    const result = checkJavaMcCompat("21.0.1", "1.16.5");
    expect(result).toBeNull();
  });

  it("handles snapshot versions", () => {
    const result = checkJavaMcCompat("21.0.1", "1.21-pre1");
    expect(result).toBeNull();
  });
});

describe("MC_JAVA_COMPAT constant", () => {
  it("is sorted newest-first", () => {
    expect(MC_JAVA_COMPAT[0].minMcVersion).toBe("1.21");
    expect(MC_JAVA_COMPAT[1].minMcVersion).toBe("1.17");
    expect(MC_JAVA_COMPAT[2].minMcVersion).toBe("1.0");
  });

  it("has correct Java requirements", () => {
    expect(MC_JAVA_COMPAT[0].minJava).toBe(21);
    expect(MC_JAVA_COMPAT[1].minJava).toBe(17);
    expect(MC_JAVA_COMPAT[2].minJava).toBe(8);
  });

  it("has labels for each entry", () => {
    expect(MC_JAVA_COMPAT[0].label).toBe("Java 21+");
    expect(MC_JAVA_COMPAT[1].label).toBe("Java 17+");
    expect(MC_JAVA_COMPAT[2].label).toBe("Java 8+");
  });
});
