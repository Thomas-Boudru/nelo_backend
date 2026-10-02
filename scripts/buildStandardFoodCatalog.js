const fs = require("node:fs");
const path = require("node:path");

const sourcePath = process.argv[2];

if (!sourcePath) {
  throw new Error("Provide the path to the frontend data/foods.js file.");
}

const source = fs.readFileSync(path.resolve(sourcePath), "utf8");

const start = source.indexOf("export const FOODS = [");

if (start < 0) {
  throw new Error("The FOODS catalogue was not found.");
}

const catalogueSource = source.slice(start);

const matches = [
  ...catalogueSource.matchAll(
    /\bid:\s*"([^"]+)"\s*,\s*translationKey:\s*"([^"]+)"/g,
  ),
];

if (matches.length === 0) {
  throw new Error("No standard foods were found.");
}

const catalogue = {};

for (const [, id, translationKey] of matches) {
  if (Object.hasOwn(catalogue, id)) {
    throw new Error(`Duplicate standard food ID: ${id}`);
  }

  catalogue[id] = { translationKey };
}

const destination = path.resolve(__dirname, "../data/standardFoodCatalog.json");

fs.mkdirSync(path.dirname(destination), { recursive: true });

fs.writeFileSync(destination, `${JSON.stringify(catalogue, null, 2)}\n`);

console.log(`Standard food catalogue generated: ${matches.length} foods.`);
