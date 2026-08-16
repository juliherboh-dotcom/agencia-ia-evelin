/**
 * Nodo n8n: "0. Preparar publicaciones queued"
 * Tipo: Code (JavaScript, "Run Once for All Items")
 *
 * Toma las publications recién creadas por Capa 5 (status='queued') y las
 * deja listas para publicar: valida que la cuenta esté conectada, arma el
 * caption final (caption + hashtags), calcula scheduled_at respetando
 * timezone del cliente y espaciado mínimo entre publicaciones.
 *
 * Env vars usadas: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
 */
const SUPABASE_URL = $env.SUPABASE_URL;
const SUPABASE_HEADERS = {
  apikey: $env.SUPABASE_SERVICE_ROLE_KEY,
  Authorization: `Bearer ${$env.SUPABASE_SERVICE_ROLE_KEY}`,
  'Content-Type': 'application/json',
};

const MAX_CAPTION_LENGTH = 2200;

// Convierte "año/mes/día/hora local en timeZone" a un Date UTC exacto,
// sin hardcodear el offset (que cambia con horario de verano). Es un
// truco estándar: formateamos un UTC tentativo EN timeZone, medimos la
// diferencia contra lo que queríamos, y corregimos.
// Limitación conocida: en el día exacto de un cambio de horario de
// verano el resultado puede quedar corrido en 1h -- aceptable para una
// heurística de "mejor horario", no crítico.
const zonedHourToUtcDate = (year, month, day, hourLocal, timeZone) => {
  const tentative = new Date(Date.UTC(year, month - 1, day, hourLocal, 0, 0));
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hour12: false,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
  });
  const parts = Object.fromEntries(formatter.formatToParts(tentative).map((p) => [p.type, p.value]));
  const hour24 = Number(parts.hour) === 24 ? 0 : Number(parts.hour);
  const asIfLocal = Date.UTC(Number(parts.year), Number(parts.month) - 1, Number(parts.day), hour24, Number(parts.minute), Number(parts.second));
  const diff = tentative.getTime() - asIfLocal;
  return new Date(tentative.getTime() + diff);
};

const localDateParts = (date, timeZone) => {
  const formatter = new Intl.DateTimeFormat('en-US', { timeZone, hour12: false, year: 'numeric', month: '2-digit', day: '2-digit' });
  const parts = Object.fromEntries(formatter.formatToParts(date).map((p) => [p.type, p.value]));
  return { year: Number(parts.year), month: Number(parts.month), day: Number(parts.day) };
};

const computeScheduledAt = (client, lastPublication) => {
  const now = new Date();
  const { year, month, day } = localDateParts(now, client.timezone);
  let target = zonedHourToUtcDate(year, month, day, client.default_publish_hour_local, client.timezone);

  if (target <= now) {
    // ya pasó el horario de hoy -- programar para mañana a la misma hora local
    const tomorrow = localDateParts(new Date(target.getTime() + 24 * 3600 * 1000), client.timezone);
    target = zonedHourToUtcDate(tomorrow.year, tomorrow.month, tomorrow.day, client.default_publish_hour_local, client.timezone);
  }

  if (lastPublication) {
    const lastTime = new Date(lastPublication.scheduled_at || lastPublication.published_at).getTime();
    const minGapMs = client.min_hours_between_posts * 3600 * 1000;
    if (target.getTime() - lastTime < minGapMs) {
      target = new Date(lastTime + minGapMs);
    }
  }

  return target.toISOString();
};

const queued = await this.helpers.httpRequest({
  method: 'GET',
  url: `${SUPABASE_URL}/rest/v1/publications?status=eq.queued&select=id,client_id,platform,render_id,caption_used,hashtags_used`,
  headers: SUPABASE_HEADERS,
  json: true,
});

const results = [];

for (const pub of queued) {
  const accounts = await this.helpers.httpRequest({
    method: 'GET',
    url: `${SUPABASE_URL}/rest/v1/social_accounts?client_id=eq.${pub.client_id}&platform=eq.${pub.platform}&status=eq.active&select=id,publisher_provider,external_account_id`,
    headers: SUPABASE_HEADERS,
    json: true,
  });
  const account = accounts[0];

  if (!account) {
    await this.helpers.httpRequest({
      method: 'PATCH',
      url: `${SUPABASE_URL}/rest/v1/publications?id=eq.${pub.id}`,
      headers: SUPABASE_HEADERS,
      body: { status: 'failed', error_message: `No hay una cuenta activa de ${pub.platform} conectada para este cliente`, updated_at: new Date().toISOString() },
      json: true,
    });
    results.push({ publication_id: pub.id, outcome: 'failed_no_account' });
    continue;
  }

  const finalCaption = [pub.caption_used || '', pub.hashtags_used || ''].filter(Boolean).join('\n\n').trim();

  if (!finalCaption) {
    await this.helpers.httpRequest({
      method: 'PATCH',
      url: `${SUPABASE_URL}/rest/v1/publications?id=eq.${pub.id}`,
      headers: SUPABASE_HEADERS,
      body: { status: 'failed', error_message: 'Caption vacío -- no hay nada que publicar', updated_at: new Date().toISOString() },
      json: true,
    });
    results.push({ publication_id: pub.id, outcome: 'failed_empty_caption' });
    continue;
  }

  const truncatedCaption = finalCaption.length > MAX_CAPTION_LENGTH
    ? `${finalCaption.slice(0, MAX_CAPTION_LENGTH - 1)}…`
    : finalCaption;

  const clients = await this.helpers.httpRequest({
    method: 'GET',
    url: `${SUPABASE_URL}/rest/v1/clients?id=eq.${pub.client_id}&select=timezone,default_publish_hour_local,min_hours_between_posts`,
    headers: SUPABASE_HEADERS,
    json: true,
  });
  const client = clients[0] || { timezone: 'America/Santiago', default_publish_hour_local: 10, min_hours_between_posts: 4 };

  const lastRows = await this.helpers.httpRequest({
    method: 'GET',
    url: `${SUPABASE_URL}/rest/v1/publications?client_id=eq.${pub.client_id}&platform=eq.${pub.platform}&status=in.(scheduled,published)&order=scheduled_at.desc.nullslast&limit=1&select=scheduled_at,published_at`,
    headers: SUPABASE_HEADERS,
    json: true,
  });
  const scheduledAt = computeScheduledAt(client, lastRows[0] || null);

  await this.helpers.httpRequest({
    method: 'PATCH',
    url: `${SUPABASE_URL}/rest/v1/publications?id=eq.${pub.id}`,
    headers: SUPABASE_HEADERS,
    body: {
      status: 'ready_to_schedule',
      caption_used: truncatedCaption,
      provider: account.publisher_provider,
      account_id: account.id,
      scheduled_at: scheduledAt,
      updated_at: new Date().toISOString(),
    },
    json: true,
  });

  results.push({ publication_id: pub.id, outcome: 'ready_to_schedule', scheduled_at: scheduledAt });
}

return results.map((r) => ({ json: r }));
