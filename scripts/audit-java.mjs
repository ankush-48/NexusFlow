import { readFile } from "node:fs/promises";

// Input is Maven dependency:tree's JSON output for the runtime scope.
async function audit(paths) {
  if (!paths.length) throw new Error("Pass at least one Maven runtime dependency tree JSON file.");
  const packages = new Map();
  function include(node) {
    if (!node.groupId || !node.artifactId || !node.version) throw new Error("Incomplete Maven coordinate.");
    const name = node.groupId + ":" + node.artifactId;
    packages.set(name + "@" + node.version, { package: { ecosystem: "Maven", name }, version: node.version });
    for (const child of node.children ?? []) include(child);
  }
  for (const path of paths) {
    const root = JSON.parse(await readFile(path, "utf8"));
    if (!root.children?.length) throw new Error("Empty runtime dependency tree in " + path);
    root.children.forEach(include);
  }
  const queries = [...packages.values()];
  let affected = 0;
  for (let start = 0; start < queries.length; start += 100) {
    const batch = queries.slice(start, start + 100);
    const response = await fetch("https://api.osv.dev/v1/querybatch", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ queries: batch }),
      signal: AbortSignal.timeout(45000),
    });
    if (!response.ok) throw new Error("OSV returned HTTP " + response.status);
    const { results } = await response.json();
    if (!Array.isArray(results) || results.length !== batch.length) throw new Error("Incomplete OSV response.");
    for (const [index, result] of results.entries()) {
      if (!result.vulns?.length && !result.next_page_token) continue;
      const { package: item, version } = batch[index];
      console.error(item.name, version, (result.vulns ?? []).map((match) => match.id).join(", "));
      affected++;
    }
  }
  console.log("Checked " + packages.size + " runtime package versions. Advisory matches on " + affected + ".");
  if (affected) process.exitCode = 1;
}

audit(process.argv.slice(2)).catch((error) => {
  console.error("Audit could not complete.", error.message);
  process.exitCode = 2;
});
