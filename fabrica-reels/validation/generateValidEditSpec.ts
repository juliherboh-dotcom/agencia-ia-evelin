import { validateEditSpec, type EditSpecValidationError } from "./validateEditSpec";
import { buildRepairPrompt } from "./repair-prompt";
import type { EditSpec } from "../schema/edit-spec.zod";

const MAX_REPAIR_ATTEMPTS = 3;

export type GenerateValidEditSpecResult =
  | { ok: true; spec: EditSpec; attempts: number }
  | { ok: false; lastErrors: EditSpecValidationError[]; attempts: number };

/**
 * Bucle de reparación: valida el JSON que salió del Edit Director y, si es
 * inválido, le pide al LLM que lo corrija hasta 3 veces antes de rendirse.
 *
 * `callLlm` se inyecta a propósito (no importa acá ningún SDK de Claude/
 * OpenAI) para que esta misma función se pueda correr tanto desde un nodo
 * Code de n8n como desde un microservicio propio — es agnóstica del motor
 * de LLM.
 *
 * Cuando devuelve ok:false después de 3 intentos, quien llama debe:
 *   1. marcar edit_specs.status = 'failed_validation'
 *   2. guardar lastErrors en edit_specs.validation_errors
 *   3. mandar una alerta a un humano (Telegram/WhatsApp) — no se reintenta
 *      indefinidamente ni se renderiza con datos inválidos.
 */
export async function generateValidEditSpec(
  callLlm: (system: string, user: string) => Promise<unknown>,
  firstAttemptJson: unknown
): Promise<GenerateValidEditSpecResult> {
  let current = firstAttemptJson;

  for (let attempt = 1; attempt <= MAX_REPAIR_ATTEMPTS; attempt++) {
    const result = validateEditSpec(current);

    if (result.valid) {
      return { ok: true, spec: result.data, attempts: attempt };
    }

    if (attempt === MAX_REPAIR_ATTEMPTS) {
      return { ok: false, lastErrors: result.errors, attempts: attempt };
    }

    const { system, user } = buildRepairPrompt(current, result.errors);
    current = await callLlm(system, user);
  }

  /* istanbul ignore next -- inalcanzable, el loop siempre retorna dentro del for */
  return { ok: false, lastErrors: [], attempts: MAX_REPAIR_ATTEMPTS };
}
