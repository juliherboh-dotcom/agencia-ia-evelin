/**
 * Render local de prueba, para desarrollo de templates.
 *
 * Uso:
 *   npm run render:local
 *   npm run render:local -- ./ruta/a/otro-edit-spec.json
 */
import path from "path";
import fs from "fs";
import { validateEditSpec } from "../../../validation/validateEditSpec";
import { renderEditSpec } from "./renderEditSpec";

async function main() {
  const specPath = process.argv[2] ?? path.join(__dirname, "../../sample-data/example-edit-spec.json");
  const rawSpec = JSON.parse(fs.readFileSync(specPath, "utf-8"));

  const validation = validateEditSpec(rawSpec);
  if (!validation.valid) {
    console.error(`❌ ${specPath} es un edit_spec inválido, no se renderiza:`);
    validation.errors.forEach((e) => console.error(`  - [${e.path}] ${e.message}`));
    process.exit(1);
  }

  const outputLocation = path.join(
    __dirname,
    `../../out/${validation.data.video_id}-${validation.data.platform}.mp4`
  );
  fs.mkdirSync(path.dirname(outputLocation), { recursive: true });

  console.log(`🎬 Renderizando ${validation.data.video_id} (${validation.data.template_id})...`);
  await renderEditSpec(validation.data, outputLocation);
  console.log(`✅ Render listo: ${outputLocation}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
