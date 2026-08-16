// Lógica compartida de autenticación con Supabase para Nexo.IA.
// Requiere que supabase-config.js y el SDK de Supabase ya estén cargados.
(function () {
  function getClient() {
    if (!window.supabase || !window.supabase.createClient) {
      console.error("Nexo.IA: no se pudo cargar el SDK de Supabase.");
      return null;
    }
    if (!window.__nexoSupabaseClient) {
      window.__nexoSupabaseClient = window.supabase.createClient(
        window.NEXO_SUPABASE_URL,
        window.NEXO_SUPABASE_ANON_KEY
      );
    }
    return window.__nexoSupabaseClient;
  }

  function mensajeError(error) {
    if (!error) return "Ocurrió un error inesperado. Intenta de nuevo.";
    const mapa = {
      "Invalid login credentials": "Correo o contraseña incorrectos.",
      "User already registered": "Ya existe una cuenta con ese correo.",
      "Email not confirmed": "Debes confirmar tu correo antes de iniciar sesión.",
      "Password should be at least 6 characters": "La contraseña debe tener al menos 6 caracteres.",
    };
    return mapa[error.message] || error.message;
  }

  async function iniciarSesionConGoogle() {
    const client = getClient();
    if (!client) return;
    await client.auth.signInWithOAuth({
      provider: "google",
      options: { redirectTo: window.location.origin + "/" },
    });
  }

  // Refleja el estado de sesión en el encabezado (enlace "Iniciar sesión"
  // vs. correo + botón de cerrar sesión), en cualquier página del sitio.
  async function actualizarEncabezadoAuth() {
    const client = getClient();
    const contenedor = document.querySelector("[data-auth-nav]");
    if (!client || !contenedor) return;

    const {
      data: { session },
    } = await client.auth.getSession();

    if (session && session.user) {
      const correo = session.user.email || "Mi cuenta";
      contenedor.innerHTML =
        '<span class="wordmark__auth-correo">' + correo + '</span>' +
        '<button type="button" class="wordmark__auth-link" data-cerrar-sesion>Cerrar sesión</button>';
      const boton = contenedor.querySelector("[data-cerrar-sesion]");
      boton.addEventListener("click", async () => {
        await client.auth.signOut();
        window.location.href = "/";
      });
    } else {
      contenedor.innerHTML =
        '<a class="wordmark__auth-link" href="/inicio-sesion">Iniciar sesión</a>';
    }
  }

  window.NexoAuth = {
    getClient,
    mensajeError,
    iniciarSesionConGoogle,
    actualizarEncabezadoAuth,
  };

  document.addEventListener("DOMContentLoaded", actualizarEncabezadoAuth);
})();
